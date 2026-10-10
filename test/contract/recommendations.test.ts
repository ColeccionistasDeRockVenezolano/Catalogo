import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { describe,it,expect,beforeAll,beforeEach,afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer,type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { getPool,closeDb,getDb } from "../../src/db/client.js";
import { migrateUp } from "../../src/db/migrate.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { importTrackContexts } from "../../src/discovery/track-context-curation.js";
import { recommend,recordRecommendationFeedback,importRecommendationVersions,recommendationFeedbackReport } from "../../src/discovery/recommendations.js";
import { evaluateRecommendations } from "../../src/discovery/recommendation-evaluation.js";
import { recommendationRequests } from "../../src/db/schema/recommendations.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRunWithJournal } from "../../src/merge/journal-undo.js";
import { mergeInto } from "../../src/review/duplicates.js";
const token="recommendation-tests-token-0123456789";
describe("etapa 4: recomendación SQL, evidencia, feedback y evaluación",()=> {
  let pg:PgContainer,app:FastifyInstance,source:number;
  const tracks:number[]=[],albums:number[]=[],artists:number[]=[],evidenceIds:number[]=[];
  let seq=0;
  const headers={authorization:`Bearer ${token}`,"x-crv-operator":"QA"};
  const request=(patch:Record<string,unknown>={})=>({intent:{requiredLabels:["serene"]},limit:3,maxPerArtist:2,...patch});
  async function evidence(track:number,field="discovery_context:serene",value="Revisión específica") {
    seq++;
    const c=(await getPool().query(`INSERT INTO ingest.claims(source_id,entity_kind,identity_key,field,raw_value,raw_hash,extractor,extractor_version,track_id)
      VALUES($1,'track',$2,$3,$4,$5,'qa','1',$6) RETURNING id`,[source,`rec-${seq}`,field,JSON.stringify(value),seq.toString(16).padStart(64,"0"),track])).rows[0].id;
    return Number((await getPool().query("INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,evidence_hash) VALUES($1,'https://fixture.invalid/review','Descripción revisada de esta edición',$2) RETURNING id",[c,seq.toString(16).padStart(64,"0")])).rows[0].id);
  }
  const decision=(i:number,patch:Record<string,unknown>={})=>({key:`d-${i}`,trackId:tracks[i],expectedTitle:"Mismo título",expectedAlbumId:albums[i],label:"serene",evidenceId:evidenceIds[i],confidence:"medium",methodVersion:"context-editorial-v1",proposalKey:null,state:"approved",reason:"Serenidad documentada de esta edición",validFrom:"2020-01-01T00:00:00Z",validUntil:null,...patch});
  const approve=async(indices=[0,1,2,3])=>importTrackContexts({batch:"rec",reviewer:"QA",note:"Revisión fixture",decisions:indices.map(i=>decision(i))},true);
  const snapshot=()=>execFileSync("docker",["exec",pg.name,"pg_dump","-U","postgres","-d","postgres","--schema=public","--schema-only"],{encoding:"utf8"}).split("\n").filter(l=>!/^\\(un)?restrict/u.test(l)).join("\n");
  beforeAll(async()=> {
    pg=await startPgContainer(); process.env["DATABASE_URL"]=pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"]=token;
    process.env["CRV_RECOMMENDATIONS_ENABLED"]="true"; process.env["CRV_CURATION_AUTOSCAN"]="false"; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    source=Number((await getPool().query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('qa-rec','QA','database','high') RETURNING id")).rows[0].id);
    for (let i=0;i<3;i++) artists.push(Number((await getPool().query("INSERT INTO artists(name) VALUES($1) RETURNING id",[`Artista fixture ${i}`])).rows[0].id));
    for (let i=0;i<4;i++) {
      albums.push(Number((await getPool().query("INSERT INTO albums(artist_id,title,release_year) VALUES($1,$2,$3) RETURNING id",[artists[Math.max(0,i-1)],`Edición ${i}`,1990+i])).rows[0].id));
      tracks.push(Number((await getPool().query("INSERT INTO tracks(album_id,track_number,title) VALUES($1,1,'Mismo título') RETURNING id",[albums[i]])).rows[0].id));
      evidenceIds.push(await evidence(tracks[i]!));
    }
    app=await buildApp();
  });
  beforeEach(async()=> {
    process.env["CRV_RECOMMENDATIONS_ENABLED"]="true"; resetEnvCache();
    await getPool().query("DELETE FROM ingest.recommendation_feedback"); await getPool().query("DELETE FROM ingest.recommendation_requests");
    await getPool().query("DELETE FROM ingest.recommendation_versions"); await getPool().query("DELETE FROM ingest.track_context_evaluations");
    await getPool().query("DELETE FROM ingest.track_context_assignments");
  });
  afterAll(async()=> {
    await app?.close(); await closeDb();
    for (const key of ["CRV_OPERATOR_TOKEN","CRV_RECOMMENDATIONS_ENABLED","CRV_CURATION_AUTOSCAN"]) delete process.env[key];
    resetEnvCache(); await pg?.stop();
  });
  it("migración repetible, rollback propio, Drizzle, public intacto y desactivación compatible",async()=> {
    const before=snapshot();
    await getPool().query(await readFile("migrations/0056_discovery_recommendations.up.sql","utf8"));
    expect((await migrateUp()).applied).toEqual([]); expect(await getDb().select().from(recommendationRequests)).toEqual([]);
    await getPool().query(await readFile("migrations/0056_discovery_recommendations.down.sql","utf8"));
    expect((await recommend(request(),"QA")).status).toBe("disabled"); expect(snapshot()).toBe(before);
    expect((await migrateUp()).applied).toEqual(["0056_discovery_recommendations"]); expect(snapshot()).toBe(before);
    process.env["CRV_RECOMMENDATIONS_ENABLED"]="false"; resetEnvCache();
    const result=await recommend(request(),"QA",true); expect(result.status).toBe("disabled"); expect(result.requestId).toBeNull();
    expect((await app.inject("/search?q=fixture")).statusCode).toBe(200);
  });
  it("solo aprobaciones vigentes y evidencias utilizables; razón y metadatos del backend",async()=> {
    expect((await recommend(request(),"QA")).status).toBe("insufficient_coverage");
    await approve();
    const result=await recommend(request(),"QA");
    expect(result.status).toBe("ok"); expect(result.results.map(x=>x.id)).toEqual([tracks[0],tracks[2],tracks[3]]);
    expect(result.diversity).toBe(1); expect(result.results[0]?.reasons[0]).toMatchObject({evidenceId:evidenceIds[0],slug:"serene",sourceId:source});
    expect(result.results[0]?.title).toBe("Mismo título");
    for (const patch of [{state:"withdrawn"},{state:"rejected"},{validFrom:"2099-01-01T00:00:00Z"},{validUntil:"2021-01-01T00:00:00Z"}]) {
      await importTrackContexts({batch:"rec",reviewer:"QA",note:"Retiro",decisions:[decision(0,patch)]},true);
      expect((await recommend(request(),"QA")).results.some(x=>x.id===tracks[0])).toBe(false);
    }
    await approve();
    await getPool().query("UPDATE ingest.claims SET status='conflict' WHERE id=(SELECT claim_id FROM ingest.claim_evidence WHERE id=$1)",[evidenceIds[0]]);
    expect((await recommend(request(),"QA")).results.some(x=>x.id===tracks[0])).toBe(false);
    await getPool().query("UPDATE ingest.claims SET status='candidate' WHERE id=(SELECT claim_id FROM ingest.claim_evidence WHERE id=$1)",[evidenceIds[0]]);
  });
  it("aplica todas las restricciones sin relajar cobertura, no deduce negativos ni géneros de pista",async()=> {
    await approve();
    for (const intent of [{requiredLabels:["serene","joyful"]},{requiredLabels:["serene"],excludedLabels:["tense"]},{artistIds:[999999]},{yearFrom:2099},{albumIds:[999999]},{seedArtistId:artists[0]}]) {
      expect((await recommend(request({intent}),"QA")).status).toBe("insufficient_coverage");
    }
    const tense=await evidence(tracks[0]!,"discovery_context:tense");
    await importTrackContexts({batch:"rec",reviewer:"QA",note:"Revisión explícita del criterio excluido",decisions:[decision(0,{key:"no-tense",label:"tense",state:"rejected",evidenceId:tense})]},true);
    const negative=await recommend(request({intent:{requiredLabels:["serene"],excludedLabels:["tense"]}}),"QA");
    expect(negative.results.map(x=>x.id)).toEqual([tracks[0]]); expect(negative.results[0]?.excludedLabelEvidence[0]).toMatchObject({slug:"tense",evidenceId:tense});
    const constrained=await recommend(request({intent:{artistIds:[artists[1]],yearFrom:1992,yearUntil:1992,albumIds:[albums[2]]}}),"QA");
    expect(constrained.results.map(x=>x.id)).toEqual([tracks[2]]); expect(constrained.status).toBe("partial");
    expect((await recommend(request({intent:{excludeTrackIds:[tracks[0]],excludeArtistIds:[artists[1]]},limit:20,maxPerArtist:1}),"QA")).results.map(x=>x.id)).toEqual([tracks[1],tracks[3]]);
  });
  it("reutiliza relaciones actuales y sigue exigiendo contextos aprobados",async()=> {
    const relation=(await getPool().query(`INSERT INTO ingest.artist_relations(from_artist_id,to_artist_id,relation_type,evidence_note,source_urls,confidence,reviewed_by)
      VALUES($1,$2,'successor','Continuidad documentada en fixture',ARRAY['https://fixture.invalid/lineage'],'high','QA') RETURNING id`,[artists[0],artists[1]])).rows[0].id;
    expect((await recommend(request({intent:{seedArtistId:artists[0]}}),"QA")).status).toBe("insufficient_coverage");
    await approve();
    const result=await recommend(request({intent:{seedArtistId:artists[0],requiredLabels:["serene"]}}),"QA");
    expect(result.results.map(x=>x.id)).toEqual([tracks[2]]);
    expect(result.results[0]?.relation).toMatchObject({kind:"related",rule:"lineage",seedArtistId:artists[0],relations:[{note:"Continuidad documentada en fixture",sources:["https://fixture.invalid/lineage"]}]});
    await getPool().query("DELETE FROM ingest.artist_relations WHERE id=$1",[relation]);
  });
  it("la energía procede de la metodología aprobada; propuestas y niveles contradictorios se abstienen",async()=> {
    await approve();
    const highEv=await evidence(tracks[0]!,"discovery_context:energy-high");
    const high={activity:"high",dynamics:"high",density:"low",basis:"reviewed-description",reference:"Fixture edición completa",rightsBasis:"Descripción textual fixture",observations:"Mediana alta documentada"};
    await importTrackContexts({batch:"rec",reviewer:"QA",note:"Revisión ordinal",decisions:[decision(0,{key:"high",label:"energy-high",evidenceId:highEv,methodVersion:"perceived-energy-v1",methodData:high})]},true);
    expect((await recommend(request({intent:{requiredLabels:["serene","energy-high"]}}),"QA")).results.map(x=>x.id)).toEqual([tracks[0]]);
    const pendingEv=await evidence(tracks[2]!,"discovery_context:energy-high");
    await importTrackContexts({batch:"rec",reviewer:"QA",note:"Observación pendiente",proposals:[{key:"pending-energy",trackId:tracks[2],expectedTitle:"Mismo título",expectedAlbumId:albums[2],label:"energy-high",evidenceId:pendingEv,confidence:"high",methodVersion:"perceived-energy-v1",methodData:high,origin:"human",proposer:"QA",modelName:null,modelVersion:null,generatedAt:"2020-01-01T00:00:00Z",rationale:"Propuesta sin decisión humana"}]},true);
    expect((await recommend(request({intent:{requiredLabels:["energy-high"]}}),"QA")).results.map(x=>x.id)).toEqual([tracks[0]]);
    const lowEv=await evidence(tracks[0]!,"discovery_context:energy-low");
    await importTrackContexts({batch:"rec",reviewer:"QA",note:"Contradicción para revisión",decisions:[decision(0,{key:"low",label:"energy-low",evidenceId:lowEv,methodVersion:"perceived-energy-v1",methodData:{...high,activity:"low",dynamics:"low"}})]},true);
    expect((await recommend(request({intent:{requiredLabels:["energy-high"]}}),"QA")).status).toBe("insufficient_coverage");
    const serene=await recommend(request(),"QA"); expect(serene.results[0]?.reasons.some((r:{kind:string})=>r.kind==="energy")).toBe(false);
    await getPool().query("DELETE FROM ingest.track_context_proposals");
  });
  it("equivalencia revisada no se infiere por título: preview, idempotencia, exclusión y evidencia retirada",async()=> {
    await approve(); expect((await recommend(request({limit:4}),"QA")).results).toHaveLength(4);
    const e0=await evidence(tracks[0]!,"discovery_recording_identity","recording-fixture"),e1=await evidence(tracks[1]!,"discovery_recording_identity","recording-fixture");
    const batch={reviewer:"QA",note:"Equivalencia de grabación revisada",versions:[0,1].map((i)=>({key:`v${i}`,group:"recording-fixture",trackId:tracks[i],expectedTitle:"Mismo título",expectedAlbumId:albums[i],evidenceId:i===0 ? e0 : e1,state:"approved",reason:"Grabación común documentada"}))};
    expect(await importRecommendationVersions(batch)).toMatchObject({applied:false,runId:null});
    expect((await recommend(request({limit:4}),"QA")).results).toHaveLength(4);
    await importRecommendationVersions(batch,true);
    const before=(await getPool().query("SELECT * FROM ingest.recommendation_versions ORDER BY id")).rows;
    await importRecommendationVersions(batch,true); expect((await getPool().query("SELECT * FROM ingest.recommendation_versions ORDER BY id")).rows).toEqual(before);
    expect((await recommend(request({limit:4}),"QA")).results.map(x=>x.id)).toEqual([tracks[0],tracks[2],tracks[3]]);
    expect((await recommend(request({intent:{excludeTrackIds:[tracks[0]]},limit:4}),"QA")).results.map(x=>x.id)).toEqual([tracks[2],tracks[3]]);
    await expect(importRecommendationVersions({...batch,versions:[{...batch.versions[0],evidenceId:evidenceIds[0]}]},true)).rejects.toThrow("evidencia");
    const retire=await importRecommendationVersions({...batch,versions:[{...batch.versions[0],state:"withdrawn"}]},true);
    expect((await recommend(request({limit:4}),"QA")).results).toHaveLength(4);
    await withOperatorRun({name:"qa:undo",operator:"QA",note:"Restaurar equivalencia"},ctx=>undoRunWithJournal(ctx,retire.runId!));
    expect((await recommend(request({limit:4}),"QA")).results).toHaveLength(3);
  });
  it("feedback explícito inmutable, atribuible, incorporado por solicitud y con discrepancias visibles",async()=> {
    await approve();
    const result=await recommend(request(),"QA",true); expect(result.requestId).toBeTruthy();
    const feedback={requestId:result.requestId,key:"f",trackId:tracks[0],verdict:"irrelevant",reason:"No es pertinente según mi escucha"};
    expect(await recordRecommendationFeedback(feedback,"QA")).toMatchObject({inserted:true});
    expect(await recordRecommendationFeedback(feedback,"QA")).toMatchObject({inserted:false});
    await expect(recordRecommendationFeedback({...feedback,trackId:tracks[1]},"QA")).rejects.toThrow("no entregada");
    await expect(recordRecommendationFeedback({...feedback,reason:"Otra decisión"},"QA")).rejects.toThrow("inmutable");
    const next=await recommend(request({useFeedbackFrom:[result.requestId]}),"QA"); expect(next.feedbackExclusions).toEqual([tracks[0]]);
    expect(next.results.some(x=>x.id===tracks[0])).toBe(false);
    await expect(recommend(request({useFeedbackFrom:[result.requestId]}),"Otro")).rejects.toThrow("propias");
    await recordRecommendationFeedback({...feedback,key:"other",verdict:"relevant"},"Otro");
    expect((await recommendationFeedbackReport()).feedback[0]).toMatchObject({verdict:"uncertain",reviews:2});
    expect((await getPool().query("SELECT response FROM ingest.recommendation_requests WHERE id=$1",[result.requestId])).rows[0].response.results[0].id).toBe(tracks[0]);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.change_journal WHERE table_name='ingest.recommendation_feedback'")).rows[0].n).toBeGreaterThan(0);
  });
  it("evalúa conjunto revisado: pertinencia, cobertura, diversidad y abstenciones, sin escrituras",async()=> {
    await approve();
    const result=await evaluateRecommendations({name:"Conjunto fixture revisado por autor de implementación",reviewedAt:"2026-10-10T00:00:00Z",cases:[
      {key:"serene",reviewer:"Codex (revisión técnica de fixtures)",rationale:"Tres artistas aprobados con evidencia",request:request(),relevantTrackIds:[tracks[0],tracks[2],tracks[3]],expectAbstention:false},
      {key:"unknown",reviewer:"Codex (revisión técnica de fixtures)",rationale:"Ninguna pista con alegría aprobada",request:request({intent:{requiredLabels:["joyful"]}}),relevantTrackIds:[],expectAbstention:true},
    ]});
    expect(result.summary).toMatchObject({cases:2,pertinence:1,coverage:1,diversity:1,abstentions:1,correctAbstentionDecisions:2,disabled:0});
    const reportPath=process.env["CRV_RECOMMENDATION_TEST_REPORT"];
    if (reportPath) await import("node:fs/promises").then(fs=>fs.writeFile(reportPath,JSON.stringify(result,null,2)));
    expect(await getDb().select().from(recommendationRequests)).toEqual([]);
  });
  it("fusión y deshacer preservan histórico, evidencia y feedback sin duplicar identidad",async()=> {
    await approve(); const history=await recommend(request(),"QA",true);
    const op=await withOperatorRun({name:"qa:merge",operator:"QA",note:"Identidad de fixture revisada"},ctx=>mergeInto(ctx.client,"track",tracks[0]!,tracks[1]!,"Identidad revisada",ctx.runId));
    expect((await recommend(request({limit:4}),"QA")).results.map(x=>x.id)).not.toContain(tracks[1]);
    expect((await recommend(request({intent:{excludeTrackIds:[tracks[1]]},limit:4}),"QA")).results.map(x=>x.id)).not.toContain(tracks[0]);
    const undo=await withOperatorRun({name:"qa:undo",operator:"QA",note:"Restaurar identidad"},ctx=>undoRunWithJournal(ctx,op.runId));
    expect((await recommend(request({limit:4}),"QA")).results).toHaveLength(4);
    const redo=await withOperatorRun({name:"qa:redo",operator:"QA",note:"Rehacer identidad"},ctx=>undoRunWithJournal(ctx,undo.runId));
    await withOperatorRun({name:"qa:restore",operator:"QA",note:"Restaurar fixture"},ctx=>undoRunWithJournal(ctx,redo.runId));
    expect((await getPool().query("SELECT response FROM ingest.recommendation_requests WHERE id=$1",[history.requestId])).rows[0].response.results).toHaveLength(3);
  });
  it("API privada, contrato estricto, feedback y fallback de proveedor",async()=> {
    await approve();
    expect((await app.inject({method:"POST",url:"/discovery/recommendations",payload:request()})).statusCode).toBe(401);
    expect((await app.inject("/discovery/recommendations/evaluation")).statusCode).toBe(401);
    expect((await app.inject({method:"HEAD",url:"/discovery/recommendations/evaluation"})).statusCode).toBe(401);
    const response=await app.inject({method:"POST",url:"/discovery/recommendations",headers,payload:request()});
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store"); expect(response.json().status).toBe("ok");
    expect((await app.inject({method:"POST",url:"/discovery/recommendations",headers,payload:{intent:{requiredLabels:["inventada"]}}})).statusCode).toBe(400);
    const unavailable=await app.inject({method:"POST",url:"/discovery/recommendations",headers,payload:{text:"Quiero música para descansar"}});
    expect(unavailable.json()).toMatchObject({status:"abstained",interpretation:{status:"unavailable"},results:[]});
    expect((await app.inject({method:"POST",url:"/discovery/recommendations/feedback",headers,payload:{requestId:response.json().requestId,key:"api",verdict:"relevant",reason:"Revisión explícita"}})).statusCode).toBe(200);
    expect((await app.inject({url:"/discovery/recommendations/evaluation",headers})).statusCode).toBe(200);
  });
  it("deshacer/rehacer snapshots UUID y feedback respeta las revisiones posteriores",async()=> {
    await approve();const response=await recommend(request(),"QA",true);
    const requestRun=Number((await getPool().query("SELECT run_id FROM ingest.change_journal WHERE table_name='ingest.recommendation_requests' AND row_pk->>'id'=$1",[response.requestId])).rows[0].run_id);
    const feedback=await recordRecommendationFeedback({requestId:response.requestId,key:"undo",trackId:tracks[0],verdict:"relevant",reason:"Revisión posterior"},"QA");
    const feedbackRun=Number((await getPool().query("SELECT run_id FROM ingest.change_journal WHERE table_name='ingest.recommendation_feedback' AND row_pk->>'id'=$1",[String(feedback.id)])).rows[0].run_id);
    const undo=(run:number)=>withOperatorRun({name:"qa:undo",operator:"QA",note:"Restaurar historial"},ctx=>undoRunWithJournal(ctx,run));
    await expect(undo(requestRun)).rejects.toThrow();
    const undoFeedback=await undo(feedbackRun),undoRequest=await undo(requestRun);
    expect(await getDb().select().from(recommendationRequests)).toEqual([]);
    await undo(undoRequest.runId);await undo(undoFeedback.runId);
    expect((await recommendationFeedbackReport()).feedback[0]).toMatchObject({verdict:"relevant",reviews:1});
  });
});
