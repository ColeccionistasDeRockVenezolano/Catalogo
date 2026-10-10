import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { getPool, closeDb, getDb } from "../../src/db/client.js";
import { migrateUp } from "../../src/db/migrate.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { importTrackContexts } from "../../src/discovery/track-context-curation.js";
import { recordContextEvidence } from "../../src/discovery/track-context-evidence.js";
import { trackContextBatchSchema } from "../../src/discovery/track-context-contract.js";
import { contextCoverage } from "../../src/discovery/track-contexts.js";
import { trackContextLabels } from "../../src/db/schema/track-contexts.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRunWithJournal } from "../../src/merge/journal-undo.js";
import { mergeInto } from "../../src/review/duplicates.js";
const TOKEN = "context-tests-operator-token-0123456789";
describe("etapa 3: contextos de pistas, evidencia, metodología y evaluación", () => {
  let pg: PgContainer, app: FastifyInstance, track: number, repeat: number, album: number, otherAlbum: number, source: number;
  let ev: number, otherEv: number, seq=0;
  const headers = { authorization: `Bearer ${TOKEN}`, "x-crv-operator":"Revisor API" };
  async function evidence(trackId: number | null, label="serene", albumId: number | null = null) {
    seq++;
    const claim = Number((await getPool().query(`INSERT INTO ingest.claims(source_id,entity_kind,identity_key,field,raw_value,raw_hash,extractor,extractor_version,track_id,album_id)
      VALUES($1,$2,$3,$4,'"Observación específica"',$5,'qa','1',$6,$7) RETURNING id`,[source,trackId ? "track":"album",`ctx-${seq}`,`discovery_context:${label}`,seq.toString(16).padStart(64,"0"),trackId,albumId])).rows[0].id);
    return Number((await getPool().query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,evidence_hash)
      VALUES($1,'https://fixture.invalid/track-review','Observaciones documentadas de esta pista concreta',$2) RETURNING id`,[claim,seq.toString(16).padStart(64,"0")])).rows[0].id);
  }
  const decision = (patch: Record<string,unknown> = {}) => ({ key:"d",trackId:track,expectedAlbumId:album,expectedTitle:"Mismo título",
    label:"serene",evidenceId:ev,confidence:"medium",methodVersion:"context-editorial-v1",methodData:null,
    proposalKey:null,state:"approved",reason:"La revisión documenta calma y estabilidad",validFrom:"2020-01-01T00:00:00Z",validUntil:null,...patch });
  const batch = (patch: Record<string,unknown> = {}) => trackContextBatchSchema.parse({ batch:"qa",reviewer:"QA",note:"Revisión documentada",decisions:[decision()],...patch });
  const get = async (id=track) => {
    const response = await app.inject(`/discovery/track-contexts/${id}`);
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl;
    process.env["CRV_OPERATOR_TOKEN"] = TOKEN; process.env["CRV_CURATION_AUTOSCAN"] = "false"; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    const p=getPool();
    source=Number((await p.query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('qa-context','QA','database','high') RETURNING id")).rows[0].id);
    const artist=Number((await p.query("INSERT INTO artists(name) VALUES('Artista fixture') RETURNING id")).rows[0].id);
    album=Number((await p.query("INSERT INTO albums(artist_id,title) VALUES($1,'Edición uno') RETURNING id",[artist])).rows[0].id);
    otherAlbum=Number((await p.query("INSERT INTO albums(artist_id,title) VALUES($1,'Edición dos') RETURNING id",[artist])).rows[0].id);
    track=Number((await p.query("INSERT INTO tracks(album_id,track_number,title) VALUES($1,1,'Mismo título') RETURNING id",[album])).rows[0].id);
    repeat=Number((await p.query("INSERT INTO tracks(album_id,track_number,title) VALUES($1,1,'Mismo título') RETURNING id",[otherAlbum])).rows[0].id);
    ev=await evidence(track); otherEv=await evidence(repeat);
    app=await buildApp();
  });
  beforeEach(async () => {
    await getPool().query("DELETE FROM ingest.track_context_evaluations");
    await getPool().query("DELETE FROM ingest.track_context_assignments");
    await getPool().query("DELETE FROM ingest.track_context_proposals");
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); delete process.env["CRV_OPERATOR_TOKEN"]; delete process.env["CRV_CURATION_AUTOSCAN"]; resetEnvCache(); await pg?.stop();
  });
  it("DDL idempotente, Drizzle, rollback específico, compatibilidad antes de migrar y public intacto", async () => {
    const snapshot = () => execFileSync("docker",["exec",pg.name,"pg_dump","-U","postgres","-d","postgres","--schema=public","--schema-only"],{encoding:"utf8"}).split("\n").filter(l=>!/^\\(un)?restrict/u.test(l)).join("\n");
    const before=snapshot();
    expect(await getDb().select().from(trackContextLabels)).toHaveLength(10);
    expect((await migrateUp()).applied).toEqual([]);
    await getPool().query(await readFile("migrations/0054_track_contexts.up.sql","utf8"));
    expect(await getDb().select().from(trackContextLabels)).toHaveLength(10);
    await getPool().query(await readFile("migrations/0054_track_contexts.down.sql","utf8"));
    expect(snapshot()).toBe(before);
    expect(await get()).toMatchObject({ enabled:false,assignments:[] });
    expect((await migrateUp()).applied).toEqual(["0054_track_contexts"]);
    expect(snapshot()).toBe(before);
  });
  it("vista previa revierte filas, runs y diario; importación idéntica conserva fechas y evidencia", async () => {
    const runs=(await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs")).rows[0].n;
    const journal=(await getPool().query("SELECT count(*)::int AS n FROM ingest.change_journal")).rows[0].n;
    expect(await importTrackContexts(batch())).toMatchObject({ applied:false,runId:null,approved:1 });
    expect((await get()).assignments).toEqual([]);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs")).rows[0].n).toBe(runs);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.change_journal")).rows[0].n).toBe(journal);
    await importTrackContexts(batch(),true);
    const before=(await getPool().query("SELECT * FROM ingest.track_context_assignments")).rows;
    await importTrackContexts(batch(),true);
    expect((await getPool().query("SELECT * FROM ingest.track_context_assignments")).rows).toEqual(before);
    expect((await get()).assignments[0]).toMatchObject({ slug:"serene",evidenceId:ev,modelName:null,methodVersion:"context-editorial-v1" });
    expect((await get(repeat)).assignments).toEqual([]);
  });
  it("algoritmos producen propuestas inmutables; solo una revisión explícita aprueba", async () => {
    const proposal={ ...decision(),key:"p",origin:"algorithm",proposer:"Piloto",modelName:"fixture-only",modelVersion:"v1",generatedAt:"2020-01-01T00:00:00Z",rationale:"Hipótesis" };
    const { proposalKey:_p,state:_s,reason:_r,validFrom:_f,validUntil:_u,...p }=proposal;
    const b=batch({ decisions:[],proposals:[p] });
    await importTrackContexts(b,true); await importTrackContexts(b,true);
    expect((await get()).assignments).toEqual([]);
    const review=(await app.inject({url:`/discovery/contexts/tracks/${track}/review`,headers})).json();
    expect(review.proposals).toHaveLength(1); expect(review.proposals[0].model_version).toBe("v1");
    await expect(importTrackContexts({ ...b,proposals:[{ ...p,modelVersion:"v2" }] },true)).rejects.toThrow("inmutable");
    await importTrackContexts(batch({ decisions:[decision({proposalKey:"p"})] }),true);
    expect((await get()).assignments[0]).toMatchObject({ modelName:"fixture-only",modelVersion:"v1",proposalOrigin:"algorithm",reviewer:"QA" });
    expect((await getPool().query("SELECT * FROM ingest.track_context_proposals")).rows).toHaveLength(1);
  });
  it("rechaza evidencia de otra edición, álbum o criterio; IDs/títulos/edición incorrectos; lote atómico", async () => {
    const albumEvidence=await evidence(null,"serene",album);
    const wrongCriterion=await evidence(track,"joyful");
    for (const patch of [{evidenceId:otherEv},{evidenceId:albumEvidence},{evidenceId:wrongCriterion},{trackId:999999},{expectedTitle:"Alias"},{expectedAlbumId:otherAlbum},{label:"nuevo-contexto"}]) {
      await expect(importTrackContexts(batch({decisions:[decision(patch)]}),true)).rejects.toThrow();
    }
    await expect(importTrackContexts(batch({decisions:[decision(),decision({key:"bad",evidenceId:otherEv})]}),true)).rejects.toThrow();
    expect((await get()).assignments).toEqual([]);
    await expect(importTrackContexts(batch({decisions:[decision(),decision()]}),true)).rejects.toThrow("repetida");
  });
  it("pendientes, retiradas, rechazadas, futuras, vencidas y evidencia rechazada no aparecen", async () => {
    for (const patch of [{state:"withdrawn"},{state:"rejected"},{validFrom:"2099-01-01T00:00:00Z"},{validUntil:"2021-01-01T00:00:00Z"}]) {
      await importTrackContexts(batch({decisions:[decision(patch)]}),true); expect((await get()).assignments).toEqual([]);
    }
    await importTrackContexts(batch(),true);
    await getPool().query("UPDATE ingest.claims SET status='rejected' WHERE id=(SELECT claim_id FROM ingest.claim_evidence WHERE id=$1)",[ev]);
    expect((await get()).assignments).toEqual([]);
    await expect(importTrackContexts(batch(),true)).rejects.toThrow("evidencia");
    await importTrackContexts(batch({decisions:[decision({state:"withdrawn"})]}),true);
    expect((await getPool().query("SELECT evidence_id FROM ingest.track_context_assignments")).rows[0].evidence_id).toBe(String(ev));
    await getPool().query("UPDATE ingest.claims SET status='candidate' WHERE id=(SELECT claim_id FROM ingest.claim_evidence WHERE id=$1)",[ev]);
  });
  it("conserva el origen de los géneros sin crear hechos de pista", async () => {
    const family=Number((await getPool().query("INSERT INTO ingest.genres(slug,name,level) VALUES('qa-context-family','Familia fixture','family') RETURNING id")).rows[0].id);
    const g=Number((await getPool().query("INSERT INTO ingest.genres(slug,name,level,parent_genre_id) VALUES('qa-context-genre','Género fixture','genre',$1) RETURNING id",[family])).rows[0].id);
    const ar=(await getPool().query("SELECT artist_id FROM albums WHERE id=$1",[album])).rows[0].artist_id;
    for (const [table,col,id] of [["album_genres","album_id",album],["artist_genres","artist_id",ar]]) {
      await getPool().query(`INSERT INTO ingest.${table}(${col},genre_id,status,confidence,source_kind,decision_rule,decision_kind,decided_by)
        VALUES($1,$2,'confirmed','high','editorial','qa','human','QA') ON CONFLICT(${col},genre_id) DO UPDATE SET
        status='confirmed',source_kind='editorial',decision_kind='human',decided_by='QA',decision_rule='qa'`,[id,g]);
    }
    const result=await get();
    expect(result.assignments).toEqual([]);
    expect(result.genreReferences.map((g: {originalLevel:string})=>g.originalLevel)).toEqual(["album","artist"]);
    expect(result.genreReferences.every((g: {verifiedForTrack:boolean})=>g.verifiedForTrack===false)).toBe(true);
  });
  it("registra observaciones en claims/evidencias existentes con fuente, vista previa e idempotencia; nunca escribe audio ni core", async () => {
    const input={reviewer:"QA",note:"Revisión de fuente textual",sourceId:source,trackId:track,expectedTitle:"Mismo título",expectedAlbumId:album,
      label:"joyful",observation:"Carácter alegre documentado para esta edición",basis:"reviewed-description",rightsBasis:"Solo fuente textual",
      url:"https://fixture.invalid/joyful",excerpt:"Descripción específica de esta versión",confidence:"medium"};
    const before=(await getPool().query("SELECT * FROM tracks ORDER BY id")).rows;
    expect(await recordContextEvidence(input)).toMatchObject({applied:false,claimId:null,evidenceId:null});
    expect((await getPool().query("SELECT id FROM ingest.claims WHERE field='discovery_context:joyful' AND track_id=$1 AND extractor='discovery-context-review'",[track])).rows).toHaveLength(0);
    const first=await recordContextEvidence(input,true),second=await recordContextEvidence(input,true);
    expect(second).toMatchObject({claimId:first.claimId,evidenceId:first.evidenceId,inserted:false});
    expect((await getPool().query("SELECT * FROM tracks ORDER BY id")).rows).toEqual(before);
    await importTrackContexts(batch({decisions:[decision({label:"joyful",evidenceId:first.evidenceId})]}),true);
    expect((await get()).assignments[0]).toMatchObject({slug:"joyful",sourceId:source});
    await expect(recordContextEvidence({...input,sourceId:999999},true)).rejects.toThrow("Fuente");
    await expect(recordContextEvidence({...input,expectedAlbumId:otherAlbum},true)).rejects.toThrow("edición");
    await getPool().query("UPDATE ingest.claims SET status='rejected' WHERE id=$1",[first.claimId]);
    await expect(recordContextEvidence(input,true)).rejects.toThrow("reactiva");
    expect((await get()).assignments).toEqual([]);
  });
  it("energía requiere evidencia específica y método documentado; distintos niveles en conflicto se abstienen", async () => {
    const energyEv=await evidence(track,"energy-medium");
    const methodData={activity:"high",dynamics:"low",density:"medium",basis:"reviewed-description",reference:"Fuente específica",
      rightsBasis:"Solo descripción textual revisada",observations:"Actividad alta, dinámica baja y densidad media"};
    await importTrackContexts(batch({decisions:[decision({label:"energy-medium",evidenceId:energyEv,methodVersion:"perceived-energy-v1",methodData})]}),true);
    expect((await get()).assignments[0]).toMatchObject({slug:"energy-medium",methodData});
    await expect(getPool().query("UPDATE ingest.track_context_assignments SET method_data='{}'::jsonb")).rejects.toThrow();
    await getPool().query("UPDATE ingest.track_context_assignments SET method_data=$1::jsonb",[JSON.stringify({...methodData,dynamics:"high"})]);
    expect((await get()).assignments).toEqual([]);
    await getPool().query("UPDATE ingest.track_context_assignments SET method_data=$1::jsonb",[JSON.stringify(methodData)]);
    const highEv=await evidence(track,"energy-high");
    await importTrackContexts(batch({decisions:[decision({key:"energy-other",label:"energy-high",evidenceId:highEv,methodVersion:"perceived-energy-v1",methodData:{ ...methodData,dynamics:"high" }})]}),true);
    expect((await get()).assignments).toEqual([]);
  });
  it("mide cobertura/pertinencia por pista, evaluación independiente, incertidumbre, y revisiones obsoletas", async () => {
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({totalTracks:2,coveredTracks:0,coverage:0,pertinence:null});
    await importTrackContexts(batch(),true);
    await expect(importTrackContexts(batch({decisions:[],evaluations:[{key:"e",assignmentKey:"d",verdict:"relevant",reason:"Reescucha"}]}),true)).rejects.toThrow("independiente");
    const evaluation=batch({reviewer:"Evaluador",decisions:[],evaluations:[{key:"e",assignmentKey:"d",verdict:"relevant",reason:"Observación independiente específica"}]});
    await importTrackContexts(evaluation,true); await importTrackContexts(evaluation,true);
    const report=await contextCoverage({limit:20,offset:0});
    expect(report.summary).toMatchObject({totalTracks:2,coveredTracks:1,coverage:0.5,approvedAssignments:1,evaluatedAssignments:1,relevant:1,pertinence:1,staleEvaluations:0});
    expect(report.tracks.find(t=>t.id===repeat)).toMatchObject({approvedAssignments:0,pertinence:null});
    expect((await contextCoverage({limit:1,offset:0,albumId:otherAlbum})).summary).toMatchObject({totalTracks:1,coverage:0});
    await importTrackContexts(batch({reviewer:"Otro evaluador",decisions:[],evaluations:[{key:"e2",assignmentKey:"d",verdict:"irrelevant",reason:"Discrepancia explícita"}]}),true);
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({evaluatedAssignments:1,uncertain:1,pertinence:null});
    await importTrackContexts(batch({decisions:[decision({confidence:"high"})]}),true);
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({evaluatedAssignments:0,staleEvaluations:2,pertinence:null});
    await expect(importTrackContexts(evaluation,true)).rejects.toThrow("inmutable");
    const renewed=batch({reviewer:"Evaluador",decisions:[],evaluations:[{key:"e3",assignmentKey:"d",verdict:"irrelevant",reason:"Revisión de nueva decisión"}]});
    await importTrackContexts(renewed,true);
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({evaluatedAssignments:1,irrelevant:1,pertinence:0});
  });
  it("fusiones explícitas conservan decisiones/evidencia contradictorias; deshacer/rehacer y retiro son reversibles", async () => {
    await importTrackContexts(batch(),true);
    await importTrackContexts(batch({decisions:[decision({key:"other",trackId:repeat,expectedAlbumId:otherAlbum,evidenceId:otherEv,state:"rejected"})]}),true);
    const before=(await getPool().query("SELECT * FROM ingest.track_context_assignments ORDER BY id")).rows;
    const merge=await withOperatorRun({name:"qa:merge-contexts",operator:"QA",note:"Identidad verificada explícitamente"},ctx=>mergeInto(ctx.client,"track",track,repeat,"Identidad verificada",ctx.runId));
    expect((await get()).assignments).toEqual([]);
    expect((await getPool().query("SELECT * FROM ingest.track_context_assignments WHERE track_id=$1",[track])).rows).toHaveLength(2);
    const undo=await withOperatorRun({name:"qa:undo",operator:"QA",note:"Restaurar ediciones"},ctx=>undoRunWithJournal(ctx,merge.runId));
    expect((await getPool().query("SELECT * FROM ingest.track_context_assignments ORDER BY id")).rows).toEqual(before);
    expect((await get()).assignments).toHaveLength(1); expect((await get(repeat)).assignments).toEqual([]);
    const redo=await withOperatorRun({name:"qa:redo",operator:"QA",note:"Rehacer fusión"},ctx=>undoRunWithJournal(ctx,undo.runId));
    expect((await get()).assignments).toEqual([]);
    await withOperatorRun({name:"qa:restore",operator:"QA",note:"Restaurar fixture"},ctx=>undoRunWithJournal(ctx,redo.runId));
    const removal=await importTrackContexts(batch({decisions:[decision({state:"withdrawn"})]}),true);
    expect((await get()).assignments).toEqual([]);
    await withOperatorRun({name:"qa:undo-retire",operator:"QA",note:"Restaurar decisión"},ctx=>undoRunWithJournal(ctx,removal.runId!));
    expect((await get()).assignments).toHaveLength(1);
  });
  it("deshacer una creación conserva revisiones posteriores; rehacer restaura propuesta, decisión y evaluación", async () => {
    const d=decision();
    const {proposalKey:_p,state:_s,reason:_r,validFrom:_f,validUntil:_u,...annotation}=d;
    const creation=await importTrackContexts(batch({proposals:[{...annotation,key:"p",origin:"human",proposer:"QA",modelName:null,modelVersion:null,
      generatedAt:"2020-01-01T00:00:00Z",rationale:"Observación revisada"}],decisions:[decision({proposalKey:"p"})]}),true);
    const evaluation=await importTrackContexts(batch({reviewer:"Evaluador",decisions:[],evaluations:[{key:"e",assignmentKey:"d",verdict:"relevant",reason:"Revisión independiente"}]}),true);
    const undo=(runId:number) => withOperatorRun({name:"qa:undo-chain",operator:"QA",note:"Restaurar historia"},ctx=>undoRunWithJournal(ctx,runId));
    await expect(undo(creation.runId!)).rejects.toThrow();
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({relevant:1,approvedAssignments:1});
    const undoEvaluation=await undo(evaluation.runId!);
    const undoCreation=await undo(creation.runId!);
    expect((await get()).assignments).toEqual([]);
    expect((await getPool().query("SELECT * FROM ingest.track_context_proposals")).rows).toEqual([]);
    await undo(undoCreation.runId); await undo(undoEvaluation.runId);
    expect((await get()).assignments).toHaveLength(1);
    expect((await contextCoverage({limit:20,offset:0})).summary).toMatchObject({relevant:1,approvedAssignments:1,staleEvaluations:0});
  });
  it("API pública filtrada, revisión/medición privadas, escritura atribuida y validación de parámetros", async () => {
    for (const url of ["/discovery/contexts/coverage","/discovery/contexts/ontology",`/discovery/contexts/tracks/${track}/review`]) {
      expect((await app.inject(url)).statusCode).toBe(401); expect((await app.inject({method:"HEAD",url})).statusCode).toBe(401);
      expect((await app.inject({url,headers})).statusCode).toBe(200);
    }
    expect((await app.inject("/discovery/track-contexts/999999")).statusCode).toBe(404);
    expect((await app.inject("/discovery/track-contexts/0")).statusCode).toBe(400);
    expect((await app.inject({url:"/discovery/contexts/coverage?limit=201",headers})).statusCode).toBe(400);
    const payload={batch:batch(),apply:true};
    expect((await app.inject({method:"POST",url:"/discovery/contexts/import",payload})).statusCode).toBe(401);
    const preview=await app.inject({method:"POST",url:"/discovery/contexts/import",headers,payload:{batch:batch()}});
    expect(preview.statusCode).toBe(200); expect(preview.json()).toMatchObject({applied:false});
    const write=await app.inject({method:"POST",url:"/discovery/contexts/import",headers,payload});
    expect(write.statusCode).toBe(200); expect((await get()).assignments[0].reviewer).toBe("Revisor API");
    expect((await app.inject(`/discovery/track-contexts/${track}`)).headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/search?q=Mismo")).statusCode).toBe(200);
    expect((await app.inject("/discovery/search-suggestions")).statusCode).toBe(200);
  });
});
