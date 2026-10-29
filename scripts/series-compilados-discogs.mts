/** Evidencia estructurada de Discogs, sin escrituras en el catálogo ni secretos en informes. */
import 'dotenv/config';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const input=process.argv[2],out=process.argv[3];if(!input||!out)throw new Error('Indica consultas JSON y staging');
const queries=JSON.parse(readFileSync(input,'utf8')) as Array<{key:string;q:string}>;
mkdirSync(`${out}/discogs`,{recursive:true});
const headers={'User-Agent':'CRV-Compilation-Research/1.0',Authorization:`Discogs token=${process.env['DISCOGS_TOKEN']??''}`};
const results=[];
for(const [i,q] of queries.entries()){
 const url=`https://api.discogs.com/database/search?type=release&per_page=8&q=${encodeURIComponent(q.q)}`;
 const key=createHash('sha256').update(url).digest('hex').slice(0,16);const file=`${out}/discogs/${key}.json`;
 let evidence;
 if(existsSync(file))evidence=JSON.parse(readFileSync(file,'utf8'));
 else{
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
  const body:unknown=await response.json();evidence={url,status:response.status,queriedAt:new Date().toISOString(),body};
  writeFileSync(file,JSON.stringify(evidence,null,2));
  if(response.status===429||response.status===401||response.status===403)throw new Error(`Discogs ${response.status}; se conserva evidencia y se detiene`);
  await new Promise(r=>setTimeout(r,1100));
 }
 results.push({...q,evidence:file.split('/').at(-1),status:evidence.status,results:evidence.body.results??[]});
 if(i%10===0)console.log(`Consultas: ${i+1}/${queries.length}`);
}
writeFileSync(`${out}/${input.includes("numbered") ? "discogs-numbered-results" : "discogs-results"}.json`,JSON.stringify(results,null,2));console.log({queries:results.length});
