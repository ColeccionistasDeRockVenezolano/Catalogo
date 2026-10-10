import dotenv from '../../../node_modules/dotenv/lib/main.js';
import {readFile} from 'node:fs/promises';
const auditEnv=dotenv.parse(await readFile(new URL('../../../.env',import.meta.url)));
const auditDbUrl=new URL(auditEnv.DATABASE_URL!);
auditDbUrl.searchParams.set('options','-c default_transaction_read_only=on');
process.env['DATABASE_URL']=auditDbUrl.href;
import {writeFile} from 'node:fs/promises';
import {getPool,closeDb} from '../../../src/db/client.ts';
import {planningContext} from '../../../src/curation/ai/context.ts';
import {hasRelevantEvidence} from '../../../src/curation/ai/evidence.ts';
const results:any={cases:[],evidenceGate:[]};
try{
 for(const [id,name]of [[6912,'Jeremías'],[1681,'Apache'],[1212,'La Banana Voladora'],[58,'Caramelos de Cianuro']] as const){
  const start=Date.now();
  try{
   const {context,evidence}=await planningContext(getPool(),'artist',id,'Revisa todos los hallazgos del último informe y aprovecha toda información relevante para completar esta ficha y sus discos.');
   const report=context['report'] as any;const pending=report?.pending??[];
   results.cases.push({id,name,ms:Date.now()-start,chars:JSON.stringify(context).length,evidence:evidence.length,reportPending:pending.length,withEvidence:pending.filter((f:any)=>f.evidenceIds?.length).length,withoutEvidence:pending.filter((f:any)=>!f.evidenceIds?.length).length,contextReduced:context['contextReduced']??false,reportCreated:report?.createdAt});
  }catch(e){results.cases.push({id,name,error:(e as Error).message,ms:Date.now()-start});}
 }
 const evidence=[{id:'E1',url:'https://example.org/prueba',quote:'La banda de rock Prueba publicó el álbum Disco Documentado.',label:'Prueba sintética',origin:'page',contentHash:'test',fetchedAt:'2026-10-10'}];
 const album:any={op:'create_album',key:'test',label:'Ejemplo',reason:'Prueba',evidenceIds:['E1'],enabled:true,artist:{kind:'artist',id:1},values:{title:'Disco Documentado',releaseYear:1987,coverUrl:'https://example.org/inventada.jpg'},tracks:[{title:'Canción inventada',discNumber:1,trackNumber:1}],credits:[],genres:[],aliases:[],formats:[]};
 const bio:any={op:'replace_fields',key:'bio',label:'Ejemplo',reason:'Prueba',evidenceIds:['E1'],enabled:true,target:{kind:'artist',id:1},values:{biography:'La banda publicó Disco Documentado y ganó cinco premios inexistentes en 1987.'}};
 results.evidenceGate=[{case:'Album title documented but invented year, cover and track',passesRelevance:hasRelevantEvidence(album,evidence)},{case:'Biography with one documented token but invented historical claims',passesRelevance:hasRelevantEvidence(bio,evidence)}];
 console.log(JSON.stringify(results,null,2));
 await writeFile('docs/ui-qa/auditoria-integral-2026-10-10/context-evidence.json',JSON.stringify(results,null,2));
}finally{await closeDb();}
