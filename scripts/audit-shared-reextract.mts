/** Relee capturas locales con adaptadores existentes; sin red ni importadores. */
import {createReadStream,readFileSync,existsSync,appendFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import {load} from 'cheerio';
import {adapterFor} from '../src/adapters/registry.js';
const out=process.argv[2]!;
if(!out?.includes('/crv-staging/'))throw Error('Usar staging SSD');
const sources=new Map(readFileSync(join(out,'ingest-sources.jsonl'),'utf8').trim().split('\n').map(l=>{const s=JSON.parse(l);return [s.id,s];}));
const resultFile=join(out,'reextraccion-registros.jsonl'),ledger=join(out,'reextraccion-paginas.jsonl');
const additional=process.argv.includes('--additional');
if(!additional){writeFileSync(resultFile,'');writeFileSync(ledger,'');}
const counts:Record<string,number>=additional?JSON.parse(readFileSync(join(out,'reextraccion-resumen.json'),'utf8')):{};
if(!additional)for await(const line of createInterface({input:createReadStream(join(out,'ingest-raw_pages.jsonl')),crlfDelay:Infinity})){
 const p=JSON.parse(line),s=sources.get(p.source_id);if(!s)continue;
 const adapter=adapterFor({slug:s.slug,siteType:s.site_type});
 if(!adapter){counts['sin_adaptador']=(counts['sin_adaptador']??0)+1;continue;}
 const file=p.stored_path.startsWith('raw/')?resolve('data',p.stored_path):resolve(p.stored_path);
 let status='ok',records=0,error:string|undefined;
 try{
  if(!existsSync(file))throw Error('captura_local_ausente');
  const buffer=readFileSync(file),body=adapter.decodeBody?adapter.decodeBody(buffer):buffer.toString('utf8');
  const kind=p.content_type?.includes('json')?'json':p.content_type?.includes('xml')?'xml':'html';
  const rows=adapter.extractSnapshot?adapter.extractSnapshot({url:p.url,kind,rawPageId:Number(p.id),body}):adapter.extract(load(body),p.url);
  records=rows.length;
  if(rows.length)appendFileSync(resultFile,rows.map(r=>JSON.stringify({rawPageId:p.id,source:s.slug,file,url:p.url,record:r})).join('\n')+'\n');
 }catch(e){status='error';error=String(e);}
 counts[s.slug]=(counts[s.slug]??0)+1;
 appendFileSync(ledger,JSON.stringify({rawPageId:p.id,source:s.slug,file,url:p.url,status,records,error})+'\n');
}
if(additional){
 const known=new Set<string>();
 for await(const line of createInterface({input:createReadStream(ledger),crlfDelay:Infinity})){const p=JSON.parse(line);if(p.status==='ok')known.add(p.url+'\0'+p.file);}
 for(const [directory,slug] of [['deep-sincopa-2026-10-25','sincopa'],['sincopa-extra','sincopa'],['deep-rhv-com-2026-10-25','rock-hecho-en-venezuela']]){
  const index=resolve('data/raw',directory!,'index.jsonl');if(!existsSync(index))continue;
  const adapter=adapterFor({slug:slug!,siteType:'website'})!;
  for await(const line of createInterface({input:createReadStream(index),crlfDelay:Infinity})){
   const p=JSON.parse(line);if(p.status!==200)continue;
   const file=p.legacy??resolve('data/raw',directory!,p.file??p.sha256+'.html');
   const key=p.url+'\0'+file;if(known.has(key))continue;known.add(key);
   let status='ok',records=0,error:string|undefined;
   try{const bytes=readFileSync(file),body=adapter.decodeBody?adapter.decodeBody(bytes):bytes.toString('utf8');const rows=adapter.extractSnapshot?adapter.extractSnapshot({url:p.url,kind:'html',rawPageId:0,body}):adapter.extract(load(body),p.url);records=rows.length;if(rows.length)appendFileSync(resultFile,rows.map(r=>JSON.stringify({rawPageId:null,source:slug,file,url:p.url,record:r,index})).join('\n')+'\n');}catch(e){status='error';error=String(e);}
   counts[directory!]=(counts[directory!]??0)+1;
   appendFileSync(ledger,JSON.stringify({rawPageId:null,source:slug,file,url:p.url,status,records,error,index})+'\n');
  }
 }
}
writeFileSync(join(out,'reextraccion-resumen.json'),JSON.stringify(counts,null,2));console.log(counts);
