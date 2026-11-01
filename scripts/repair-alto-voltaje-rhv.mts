/** Portada y clasificación demo de la edición Alto Voltaje 2008. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
import { persistClaim } from '../src/claims/persistence.js';
import { sourceTitleKey } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const cover=JSON.parse(readFileSync(path.join(root,'alto-cover.json'),'utf8')) as {sourceUrl:string;sha256:string;localUrl:string};
if(createHash('sha256').update(readFileSync(path.join('web/public/media',cover.localUrl.slice('/crv/media/'.length)))).digest('hex')!==cover.sha256)throw new Error('Portada no verificada');
const source='https://rockhechovenezuela.com/a/alto-voltaje/';
try{
 const result=await withOperatorRun({name:'rhv:alto-voltaje-cover-demo',operator:'codex',note:'RHV y la nota de prensa de 2016 identifican el demo de cuatro temas; el catálogo conserva además el tipo EP.',params:{source,corroboration:'https://centuriontours.blogspot.com/2016/10/rockhastalamuerteviareceyes.html'}},async ctx=>{
  const album=(await ctx.client.query<{id:number;artistId:number;year:number;cover:string|null;type:string}>(`SELECT id::int,artist_id::int "artistId",release_year AS "year",cover_url cover,album_type::text type FROM ingest.catalog_albums WHERE id=3791 FOR UPDATE`)).rows[0];
  const tracks=(await ctx.client.query<{title:string}>('SELECT title FROM ingest.catalog_tracks WHERE album_id=3791 ORDER BY disc_number,track_number,id')).rows;
  const expected=['Las chicas quieren rock','En el nombre del rock´n´roll','Fuego (Dinamita)','Polución'];
  if(!album||album.artistId!==624||album.year!==2008||album.type!=='ep'||JSON.stringify(tracks.map(t=>sourceTitleKey(t.title)))!==JSON.stringify(expected.map(sourceTitleKey)))throw new Error('Cambió la edición o el repertorio');
  const addedCover=!album.cover;
  if(addedCover)await updateEntity(ctx,'album',3791,{cover_url:cover.localUrl});
  const prior=(await ctx.client.query<{selected:boolean}>("SELECT selected FROM ingest.album_classification_decisions WHERE album_id=3791 AND classification='Demos' FOR UPDATE")).rows[0];
  if(prior?.selected===false)throw new Error('Existe una decisión editorial que rechaza Demos');
  await writeAlbumClassifications(ctx,3791,['Demos'],{addOnly:true});
  const sourceId=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
  for(const [field,raw,normalized] of [['cover_url',cover.sourceUrl,cover.localUrl],['classification','Demos','Demos']]){
   const identity=`rhv-alto-2008:${field}`;
   const claim=await persistClaim({entityKind:'album',albumId:3791,field:field!,rawValue:raw,normalizedValue:normalized,identity,identitySecondary:identity,originalIdentity:'Cárcel, Muerte o Rock´n´Roll (2008)',rawHash:createHash('sha256').update(JSON.stringify([identity,raw])).digest('hex'),sourceId,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-integral-alto',extractorVersion:'1',evidence:{url:source,excerpt:'Demos: Cárcel, Muerte o Rock´n´Roll (2008), cuatro temas. Corroboración: https://centuriontours.blogspot.com/2016/10/rockhastalamuerteviareceyes.html'}},ctx.client);
   await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
  }
  return {albumId:3791,coverAdded:addedCover,classification:'Demos',albumType:album.type};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`alto-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify({confirmed:confirm,...result}));
}finally{await closeDb();}
