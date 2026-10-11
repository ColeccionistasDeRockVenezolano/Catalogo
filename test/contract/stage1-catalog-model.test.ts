import { inventoryHistoricalClaims } from "../../src/evidence/history.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp, DEFAULT_MIGRATIONS_DIR } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { createEntity, updateEntity, withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { writeModel, readModel } from "../../src/catalog/model.js";
import { mergeInto } from "../../src/review/duplicates.js";

const token="qa-stage1-model-01234567890123456789";
describe("etapa 1: precisión e identidad musical, obra, edición y soporte",()=>{
  let database:PgContainer,app:FastifyInstance,person:number,artist:number,cd:number,dvd:number,cdTrack:number,dvdTrack:number,work:number,support:number;
  const oldToken=process.env["CRV_OPERATOR_TOKEN"];
  const op=<T>(fn:Parameters<typeof withOperatorRun<T>>[1])=>withOperatorRun({name:"qa:stage1:model",operator:"QA Modelo",note:"Decisión editorial representativa"},fn);
  const request=(method:"GET"|"POST"|"PATCH",url:string,payload?:object)=>app.inject({method,url,headers:{authorization:`Bearer ${token}`},...(payload?{payload}:{})});
  const migration=async(name:string)=>getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR,name),"utf8"));
  beforeAll(async()=>{
    database=await startPgContainer();process.env["DATABASE_URL"]=database.databaseUrl;process.env["CRV_OPERATOR_TOKEN"]=token;resetEnvCache();
    await applyCore(database.name);
    const old=(await getPool().query("INSERT INTO public.persons(name,birth_date,death_date) VALUES('Fecha histórica exacta','1950-01-01','2000-01-01') RETURNING id")).rows[0];
    person=Number(old.id);
    await migrateUp();app=await buildApp();
    artist=(await op(ctx=>createEntity(ctx,"artist",{name:"Artista modelo",artist_type:"solo_artist"},{allowSimilar:true}))).result.id;
    cd=(await op(ctx=>createEntity(ctx,"album",{title:"Obra compartida",media_format:"CD",release_year:2001},{artistId:artist,allowSimilar:true}))).result.id;
    dvd=(await op(ctx=>createEntity(ctx,"album",{title:"Obra compartida",media_format:"DVD",release_year:2001},{artistId:artist,allowSimilar:true}))).result.id;
    cdTrack=(await op(ctx=>createEntity(ctx,"track",{title:"Audio",track_number:1},{albumId:cd,allowSimilar:true}))).result.id;
    dvdTrack=(await op(ctx=>createEntity(ctx,"track",{title:"Video",track_number:1},{albumId:dvd,allowSimilar:true}))).result.id;
  });
  afterAll(async()=>{await app?.close();await closeDb();await database?.stop();if(oldToken===undefined)delete process.env["CRV_OPERATOR_TOKEN"];else process.env["CRV_OPERATOR_TOKEN"]=oldToken;resetEnvCache();});
  it("la migración conserva días históricos exactos, incluidos los primeros de enero",async()=>{
    const row=(await getPool().query("SELECT birth_date::text,death_date::text,birth_date_value,death_date_value FROM public.persons WHERE id=$1",[person])).rows[0];
    expect(row).toEqual({birth_date:"1950-01-01",death_date:"2000-01-01",birth_date_value:"1950-01-01",death_date_value:"2000-01-01"});
  });
  it.each(["1973","1973-05","~1973-05-12","1973/1974","/1973"])("guarda %s por API sin inventar un día y deshacer restaura el valor anterior",async value=>{
    const result=await request("PATCH",`/persons/${person}`,{birthDate:value,note:"Precisión conocida de la fuente"});expect(result.statusCode).toBe(200);
    expect((await request("GET",`/persons/${person}`)).json().birthDate).toBe(value);
    expect((await getPool().query("SELECT birth_date FROM public.persons WHERE id=$1",[person])).rows[0].birth_date).toBeNull();
    await op(ctx=>undoRun(ctx,result.json().runId));
    expect((await request("GET",`/persons/${person}`)).json().birthDate).toBe("1950-01-01");
  });
  it.each(["1973-02-29","0000","1974/1973","2030"])("rechaza calendario o cronología imposible (%s)",async birthDate=>{
    expect((await request("PATCH",`/persons/${person}`,{birthDate,note:"Negativo de fecha"})).statusCode).toBe(birthDate==="2030"?422:400);
  });
  it("las escrituras antiguas de DATE siguen actualizando la precisión y SQL directo rechaza fechas inválidas",async()=>{
    await getPool().query("UPDATE public.persons SET birth_date='1951-02-03' WHERE id=$1",[person]);
    expect((await request("GET",`/persons/${person}`)).json().birthDate).toBe("1951-02-03");
    await expect(getPool().query("UPDATE public.persons SET birth_date_value='1973-02-29' WHERE id=$1",[person])).rejects.toMatchObject({code:"23514"});
  });
  it("persona y proyecto se vinculan por período sin fusionar fichas ni añadir una membresía inferida",async()=>{
    const result=await op(ctx=>writeModel(ctx,"identity",{personId:person,artistId:artist,relationship:"solo_identity",period:"~1970/2000"}));
    expect((await readModel(getPool(),"person",person)).identities[0]).toMatchObject({person_id:String(person),artist_id:String(artist),relationship:"solo_identity",period:{kind:"interval"}});
    expect((await getPool().query("SELECT count(*)::int AS n FROM public.artist_members WHERE person_id=$1",[person])).rows[0].n).toBe(0);
    await op(ctx=>undoRun(ctx,result.runId));expect((await readModel(getPool(),"person",person)).identities).toHaveLength(0);
  });
  it("CD y DVD comparten obra por decisión explícita y conservan sus pistas y fichas",async()=>{
    work=(await op(ctx=>writeModel(ctx,"work",{title:"Obra compartida",artistId:artist}))).result;
    for(const albumId of [cd,dvd]) {
      const edition=(await readModel(getPool(),"album",albumId)).editions[0]!;
      await op(ctx=>writeModel(ctx,"edition",{workId:work,releaseDate:albumId===cd?"2001":"2001-05",editionName:albumId===cd?"CD original":"DVD de concierto"},Number(edition["id"])));
    }
    expect((await readModel(getPool(),"artist",artist)).editions.map(row=>row["work_id"])).toEqual([String(work),String(work)]);
    await expect(op(ctx=>mergeInto(ctx.client,"album",cd,dvd,ctx.note,ctx.runId))).rejects.toThrow(/ediciones distintas/);
    expect((await getPool().query("SELECT album_id::text,title FROM public.tracks WHERE id=ANY($1::bigint[]) ORDER BY id",[[cdTrack,dvdTrack]])).rows).toEqual([{album_id:String(cd),title:"Audio"},{album_id:String(dvd),title:"Video"}]);
  });
  it("un soporte solo admite pistas de su edición y disco; el padre tampoco puede moverlas silenciosamente",async()=>{
    support=(await op(ctx=>writeModel(ctx,"support",{albumId:cd,format:"CD",discNumber:1,trackIds:[cdTrack]}))).result;
    await expect(op(ctx=>writeModel(ctx,"support",{trackIds:[dvdTrack]},support))).rejects.toThrow(/another edition/);
    await expect(getPool().query("INSERT INTO ingest.support_tracks(support_id,track_id) VALUES($1,$2)",[support,dvdTrack])).rejects.toMatchObject({code:"23514"});
    await expect(op(ctx=>updateEntity(ctx,"track",cdTrack,{disc_number:2}))).rejects.toThrow(/another edition or disc/);
    expect((await readModel(getPool(),"album",cd)).supports[0]!["track_ids"]).toEqual([cdTrack]);
  });
  it("revertir y reaplicar el modelo y las fechas conserva todas las filas y secuencias",async()=>{
    const tables=["catalog_works","catalog_edition_details","musical_identities","edition_support_details","support_tracks","scoped_genres"];
    const snapshot=async(schema:string)=>Promise.all(tables.map(async table=>(await getPool().query(`SELECT to_jsonb(t) AS row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`)).rows));
    await op(ctx=>updateEntity(ctx,"person",person,{birth_date:"1973-05"}));
    const before=await snapshot("ingest");
    await migration("0062_catalog_model.down.sql");expect(await snapshot("crv_evidence_archive")).toEqual(before);
    await migration("0061_person_date_precision.down.sql");
    await migration("0061_person_date_precision.up.sql");await migration("0062_catalog_model.up.sql");
    expect(await snapshot("ingest")).toEqual(before);
    expect((await request("GET",`/persons/${person}`)).json().birthDate).toBe("1973-05");
    expect((await getPool().query("SELECT birth_date FROM public.persons WHERE id=$1",[person])).rows[0].birth_date).toBeNull();
    expect((await op(ctx=>writeModel(ctx,"work",{title:"Después de reaplicar",artistId:artist}))).result).toBeGreaterThan(work);
  });
  it("concilia claims históricos sin inventar captura ni cambiar el catálogo y repetir no duplica",async()=>{
    const original=(await getPool().query("SELECT to_jsonb(t) AS row FROM public.persons t ORDER BY id")).rows;
    const first=await op(ctx=>inventoryHistoricalClaims(ctx,0,10_000));
    expect(first.result.inserted).toBeGreaterThan(0);
    const facts=(await getPool().query("SELECT documentary_state,created_by,value FROM ingest.catalog_facts WHERE relation='historical_claim' ORDER BY id")).rows;
    expect(facts.every(row=>row.documentary_state==="unverifiable"&&row.created_by==="system"&&row.value.captureState==="unknown"&&row.value.claim.field)).toBe(true);
    const second=await op(ctx=>inventoryHistoricalClaims(ctx,0,10_000));expect(second.result.inserted).toBe(0);
    expect((await getPool().query("SELECT to_jsonb(t) AS row FROM public.persons t ORDER BY id")).rows).toEqual(original);
  });
  it("un género por período mantiene su ámbito y su incertidumbre temporal",async()=>{
    const genre=Number((await getPool().query("INSERT INTO ingest.genres(name,slug,level) VALUES('Género QA','genero-qa','family') RETURNING id")).rows[0].id);
    const added=await op(ctx=>writeModel(ctx,"genre",{personId:person,genreSlug:"genero-qa",period:"~1970/1980"}));
    expect((await readModel(getPool(),"person",person)).genres[0]).toMatchObject({genre_id:String(genre),period:{kind:"interval",from:{approximate:true}}});
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.artist_genres WHERE artist_id=$1",[artist])).rows[0].n).toBe(0);
    await op(ctx=>undoRun(ctx,added.runId));expect((await readModel(getPool(),"person",person)).genres).toHaveLength(0);
  });
  it("la API del modelo exige autenticación y motivo y permite leer los vínculos conservados",async()=>{
    expect((await app.inject({method:"GET",url:`/catalog-model/album/${cd}`})).statusCode).toBe(401);
    expect((await request("POST","/catalog-model/work",{title:"Sin motivo",artistId:artist})).statusCode).toBe(400);
    expect((await request("GET",`/catalog-model/album/${cd}`)).json().editions[0].work_title).toBe("Obra compartida");
  });
});
