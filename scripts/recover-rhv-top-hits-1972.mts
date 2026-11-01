/** Restauración de Top Hits de Venezuela (TH-1016) desde la contraportada y RHV. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const source='https://barraezo.blogspot.com/2015/10/v-top-hits-de-venezuela-top-hits-th.html';
const html=readFileSync(path.join(root,'top-hits-1972-source.html'),'utf8');
if(!html.includes('TH - 1016')||!html.includes('La Guitarra')||!html.includes('Soy Un Hombre Feliz'))throw new Error('Captura incompleta');
const tracks=[
 {title:'La Guitarra',artist:289,printed:'Azúcar, Cacao y Leche'},
 {title:'Tu Nombre es Amor',artist:1522,printed:'Grupo C'},
 {title:'Un Mundo Nuevo',artist:1910,printed:'Los Darts'},
 {title:'Lejos de Aquí',artist:1479,printed:'Los 007',id:258593},
 {title:'Sonidos de la Mañana',artist:8533,printed:'La Cuarta Calle'},
 {title:'Gaseoso',artist:8552,printed:'Gas Light'},
 {title:'Cuando Viviremos Como Dios Manda',artist:1891,printed:'The Hunters (Los Cazadores)'},
 {title:'Cosas Que Dijimos',artist:1910,printed:'Los Darts'},
 {title:'Soy Un Hombre Feliz',artist:1479,printed:'Los 007',id:258594},
 {title:'Viendo el Tiempo Pasar',artist:8533,printed:'La Cuarta Calle'},
 {title:'Jenny',artist:8552,printed:'Gas Light'},
 {title:'Jóven Amor',artist:289,printed:'Azúcar, Cacao y Leche'},
];
try {
 const outcome=await withOperatorRun({name:'rhv:top-hits-1972-compilation',operator:'codex',note:'Top Hits TH-1016: la contraportada identifica varios intérpretes y la lista completa; RHV confirma sus participaciones. Corregir titular y posiciones conservando pistas existentes.',params:{source,albumId:39975}},async ctx=>{
  const album=(await ctx.client.query<{artistId:number;title:string;year:number;type:string}>(`SELECT artist_id::int "artistId",title,release_year AS "year",album_type::text type FROM ingest.catalog_albums WHERE id=39975 FOR UPDATE`)).rows[0];
  if(!album||album.artistId!==1479||album.year!==1972||album.type!=='compilation'||album.title!=='Top Hits de Venezuela')throw new Error('Cambió el álbum desde el cotejo');
  const existing=(await ctx.client.query<{id:number;title:string;number:number}>(`SELECT id::int,title,track_number::int number FROM public.tracks WHERE album_id=39975 ORDER BY track_number FOR UPDATE`)).rows;
  if(existing.length!==2||existing[0]?.id!==258593||existing[1]?.id!==258594||key(existing[0]!.title)!==key('Lejos de Aquí')||key(existing[1]!.title)!==key('Soy Un Hombre Feliz'))throw new Error('Cambió la lista incompleta');
  const docs=(await ctx.client.query<{artistId:number;url:string}>(`SELECT DISTINCT artist_id::int "artistId",source_url url FROM media.artist_documents WHERE artist_id=ANY($1::bigint[]) AND source_url LIKE 'https://rockhechovenezuela.com/%'`,[[289,1522,1910,1479,8533,8552,1891]])).rows;
  if(new Set(docs.map(d=>d.artistId)).size!==7)throw new Error('Falta identidad documentada de un intérprete');
  await updateEntity(ctx,'album',39975,{}, {parentId:257});
  await updateEntity(ctx,'track',258593,{track_number:4});
  await updateEntity(ctx,'track',258594,{track_number:9});
  const sid=Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='barraezo-blogspot'")).rows[0].id);
  const albumCredits=new Map<number,number>();const rows=[];
  for(const [i,t] of tracks.entries()){
   const trackId=t.id??(await createEntity(ctx,'track',{title:t.title,track_number:i+1,disc_number:1,notes:`Según ${source}`},{albumId:39975,allowSimilar:true})).id;
   const credit=await createRelation(ctx,'track_credit',{trackId,artistId:t.artist},{credit_role:'Intérprete',credit_type:'musician',notes:`${t.printed}; contraportada citada en ${source}`});
   if(!albumCredits.has(t.artist)){
    const ac=await createRelation(ctx,'album_credit',{albumId:39975,artistId:t.artist},{credit_role:'Intérprete',credit_type:'musician',notes:`Participación en Top Hits de Venezuela según ${source}`});albumCredits.set(t.artist,ac.id);
   }
   const identity=`barraezo-top-hits-1016:${i+1}`;
   const claim=await persistClaim({entityKind:'track_credit',trackCreditId:credit.id,field:'credit_role',rawValue:`${t.title} - ${t.printed}`,normalizedValue:'Intérprete',identity,identitySecondary:identity,originalIdentity:`${i+1}. ${t.title}`,rawHash:createHash('sha256').update(JSON.stringify([identity,t])).digest('hex'),sourceId:sid,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-top-hits-1016',extractorVersion:'1',evidence:{url:source,excerpt:`${i+1}. ${t.title} - ${t.printed}`}},ctx.client);
   await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
   rows.push({position:i+1,trackId,title:t.title,artistId:t.artist});
  }
  return {albumId:39975,ownerBefore:1479,ownerAfter:257,albumArtists:[...albumCredits.keys()],tracks:rows};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`top-hits-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,tracks:outcome.result.tracks.length,artists:outcome.result.albumArtists.length}));
}finally{await closeDb();}
