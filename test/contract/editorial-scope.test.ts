import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { startPgContainer,type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb,getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { excludedArtist } from "../../src/catalog/editorial-scope.js";
import { getEphemerides } from "../../src/api/repositories/ephemerides.js";
import { listArtists,getArtistDetail } from "../../src/api/repositories/artists.js";
import { getAlbumDetail,scopedCreditsByType } from "../../src/api/repositories/albums.js";
import { createEntity,withOperatorRun } from "../../src/merge/operator.js";
import { resolvePersonArtist } from "../../src/curation/ai/person-artist.js";
import { getPersonDetail } from "../../src/api/repositories/persons.js";
import { admitArtist } from "../../src/catalog/editorial-admissions.js";

describe("retiro editorial y conservación independiente de efemérides",()=>{
  let pg:PgContainer, artist:number,person:number,album:number,local:number,localAlbum:number;
  beforeAll(async()=>{
    pg=await startPgContainer();process.env["DATABASE_URL"]=pg.databaseUrl;resetEnvCache();
    await applyCore(pg.name);await migrateUp();
    const db=getPool();
    artist=Number((await db.query("INSERT INTO public.artists(name,origin_country) VALUES('Extranjero de prueba','Brasil') RETURNING id")).rows[0].id);
    local=Number((await db.query("INSERT INTO public.artists(name) VALUES('Banda venezolana de prueba') RETURNING id")).rows[0].id);
    person=Number((await db.query("INSERT INTO public.persons(name) VALUES('Persona extranjera de prueba') RETURNING id")).rows[0].id);
    album=Number((await db.query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Discografía ajena') RETURNING id",[artist])).rows[0].id);
    localAlbum=Number((await db.query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Recopilación venezolana') RETURNING id",[local])).rows[0].id);
    await db.query("INSERT INTO public.album_credits(album_id,artist_id,credit_type,role) VALUES($1,$2,'guest','Invitado')",[localAlbum,artist]);
    await db.query("INSERT INTO ingest.artist_editorial_policy(artist_id,disposition,reference_kind,reason,snapshot,decided_by) VALUES($1,'reference','person','Decisión del propietario','{}','test')",[artist]);
    await db.query("INSERT INTO ingest.artist_editorial_names(artist_id,name) VALUES($1,'Extranjero de prueba'),($1,'Alias de prueba')",[artist]);
    await db.query("INSERT INTO ingest.artist_editorial_persons(artist_id,person_id) VALUES($1,$2)",[artist,person]);
    await db.query("INSERT INTO ingest.artist_editorial_identifiers(artist_id,namespace,identifier) VALUES($1,'platform:spotify','foreign-id')",[artist]);
  },180_000);
  afterAll(async()=>{await closeDb();await pg?.stop();},60_000);
  it("retira ficha y discos públicos; conserva todas las filas originales",async()=>{
    expect(await getArtistDetail(artist)).toBeNull();
    expect(await getAlbumDetail(album)).toBeNull();
    const list=await listArtists({limit:20,offset:0});expect(list.rows.map(r=>r.id)).toEqual([local]);
    expect((await getPool().query("SELECT id FROM public.albums WHERE id=$1",[album])).rowCount).toBe(1);
  });
  it("conserva el crédito externo y lo lleva a la persona, sin enlace a artista",async()=>{
    const detail=await getAlbumDetail(localAlbum);
    expect(detail?.credits[0]).toMatchObject({personId:person,artistId:null,artistName:"Extranjero de prueba"});
    const personDetail=await getPersonDetail(person);
    expect(personDetail?.artistConversionBlocked).toBe(true);
    expect(personDetail?.albumCredits).toHaveLength(1);
  });
  it("bloquea altas por nombre y alias incluso mediante SQL directo",async()=>{
    for(const name of ["Extranjero de prueba"," ALIAS  DE PRUEBA "])
      await expect(getPool().query("INSERT INTO public.artists(name) VALUES($1)",[name])).rejects.toMatchObject({code:"PCE01"});
    await expect(withOperatorRun({name:"test",operator:"test",note:"Intento de reimportación"},ctx=>createEntity(ctx,"artist",{name:"Alias de prueba"}))).rejects.toThrow("decisión editorial");
  });
  it("bloquea discografía, renombres y borrados que perderían evidencia",async()=>{
    await expect(getPool().query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Nuevo disco')",[artist])).rejects.toMatchObject({code:"PCE01"});
    await expect(getPool().query("UPDATE public.artists SET name='Otra forma' WHERE id=$1",[artist])).rejects.toMatchObject({code:"PCE01"});
    await expect(getPool().query("DELETE FROM public.albums WHERE id=$1",[album])).rejects.toMatchObject({code:"PCE01"});
  });
  it("un identificador conocido no puede vincularse a otra ficha",async()=>{
    await expect(getPool().query("INSERT INTO public.streaming_links(artist_id,platform,url,external_id,method,source) VALUES($1,'spotify','https://open.spotify.com/artist/foreign-id','foreign-id','manual','test')",[local])).rejects.toMatchObject({code:"PCE01"});
  });
  it("impide convertir a la persona antes de investigar con IA",async()=>{
    expect(await excludedArtist(getPool(),{personId:person})).toBeTruthy();
    const result=await resolvePersonArtist(person,"test",async()=>{throw new Error("No debe investigar");});
    expect(result.action).toBe("conflict");expect(result.artistId).toBeNull();
    await expect(getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'solista')",[local,person])).rejects.toMatchObject({code:"PCE01"});
  });
  it("solo publica fechas verificadas; conserva discrepancias y respeta el ciclo de Caracas",async()=>{
    const db=getPool();
    for(const [key,date,status] of [["concierto","2010-03-12","verified"],["discrepancia",null,"pending"]])
      await db.query("INSERT INTO ingest.ephemerides(event_key,title,description,event_date,event_year,place,subject_name,status,sources,created_by) VALUES($1,'Concierto','Hecho conservado',$2,2010,'Caracas','Banda extranjera',$3,'[{\"title\":\"Fuente\",\"url\":\"https://example.org/hecho\"}]','test')",[key,date,status]);
    const today=await getEphemerides("2026-03-12");expect(today.today).toHaveLength(1);expect(today.events).toHaveLength(1);
    expect(today.dailyCycle.timeZone).toBe("America/Caracas");
    expect((await getEphemerides("2026-03-13")).today).toHaveLength(0);
    expect((await db.query("SELECT count(*)::int n FROM ingest.ephemerides")).rows[0].n).toBe(2);
    await expect(db.query(await readFile("migrations/0096_editorial_scope_ephemerides.down.sql","utf8"))).rejects.toThrow("decisiones editoriales");
    await db.query("ROLLBACK");
  });
  it("no agrupa créditos de colectivos distintos como un único crédito",()=>{
    const base={creditType:"guest",role:"Invitado",personId:null,personName:null,personIsDeceased:false,artistId:null,organizationId:null,organizationName:null};
    const track={id:1,discNumber:1,trackNumber:1,title:"Tema",durationSeconds:null,youtubeStartSeconds:null,notes:null,hasLyrics:false,credits:[{...base,id:1,artistName:"Banda A"},{...base,id:2,artistName:"Banda B"}]};
    expect(scopedCreditsByType([track],[])["guest"]).toHaveLength(2);
  });
  it("un proyecto venezolano en el exterior se reincorpora por decisión explícita y queda protegido",async()=>{
    const result=await withOperatorRun({name:"test-admission",operator:"Brian",note:"Proyecto de venezolanos aunque se forme en Brasil"},ctx=>admitArtist(ctx,artist,"Músico venezolano documentado",["Confirmación del propietario"]));
    expect(result.result.reinstated).toBe(true);
    expect(await getArtistDetail(artist)).not.toBeNull();
    expect(await excludedArtist(getPool(),{personId:person})).toBeUndefined();
    const previous=(await getPool().query("SELECT previous_exclusion FROM ingest.artist_editorial_admissions WHERE artist_id=$1",[artist])).rows[0];
    expect(previous.previous_exclusion.names.length).toBe(2);
    await expect(getPool().query("INSERT INTO ingest.artist_editorial_policy(artist_id,disposition,reference_kind,reason,snapshot,decided_by) VALUES($1,'reference','person','No reside en Venezuela','{}','importador')",[artist])).rejects.toMatchObject({code:"PCE02"});
  });
});
