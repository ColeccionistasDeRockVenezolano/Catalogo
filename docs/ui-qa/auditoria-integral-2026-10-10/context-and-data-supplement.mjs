import {readFile,writeFile} from 'node:fs/promises';
import dotenv from '../../../node_modules/dotenv/lib/main.js';
const env=dotenv.parse(await readFile(new URL('../../../.env',import.meta.url)));
const dbUrl=new URL(env.DATABASE_URL);dbUrl.searchParams.set('options','-c default_transaction_read_only=on');process.env.DATABASE_URL=dbUrl.href;
const {getPool,closeDb}=await import('../../../src/db/client.ts');
const {planningContext}=await import('../../../src/curation/ai/context.ts');
const {findingInstruction,curationFindings}=await import('../../../src/verification/curation.ts');
const out={focused:[],data:{},liveFlags:{autoscan:env.CRV_CURATION_AUTOSCAN??'default',autofix:env.CRV_CURATION_AUTOFIX??'default'}};
try{
const db=getPool();
const report=(await db.query("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=6912 ORDER BY id DESC LIMIT 1")).rows[0].report;
const findings=curationFindings(report);
for(const f of [findings[0],findings[Math.floor(findings.length/2)],findings.at(-1)]){
try{const {context,evidence}=await planningContext(db,'artist',6912,findingInstruction(f));out.focused.push({key:f.key,chars:JSON.stringify(context).length,evidence:evidence.length,pending:context.report?.pending?.length});}catch(e){out.focused.push({key:f.key,error:e.message});}
}
for(const [key,sql]of Object.entries({person:"SELECT * FROM public.persons WHERE id=15368",banana:"SELECT id,title,description,notes,cover_url FROM public.albums WHERE artist_id=1212",autofix:"SELECT * FROM ingest.curation_autofix_rules",organizations:"SELECT id,name FROM public.organizations ORDER BY id LIMIT 2"})){
try{out.data[key]=(await db.query(sql)).rows}catch(e){out.data[key]={error:e.message}}
}
await writeFile(new URL('context-and-data-supplement.json',import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}finally{await closeDb()}
