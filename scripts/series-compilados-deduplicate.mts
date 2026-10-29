/** Duplicados revisados con portadas y repertorio; ensayo por defecto y diario reversible. */
import {readFileSync,writeFileSync} from 'node:fs';import {closeDb} from '../src/db/client.js';import {withOperatorRun} from '../src/merge/operator.js';
import {previewAlbumMerge,mergeAlbums} from '../src/merge/album-merge.js';import {writeAlbumClassifications} from '../src/catalog/album-classifications.js';
const out=process.argv[2];if(!out)throw new Error('Indica staging');const confirm=process.argv.includes('--confirm');
const reviewed=JSON.parse(readFileSync(`${out}/merge-previews.json`,'utf8')) as Array<Awaited<ReturnType<typeof previewAlbumMerge>>>;
const tracksKey=(side:Awaited<ReturnType<typeof previewAlbumMerge>>['keep'])=>JSON.stringify(side.tracks.map(t=>[t.discNumber,t.trackNumber,t.title]));
try{
 const result=await withOperatorRun({name:'series:compilados-duplicados',operator:'codex',note:'Misma edición de Aditus: portadas idénticas y 21 pistas idénticas; Rock El Compilado II: mismo repertorio completo y sello, contrastado con archivo del editor.',params:{evidence:['https://www.discogs.com/release/11333703','https://www.discogs.com/release/7799918','https://sincopa.com/rock_pop/cdinfo_rock/aditus_18lomaximo.htm','https://rockhechovenezuela.com/a/aditus/','https://rockdevzla.blogspot.com/2010/09/el-compilado-compilado-editado-por.html']}},async ctx=>{
  for(const id of [39998,39999])await writeAlbumClassifications({...ctx,note:`Discogs edición ${id===39998?11333703:7799918}: Aditus, CD, Compilation, Remastered; portada y repertorio corroborados en el archivo del artista.`},id,['Compilation Album'],{addOnly:true});
  const operations=[];
  for(const [keep,drop,count] of [[39998,3641,0],[39998,4623,21],[656,3305,18]] as const){
   const preview=await previewAlbumMerge(ctx.client,keep,drop,{mode:'match',lock:true});
   const baseline=reviewed.find(p=>p.keep.id===keep&&p.drop.id===drop);
   if(!baseline||preview.keep.artistId!==baseline.keep.artistId||preview.drop.artistId!==baseline.drop.artistId||tracksKey(preview.keep)!==tracksKey(baseline.keep)||tracksKey(preview.drop)!==tracksKey(baseline.drop))throw new Error(`Cambió una ficha desde la revisión: ${keep}/${drop}`);
   if(preview.drop.tracks.length!==count||preview.unmatchedDropTracks.length!==0||preview.matchedTracks.length!==count)throw new Error(`Revisar repertorio: ${keep}/${drop}`);
   operations.push(await mergeAlbums(ctx,{keepId:keep,dropId:drop,previewHash:preview.previewHash,mode:'match',keepDropNameAsAlias:true,...(drop===3641?{fieldChoices:{album_type:'drop' as const}}:{})}));
  }
  const sid=(await ctx.client.query("SELECT id FROM ingest.series WHERE title='Serie Lo Máximo'")).rows[0].id;
  for(const id of [39998,39999])await ctx.client.query("INSERT INTO ingest.series_albums(series_id,album_id,run_id) VALUES($1,$2,$3) ON CONFLICT(series_id,album_id) DO NOTHING",[sid,id,ctx.runId]);
  return operations;
 },{rollbackOnly:!confirm});
 writeFileSync(`${out}/deduplicate-${confirm?'applied':'dry-run'}.json`,JSON.stringify({confirmed:confirm,...result},null,2));console.log(JSON.stringify(result));
}finally{await closeDb();}
