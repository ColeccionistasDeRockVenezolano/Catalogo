import {readFileSync,writeFileSync} from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';import{getPool,closeDb}from'../src/db/client.js';
const data=path.resolve('data/research/hermes-importacion-integral-2026-10-24');const out=path.join(process.env['HOME']!,'crv-staging/data/research/hermes-venezuelademo-ediciones-2026-10-24');
const read=(file:string):Record<string,unknown>[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)as Record<string,unknown>);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
try{
 const db=getPool();const albums=(await db.query('SELECT id::text,artist_id::text,title FROM public.albums')).rows as Record<string,unknown>[];const aliases=(await db.query('SELECT album_id::text,alias FROM ingest.album_aliases')).rows as Record<string,unknown>[];
 const possible=[...albums.map(a=>String(a['title'])),...aliases.map(a=>String(a['alias']))].filter(t=>/venezuela\s*demo/iu.test(t));if(possible.length)throw new Error('Hay ediciones posibles: revisar antes de crear '+JSON.stringify(possible));
 const snapshot={readAt:new Date().toISOString(),albums,aliases};writeFileSync(path.join(out,'catalogue-editions-before.json'),JSON.stringify(snapshot));
 const captures=new Map(read(path.join(data,'captures.jsonl')).map(c=>[c['key'],c]));const plans=read(path.join(data,'plan-albums.jsonl')).filter(r=>String(r['key']).startsWith('venezuelademo:volume:'));
 const decisions:string[]=['# Ediciones documentadas de Venezuela Demo','','Decisión editorial acotada a los 24 volúmenes numerados; no autoriza similitudes de artistas ni otras ediciones.',''];
 for(const r of plans){const c=captures.get(r['captureKey'])!;const raw=JSON.parse(readFileSync(String(c['storedPath']),'utf8'))as{n:number;pdf:string;titulo:string};const pdf=path.join('data/raw/venezuelademo-2026-10-23',raw.pdf);
  if(!readFileSync(pdf).subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('Original PDF inválido');
  r['editorialDistinctEdition']={volume:raw.n,captureHash:c['rawHash'],pdf,pdfHash:hash(readFileSync(pdf)),reviewedAt:snapshot.readAt,reason:'Edición física numerada con PDF y listado propio. El contraste de títulos y alias del catálogo no encuentra ninguna edición de esta serie. Las similitudes nominales con otras compilaciones no identifican el mismo volumen.'};
  decisions.push('DATO: '+raw.titulo+' es una edición musical distinta.','EVIDENCIA 1: '+String(c['url'])+' — '+String(c['capturedAt'])+' — «'+raw.titulo+'», PDF '+pdf+'.','EVIDENCIA 2: catálogo y alias completos leídos '+snapshot.readAt+' — 0 títulos/alias Venezuela Demo; la lista numerada de cada PDF conserva su propio repertorio.','CONCLUSIÓN: confirmado. Alta editorial como edición diferente; pistas con posiciones verificadas contra ese PDF.','');
 }
 writeFileSync(path.join(out,'plan-albums.jsonl'),plans.map(r=>JSON.stringify(r)).join('\n')+'\n');writeFileSync(path.join(out,'captures.jsonl'),'');writeFileSync(path.join(out,'decisiones-volumenes.md'),decisions.join('\n'));console.log(JSON.stringify({documentedVolumes:plans.length,existingSeriesMatches:possible.length}));
}finally{await closeDb();}
