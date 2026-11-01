import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root=process.argv[2];
if(!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const source='https://rockhechovenezuela.com/g/gaelica/';
const corroboration='https://seryhumano.com/web/?p=9473';
const coverNew='/crv/media/gaelica-rhv-2026-11-01/02a42c2df79dbf574cf7694e2bb009397003000b952312be3a38c2cf117262ad.jpg';
const coverHerencia='/crv/media/gaelica-rhv-2026-11-01/90567fbc412b4d462eb0887afe5eb19d94e04c3edead4d0ba262bf9f79d35d44.jpg';
for(const url of [coverNew,coverHerencia]){
 const file=path.join('web/public/media',url.slice('/crv/media/'.length));
 const hash=createHash('sha256').update(readFileSync(file)).digest('hex');
 if(!url.includes(hash)) throw new Error('Captura no verificada');
}
try {
 const outcome=await withOperatorRun({name:'rhv:gaelica-appearances-2026-11-01',operator:'codex',note:'Recuperación de la colaboración Gaélica y Anaïs Vivas con evidencia adicional; portada de La Herencia; revisión del posible duplicado',params:{source,corroboration}},async ctx=>{
  await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:gaelica-appearances'))");
  const sourceId=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
  const existing=(await ctx.client.query<{id:number}>("SELECT id::int FROM ingest.catalog_albums WHERE lower(title)=lower($1)",['Un Cancionero Venezolano Entre Amigos'])).rows;
  if(existing.length>1)throw new Error('Disco ambiguo');
  const albumId=existing[0]?.id ?? (await createEntity(ctx,'album',{title:'Un Cancionero Venezolano Entre Amigos',release_year:2013,album_type:'compilation',media_format:'CD',cover_url:coverNew,description:'Recopilatorio de música venezolana. Gaélica y Anaïs Vivas interpretan «Luna de Margarita»; el repertorio citado no constituye una lista completa de pistas.',notes:`Fuentes: ${source}; ${corroboration}`},{artistId:257})).id;
  const album=(await ctx.client.query<{artistId:number;year:number|null}>(`SELECT artist_id::int "artistId",release_year AS "year" FROM ingest.catalog_albums WHERE id=$1 FOR SHARE`,[albumId])).rows[0];
  if(!album || album.artistId!==257 || album.year!==2013)throw new Error('El disco existente no coincide');
  const credit=await createRelation(ctx,'album_credit',{albumId,artistId:103},{credit_role:'Intérprete',credit_type:'musician',notes:`Luna de Margarita, con Anaïs Vivas. ${source}; corroborado por ${corroboration}`});
  const identity=`rhv-gaelica-cancionero:${albumId}:tracks`;
  const claim=await persistClaim({entityKind:'album_credit',albumCreditId:credit.id,field:'documented_tracks',rawValue:['Luna de Margarita'],normalizedValue:['Luna de Margarita'],identity,identitySecondary:identity,originalIdentity:'Gaélica (con Anaís Vivas): Luna de Margarita',rawHash:createHash('sha256').update(identity).digest('hex'),sourceId,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-gaelica-2026-11-01',extractorVersion:'1',evidence:{url:source,excerpt:'Tema interpretado por Gaélica (con Anaís Vivas): Luna de Margarita. Corroboración: '+corroboration}},ctx.client);
  await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
  const herencia=(await ctx.client.query<{cover:string|null;title:string}>('SELECT cover_url cover,title FROM ingest.catalog_albums WHERE id=34048 FOR UPDATE')).rows[0];
  if(!herencia || herencia.title!=='Simón Díaz: La Herencia')throw new Error('Cambió La Herencia');
  if(!herencia.cover)await updateEntity(ctx,'album',34048,{cover_url:coverHerencia});
  await ctx.client.query(`UPDATE ingest.review_queue SET status='approved',resolved_by='human',resolved_at=now(),updated_at=now(),resolution_note=$2 WHERE id=$1 AND status='dismissed'`,[1873825,`Apareció corroboración independiente de la interpretación conjunta: ${corroboration}. Disco ${albumId}, run ${ctx.runId}. Se conserva el cierre anterior en el payload.`]);
  const reviewKey='gaelica-herencia-34048-41574';
  const review=await ctx.client.query(`INSERT INTO ingest.review_queue(kind,artist_a_id,payload,notes) SELECT 'manual_review',103,$1::jsonb,$2 WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue WHERE payload->>'gaelicaReviewKey'=$3) RETURNING id`,[JSON.stringify({gaelicaReviewKey:reviewKey,albumIds:[34048,41574],source,corroboration:'https://sarakafrouni.com/2015/03/04/la-herencia-de-simon-diaz/',runId:ctx.runId}), 'La Herencia: dos fichas con el mismo repertorio; contrastar y conservar todos los créditos antes de fusionar.',reviewKey]);
  return {albumId,creditId:credit.id,creditCreated:credit.created,herenciaCoverAdded:!herencia.cover,duplicateReviewCreated:!!review.rowCount};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,confirm?'applied.json':'rehearsal.json'),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,...outcome}));
} finally {await closeDb();}
