/** Correcciones puntuales revisadas; no reejecuta la incorporación. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {previewAlbumMerge,mergeAlbums} from '../../src/merge/album-merge.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');
const p=getPool(),results:any[]=existsSync(out+'/correcciones-aplicadas.json')?JSON.parse(readFileSync(out+'/correcciones-aplicadas.json','utf8')):[];
for(const [keep,drop,matches] of process.env['WAYBACK_METADATA_ONLY']==='1'?[]:[[33991,34037,4],[33996,34038,4],[33997,34039,4],[2384,26643,5]]){
 const preview=await previewAlbumMerge(p,keep!,drop!);
 if(preview.keep.artistId!==preview.drop.artistId||preview.matchedTracks.length!==matches||preview.unmatchedDropTracks.length!==(keep===2384?1:0))throw new Error('Previsualización distinta de la revisión manual');
 writeFileSync(out+'/fusion-revisada-'+drop+'.json',JSON.stringify(preview,null,2));
 results.push(await withOperatorRun({name:'wayback-audit:merge-confirmed-albums',operator:'codex (encargo de Brian)',note:keep===2384?'Poietiké: mismo EP de Presidente/Sr. Presidente de 2011. Cinco posiciones coincidentes; conservar además Leibniz, sexta pista de la ficha RYM, y todos los datos de ambas fichas.':'Duplicado tras unificar Rafael L. Garnica con Garnica. Coinciden sello, año, fecha literal y cuatro títulos/posiciones del mismo catálogo primario de Los Andes Electrónicos.',params:{campaign:'wayback-auditoria-2026-10-24',keepId:keep,dropId:drop}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const merged=await mergeAlbums(ctx,{keepId:keep!,dropId:drop!,previewHash:preview.previewHash,mode:'match',keepDropNameAsAlias:true,fieldChoices:{cover_url:'keep'}});
  const metadata=await ctx.client.query("UPDATE media.artist_documents SET metadata=jsonb_set(metadata,'{albumId}',to_jsonb($2::bigint)),updated_at=now() WHERE metadata->>'albumId'=$1 RETURNING id",[String(drop),keep]);
  return {keep,drop,merged,updatedDocuments:metadata.rows};
 }));
}
const decisions=JSON.parse(readFileSync('reports/wayback-restantes-2026-10-23/fechas-resoluciones-aprobadas.json','utf8'));
const decision=decisions.find((d:any)=>d.albumId===338);
const source=typeof decision.source==='object'?decision.source:{url:decision.sourceUrl.replace(/^https:\/\/web.archive.org\/web\/\d+\//,''),wayback:decision.sourceUrl,archivo:process.cwd()+'/data/raw/wayback-fuentes-2026-10-22/losandes/espanol/records.html',snapshot:'20041028175647'};
if(!source.url||!source.wayback||!existsSync(source.archivo))throw new Error('Fuente incompleta o captura histórica ausente');
results.push(await withOperatorRun({name:'wayback-audit:document-references',operator:'codex (encargo de Brian)',note:'Retirar vínculos JSON a discos dados de baja posteriormente por un operador. Conservar documentación histórica e ID anterior sin restablecer fichas eliminadas. Completar fuente histórica de la revisión de Submarino.',params:{campaign:'wayback-auditoria-2026-10-24'}},async ctx=>{
 await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
 const updated=[];
 for(const [albumId,runId,note] of [[33868,31784,'No pertenece al catálogo'],[33960,31786,'Ficha duplicada']]){
  if((await ctx.client.query('SELECT id FROM public.albums WHERE id=$1',[albumId])).rowCount)throw new Error('Disco reaparecido; revisar antes de corregir');
  const r=await ctx.client.query("UPDATE media.artist_documents SET metadata=(metadata-'albumId')||jsonb_build_object('formerAlbumId',$1::bigint,'albumLinkReview',jsonb_build_object('reason',$3::text,'removalRunId',$2::bigint)),tags=ARRAY(SELECT DISTINCT unnest(tags||ARRAY['referencia-discografica-retirada'])),updated_at=now() WHERE metadata->>'albumId'=$4 RETURNING id",[albumId,runId,note,String(albumId)]);
  updated.push(...r.rows);
 }
 const provenance=await ctx.client.query("UPDATE media.artist_documents SET source_url=$1,archive_url=$2,metadata=metadata||jsonb_build_object('evidence',$3::jsonb),updated_at=now() WHERE id=2646 AND source_url IS NULL RETURNING id",[source.url,source.wayback,JSON.stringify(source)]);
 return {referencesUpdated:updated,provenanceUpdated:provenance.rows};
}));
writeFileSync(out+'/correcciones-aplicadas.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await closeDb();
