import { scryptSync } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer,type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb,getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { refreshSearchIndex } from "../../src/api/search-index.js";
import { comparisonReportSchema } from "../../src/api/routes/entity-comparison.js";
import { evaluateJoint,loadComparisonSide,normalizePair } from "../../src/verification/comparison.js";
import { activeComparisonJob,comparisonHistory,getComparison,getComparisonJob,recoverComparisonJobs,saveComparison,startComparison } from "../../src/verification/comparison-store.js";
import type { ComparisonReport,EntityRef } from "../../src/verification/comparison-types.js";
const TOKEN="comparaciones-cruzadas-token-admin-0123456789";
const PASSWORD="clave-larga-lector-qa";const salt=Buffer.from("comparison-test-salt");
const hash=`scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(PASSWORD,salt,64).toString("base64url")}`;
describe("comparaciones desde fichas: API, almacenamiento y privacidad",()=>{
 let container:PgContainer,app:FastifyInstance;let artist:EntityRef,person:EntityRef,album:EntityRef,other:EntityRef;
 const headers={authorization:`Bearer ${TOKEN}`};
 const url=(l:EntityRef,r:EntityRef)=>`/entity-verification/compare?leftKind=${l.kind}&leftId=${l.id}&rightKind=${r.kind}&rightId=${r.id}`;
 beforeAll(async()=>{
  container=await startPgContainer();process.env["DATABASE_URL"]=container.databaseUrl;process.env["CRV_OPERATOR_TOKEN"]=TOKEN;
  process.env["CRV_COLLABORATORS_JSON"]=JSON.stringify([{username:"lector.qa",name:"Lector QA",passwordHash:hash,role:"reader"}]);resetEnvCache();await applyCore(container.name);await migrateUp();
  const a=(await getPool().query("INSERT INTO public.artists(name,artist_type) VALUES('Voz QA','solo_artist') RETURNING id")).rows[0].id;
  const p=(await getPool().query("INSERT INTO public.persons(name) VALUES('Pedro QA') RETURNING id")).rows[0].id;
  const albums=(await getPool().query("INSERT INTO public.albums(title,artist_id,release_year) VALUES('Álbum Único',$1,2000),('Disco Dos',$1,2001) RETURNING id",[a])).rows;
  artist={kind:"artist",id:Number(a)};person={kind:"person",id:Number(p)};album={kind:"album",id:Number(albums[0].id)};other={kind:"album",id:Number(albums[1].id)};
  await getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Vocals')",[artist.id,person.id]);
  await getPool().query("INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds) VALUES($1,1,1,'Primera',120)",[album.id]);
  await getPool().query("INSERT INTO ingest.album_aliases(album_id,alias,normalized_alias) VALUES($1,'Apodo Único','apodo unico')",[album.id]);
  app=await buildApp();
 },120000);
 afterAll(async()=>{await app?.close();await closeDb();delete process.env["CRV_OPERATOR_TOKEN"];delete process.env["CRV_COLLABORATORS_JSON"];resetEnvCache();await container?.stop();},60000);
 it("protege todas las lecturas y escrituras; admin recibe un contrato completo sin caché",async()=>{
  const login=await app.inject({method:"POST",url:"/auth/login",payload:{username:"lector.qa",password:PASSWORD}});expect(login.statusCode).toBe(200);
  const cookie=(login.headers["set-cookie"] as string).split(";",1)[0]!;
  for(const request of [{method:"GET" as const,url:url(artist,person)},{method:"GET" as const,url:url(artist,person).replace("compare?","compare/active-job?")},{method:"GET" as const,url:`/entity-verification/compare/history/artist/${artist.id}`},{method:"GET" as const,url:"/entity-verification/compare/jobs/1"},{method:"POST" as const,url:"/entity-verification/compare/jobs",payload:{left:artist,right:person}}]) {
   expect((await app.inject(request)).statusCode).toBe(401);expect((await app.inject({...request,headers:{cookie,"x-crv-csrf":login.json().csrf}})).statusCode).toBe(403);
  }
  const response=await app.inject({method:"GET",url:url(artist,person),headers});expect(response.statusCode).toBe(200);expect(response.headers["cache-control"]).toBe("no-store");expect(comparisonReportSchema.parse(response.json()).score).toBeNull();
  expect((await app.inject({method:"GET",url:url(artist,artist),headers})).statusCode).toBe(400);expect((await app.inject({method:"GET",url:url(artist,album),headers})).statusCode).toBe(400);
  expect((await app.inject({method:"GET",url:url(artist,{kind:"person",id:99999}),headers})).statusCode).toBe(404);
 });
 it("busca álbumes por título, alias o artista, con o sin tildes",async()=>{
  await refreshSearchIndex("album");
  for(const q of ["album unico","apodo unico","Voz QA"]){const response=await app.inject({method:"GET",url:`/search?types=album&q=${encodeURIComponent(q)}`});expect(response.statusCode).toBe(200);expect(response.json().album.map((a:{id:number})=>a.id)).toContain(album.id);}
 });
 it("guarda versiones y evidencias accesibles desde ambas fichas; invalida una edición al cambiar duración",async()=>{
  const refs=normalizePair(album,other);const [l,r]=await Promise.all(refs.map(loadComparisonSide));const report=evaluateJoint(l!,r!,[],undefined,true);
  await saveComparison(report,"QA");expect(await getComparison(other,album)).toMatchObject({stale:false,score:report.score});
  expect((await comparisonHistory(album))[0]?.target).toEqual(other);expect((await comparisonHistory(other))[0]?.target).toEqual(album);
  await getPool().query("UPDATE public.tracks SET duration_seconds=121 WHERE album_id=$1",[album.id]);expect(await getComparison(album,other)).toMatchObject({stale:true,score:null});
  const fresh=await getComparison(album,other);await saveComparison({...fresh,stale:false},"QA");expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_comparison_reports")).rows[0].n).toBe(2);
 });
 it("un trabajo es compartido en ambos sentidos, visible desde la API y termina con informe persistido",async()=>{
  let finish:((report:ComparisonReport)=>void)|undefined;
  const first=await startComparison(artist,person,"QA",()=>new Promise(resolve=>{finish=resolve;}));
  expect((await startComparison(person,artist,"QA",()=>{throw new Error("No debe ejecutarse dos veces");})).id).toBe(first.id);
  const accepted=await app.inject({method:"POST",url:"/entity-verification/compare/jobs",headers,payload:{left:person,right:artist}});expect(accepted.statusCode).toBe(200);expect(accepted.json().id).toBe(first.id);
  const refs=normalizePair(artist,person);for(let n=0;n<50&&!finish;n++)await new Promise(resolve=>setTimeout(resolve,20));
  const [l,r]=await Promise.all(refs.map(loadComparisonSide));const quote="Voz QA es el alias y nombre artístico de Pedro QA.";
  finish!(evaluateJoint(l!,r!,[{url:"https://oficial.example/qa",title:"Voz QA",content:quote,contentHash:"qa",fetchedAt:new Date().toISOString()}],{conclusion:"same_identity",explanation:"Alias documentado",evidence:[{source:0,quote}]},true));
  for(let n=0;n<50&&(await getComparisonJob(first.id))?.status!=="done";n++)await new Promise(resolve=>setTimeout(resolve,20));
  expect(await getComparisonJob(first.id)).toMatchObject({status:"done",error:null});expect(await activeComparisonJob(person,artist)).toBeNull();
  const response=await app.inject({method:"GET",url:url(person,artist),headers});expect(response.statusCode).toBe(200);expect(comparisonReportSchema.parse(response.json()).evidence[0]?.quote).toBe(quote);
  expect((await comparisonHistory(person))[0]).toMatchObject({target:artist,status:"done"});
 });
 it("registra fallos y reinicios sin dejar trabajos pendientes para siempre",async()=>{
  const failed=await startComparison(album,other,"QA",async()=>{throw new Error("Fuente no disponible");});
  for(let n=0;n<50&&(await getComparisonJob(failed.id))?.status!=="failed";n++)await new Promise(resolve=>setTimeout(resolve,20));
  expect(await getComparisonJob(failed.id)).toMatchObject({status:"failed",error:"Fuente no disponible"});
  await getPool().query("INSERT INTO ingest.entity_comparison_jobs(pair_key,left_ref,right_ref,requested_by,status) VALUES('interrupted',$1::jsonb,$2::jsonb,'QA','running')",[JSON.stringify(album),JSON.stringify(other)]);
  await recoverComparisonJobs();expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.entity_comparison_jobs WHERE status IN ('queued','running')")).rows[0].n).toBe(0);
 });
});
