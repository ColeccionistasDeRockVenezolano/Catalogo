/** Perfiles HTML no cubiertos por adaptadores. Lectura local, sin red. */
import {createReadStream,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
const out=process.argv[2]!;if(!out?.includes('/crv-staging/'))throw Error('Usar SSD');
const result=join(out,'html-normalizados.jsonl'),ledger=join(out,'html-lecturas.jsonl');writeFileSync(result,'');writeFileSync(ledger,'');
const seen=new Set<string>();const counts:Record<string,number>={};
for await(const line of createInterface({input:createReadStream(join(out,'inventario-archivos.jsonl')),crlfDelay:Infinity})){
 const r=JSON.parse(line);if(!/\/data\/raw\/lobotoradio(?:-bio)?\//.test(r.path)||r.extension!=='.html')continue;
 let state='ok',error:string|undefined;let sha:string|undefined;
 try{
  const bytes=readFileSync(join('/mnt/1tb/Shared',r.path));sha=createHash('sha256').update(bytes).digest('hex');
  if(seen.has(sha))state='duplicado';else{
   seen.add(sha);const $=load(bytes.toString('utf8'));const name=$('h1.entry-title,h1').first().text().trim();const url=$('link[rel=canonical]').attr('href')??$('meta[property="og:url"]').attr('content');
   const article=$('#content,article .entry-content,.entry-content').first().clone();article.find('script,style,nav,form,.header,.empty-msg,.sharedaddy,.related-posts,.jp-relatedposts').remove();
   const text=article.text().replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();
   if(name&&text.length>70)appendFileSync(result,JSON.stringify({file:r.path,url,kind:url?.includes('/artistas/')?'person':'artist_or_person',schema:'lobotoradio-profile',name,fields:{biography:text},pointer:'#content'})+'\n');else state='sin_biografia_extraible';
  }
 }catch(e){state='error';error=String(e);}
 counts[state]=(counts[state]??0)+1;appendFileSync(ledger,JSON.stringify({file:r.path,sha256:sha,state,error})+'\n');
}
writeFileSync(join(out,'html-resumen.json'),JSON.stringify(counts,null,2));console.log(counts);
