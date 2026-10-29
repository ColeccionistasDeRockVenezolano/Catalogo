import 'dotenv/config';import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const root=process.argv[2];if(!root)throw new Error('Indica staging');
const results=JSON.parse(readFileSync(`${root}/discogs-results.json`,'utf8')) as Array<{key:string;results:Array<{id:number;title:string;resource_url:string}>}>;
const pending=JSON.parse(readFileSync(`${root}/catalog-evidence.json`,'utf8')).albums as Array<{id:string;artist:string}>;
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\(\d+\)|\*/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const selected=new Map<number,{id:number;url:string;keys:string[]}>();
for(const result of results){const artist=pending.find(a=>a.id===result.key)?.artist;
 for(const r of result.results){const name=r.title.split(' - ')[0]??'';
  if(artist&&!(norm(name)===norm(artist)||norm(name).includes(norm(artist))||norm(artist).includes(norm(name))))continue;
  if(!artist&&!['fnb','syma','bonne','melomaniac'].includes(result.key))continue;
  const item=selected.get(r.id)??{id:r.id,url:r.resource_url,keys:[]};item.keys.push(result.key);selected.set(r.id,item);
 }
}
const evidence=[];
for(const item of selected.values()){
 const file=`${root}/discogs/release-${item.id}.json`;let doc;
 if(existsSync(file))doc=JSON.parse(readFileSync(file,'utf8'));else{
 const response=await fetch(item.url,{headers:{'User-Agent':'CRV-Compilation-Research/1.0',Authorization:`Discogs token=${process.env['DISCOGS_TOKEN']??''}`},signal:AbortSignal.timeout(25000)});
 const body:unknown=await response.json();doc={url:item.url,status:response.status,queriedAt:new Date().toISOString(),body};writeFileSync(file,JSON.stringify(doc,null,2));
 if(!response.ok)throw new Error(`Discogs ${response.status}`);await new Promise(r=>setTimeout(r,1100));
 }
 evidence.push({...item,file:file.split('/').at(-1),title:doc.body.title,artists:doc.body.artists?.map((a:{name:string})=>a.name),formats:doc.body.formats,series:doc.body.series,tracks:doc.body.tracklist?.length,notes:doc.body.notes});
}
writeFileSync(`${root}/discogs-matches.json`,JSON.stringify(evidence,null,2));console.log({releases:evidence.length});
