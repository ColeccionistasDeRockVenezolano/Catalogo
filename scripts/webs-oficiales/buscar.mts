import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {closeDb} from '../../src/db/client.js';
import {WebSearchBroker} from '../../src/ambiguity/web-search.js';
const out='reports/webs-oficiales-2026-10-18';
const rows=JSON.parse(readFileSync(`${out}/inventario.json`,'utf8')) as Array<{artistId:number;name:string;country:string;searches:unknown[]}>;
const broker=new WebSearchBroker();mkdirSync(`${out}/busquedas`,{recursive:true});
const {existsSync}=await import('node:fs');
const searched=new Set<number>();
for(const file of readdirSync(out).filter(f=>/^web-batch-\d+\.json$/u.test(f))){for(const r of JSON.parse(readFileSync(`${out}/${file}`,'utf8')) as Array<{artistId:number;error?:string}>){if(!r.error)searched.add(r.artistId);}}
let done=0,failed=0;
try{
 for(const row of rows.filter(r=>!r.searches.length)){
  const path=`${out}/busquedas/${row.artistId}.json`;
  if(searched.has(row.artistId)||(existsSync(path)&&!JSON.parse(readFileSync(path,'utf8')).error)){done++;continue;}
  const query=`"${row.name.replace(/"/gu,'')}" ${row.country||'Venezuela'} sitio web oficial official website`;
  let result;
  try{result={artistId:row.artistId,name:row.name,query,hits:await broker.search(query),searchedAt:new Date().toISOString()};done++;}
  catch(error){result={artistId:row.artistId,name:row.name,query,error:String(error),searchedAt:new Date().toISOString()};failed++;}
  writeFileSync(path,JSON.stringify(result,null,2)+'\n');
  writeFileSync(`${out}/busquedas-progreso.json`,JSON.stringify({done,failed,total:rows.filter(r=>!r.searches.length).length,updatedAt:new Date().toISOString()},null,2)+'\n');
  console.log(JSON.stringify({done,failed,name:row.name}));
 }
}finally{await closeDb();}
