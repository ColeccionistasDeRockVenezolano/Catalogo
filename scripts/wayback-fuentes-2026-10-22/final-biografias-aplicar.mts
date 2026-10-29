/** Incorpora únicamente los párrafos contrastados de formación histórica. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,updateEntity} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
const planText=readFileSync(out+'/biografias-integrantes-aprobadas.json','utf8'),plan=JSON.parse(planText);
const file=out+'/biografias-aplicadas.json',results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const campaign='wayback-finalizacion-2026-10-25',hash=createHash('sha256').update(planText).digest('hex');
try{for(const r of plan){if(results.some(a=>a.artistId===r.artistId))continue;
 const applied=await withOperatorRun({name:'wayback-final:biography-members',operator:'codex (encargo de Brian)',note:'Integrar formación histórica omitida de la biografía sin atribuir actividad actual ni crear personas por nombres incompletos.',params:{campaign,artistId:r.artistId,documentId:r.documentId,planSha256:hash}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  const a=(await ctx.client.query('SELECT biography,notes FROM public.artists WHERE id=$1 FOR UPDATE',[r.artistId])).rows[0];
  const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[r.documentId])).rows[0];
  if(!a||a.biography!==r.previous)throw Error('Cambió la biografía '+r.artistId);
  if(!d||Number(d.artist_id)!==r.artistId||!d.content.includes(r.quote)||d.metadata.editorialHidden)throw Error('La evidencia no coincide '+r.artistId);
  const text=a.biography.trimEnd()+'\n\n'+r.paragraph;
  const provenance='Formación histórica integrada desde el archivo Wayback: '+(r.archiveUrl??r.sourceUrl);
  await updateEntity(ctx,'artist',r.artistId,{biography:text,notes:[a.notes,provenance].filter(Boolean).join('\n\n')});
  await ctx.client.query('UPDATE media.artist_documents SET tags=$2,metadata=$3::jsonb,updated_at=now() WHERE id=$1',[d.id,[...new Set([...d.tags,'formacion-integrada-en-biografia'])],JSON.stringify({...d.metadata,biographyIntegration:{campaign,artistId:r.artistId,paragraph:r.paragraph,quote:r.quote,reviewedAt:new Date().toISOString(),runId:ctx.runId}})]);
  return {artistId:r.artistId,documentId:r.documentId,previousChars:a.biography.length,newChars:text.length};
 });results.push({artistId:r.artistId,...applied});writeFileSync(file,JSON.stringify(results,null,2));if(results.length%20===0)console.log('biografias',results.length,'/',plan.length);
}}finally{await closeDb();}
