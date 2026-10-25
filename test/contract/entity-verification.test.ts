import { createHash } from "node:crypto";
import { scryptSync } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer,type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb,getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { loadVerificationSnapshot } from "../../src/verification/snapshot.js";
import { evaluateVerification } from "../../src/verification/evaluate.js";
import { controlIndividualVerification,activeIndividualJob,getIndividualJob,getIndividualVerification,recoverIndividualJobs,saveIndividualVerification,startIndividualVerification } from "../../src/verification/store.js";
import { verificationReportSchema } from "../../src/api/routes/entity-verification.js";
import { researchStored } from "../../src/verification/research-state.js";
import {reprocessIndividualVerification,type VerificationWork} from "../../src/verification/store.js";
import { createDeepSeekGateway, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { RULES_VERSION } from "../../src/verification/proof.js";
import type { VerificationReport } from "../../src/verification/types.js";
import {preservedReportState} from "../../src/verification/history.js";
import {snapshotHash} from "../../src/verification/evaluate.js";
import type {ResearchState} from "../../src/verification/research.js";
import {getComparison} from "../../src/verification/comparison-store.js";

const TOKEN="token-de-verificacion-individual-0123456789";
const PASSWORD="clave-larga-lector-prueba";
const SALT=Buffer.from("verification-test");
const HASH=`scrypt$16384$8$1$${SALT.toString("base64url")}$${scryptSync(PASSWORD,SALT,64).toString("base64url")}`;
describe("verificación individual persistente y privada",()=>{
  let container:PgContainer;let app:FastifyInstance;let artist:number;let person:number;let album:number;
  beforeAll(async()=>{
    container=await startPgContainer();process.env["DATABASE_URL"]=container.databaseUrl;process.env["CRV_OPERATOR_TOKEN"]=TOKEN;
    process.env["CRV_COLLABORATORS_JSON"]=JSON.stringify([{username:"lector.qa",name:"Lector QA",passwordHash:HASH,role:"reader"}]);
    resetEnvCache();await applyCore(container.name);await migrateUp();
    artist=Number((await getPool().query("INSERT INTO public.artists(name,formed_year,biography) VALUES('Banda QA',2000,'Banda QA se formó en 2000. Publicó Disco QA en 2001.') RETURNING id")).rows[0].id);
    person=Number((await getPool().query("INSERT INTO public.persons(name,birth_date) VALUES('Músico QA','1980-01-01') RETURNING id")).rows[0].id);
    album=Number((await getPool().query("INSERT INTO public.albums(title,artist_id,release_year) VALUES('Disco QA',$1,2001) RETURNING id",[artist])).rows[0].id);
    await getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Bass',1999)",[artist,person]);
    await getPool().query("INSERT INTO public.album_credits(album_id,person_id,role,credit_type) VALUES($1,$2,'Bass','musician')",[album,person]);
    await getPool().query("INSERT INTO public.tracks(album_id,disc_number,track_number,title) VALUES($1,1,1,'Primera'),($1,1,3,'Tercera')",[album]);
    await getPool().query("INSERT INTO public.social_links(artist_id,platform,url,method,source,verified) VALUES($1,'instagram','https://instagram.com/bandaqa','exact','qa',false)",[artist]);
    app=await buildApp();
  },120000);
  afterAll(async()=>{await app?.close();await closeDb();delete process.env["CRV_OPERATOR_TOKEN"];delete process.env["CRV_COLLABORATORS_JSON"];resetEnvCache();await container?.stop();},60000);
  it("investiga sellos y pistas con contexto, guarda sus versiones y permite compararlos por su tipo",async()=>{
    const org=Number((await getPool().query("INSERT INTO public.organizations(name,country) VALUES('Sello QA','Venezuela') RETURNING id")).rows[0].id);
    await getPool().query("UPDATE public.albums SET label_id=$1 WHERE id=$2",[org,album]);
    const track=Number((await getPool().query("SELECT id FROM public.tracks WHERE album_id=$1 ORDER BY id LIMIT 1",[album])).rows[0].id);
    const organization=await loadVerificationSnapshot("organization",org),song=await loadVerificationSnapshot("track",track);
    expect(organization.albums.map(item=>item.id)).toContain(album);expect(organization.units.find(item=>item.key==="identity.country")?.value).toBe("Venezuela");
    expect(song.units[0]?.expected).toEqual(["Primera","Disco QA","Banda QA"]);
    expect(song.units.find(item=>item.key==="track.order")?.value).toBe("1.1");
    for(const snapshot of [organization,song]){
      const report=evaluateVerification(snapshot,[]),versionId=await saveIndividualVerification(report,"QA");
      const response=await app.inject({method:"GET",url:`/entity-verification/${snapshot.kind}/${snapshot.id}/versions/${versionId}`,headers:{authorization:`Bearer ${TOKEN}`}});
      expect(response.statusCode,response.body).toBe(200);expect(response.json().kind).toBe(snapshot.kind);
    }
    const other=Number((await getPool().query("INSERT INTO public.organizations(name,country) VALUES('Sello Alternativo QA','Venezuela') RETURNING id")).rows[0].id);
    const comparison=await getComparison({kind:"organization",id:org},{kind:"organization",id:other});
    expect(comparison.rows.some(row=>row.key==="location")).toBe(true);expect(comparison.rows.reduce((sum,row)=>sum+row.maximum,0)).toBe(40);
    await getPool().query("UPDATE public.albums SET label_id=NULL WHERE id=$1",[album]);
  });
  it("recupera todos los descubrimientos de un estado legado anterior al informe sin inventar una versión nueva de sus fuentes",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Legado QA') RETURNING id")).rows[0].id);
    const snapshot=await loadVerificationSnapshot("artist",entity),content="Legado QA publicó el Disco Legado en 1999.",page={url:"https://archivo.example/legado",title:"Legado QA",content,contentHash:createHash("sha256").update(content).digest("hex"),fetchedAt:"2020-01-01T00:00:00Z",capturedAt:"2020-01-01T00:00:00Z",acquisitionMethod:"http" as const};
    const state:ResearchState={rulesVersion:6,pages:[{...page,url:"https://archivo.example/empty",content:"",contentHash:"legacy",origin:"search_snippet",acquisitionMethod:"search_snippet"},page],proposal:{findings:[],discoveries:[{area:"discography",value:"Disco Legado",context:"Legado QA",reason:"Crudo conservado",evidence:[{source:1,quote:content}]}]},pendingKeys:[],limitations:[],attempts:1};
    await getPool().query("INSERT INTO ingest.entity_verification_research_state(entity_kind,entity_id,snapshot_hash,state) VALUES('artist',$1,$2,$3::jsonb)",[entity,snapshotHash(snapshot),JSON.stringify(state)]);
    const report=evaluateVerification(snapshot,[page]),versionId=await saveIndividualVerification(report,"QA");
    const response=await app.inject({method:"GET",url:`/entity-verification/artist/${entity}/versions`,headers:{authorization:`Bearer ${TOKEN}`}});expect(response.statusCode,response.body).toBe(200);expect(response.json().versions[0].reprocessAvailable).toBe(true);
    const copy=await preservedReportState("artist",entity,versionId);expect(copy.pages).toEqual([page]);expect(copy.proposal.discoveries[0]?.evidence[0]?.source).toBe(0);expect(copy.normalizations).toHaveLength(1);
    expect((await getPool().query("SELECT state FROM ingest.entity_verification_research_state WHERE entity_kind='artist' AND entity_id=$1",[entity])).rows[0].state).toEqual(state);
    await getPool().query("UPDATE ingest.entity_verification_research_state SET updated_at=now()+interval '1 second' WHERE entity_kind='artist' AND entity_id=$1",[entity]);
    await expect(preservedReportState("artist",entity,versionId)).rejects.toThrow(/copia íntegra/);
  });
  it("incluye datos de las tres fichas, pistas de cada álbum y enlaces aún no verificados",async()=>{
    const band=await loadVerificationSnapshot("artist",artist);
    expect(new Set(band.units.map(u=>u.area)).size).toBe(11);
    expect(band.units.find(u=>u.key==="social.instagram")?.value).toContain("bandaqa");
    expect(band.units.filter(u=>u.area==="biography")).toHaveLength(2);
    expect(band.units.some(u=>u.key===`tracks.${album}.gap.1.2`)).toBe(true);
    expect(band.units.find(u=>u.key===`album.${album}.cover`)).toMatchObject({area:"images",value:null,context:["Banda QA","Disco QA"]});
    expect(band.units.find(u=>u.key===`album.${album}.label`)).toMatchObject({area:"labels",value:null});
    expect(band.units.find(u=>u.key===`album.${album}.genres.empty`)).toMatchObject({area:"genres",context:["Banda QA","Disco QA"]});
    expect(band.units.some(u=>u.key==="identity.aliases.search")).toBe(true);
    const individual=await loadVerificationSnapshot("person",person);
    expect(individual.albums.map(a=>a.id)).toEqual([album]);
    expect(individual.units.some(u=>u.area==="tracks"&&u.value==="Primera")).toBe(true);
    const release=await loadVerificationSnapshot("album",album);
    expect(release.units.some(u=>u.area==="members"&&u.context.includes("Músico QA"))).toBe(true);
    expect(release.units.find(u=>u.key==="identity.name")?.expected).toEqual(["Disco QA","Banda QA"]);
  });
  it("prohíbe informes, puntajes y trabajos a visitantes y lectores",async()=>{
    const login=await app.inject({method:"POST",url:"/auth/login",payload:{username:"lector.qa",password:PASSWORD}});
    expect(login.statusCode).toBe(200);
    const cookie=(login.headers["set-cookie"] as string).split(";",1)[0]!;
    for(const suffix of ["", "/active-job", "/latest-job", "/jobs"]) {
      const method=suffix==="/jobs"?"POST":"GET";
      const url=`/entity-verification/artist/${artist}${suffix}`;
      expect((await app.inject({method,url})).statusCode).toBe(401);
      expect((await app.inject({method,url,headers:{cookie,"x-crv-csrf":login.json().csrf}})).statusCode).toBe(403);
    }
    expect((await app.inject({method:"GET",url:"/entity-verification/jobs/1"})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:"/entity-verification/jobs/1",headers:{cookie}})).statusCode).toBe(403);
    const privateData=await app.inject({method:"GET",url:`/entity-verification/artist/${artist}`,headers:{authorization:`Bearer ${TOKEN}`}});
    expect(privateData.statusCode).toBe(200);expect(privateData.headers["cache-control"]).toBe("no-store");
    expect(verificationReportSchema.parse(privateData.json()).score).toBeNull();
    const publicData=(await app.inject({method:"GET",url:`/artists/${artist}`})).json();
    expect(publicData).not.toHaveProperty("score");expect(publicData).not.toHaveProperty("findings");
  });
  it("guarda citas y puntaje, conserva versiones y detecta cambios en pistas",async()=>{
    const snapshot=await loadVerificationSnapshot("album",album);
    const capturedAt="2001-05-06T00:00:00Z",readAt=new Date().toISOString();
    const report=evaluateVerification(snapshot,[{url:"https://fuente.example/qa",title:"Disco QA",content:"Banda QA publicó Disco QA en 2001.",contentHash:"qa",fetchedAt:capturedAt,capturedAt,readAt,acquisitionMethod:"raw_archive"}],{findings:[{key:"identity.name",status:"confirmed",observed:"Disco QA",reason:"Disco y artista documentados",evidence:[{source:0,quote:"Banda QA publicó Disco QA en 2001."}]}],discoveries:[]},true);
    await saveIndividualVerification(report,"QA admin");
    expect(await getIndividualVerification("album",album)).toMatchObject({score:report.score,stale:false,researched:true});
    expect((await getIndividualVerification("album",album)).findings[0]?.evidence).toHaveLength(1);
    const apiReport=await app.inject({method:"GET",url:`/entity-verification/album/${album}`,headers:{authorization:`Bearer ${TOKEN}`}});
    expect(apiReport.statusCode).toBe(200);
    expect(apiReport.json().sources[0]).toMatchObject({capturedAt,readAt,acquisitionMethod:"raw_archive"});
    expect(apiReport.json().findings[0].evidence[0]).toMatchObject({capturedAt,readAt,acquisitionMethod:"raw_archive"});
    await getPool().query("UPDATE public.tracks SET title='Primera corregida' WHERE album_id=$1 AND track_number=1",[album]);
    expect(await getIndividualVerification("album",album)).toMatchObject({score:null,stale:true});
    await saveIndividualVerification(evaluateVerification(await loadVerificationSnapshot("album",album),[],undefined,true),"QA admin");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_verification_reports WHERE entity_kind='album' AND entity_id=$1",[album])).rows[0].n).toBe(2);
  });
  it("ejecuta el trabajo una vez, continúa fuera de la petición y persiste el informe",async()=>{
    let finish:((result:VerificationReport)=>void)|undefined;
    const work=()=>new Promise<VerificationReport>(resolve=>{finish=resolve;});
    const first=await startIndividualVerification("person",person,"QA admin",work);
    const duplicate=await startIndividualVerification("person",person,"QA admin",work);expect(duplicate.id).toBe(first.id);
    for(let n=0;n<50&&!finish;n++)await new Promise(resolve=>setTimeout(resolve,20));
    finish!(evaluateVerification(await loadVerificationSnapshot("person",person),[],undefined,true));
    for(let n=0;n<50&&(await getIndividualJob(first.id))?.status!=="done";n++)await new Promise(resolve=>setTimeout(resolve,20));
    expect(await getIndividualJob(first.id)).toMatchObject({status:"done",error:null});
    expect(await activeIndividualJob("person",person)).toBeNull();expect((await getIndividualVerification("person",person)).researched).toBe(true);
    await getPool().query("INSERT INTO ingest.entity_verification_jobs(entity_kind,entity_id,requested_by,status) VALUES('artist',$1,'QA','running')",[artist]);
    await recoverIndividualJobs();expect(await activeIndividualJob("artist",artist)).toBeNull();
  });
  it("recupera progreso y respaldo parcial desde la API y conserva el checkpoint ante interrupción",async()=>{
    let stop:((report:VerificationReport)=>void)|undefined;
    const snapshot=await loadVerificationSnapshot("album",album);
    const checkpoint={...evaluateVerification(snapshot,[],undefined,true),inProgress:true};
    const first=await startIndividualVerification("album",album,"QA",async(_kind,_id,notify)=>{
      await notify({phase:"evaluating",completed:3,total:snapshot.units.length,sources:2,evaluated:3,totalUnits:snapshot.units.length,updatedAt:new Date().toISOString()},checkpoint);
      return new Promise<VerificationReport>(resolve=>{stop=resolve;});
    });
    for(let n=0;n<50&&!stop;n++)await new Promise(resolve=>setTimeout(resolve,20));
    const headers={authorization:`Bearer ${TOKEN}`};
    const job=(await app.inject({method:"GET",url:`/entity-verification/jobs/${first.id}`,headers})).json();
    expect(job.progress).toMatchObject({phase:"evaluating",evaluated:3});
    expect((await app.inject({method:"GET",url:`/entity-verification/album/${album}`,headers})).json()).toMatchObject({inProgress:true,score:null});
    await recoverIndividualJobs();
    expect((await getIndividualJob(first.id))?.status).toBe("running");
    await getPool().query("UPDATE ingest.entity_verification_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    await recoverIndividualJobs();
    expect(await getIndividualVerification("album",album)).toMatchObject({inProgress:true,score:null});
    expect((await app.inject({method:"GET",url:`/entity-verification/album/${album}/latest-job`,headers})).json()).toMatchObject({id:first.id,status:"paused",progress:{evaluated:3}});
    stop!(evaluateVerification(snapshot,[],undefined,true));
    const resumed=await controlIndividualVerification(first.id,"resume","QA",{},async()=>evaluateVerification(snapshot,[],undefined,true));
    expect(resumed.id).not.toBe(first.id);
    for(let n=0;n<50&&(await getIndividualJob(resumed.id))?.status!=="done";n++)await new Promise(resolve=>setTimeout(resolve,20));
    expect((await getIndividualJob(first.id))?.status).toBe("paused");
    expect(await getIndividualVerification("album",album)).not.toHaveProperty("inProgress");
    expect((await getIndividualJob(resumed.id))?.status).toBe("done");
  });
  it("persiste propuestas y datos pendientes y los retoma con un contrato que cabe en ai_runs",async()=>{
    const full=await loadVerificationSnapshot("artist",artist);const snapshot={...full,units:full.units.slice(0,2),sourceUrls:["https://archivo.example/banda-qa"]};
    const page={url:snapshot.sourceUrls[0]!,title:"Banda QA",content:"Banda QA, banda formada en 2000. Músico QA toca Bass.",contentHash:createHash("sha256").update("Banda QA, banda formada en 2000. Músico QA toca Bass.").digest("hex"),fetchedAt:new Date().toISOString()};
    const response=(key:string)=>({findings:[{key,status:"unverified",observed:null,reason:"No hay respaldo suficiente",evidence:[]}],discoveries:[]});
    // The call fails twice, then its halves: the first answers, the second keeps failing and stays pending.
    const gateway=createDeepSeekGateway(new MockDeepSeekTransport("truncada","truncada",response(snapshot.units[0]!.key),"truncada","truncada",{findings:[],discoveries:[]}));
    const partial=await researchStored(snapshot,{search:async()=>[],page:async()=>page},gateway);
    expect(partial.evaluation).toMatchObject({processed:1,complete:false,pendingKeys:[snapshot.units[1]!.key]});
    expect((await getPool().query("SELECT state FROM ingest.entity_verification_research_state WHERE entity_kind='artist' AND entity_id=$1",[artist])).rows[0].state.pendingKeys).toEqual([snapshot.units[1]!.key]);
    const before=(await getPool().query("SELECT id,state FROM ingest.entity_verification_research_versions WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[artist])).rows[0];
    const finished=await researchStored(snapshot,{search:async()=>{throw new Error("No repetir búsqueda");},page:async()=>null},createDeepSeekGateway(new MockDeepSeekTransport(response(snapshot.units[1]!.key))));
    expect(finished.evaluation).toMatchObject({processed:2,complete:true,pendingKeys:[]});
    const versions=(await getPool().query("SELECT id,parent_version_id,state FROM ingest.entity_verification_research_versions WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id",[artist])).rows;
    expect(versions).toHaveLength(2);expect(versions[0].state).toEqual(before.state);expect(versions[1].parent_version_id).toBe(before.id);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.ai_runs WHERE schema_version LIKE 'verification.reading.%'")).rows[0].n).toBeGreaterThan(0);
    await saveIndividualVerification({...finished,evaluation:{...finished.evaluation!,complete:false,pendingKeys:[snapshot.units[1]!.key]},suggestions:[]},"QA");
    const stored=(await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[artist])).rows[0].report;
    const serialized=verificationReportSchema.parse(stored);expect(serialized.rulesVersion).toBe(RULES_VERSION);expect(serialized.evaluation?.pendingKeys).toEqual([snapshot.units[1]!.key]);expect(serialized.suggestions).toEqual([]);
  });

  it("abre versiones y reprocesa copias preservadas con presupuesto y reanudación sin búsquedas ni descargas",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name,artist_type) VALUES('Archivo QA','band') RETURNING id")).rows[0].id);
    const full=await loadVerificationSnapshot("artist",entity),snapshot={...full,units:full.units.slice(0,1),sourceUrls:["https://archivo.example/version-qa"]};
    const content="Archivo QA es una banda venezolana. Publicó Disco Histórico en 2001.",page={url:snapshot.sourceUrls[0]!,title:"Archivo QA",content,contentHash:createHash("sha256").update(content).digest("hex"),fetchedAt:"2026-10-10T00:00:00Z",capturedAt:"2026-10-10T00:00:00Z",acquisitionMethod:"http" as const};
    const response={findings:[{key:snapshot.units[0]!.key,status:"confirmed",observed:"Archivo QA",reason:"Nombre documentado",evidence:[{source:0,quote:content}]}],discoveries:[{area:"discography",value:"Disco Histórico",context:"Archivo QA",reason:"Lanzamiento documentado",evidence:[{source:0,quote:content}]}]};
    const report=await researchStored(snapshot,{search:async()=>[],page:async()=>page},createDeepSeekGateway(new MockDeepSeekTransport({...response,discoveries:[]},{findings:[],discoveries:response.discoveries})));
    const versionId=await saveIndividualVerification(report,"QA archivo"),headers={authorization:`Bearer ${TOKEN}`},base=`/entity-verification/artist/${entity}/versions`;
    expect((await app.inject({method:"GET",url:base})).statusCode).toBe(401);
    const history=await app.inject({method:"GET",url:base,headers});expect(history.statusCode).toBe(200);expect(history.json().versions).toMatchObject([{id:versionId,reprocessAvailable:true,sourceCount:1}]);
    expect((await app.inject({method:"GET",url:`/entity-verification/artist/${artist}/versions/${versionId}`,headers})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:`${base}/${versionId}/reprocess`})).statusCode).toBe(401);
    const missing=await app.inject({method:"POST",url:`${base}/${versionId+99999}/reprocess`,headers});expect(missing.statusCode,missing.body).toBe(404);
    const original=(await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE id=$1",[versionId])).rows[0].report;
    await getPool().query("UPDATE public.artists SET picture_url='https://archivo.example/retrato.jpg' WHERE id=$1",[entity]);
    const historical=await app.inject({method:"GET",url:`${base}/${versionId}`,headers});expect(historical.statusCode).toBe(200);expect(historical.json()).toMatchObject({stale:true,score:null,researchVersionId:report.researchVersionId});
    const now=await loadVerificationSnapshot("artist",entity),transport=new MockDeepSeekTransport(...Array.from({length:20},()=>({findings:now.units.map(unit=>({key:unit.key,status:"unverified",observed:null,reason:"Dato pendiente",evidence:[]})),discoveries:[]})));
    const work:VerificationWork=async(_kind,_id,notify,options)=>{
      expect(options.preservedOnly).toBe(true);
      return researchStored(now,{search:async()=>{throw Error("No buscar durante reprocesamiento");},page:async()=>{throw Error("No descargar durante reprocesamiento");}},createDeepSeekGateway(transport),notify,options);
    };
    const created=await reprocessIndividualVerification("artist",entity,versionId,"QA archivo",{maxCalls:0},work);
    for(let n=0;n<200&&["queued","running"].includes((await getIndividualJob(created.id))!.status);n++)await new Promise(resolve=>setTimeout(resolve,25));
    const partial=(await getIndividualJob(created.id))!;expect(partial).toMatchObject({status:"partial",sourceReportId:versionId,preservedOnly:true});expect(partial.reportId).toBeDefined();
    const resumed=await controlIndividualVerification(created.id,"resume","QA archivo",{maxCalls:30},work);
    for(let n=0;n<200&&["queued","running"].includes((await getIndividualJob(resumed.id))!.status);n++)await new Promise(resolve=>setTimeout(resolve,25));
    expect((await getIndividualJob(resumed.id))?.status).toBe("done");
    const result=await getIndividualVerification("artist",entity);expect(result.evaluation?.complete).toBe(true);expect(result.sources[0]).toMatchObject({url:page.url,contentHash:page.contentHash,capturedAt:page.capturedAt});
    expect(result.suggestions?.some(finding=>finding.observed==="Disco Histórico")).toBe(true);
    expect((await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE id=$1",[versionId])).rows[0].report).toEqual(original);
    const versions=(await getPool().query("SELECT id,parent_version_id FROM ingest.entity_verification_research_versions WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id",[entity])).rows;
    expect(versions).toHaveLength(3);expect(Number(versions[1].parent_version_id)).toBe(report.researchVersionId);expect(versions[2].parent_version_id).toBe(versions[1].id);
  });

  it("reanuda el checkpoint propio tras un fallo de publicación aunque otra ejecución haya sustituido el estado de la ficha",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name,artist_type) VALUES('Checkpoint QA','band') RETURNING id")).rows[0].id);
    const snapshot=await loadVerificationSnapshot("artist",entity),content="Checkpoint QA es una banda venezolana.",page={url:"https://archivo.example/checkpoint",title:snapshot.name,content,contentHash:createHash("sha256").update(content).digest("hex"),fetchedAt:"2026-10-10T00:00:00Z"};
    const transport=new MockDeepSeekTransport(...Array.from({length:20},()=>({findings:snapshot.units.map(unit=>({key:unit.key,status:"unverified",observed:null,reason:"Pendiente",evidence:[]})),discoveries:[]})));
    let first=true,searches=0,downloads=0;
    const work:VerificationWork=async(_kind,_id,notify,options)=>{
      const report=await researchStored(snapshot,{search:async()=>{searches++;if(!first)throw Error("No repetir búsquedas");return [{url:page.url,title:page.title,snippet:content}];},page:async()=>{downloads++;if(!first)throw Error("No repetir descargas");return page;}},createDeepSeekGateway(transport),notify,options);
      if(first){first=false;throw Error("Fallo después del checkpoint, antes de publicar");}
      return report;
    };
    const created=await startIndividualVerification("artist",entity,"QA",work);
    for(let n=0;n<200&&["queued","running"].includes((await getIndividualJob(created.id))!.status);n++)await new Promise(resolve=>setTimeout(resolve,25));
    const failed=(await getIndividualJob(created.id))!;expect(failed.status).toBe("failed");expect(failed.reportId).toBeUndefined();expect(failed.researchVersionId).toBeDefined();
    const counts={searches,downloads,calls:transport.requests.length};
    await getPool().query("UPDATE ingest.entity_verification_research_state SET state=jsonb_set(state,'{pages}','[]'::jsonb) WHERE entity_kind='artist' AND entity_id=$1",[entity]);
    const resumed=await controlIndividualVerification(created.id,"resume","QA",{},work);
    for(let n=0;n<200&&["queued","running"].includes((await getIndividualJob(resumed.id))!.status);n++)await new Promise(resolve=>setTimeout(resolve,25));
    expect((await getIndividualJob(resumed.id))?.status).toBe("done");expect({searches,downloads,calls:transport.requests.length}).toEqual(counts);
    expect((await getIndividualVerification("artist",entity)).sources).toMatchObject([{url:page.url,contentHash:page.contentHash}]);
  });

  it("controla pausa y cancelación por la API y distingue un resultado parcial de uno terminado",async()=>{
    let finish:((report:VerificationReport)=>void)|undefined;
    const snapshot=await loadVerificationSnapshot("artist",artist);
    const created=await startIndividualVerification("artist",artist,"QA",async()=>new Promise<VerificationReport>(resolve=>{finish=resolve;}));
    for(let n=0;n<50&&!finish;n++)await new Promise(resolve=>setTimeout(resolve,20));
    const controlUrl=`/entity-verification/jobs/${created.id}/control`;
    expect((await app.inject({method:"POST",url:controlUrl,payload:{action:"pause"}})).statusCode).toBe(401);
    const headers={authorization:`Bearer ${TOKEN}`};
    const paused=await app.inject({method:"POST",url:controlUrl,headers,payload:{action:"pause"}});
    expect(paused.statusCode).toBe(200);expect(paused.json()).toMatchObject({status:"running",control:"paused"});
    expect((await app.inject({method:"POST",url:controlUrl,headers,payload:{action:"resume"}})).statusCode).toBe(400);
    finish!({...evaluateVerification(snapshot,[],undefined,true),evaluation:{total:snapshot.units.length,processed:0,pendingKeys:snapshot.units.map(u=>u.key),attempts:0,complete:false}});
    for(let n=0;n<50&&(await getIndividualJob(created.id))?.status==="running";n++)await new Promise(resolve=>setTimeout(resolve,20));
    expect((await getIndividualJob(created.id))?.status).toBe("paused");
    const cancelled=await app.inject({method:"POST",url:controlUrl,headers,payload:{action:"cancel"}});
    expect(cancelled.statusCode).toBe(200);expect(cancelled.json().status).toBe("cancelled");
    const partial=await startIndividualVerification("artist",artist,"QA",async()=>({...evaluateVerification(snapshot,[],undefined,true),evaluation:{total:snapshot.units.length,processed:0,pendingKeys:snapshot.units.map(u=>u.key),attempts:0,complete:false}}));
    for(let n=0;n<50&&(await getIndividualJob(partial.id))?.status!=="partial";n++)await new Promise(resolve=>setTimeout(resolve,20));
    expect((await getIndividualJob(partial.id))?.status).toBe("partial");
    expect(await activeIndividualJob("artist",artist)).toBeNull();
  });

  it("conserva un trabajo de otro proceso con lease vigente y recupera solo el expirado",async()=>{
    const existing=await getPool().query<{id:string}>("INSERT INTO ingest.entity_verification_jobs(entity_kind,entity_id,requested_by,status,lease_owner,lease_expires_at) VALUES('person',$1,'otro proceso','running','foreign-worker',now()+interval '1 minute') RETURNING id::text",[person]);
    const id=Number(existing.rows[0]!.id);
    await recoverIndividualJobs();expect((await getIndividualJob(id))?.status).toBe("running");
    await getPool().query("UPDATE ingest.entity_verification_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[id]);
    await recoverIndividualJobs();expect((await getIndividualJob(id))?.status).toBe("paused");
  });

  it("no publica informes ni inventario si el proceso perdió el trabajo antes del guardado final",async()=>{
    const report=evaluateVerification(await loadVerificationSnapshot("person",person),[]);
    const before=(await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_verification_reports")).rows[0].n;
    const existing=await getPool().query<{id:string}>("INSERT INTO ingest.entity_verification_jobs(entity_kind,entity_id,requested_by,status,lease_owner,lease_expires_at) VALUES('person',$1,'QA','running','current-owner',now()+interval '1 minute') RETURNING id::text",[person]);
    const id=Number(existing.rows[0]!.id);
    await expect(saveIndividualVerification(report,"QA",{jobId:id,owner:"expired-owner",status:"done"})).rejects.toThrow("perdió la propiedad");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_verification_reports")).rows[0].n).toBe(before);
    expect((await getIndividualJob(id))?.status).toBe("running");
    await saveIndividualVerification(report,"QA",{jobId:id,owner:"current-owner",status:"done"});
    expect((await getIndividualJob(id))?.status).toBe("done");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_verification_reports")).rows[0].n).toBe(before+1);
  });

  it("envía todas las alternativas documentadas a Curaduría sin cambiar las imágenes principales ni reabrir rechazos",async()=>{
    const snapshot=await loadVerificationSnapshot("artist",artist);
    const url="https://fuente.example/fotos";
    const resources=[
      {context:"Banda QA",value:"https://fuente.example/retrato1.jpg",quote:"Imagen: Retrato Banda QA | URL: https://fuente.example/retrato1.jpg | Dimensiones declaradas: 1200 × 1600 px"},
      {context:"Banda QA",value:"https://fuente.example/retrato2.jpg",quote:"Imagen: Retrato Banda QA | URL: https://fuente.example/retrato2.jpg"},
      {context:"Disco QA",value:"https://fuente.example/portada.jpg",quote:"Imagen: Portada Disco QA de Banda QA | URL: https://fuente.example/portada.jpg"},
    ];
    const page={url,title:"Banda QA Disco QA",content:resources.map(r=>r.quote).join(" · "),contentHash:"images-qa",fetchedAt:new Date().toISOString()};
    const report=evaluateVerification(snapshot,[page],{findings:[],discoveries:resources.map(r=>({area:"images" as const,...r,reason:"Recurso documentado",evidence:[{source:0,quote:r.quote}]}))},true);
    await saveIndividualVerification(report,"QA imágenes");
    await saveIndividualVerification(report,"QA imágenes repetidas");
    const rows=(await getPool().query("SELECT entity_kind,artist_id,album_id,candidate_url,page_url,width,height,current_url FROM ingest.image_candidates WHERE origin='verificacion-fuentes' ORDER BY id")).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({entity_kind:"artist",artist_id:String(artist),page_url:url,width:1200,height:1600,current_url:null});
    expect(rows[2]).toMatchObject({entity_kind:"album",album_id:String(album),page_url:url,current_url:null});
    expect((await getPool().query("SELECT picture_url FROM public.artists WHERE id=$1",[artist])).rows[0].picture_url).toBeNull();
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1",[album])).rows[0].cover_url).toBeNull();
    await getPool().query("UPDATE ingest.image_candidates SET status='rejected' WHERE candidate_url=$1",[resources[0]!.value]);
    await saveIndividualVerification(report,"QA imágenes decididas");
    expect((await getPool().query("SELECT status FROM ingest.image_candidates WHERE candidate_url=$1",[resources[0]!.value])).rows[0].status).toBe("rejected");
  });

});
