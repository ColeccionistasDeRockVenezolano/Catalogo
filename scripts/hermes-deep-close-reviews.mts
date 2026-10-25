/** Cierra exclusivamente dudas satisfechas por resultados comprobados en la BD. */
import{readFileSync,appendFileSync,existsSync}from'node:fs';import path from'node:path';
import{withOperatorRun}from'../src/merge/operator.js';import{closeDb}from'../src/db/client.js';
const data=process.env['HERMES_DEEP_DATA'],report=process.env['HERMES_DEEP_REPORT'];if(!data||!report)throw new Error('Faltan rutas');const apply=process.argv.includes('--apply');
const TAG='hermes-integral-2026-10-24';
type Row=Record<string,unknown>;
const read=(file:string):Row[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as Row);
const plans=[...read(path.join(data,'plan-artists.jsonl')),...['plan-vd-identities.jsonl','plan-mp3-manual-artists.jsonl'].flatMap(f=>existsSync(path.join(data,f))?read(path.join(data,f)):[])];
if(existsSync(path.join(report,'plan-identidades-finales.jsonl')))plans.push(...read(path.join(report,'plan-identidades-finales.jsonl')));
const mp3Decisions=existsSync(path.join(data,'mp3-92-decisions.jsonl'))?read(path.join(data,'mp3-92-decisions.jsonl')):[];
const members=[...read(path.join(data,'plan-members.jsonl')),...(existsSync(path.join(data,'plan-members-credit.jsonl'))?read(path.join(data,'plan-members-credit.jsonl')):[])];
const albums=read(path.join(report,'albums-applied.jsonl')).flatMap(r=>r['results']as Row[]).filter(r=>r['albumId']);
const songs=read(path.join(data,'plan-songs.jsonl'));
const recoveryIds=new Set([1216,249,37,7355,728,782,1174,2040,1155,774,1033,1875,3061,153,1433,43,3709,278]);
for(const p of plans)if(p['existingId'])recoveryIds.add(Number(p['existingId']));
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/gu,'');
try{
 const run=await withOperatorRun({name:'hermes-deep:review-closures',operator:'codex (encargo de Brian)',note:'Cerrar dudas concretas satisfechas: continuidad de página, membresía nativa corroborada, disco incorporado o título recuperado. No aprobar audiovisuales retirados, nombres ambiguos ni datos no afirmados.',params:{campaign:'hermes-cierre-profundo-2026-10-24'}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);const decisions=new Map<string,{note:string;check:string}>();
  for(const p of plans){const expected=Number(p['existingId']);const binding=(await ctx.client.query<{artist_id:string}>("SELECT artist_id::text FROM media.artist_documents WHERE metadata->>'artistKey'=$1 AND metadata->>'bindingStatus'='confirmed'",[p['key']])).rows;const aid=expected||Number(binding[0]?.artist_id);
   if(new Set(binding.map(r=>r.artist_id)).size!==1||(expected&&binding[0]?.artist_id!==String(expected)))throw new Error('Binding ambiguo o discrepante');
   if(!binding.length)throw new Error('Falta continuidad incorporada');
   const note=(p['decision']==='new'?'Banda diferenciada y creada en la ficha #':'Fuente histórica vinculada a la ficha existente #')+aid+' conforme al plan documentado de cierre. No se infiere el origen de la ubicación del perfil. Las dudas de discos, canciones o audiovisuales conservan sus propios casos.';
   decisions.set(TAG+':identity:'+p['key'],{note,check:'binding'});
   decisions.set(TAG+':'+p['key'],{note,check:'source_identity'});
  }
  for(const a of albums){if(!(await ctx.client.query('SELECT id FROM public.albums WHERE id=$1',[a['albumId']])).rowCount)throw new Error('Falta disco incorporado');
   decisions.set(TAG+':albums:'+a['key'],{note:'La duda sobre el alta de esta edición quedó satisfecha con el disco #'+a['albumId']+'. Las pistas y ediciones homónimas no se aprueban por este cierre.',check:'album'});
  }
  for(const p of songs){const rs=(await ctx.client.query<{id:string;raw_value:{title?:string;artistId?:number}}>('SELECT id::text,raw_value FROM ingest.claims WHERE identity_key=$1',[TAG+':'+p['key']])).rows;
   if(rs.length!==1||norm(rs[0]!.raw_value.title??'')!==norm(String(p['title']))||rs[0]!.raw_value.artistId!==Number(String(p['artistRef']).slice(3)))throw new Error('Claim de canción no reconciliado');
   decisions.set(TAG+':songs:'+p['key'],{note:'Título y atribución documental recuperados en el claim #'+rs[0]!.id+'. Se conserva como referencia de canción sin inferir pista, orden ni edición musical.',check:'song'});
  }
  const all=(await ctx.client.query<{id:string;notes:string;payload:{hermesIntegralKey?:string;campaign?:string;profiles?:Row[];record?:Row}}>("SELECT id::text,notes,payload FROM ingest.review_queue WHERE status='open' AND payload->>'campaign' IN('hermes-integral-2026-10-24','hermes-recuperacion-2026-10-24') FOR UPDATE")).rows;
  const results=[];
  for(const q of all){let decision=decisions.get(q.payload.hermesIntegralKey??'');const rec=q.payload.record;
   if(!decision&&q.id==='1864270'&&rec?.['name']==='bongó, güira, güiro, campana, bombak'&&rec['captureKey']==='venezuelademo:argenis-carruyo-y-su-orquesta'){
    const repaired=read(path.join(report,'vd-integrantes-relectura.jsonl')).find(r=>r['key']===rec['captureKey']);
    const roster=repaired?.['integrantes']as{nombre:string;rol:string}[]|undefined;
    if(!roster?.some(m=>m.nombre==='José Diego “El Picure” Boscán'&&m.rol==='caja colombiana, bongó, güira, güiro, campana, bombak'))throw new Error('No consta la continuación del rol en la relectura');
    const note='Propuesta de persona descartada: la línea enumera instrumentos y continúa el rol de José Diego “El Picure” Boscán en el PDF. Parser corregido y relectura preservada; no es una persona nueva ni se deduce nacionalidad o vigencia.';
    await ctx.client.query("UPDATE ingest.review_queue SET status='dismissed',resolved_by='system',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE id=$1 AND status='open'",[q.id,note]);results.push({key:'review:'+q.id,reviewId:Number(q.id),closed:true,note,check:'invalid_person_extraction'});continue;
   }
   if(!decision&&q.notes==='Nombre de persona existente sin identidad corroborada para esta banda'&&rec){
    const raw=rec['data']as Row|undefined;const aid=Number(rec['artistId']);const name=String(raw?.['nombre']??'');
    const m=members.filter(p=>p['artistRef']==='id:'+aid&&norm(String(p['name']))===norm(name));
    if(m.length===1&&(await ctx.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=$2',[aid,m[0]!['personId']])).rowCount)decision={check:'member',note:'La persona #'+m[0]!['personId']+' ya tiene membresía nativa en el artista #'+aid+' y coincide con el nombre/alias histórico. Evidencia vinculada sin duplicar personas ni asignar otro homónimo. Roles y vigencia actuales no inferidos.'};
   }
   if(!decision&&q.payload.campaign==='hermes-recuperacion-2026-10-24'&&q.payload.profiles?.length){
    let safe=true;
    for(const profile of q.payload.profiles){const aid=Number(profile['artist_id']);if(!recoveryIds.has(aid)){safe=false;break;}
     if(!(await ctx.client.query("SELECT 1 FROM media.artist_documents WHERE artist_id=$1 AND metadata->>'artistKey'=$2 AND metadata->>'bindingStatus'='confirmed'",[aid,'mp3com:'+profile['mp3com_page']])).rowCount){safe=false;break;}}
    if(safe)decision={check:'recovery_identity',note:'Perfil histórico contrastado con integrantes y/o repertorio ya documentados de la ficha. Se confirma exclusivamente la identidad; la ubicación de MP3.com no sustituye el origen de la banda. No se aplican tipos discrepantes. Evidencias detalladas preservadas en el expediente de recuperación.'};
   }
   if(!decision&&rec){const key=String(rec['key']??'').replace(/^artists:/u,'');const source=mp3Decisions.find(d=>d['sourceKey']===key&&['context_only_no_origin_assertion','reject_artist_proposal'].includes(String(d['decision'])));
    if(source){await ctx.client.query("UPDATE ingest.review_queue SET status='dismissed',resolved_by='system',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE id=$1 AND status='open'",[q.id,source['reason']]);results.push({key:'review:'+q.id,reviewId:Number(q.id),closed:true,note:String(source['reason']),check:'source_proposal_declined'});continue;}}
   if(!decision)continue;
   await ctx.client.query("UPDATE ingest.review_queue SET status='approved',resolved_by='system',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE id=$1 AND status='open'",[q.id,decision.note]);
   results.push({key:'review:'+q.id,reviewId:Number(q.id),closed:true,...decision});
  }
  return results;
 },{rollbackOnly:!apply});
 appendFileSync(path.join(report,'deepclosures-'+(apply?'applied':'probe')+'.jsonl'),JSON.stringify({runId:run.runId,applied:apply,results:run.result})+'\n');console.log(JSON.stringify({runId:run.runId,applied:apply,closed:run.result.length,checks:run.result.reduce<Record<string,number>>((a,r)=>{a[r.check]=(a[r.check]??0)+1;return a;},{})}));
}finally{await closeDb();}
