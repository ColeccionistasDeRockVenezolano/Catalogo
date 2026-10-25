import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startPgContainer,type PgContainer } from '../support/pg-container.js';
import { applyCore } from '../support/apply-core.js';
import { migrateUp } from '../../src/db/migrate.js';
import { getPool,closeDb } from '../../src/db/client.js';
import { resetEnvCache } from '../../src/config/env.js';
import { withOperatorRun,updateEntity } from '../../src/merge/operator.js';
import { getAlbumDetail,listAlbums } from '../../src/api/repositories/albums.js';
import { getArtistDetail } from '../../src/api/repositories/artists.js';

describe('atribución de disco retenida para revisión',()=>{
 let pg:PgContainer,artist:number,other:number,album:number,track:number;
 beforeAll(async()=>{
  pg=await startPgContainer();process.env['DATABASE_URL']=pg.databaseUrl;resetEnvCache();
  await applyCore(pg.name);await migrateUp();
  const db=getPool();
  artist=Number((await db.query("INSERT INTO public.artists(name)VALUES('Banda con homónimo')RETURNING id")).rows[0].id);
  other=Number((await db.query("INSERT INTO public.artists(name,origin_country)VALUES('Homónimo documentado','Italia')RETURNING id")).rows[0].id);
  album=Number((await db.query("INSERT INTO public.albums(artist_id,title)VALUES($1,'Edición mezclada')RETURNING id",[artist])).rows[0].id);
  track=Number((await db.query("INSERT INTO public.tracks(album_id,title,track_number)VALUES($1,'Pista conservada',1)RETURNING id",[album])).rows[0].id);
  const own=Number((await db.query("INSERT INTO ingest.genres(slug,name,level)VALUES('test-own-rock','Rock de prueba','family')RETURNING id")).rows[0].id);
  const derived=Number((await db.query("INSERT INTO ingest.genres(slug,name,level)VALUES('test-mixed-electronic','Electrónica de prueba','family')RETURNING id")).rows[0].id);
  await db.query("INSERT INTO ingest.artist_genres(artist_id,genre_id,role,status,source_kind,decided_by,decision_kind,decision_rule)VALUES($1,$2,'primary','confirmed','editorial','test','human','prueba')",[artist,own]);
  await db.query("INSERT INTO ingest.album_genres(album_id,genre_id,role,status,source_kind,decided_by,decision_kind,decision_rule)VALUES($1,$2,'primary','confirmed','editorial','test','human','prueba')",[album,derived]);
  expect((await db.query("SELECT id FROM ingest.artist_genres WHERE artist_id=$1 AND source_kind='albums'",[artist])).rowCount).toBe(1);
  await withOperatorRun({name:'test-hold',operator:'test',note:'Identidad de edición no probada'},async ctx=>{
   await ctx.client.query("INSERT INTO ingest.album_attribution_holds(album_id,artist_id,reason,run_id)VALUES($1,$2,$3,$4)",[album,artist,ctx.note,ctx.runId]);
  });
 },180_000);
 afterAll(async()=>{await closeDb();await pg?.stop();},60_000);
 it('oculta ficha, listado y discografía; conserva disco y pistas nativas',async()=>{
  expect(await getAlbumDetail(album)).toBeNull();
  expect((await listAlbums({artistId:artist,limit:20,offset:0})).rows).toHaveLength(0);
  const detail=await getArtistDetail(artist);expect(detail?.discography).toHaveLength(0);
  expect((await getPool().query('SELECT id FROM public.albums WHERE id=$1',[album])).rowCount).toBe(1);
  expect((await getPool().query('SELECT id FROM public.tracks WHERE id=$1',[track])).rowCount).toBe(1);
  expect((await getPool().query('SELECT id FROM ingest.catalog_tracks WHERE id=$1',[track])).rowCount).toBe(0);
  expect((await getPool().query("SELECT id FROM ingest.artist_genres WHERE artist_id=$1 AND source_kind='albums'",[artist])).rowCount).toBe(0);
  expect((await getPool().query("SELECT id FROM ingest.artist_genres WHERE artist_id=$1 AND source_kind='editorial'",[artist])).rowCount).toBe(1);
 });
 it('registra evidencia en el diario y no permite perderla por rollback',async()=>{
  expect((await getPool().query("SELECT id FROM ingest.change_journal WHERE table_name='ingest.album_attribution_holds' AND op='I' AND run_id IS NOT NULL")).rowCount).toBe(1);
  await expect(getPool().query(await readFile('migrations/0101_album_attribution_holds.down.sql','utf8'))).rejects.toThrow('atribuciones retiradas');
  await getPool().query('ROLLBACK');
 });
 it('una reatribución auditada publica al dueño nuevo y conserva los mismos IDs',async()=>{
  await withOperatorRun({name:'test-reparent',operator:'test',note:'Dueño confirmado con evidencia'},ctx=>updateEntity(ctx,'album',album,{}, {parentId:other}));
  expect((await getAlbumDetail(album))?.artist.id).toBe(other);
  expect((await getArtistDetail(artist))?.discography).toHaveLength(0);
  expect((await getArtistDetail(other))?.discography).toHaveLength(1);
  expect((await getPool().query('SELECT id FROM ingest.catalog_tracks WHERE id=$1',[track])).rowCount).toBe(1);
 });
});
