// Read-only audit harness: production frontend and current API routes against
// the real database. Startup recovery updates are suppressed in this process.
// PostgreSQL also rejects writes, and the browser blocks all write requests.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
const env=dotenv.parse(await readFile('.env'));
const url=new URL(env['DATABASE_URL']!);
url.searchParams.set('options','-c default_transaction_read_only=on');
process.env['DATABASE_URL']=url.href;
process.env['CRV_OPERATOR_TOKEN']=randomBytes(32).toString('hex');
process.env['CRV_CURATION_AUTOSCAN']='false';
process.env['CRV_CURATION_AUTOFIX']='false';
process.env['LOG_LEVEL']='silent';
const {getPool,closeDb}=await import('../../../src/db/client.js');
const db=getPool();
const original=db.query.bind(db);
const suppressed:string[]=[];
// The application registers recovery at startup. Running it in a second
// process would mark live jobs failed; only these recovery calls are skipped.
db.query=((...args:unknown[])=>{
 const sql=typeof args[0]==='string'?args[0]:String((args[0] as {text?:string})?.text??'');
 if(/^UPDATE ingest\.(?:entity_verification_jobs|entity_comparison_jobs|ai_curation_plans|person_artist_resolution_jobs|person_identity_research_jobs)\s+SET status='failed'/u.test(sql)){
  suppressed.push(sql.split(' SET')[0]!);return Promise.resolve({rows:[],rowCount:0});
 }
 return (original as (...args:unknown[])=>unknown)(...args);
}) as typeof db.query;
const {buildApp}=await import('../../../src/api/app.js');
const app=await buildApp();
(globalThis as unknown as {auditInject:unknown}).auditInject=async(path:string)=>{
 const result=await app.inject({method:'GET',url:path,headers:{authorization:`Bearer ${process.env['CRV_OPERATOR_TOKEN']}`}});
 return {status:result.statusCode,body:result.body,headers:{'content-type':String(result.headers['content-type']??'application/json')}};
};
console.log('Startup recovery suppressed:',suppressed);
try{await import(process.env['CRV_AUDIT_BROWSER_SCRIPT'] ?? '../../../docs/ui-qa/auditoria-integral-2026-10-10/baseline-browser.mjs');}
finally{await app.close();await closeDb();}
