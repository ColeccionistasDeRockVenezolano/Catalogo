import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {saveEphemeris} from '../../src/catalog/ephemerides.js';
const out=process.env['WAYBACK_OUT'];if(!out||existsSync(out+'/aplicado.json'))throw Error('Ruta ausente o lote ya aplicado');
const before=JSON.parse(readFileSync(out+'/antes.json','utf8'));
const text=readFileSync(out+'/plan-procedencia.json','utf8'), plan=JSON.parse(text);
const campaign='wayback-finalizacion-4-2026-10-25';
const affected=new Set(plan.map((e:any)=>e.eventId));
const documents=before.documents.filter((d:any)=>d.tags.includes('cronologia-por-ano')&&
 (d.metadata.events??[]).some((e:any)=>affected.has(Number(e.id))));
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const comparable=(v:any):any=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(comparable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,comparable(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));
if(!plan.length)throw Error('Plan vacío');
for(const s of JSON.parse(readFileSync(out+'/originales-procedencia.json','utf8')))
 if(hash(readFileSync(s.path))!==s.sha256)throw Error('Cambió el HTML '+s.path);
try{
 const result=await withOperatorRun({name:'wayback-cierre4:procedencia-cronologias',
  operator:'codex (encargo de Brian)',note:'Corregir atribuciones anacrónicas comprobadas con HTML local. Se conservan hechos, años, identidades y evidencia anterior; no se promueven a verificados.',
  params:{campaign,planSha256:hash(text),events:plan.length,documents:documents.length}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
  for(const r of plan){
   const e=(await ctx.client.query('SELECT * FROM ingest.ephemerides WHERE id=$1 FOR UPDATE',[r.eventId])).rows[0];
   if(!same(e,r.previous))throw Error('Cambió el hito '+r.eventId);
   const saved=await saveEphemeris(ctx,{key:e.event_key,title:e.title,description:e.description,
    date:e.event_date,year:e.event_year,dateNote:r.dateNote,place:e.place,subject:e.subject_name,
    originalArtistId:Number(e.original_artist_id),status:e.status,sources:r.sources});
   if(Number(saved.id)!==r.eventId)throw Error('Cambió el identificador del hito');
  }
  for(const old of documents){
   const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[old.id])).rows[0];
   if(!same(d,old))throw Error('Cambió la cronología '+old.id);
   const ids=old.metadata.events.map((e:any)=>Number(e.id));
   const events=(await ctx.client.query('SELECT * FROM ingest.ephemerides WHERE id=ANY($1::bigint[]) ORDER BY event_year,id',[ids])).rows;
   if(events.length!==ids.length)throw Error('Cronología con referencias ausentes '+d.id);
   const content=events.map((e:any)=>[
    (e.event_year??'Año sin confirmar')+' — '+e.title,e.description,
    e.place?'Lugar documentado: '+e.place:null,
    e.event_date?'Fecha: '+String(e.event_date).slice(0,10):e.date_note,
    ...e.sources.map((s:any)=>s.title+': '+s.url+(s.quote?'\nCita: '+s.quote:'')+
      (s.verificationStatus==='unverified-catalog-only'?'\nProcedencia: dato de la ficha previa del catálogo, pendiente de corroboración externa.':''))
   ].filter(Boolean).join('\n')).join('\n\n');
   const metadata={...d.metadata,events,sourceAttributionRevisions:[...(d.metadata.sourceAttributionRevisions??[]),
    {campaign,runId:ctx.runId,planSha256:hash(text),correctedEventIds:ids.filter((id:number)=>affected.has(id)),
     previousSourceUrl:d.source_url,previousArchiveUrl:d.archive_url,previousEvidence:d.metadata.evidence??null,
     reason:'Se corrigieron citas ausentes del HTML y atribuidas a capturas anteriores al hecho descrito; los hechos permanecen pendientes.'}]};
   delete metadata.evidence;
   await ctx.client.query('UPDATE media.artist_documents SET content=$2,source_url=$3,archive_url=NULL,tags=$4,metadata=$5::jsonb,updated_at=now() WHERE id=$1',
    [d.id,content,'/crv/artistas/'+d.artist_id,[...new Set([...d.tags,'procedencia-corregida','corroboracion-externa-pendiente'])],JSON.stringify(metadata)]);
  }
  return {eventIds:plan.map((r:any)=>r.eventId),documentIds:documents.map((d:any)=>Number(d.id)),
   artistIds:[...new Set(plan.map((r:any)=>r.artistId))]};
 });
 writeFileSync(out+'/aplicado.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({runId:result.runId,events:result.result.eventIds.length,documents:result.result.documentIds.length,artists:result.result.artistIds.length}));
}finally{await closeDb();}
