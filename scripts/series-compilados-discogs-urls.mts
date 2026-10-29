import 'dotenv/config';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
const input=process.argv[2],out=process.argv[3];if(!input||!out)throw new Error('Indica consultas y staging');
const urls=JSON.parse(readFileSync(input,'utf8')) as string[];mkdirSync(`${out}/discogs`,{recursive:true});const index=[];
for(const url of urls){if(!url.startsWith('https://api.discogs.com/'))throw new Error('Origen no permitido');const file=`${out}/discogs/${createHash('sha256').update(url).digest('hex').slice(0,16)}.json`;
 if(!existsSync(file)){const r=await fetch(url,{headers:{'User-Agent':'CRV-Compilation-Research/1.0',Authorization:`Discogs token=${process.env['DISCOGS_TOKEN']??''}`},signal:AbortSignal.timeout(25000)});const doc={url,status:r.status,queriedAt:new Date().toISOString(),body:await r.json()};writeFileSync(file,JSON.stringify(doc,null,2));if(!r.ok)throw new Error(`Discogs ${r.status}`);await new Promise(r=>setTimeout(r,1100));}index.push({url,file:file.split('/').at(-1)});
}
writeFileSync(`${out}/discogs-url-index.json`,JSON.stringify(index,null,2));console.log({urls:index.length});
