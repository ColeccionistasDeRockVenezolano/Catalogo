/** Revisión final de pertenencia, procedencia y precisión de fechas. */
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';import {withOperatorRun,updateEntity} from '../../src/merge/operator.js';
import {saveEphemeris} from '../../src/catalog/ephemerides.js';import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const O=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const rows=(file:string):any[]=>readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
const cases=rows(join(O,'expedientes-artistas.jsonl')),synth=rows(join(O,'sintesis-artistas.jsonl'));
const mapping=JSON.parse(readFileSync(join(O,'artistas-aplicados.json'),'utf8'));
const resolutions=rows(join(O,'resoluciones-identidad.jsonl'));
const before=new Map(JSON.parse(readFileSync(join(O,'antes-artists.json'),'utf8')).map((a:any)=>[a.id,a]));
const key=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const pages=rows('reports/wayback-analisis-catalogo-2026-10-22/paginas-compactas.jsonl');
const checks:any[]=[];
const result=await withOperatorRun({name:'wayback:final-audit',operator:'codex',note:'Revisión de pertenencia de imágenes, documentos y efemérides de la incorporación autorizada.',params:{campaign:TAG}},async ctx=>{
 await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
 for(const c of cases){
  const id=mapping[c.key];if(!id)continue;
  if(c.source.publicaciones){const content=c.source.publicaciones.map((p:any)=>`${p.titulo??p.titulo_fuente}${p.anio||p.anio_fuente?' ('+(p.anio??p.anio_fuente)+')':''}${p.tipo?' — '+p.tipo:''}${p.produccion?'\nProducción: '+p.produccion:''}`).join('\n\n');
   await ctx.client.query('UPDATE media.artist_documents SET content=$3 WHERE artist_id=$1 AND source_key=$2 AND content<>$3',[id,TAG+':'+c.key,content]);
  }
 }
 // La imagen sigue la ficha histórica que la enlaza, nunca al primer homónimo.
 for(const img of rows(join(O,'imagenes-localizadas.jsonl'))){
  const c=cases.find(c=>c.key.startsWith('banda:')&&key(c.source.nombre_fuente??'')===key(img.banda));const id=c?mapping[c.key]:null;const resolution=c?resolutions.find(r=>r.key===c.key):null;if(!id||!resolution)continue;
  const oldCandidates=new Set(resolution.oldCandidates.map((a:any)=>a.id));
  const photos=(await ctx.client.query('SELECT * FROM media.artist_gallery WHERE source_key=$1',[TAG+':image:'+img.sha256])).rows;
  for(const photo of photos){const oldId=Number(photo.artist_id);if(oldId===id||!oldCandidates.has(oldId)||photo.metadata?.originalPath!==img.archivo)continue;
   const correct=(await ctx.client.query('SELECT id FROM media.artist_gallery WHERE artist_id=$1 AND source_key=$2',[id,photo.source_key])).rows[0];
   if(correct)await ctx.client.query('DELETE FROM media.artist_gallery WHERE id=$1',[photo.id]);else await ctx.client.query('UPDATE media.artist_gallery SET artist_id=$2,updated_at=now() WHERE id=$1',[photo.id,id]);
   const old=(await ctx.client.query('SELECT logo_url FROM public.artists WHERE id=$1',[oldId])).rows[0];
   if(old?.logo_url===photo.image_url){const original=before.get(oldId) as any;await updateEntity(ctx,'artist',oldId,{logo_url:original?.logo_url??null});}
   if(photo.category==='logo'&&!(await ctx.client.query('SELECT 1 FROM public.artists WHERE id=$1 AND logo_url IS NOT NULL',[id])).rowCount)await updateEntity(ctx,'artist',id,{logo_url:photo.image_url});
   checks.push({kind:'image_identity',fromArtist:oldId,toArtist:id,image:photo.image_url});
  }
 }
 // La comparación de biografías detectó asociaciones de artículos a homónimos.
 for(const id of [4628,2718,6786,545]){
  const hidden=await ctx.client.query(`UPDATE media.artist_documents SET metadata=metadata||'{"editorialHidden":true,"identityReview":"Contenido sobre otra identidad detectado al cotejar la biografía"}'::jsonb WHERE artist_id=$1 AND source_key LIKE $2 AND NOT (metadata @> '{"editorialHidden":true}') RETURNING id`,[id,TAG+':document:%']);
  if(hidden.rowCount)checks.push({kind:'document_identity_review',artistId:id,documents:hidden.rows.map(r=>Number(r.id))});
 }
 // Registrar las citas de cada hito y revisar el día/mes en el texto original.
 const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 for(const r of synth){const c=cases.find(c=>c.key===r.key);if(!c||!mapping[r.key])continue;
  for(const e of r.events??[]){if(!e.year)continue;const eventKey=TAG+':'+r.key+':'+createHash('sha256').update(key(e.title)+e.year).digest('hex').slice(0,14);
   const saved=(await ctx.client.query('SELECT id,event_date::text,status,sources FROM ingest.ephemerides WHERE event_key=$1',[eventKey])).rows[0];if(!saved)continue;
   const sources=(saved.sources??[]).map((s:any)=>({...s,quote:e.quote,requestedSnapshotOnly:true}));
   await ctx.client.query('UPDATE ingest.ephemerides SET sources=$2::jsonb WHERE id=$1',[saved.id,JSON.stringify(sources)]);
   if(saved.status!=='verified'||!saved.event_date)continue;
   const date=String(saved.event_date),[y,m,d]=date.split('-').map(Number);
   const urls=[c.source.evidencia?.url,...(c.source.evidencia?.sources??[]).map((s:any)=>s.url)].filter(Boolean);
   const rawText=pages.filter(p=>urls.includes(p.url)).map(p=>p.texto).join('\n').toLowerCase();
   const dayMonth=new RegExp(`\\b0?${d}\\s*(?:de\\s+)?${months[m!-1]}`);
   const direct=rawText.includes(String(y))&&(dayMonth.test(rawText)||rawText.includes(`${d}/${m}/${y}`)||rawText.includes(date));
   if(!direct){await ctx.client.query("UPDATE ingest.ephemerides SET status='pending',event_date=NULL,date_note=$2 WHERE id=$1",[saved.id,`Fecha propuesta ${date}; el día y mes requieren contraste literal en el original. Se conserva el año sin inventar aniversario.`]);checks.push({kind:'event_precision_review',id:Number(saved.id),proposedDate:date,title:e.title});}
  }
 }
 const fnb=pages.find(p=>p.site==='lagaleriadelrock'&&p.url.includes('/videos/')&&/13 y domingo 14 de julio de 2013/.test(p.texto));
 if(fnb)for(const [day,label] of [['13','Inicio'],['14','Cierre']])await saveEphemeris(ctx,{key:TAG+':fnb2013-'+day,title:`${label} del Festival Nuevas Bandas 2013`,description:'La Galería del Rock documentó con una grabación la vigésima segunda edición del Festival Nuevas Bandas, celebrada el sábado 13 y domingo 14 de julio de 2013.',date:'2013-07-'+day,year:2013,dateNote:null,place:'Estacionamiento del diario El Nacional',subject:'Festival Nuevas Bandas',originalArtistId:257,status:'verified',sources:[{title:'La Galería del Rock — relato de la grabación',url:'https://web.archive.org/web/'+fnb.ts+'/'+fnb.url}]});
 return checks;
});
writeFileSync(join(O,'auditoria-final.json'),JSON.stringify({runId:result.runId,checks},null,2));console.log({runId:result.runId,corrections:checks.length});await closeDb();
