import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {startPgContainer,type PgContainer} from '../support/pg-container.js';
import {applyCore} from '../support/apply-core.js';
import {closeDb,getPool} from '../../src/db/client.js';
import {resetEnvCache} from '../../src/config/env.js';
import {migrateUp} from '../../src/db/migrate.js';
import {normalizeRecord} from '../../src/normalization/claims.js';
import {persistClaim,type ClaimToPersist} from '../../src/claims/persistence.js';
import {mergeClaim} from '../../src/merge/engine.js';
describe('ámbito de los alias de discos y pistas',()=>{
 let container:PgContainer;let sourceId:number;let seq=0;
 beforeAll(async()=>{container=await startPgContainer();process.env['DATABASE_URL']=container.databaseUrl;resetEnvCache();await applyCore(container.name);await migrateUp();sourceId=Number((await getPool().query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('alias-scope-test','Prueba','website','high') RETURNING id")).rows[0].id);});
 afterAll(async()=>{await closeDb();await container?.stop();});
 const one=async(sql:string,params:unknown[]=[])=>Number((await getPool().query(sql,params)).rows[0].id);
 const addAlias=async(kind:'album'|'track'|'person',id:number,alias:string)=>{
  const normalized=normalizeRecord({entityKind:kind,identity:`fixture-${kind}-${id}`,extractor:'alias-scope',extractorVersion:'1',fields:[{field:kind==='person'?'alias':'alternate_title',value:alias,evidence:{url:`https://fixture.invalid/${++seq}`}}]})[0]!;
  const input:ClaimToPersist={...normalized,sourceId,confidence:'high',...(kind==='album'?{albumId:id}:kind==='track'?{trackId:id}:{personId:id})};
  return mergeClaim(input,await persistClaim(input));
 };
 it('conserva títulos iguales bajo artistas distintos, y pistas iguales en posiciones distintas',async()=>{
  const a=await one("INSERT INTO public.artists(name) VALUES('Banda Alfa QA') RETURNING id");const b=await one("INSERT INTO public.artists(name) VALUES('Banda Beta QA') RETURNING id");
  const x=await one("INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,'Disco Alfa',2020) RETURNING id",[a]);const y=await one("INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,'Disco Beta',2020) RETURNING id",[b]);
  await addAlias('album',x,'Dreams');await addAlias('album',y,'Dreams');
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.album_aliases WHERE alias='Dreams'")).rows[0].n).toBe(2);
  for(const [album,pos] of [[x,1],[x,2],[y,1]]){const id=await one("INSERT INTO public.tracks(album_id,title,disc_number,track_number) VALUES($1,'Intro',1,$2) RETURNING id",[album,pos]);await addAlias('track',id,'Intro');}
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.track_aliases WHERE alias='Intro'")).rows[0].n).toBe(3);
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE kind='ambiguous_alias'")).rows[0].n).toBe(0);
 });
 it('distingue álbumes del mismo artista por año y sigue revisando alias ambiguos de personas',async()=>{
  const a=await one("INSERT INTO public.artists(name) VALUES('Arabella QA') RETURNING id");
  for(const year of [1978,1985]){const id=await one("INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,'Arabella', $2) RETURNING id",[a,year]);await addAlias('album',id,'Arabella');}
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.album_aliases WHERE alias='Arabella'")).rows[0].n).toBe(2);
  for(const name of ['Persona Alfa QA','Persona Beta QA']){const id=await one('INSERT INTO public.persons(name) VALUES($1) RETURNING id',[name]);await addAlias('person',id,'Nombre artístico compartido');}
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE kind='ambiguous_alias' AND payload->>'entityKind'='person'")).rows[0].n).toBe(1);
 });
 it('mantiene la revisión de discos del mismo artista con igual año y tipo',async()=>{
  const a=await one("INSERT INTO public.artists(name) VALUES('Banda Ambigua QA') RETURNING id");
  for(const title of ['Uno','Dos']){const id=await one("INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,$2,2020) RETURNING id",[a,title]);await addAlias('album',id,'Identidad sin resolver');}
  expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE kind='ambiguous_alias' AND payload->>'entityKind'='album'")).rows[0].n).toBe(1);
 });
});
