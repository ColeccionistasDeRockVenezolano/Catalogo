/** Duplicados de RHV contrastados por portada, artista, año y lista ordenada completa. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { mergeAlbums, previewAlbumMerge, type AlbumMergePreview } from '../src/merge/album-merge.js';
import { sourceTitleKey } from '../src/discography/source-appearances.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const decisions=[
 {keep:107,drop:42302,count:7,source:'https://rockhechovenezuela.com/a/aditus/'},
 {keep:196,drop:42408,count:13,source:'https://rockhechovenezuela.com/h/hora-cero/'},
 {keep:6309,drop:42418,count:7,source:'https://rockhechovenezuela.com/j/joseph-derteano/'},
];
const pin=path.join(root,'album-duplicate-previews.json');
const baselines=confirm ? JSON.parse(readFileSync(pin,'utf8')) as AlbumMergePreview[] : [];
try {
 const outcome=await withOperatorRun({name:'rhv:verified-duplicate-albums',operator:'codex',note:'RHV y catálogo: misma banda, año, portada y repertorio completo en el mismo orden; consolidación con previsualización y diario.',params:{decisions}},async ctx=>{
  const previews=[];const merged=[];const review=[];
  for(const d of decisions){
   await ctx.client.query('SAVEPOINT album_pair');
   try {
   const preview=await previewAlbumMerge(ctx.client,d.keep,d.drop,{lock:true,mode:'match'});
   if(preview.keep.artistId!==preview.drop.artistId || preview.keep.fields['release_year']!==preview.drop.fields['release_year'] || preview.keep.tracks.length!==d.count || preview.drop.tracks.length!==d.count || preview.unmatchedDropTracks.length || preview.matchedTracks.length!==d.count || preview.matchedTracks.some(t=>t.matchType!=='position_and_title'))throw new Error(`Repertorio o identidad incompatibles: ${d.keep}/${d.drop}`);
   if(preview.keep.tracks.some((t,i)=>sourceTitleKey(t.title)!==sourceTitleKey(preview.drop.tracks[i]!.title)))throw new Error('Títulos no idénticos');
   if(confirm){
    const prior=baselines.find(p=>p.keep.id===d.keep&&p.drop.id===d.drop);
    if(!prior||prior.previewHash!==preview.previewHash)throw new Error(`Cambió la previsualización de ${d.keep}`);
   }
   const operation=await mergeAlbums(ctx,{keepId:d.keep,dropId:d.drop,previewHash:preview.previewHash,mode:'match',keepDropNameAsAlias:true});
   previews.push(preview);
   merged.push(operation);
   await ctx.client.query('RELEASE SAVEPOINT album_pair');
   } catch(error) {
    await ctx.client.query('ROLLBACK TO SAVEPOINT album_pair');
    await ctx.client.query('RELEASE SAVEPOINT album_pair');
    review.push({...d,error:error instanceof Error?error.message:String(error)});
   }
  }
  return {previews,merged,review};
 },{rollbackOnly:!confirm});
 if(!confirm)writeFileSync(pin,JSON.stringify(outcome.result.previews,null,2));
 writeFileSync(path.join(root,`duplicates-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));
 console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,merged:outcome.result.merged.length,review:outcome.result.review}));
}finally{await closeDb();}
