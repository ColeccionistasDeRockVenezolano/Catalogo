/** Lista completa y créditos del LP Top Hits 102-07404 de 1984. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const source='https://barraezo.blogspot.com/2014/07/v-grandes-exitos-de-los-anos-70-top.html';
const html=readFileSync(path.join(root,'grandes-70-1984-source.html'),'utf8');
if(!html.includes('102-07404')||!html.includes('Quiero escribir tu nombre'))throw new Error('Captura incompleta');
const tracks=[
 {title:'Sólo otra vez',artist:2030,printed:'Los Tres Tristes Tigres'},
 {title:'Iliana',artist:1891,printed:'Los Cazadores'},
 {title:'Solo para tontos',artist:4788,printed:'Acuario'},
 {title:'El último beso',artist:1479,printed:'Los 007'},
 {title:'Busco mi destino',artist:1522,printed:'Grupo C'},
 {title:'Amor es...',artist:289,printed:'Azúcar, Cacao y Leche'},
 {title:'Tú la vas a perder',artist:1910,printed:'Los Darts'},
 {title:'El guía',artist:289,printed:'Azúcar, Cacao y Leche'},
 {title:'Detén la noche',artist:1479,printed:'Los 007'},
 {title:'Matrimonio',artist:2030,printed:'Los Tres Tristes Tigres'},
 {title:'Vuélvete',artist:1891,printed:'Los Cazadores'},
 {title:'Ahora es tarde',artist:1910,printed:'Los Darts'},
 {title:'Quiero escribir tu nombre',artist:1522,printed:'Grupo C'},
 {title:'A dónde vamos',artist:4788,printed:'Acuario'},
];
try{
 const outcome=await withOperatorRun({name:'rhv:grandes-exitos-70-1984',operator:'codex',note:'Completar el LP Top Hits 102-07404 con la lista numerada de la edición y sus intérpretes; RHV corrobora las participaciones.',params:{source,albumId:39976}},async ctx=>{
  const album=(await ctx.client.query<{artistId:number;title:string;year:number;type:string}>(`SELECT artist_id::int "artistId",title,release_year AS "year",album_type::text type FROM ingest.catalog_albums WHERE id=39976 FOR UPDATE`)).rows[0];
  if(!album||album.artistId!==257||album.year!==1984||album.type!=='compilation'||album.title!=='Grandes Éxitos de los Años 70')throw new Error('Cambió el álbum desde el cotejo');
  if((await ctx.client.query('SELECT 1 FROM public.tracks WHERE album_id=39976')).rowCount)throw new Error('La lista ya no está vacía');
  const artists=[...new Set(tracks.map(t=>t.artist))];
  const docs=(await ctx.client.query<{artistId:number}>(`SELECT DISTINCT artist_id::int "artistId" FROM media.artist_documents WHERE artist_id=ANY($1::bigint[])`,[artists])).rows;
  if(new Set(docs.map(d=>d.artistId)).size!==artists.length)throw new Error('Falta evidencia de un intérprete');
  const sid=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='barraezo-blogspot'")).rows[0].id);
  const albumCredits=new Set<number>();const rows=[];
  for(const [i,t] of tracks.entries()){
   const created=await createEntity(ctx,'track',{title:t.title,track_number:i+1,disc_number:1,notes:`Según ${source}`},{albumId:39976,allowSimilar:true});
   const credit=await createRelation(ctx,'track_credit',{trackId:created.id,artistId:t.artist},{credit_role:'Intérprete',credit_type:'musician',notes:`${t.printed}; fuente ${source}`});
   if(!albumCredits.has(t.artist)){await createRelation(ctx,'album_credit',{albumId:39976,artistId:t.artist},{credit_role:'Intérprete',credit_type:'musician',notes:`Participación según ${source}`});albumCredits.add(t.artist);}
   const identity=`barraezo-grandes-70-10207404:${i+1}`;
   const claim=await persistClaim({entityKind:'track_credit',trackCreditId:credit.id,field:'credit_role',rawValue:`${t.title} - ${t.printed}`,normalizedValue:'Intérprete',identity,identitySecondary:identity,originalIdentity:`${i+1}. ${t.title}`,rawHash:createHash('sha256').update(JSON.stringify([identity,t])).digest('hex'),sourceId:sid,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-grandes-70',extractorVersion:'1',evidence:{url:source,excerpt:`${i+1}. ${t.printed} - ${t.title}`}},ctx.client);
   await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
   rows.push({position:i+1,trackId:created.id,title:t.title,artistId:t.artist});
  }
  return {albumId:39976,albumArtists:[...albumCredits],tracks:rows};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`grandes-70-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,tracks:outcome.result.tracks.length,artists:outcome.result.albumArtists.length}));
}finally{await closeDb();}
