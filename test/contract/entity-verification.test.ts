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
import { activeIndividualJob,getIndividualJob,getIndividualVerification,recoverIndividualJobs,saveIndividualVerification,startIndividualVerification } from "../../src/verification/store.js";
import { verificationReportSchema } from "../../src/api/routes/entity-verification.js";
import { researchStored } from "../../src/verification/research-state.js";
import { createDeepSeekGateway, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { RULES_VERSION } from "../../src/verification/proof.js";
import type { VerificationReport } from "../../src/verification/types.js";

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
    const report=evaluateVerification(snapshot,[{url:"https://fuente.example/qa",title:"Disco QA",content:"Banda QA publicó Disco QA en 2001.",contentHash:"qa",fetchedAt:new Date().toISOString()}],{findings:[{key:"identity.name",status:"confirmed",observed:"Disco QA",reason:"Disco y artista documentados",evidence:[{source:0,quote:"Banda QA publicó Disco QA en 2001."}]}],discoveries:[]},true);
    await saveIndividualVerification(report,"QA admin");
    expect(await getIndividualVerification("album",album)).toMatchObject({score:report.score,stale:false,researched:true});
    expect((await getIndividualVerification("album",album)).findings[0]?.evidence).toHaveLength(1);
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
    expect(await getIndividualVerification("album",album)).toMatchObject({inProgress:true,score:null});
    expect((await app.inject({method:"GET",url:`/entity-verification/album/${album}/latest-job`,headers})).json()).toMatchObject({id:first.id,status:"failed",progress:{evaluated:3}});
    stop!(evaluateVerification(snapshot,[],undefined,true));
    for(let n=0;n<50&&(await getIndividualJob(first.id))?.status!=="done";n++)await new Promise(resolve=>setTimeout(resolve,20));
    expect(await getIndividualVerification("album",album)).not.toHaveProperty("inProgress");
    expect((await getIndividualJob(first.id))?.progress?.phase).toBe("done");
  });
  it("persiste propuestas y datos pendientes y los retoma con un contrato que cabe en ai_runs",async()=>{
    const full=await loadVerificationSnapshot("artist",artist);const snapshot={...full,units:full.units.slice(0,2),sourceUrls:["https://archivo.example/banda-qa"]};
    const page={url:snapshot.sourceUrls[0]!,title:"Banda QA",content:"Banda QA, banda formada en 2000. Músico QA toca Bass.",contentHash:"state-qa",fetchedAt:new Date().toISOString()};
    const response=(key:string)=>({findings:[{key,status:"unverified",observed:null,reason:"No hay respaldo suficiente",evidence:[]}],discoveries:[]});
    const gateway=createDeepSeekGateway(new MockDeepSeekTransport(response(snapshot.units[0]!.key),{findings:[],discoveries:[]},{findings:[],discoveries:[]}));
    const partial=await researchStored(snapshot,{search:async()=>[],page:async()=>page},gateway);
    expect(partial.evaluation).toMatchObject({processed:1,complete:false,pendingKeys:[snapshot.units[1]!.key]});
    expect((await getPool().query("SELECT state FROM ingest.entity_verification_research_state WHERE entity_kind='artist' AND entity_id=$1",[artist])).rows[0].state.pendingKeys).toEqual([snapshot.units[1]!.key]);
    const finished=await researchStored(snapshot,{search:async()=>{throw new Error("No repetir búsqueda");},page:async()=>null},createDeepSeekGateway(new MockDeepSeekTransport(response(snapshot.units[1]!.key))));
    expect(finished.evaluation).toMatchObject({processed:2,complete:true,pendingKeys:[]});
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.ai_runs WHERE schema_version LIKE 'verification.v4.compact.%'")).rows[0].n).toBeGreaterThan(0);
    await saveIndividualVerification({...finished,evaluation:{...finished.evaluation!,complete:false,pendingKeys:[snapshot.units[1]!.key]},suggestions:[]},"QA");
    const stored=(await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[artist])).rows[0].report;
    const serialized=verificationReportSchema.parse(stored);expect(serialized.rulesVersion).toBe(RULES_VERSION);expect(serialized.evaluation?.pendingKeys).toEqual([snapshot.units[1]!.key]);expect(serialized.suggestions).toEqual([]);
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
