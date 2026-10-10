/** Resolución documentada del remanente RYM. Ensayo reversible por defecto. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {createEntity,updateEntity,createRelation,withOperatorRun,type OperatorContext,OperatorError} from '../../src/merge/operator.js';
import {bindRun} from '../../src/db/run-binding.js';
import {normalizeEntityName} from '../../src/normalization/entity-name.js';
import {convertPerson} from '../../src/review/person-corrections.js';
const DIR='reports/rym-resolucion-2026-10-09';
const MANIFEST='docs/decisions/2026-10-09-rym-remanente.json';
const confirm=process.argv.includes('--confirm');
const reviewed=process.argv.includes('--reviewed');
const phase=process.argv.find(a=>a.startsWith('--phase='))?.slice(8)??'31';
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const decisions=read(MANIFEST);
const result: { mode: string; phase: string; runs: number[]; ok: Array<{ href: string; id: number; tracks: number }>; errors: Array<{ href: string; error: string; details: unknown; candidates: unknown }> }={mode:confirm?'aplicado':'ensayo revertido',phase,runs:[],ok:[],errors:[]};
async function evidence(c:OperatorContext,kind:string,id:number,field:string,value:unknown,url:string){
 const col={artist:'artist_id',person:'person_id',album:'album_id',track:'track_id'}[kind]!;
 const slug=url.startsWith('https://rateyourmusic.com')?'rateyourmusic':'rym-remanente-verificacion-web';
 if(slug!=='rateyourmusic')await c.client.query("INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled,notes) VALUES($1,'Verificación web del remanente RYM 2026-10-09','website','medium',false,'Fuentes externas citadas individualmente en claim_evidence') ON CONFLICT DO NOTHING",[slug]);
 const sid=Number((await c.client.query('SELECT id FROM ingest.sources WHERE slug=$1',[slug])).rows[0].id);
 const key=`rym-remanente:${kind}:${id}:${field}`;
 const v=JSON.stringify(value); const excerpt=`${field}: ${v}. Resolución del remanente RYM autorizada por Brian el 2026-10-09.`;
 const r=await c.client.query(`INSERT INTO ingest.claims(source_id,entity_kind,${col},field,raw_value,normalized_value,raw_hash,extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key) VALUES($1,$2,$3,$4,$5::jsonb,$5::jsonb,$6,'rym-remanente','1','medium','accepted','human',$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,[sid,kind,id,field,v,sha([key,value,url]),c.runId,excerpt,key]);
 if(r.rows[0])await c.client.query('INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING',[r.rows[0].id,url,excerpt,sha([url,excerpt])]);
 return r.rows[0]?.id;
}
async function alias(c:OperatorContext,id:number,title:string,url:string){
 const key=normalizeEntityName(title).primaryKey;
 const clash=await c.client.query(`SELECT aa.album_id FROM ingest.album_aliases aa JOIN public.albums a ON a.id=aa.album_id WHERE aa.normalized_alias=$1 AND a.artist_id=(SELECT artist_id FROM public.albums WHERE id=$2) AND aa.album_id<>$2`,[key,id]);
 if(clash.rowCount)throw Error(`Alias ambiguo dentro del artista: ${title}`);
 const claim=await evidence(c,'album',id,'alternate_title',title,url);
 await c.client.query(`INSERT INTO ingest.album_aliases(album_id,alias,alias_type,normalized_alias,is_primary,confidence,claim_id,notes) VALUES($1,$2,'alternate_title',$3,false,'high',$4,$5) ON CONFLICT DO NOTHING`,[id,title,key,claim??null,`Mismo disco, cotejado con RYM: ${url}`]);
}
async function tracks(c:OperatorContext,id:number,items:Array<{ title: string; disc: number; position: number; duration?: number }>,url:string){
 if((await c.client.query('SELECT 1 FROM public.tracks WHERE album_id=$1 LIMIT 1',[id])).rowCount)return 0;
 for(const t of items){
  const values={title:t.title,disc_number:t.disc,track_number:t.position,...(t.duration?{duration_seconds:t.duration}:{})};
  const r=await createEntity(c,'track',values,{albumId:id,allowSimilar:true});
  await evidence(c,'track',r.id,'title',t.title,url);
 }
 return items.length;
}
if(!['31','artistas','discos','ajustes','ajustes-extra'].includes(phase))throw Error('Fase desconocida: '+phase);
const items=read(`${DIR}/operaciones-${phase}.json`);
for(let start=0;start<items.length;start+=10){
 const batch=items.slice(start,start+10);
 const run=await withOperatorRun({name:`RYM remanente 2026-10-09: ${phase} lote ${start/10+1}`,operator:'Codex (autorizado por Brian)',note:'Brian pidió resolver todos los pendientes RYM el 2026-10-09. Destinos, excepciones y fuentes en docs/decisions/2026-10-09-rym-remanente.json.',params:{manifest:MANIFEST,phase}},async c=>{
  await bindRun(c.client,c.runId);
  for(const it of batch){
   await c.client.query('SAVEPOINT ficha');
   try{
    let id=it.id;
    let ntracks=0;
    if(phase==='31'||phase.startsWith('ajustes')){
     if(Object.keys(it.values).length)await updateEntity(c,'album',id,it.values);
     if(it.alias)await alias(c,id,it.alias,it.url);
     ntracks=await tracks(c,id,it.tracks,it.url);
     await evidence(c,'album',id,'rym_identity',it.href,it.url);
    }else if(phase==='artistas'){
     id=decisions.artistas[it.href]?.artist_id??id;
     if(!id){const r=await createEntity(c,'artist',it.values,{allowSimilar:reviewed});id=r.id;}
     await evidence(c,'artist',id,'rym_identity',it.href,it.source);
     if(it.person_id && !it.href.includes('cabrujas')){
      await createRelation(c,'artist_membership',{artistId:id,personId:it.person_id},{role:it.href.includes('porfi')||it.href.includes('billo')||it.href.includes('arteta')?'Director':'Titular del proyecto'});
     }
     if(it.convert_person_id && (await c.client.query('SELECT 1 FROM public.persons WHERE id=$1',[it.convert_person_id])).rowCount){
      await convertPerson(c.client,it.convert_person_id,{kind:'artist',id},false,'Recordatorio es el proyecto de Armando Añez (persona 971), confirmado por Bandcamp; mover créditos del proyecto.',c.runId);
     }
    }else{
     id=decisions.discos[it.href]?.album_id??id;
     if(!id){const r=await createEntity(c,'album',it.values,{artistId:it.artist_id,allowSimilar:reviewed});id=r.id;}
     await evidence(c,'album',id,'rym_identity',it.href,it.url);
     if(it.new || !it.id)for(const [f,v] of Object.entries(it.values))await evidence(c,'album',id,f,v,it.url);
     ntracks=await tracks(c,id,it.tracks,it.url);
     for(const cr of it.credits??[]){
      let personId=cr.person_id;
      if(cr.person_name){
       const existing=await c.client.query('SELECT id FROM public.persons WHERE name=$1',[cr.person_name]);
       if(existing.rows.length>1)throw Error('Identidad de persona ambigua: '+cr.person_name);
       personId=existing.rows[0]?.id;
       if(!personId){const p=await createEntity(c,'person',{name:cr.person_name,is_venezuelan:true,notes:'Dramaturgo venezolano; textos y voz en colaboración con Juan Carlos Núñez. Fuente: '+it.url},{allowSimilar:reviewed});personId=p.id;await evidence(c,'person',personId,'name',cr.person_name,it.url);}
      }
      await createRelation(c,'album_credit',{albumId:id,...(personId?{personId:Number(personId)}:{artistId:cr.artist_id})},{credit_type:cr.type,credit_role:cr.role});
     }
    }
    await c.client.query('RELEASE SAVEPOINT ficha');
    result.ok.push({href:it.href,id,tracks:ntracks});
   }catch(error: unknown){
    const e=error instanceof Error?error:new Error(String(error));
    const details=error instanceof OperatorError?error.details:undefined;
    let candidates;
    if(details?.['resolutionDecisionId'])candidates=(await c.client.query('SELECT candidates FROM ingest.entity_resolution_decisions WHERE id=$1',[details['resolutionDecisionId']])).rows[0]?.candidates?.filter((a:{ score: number })=>a.score>=0.5).sort((a:{ score: number },b:{ score: number })=>b.score-a.score).slice(0,8);
    await c.client.query('ROLLBACK TO SAVEPOINT ficha');result.errors.push({href:it.href,error:e.message,details:details,candidates});
   }
  }
 },{rollbackOnly:!confirm});
 if(confirm){
  result.runs.push(run.runId);
  for(const row of result.ok){if(phase==='artistas')decisions.artistas[row.href].artist_id=row.id;else decisions.discos[row.href]={...(decisions.discos[row.href]??{}),album_id:row.id,motivo:decisions.discos[row.href]?.motivo??'Identidad cotejada: catálogo y alias del titular; alta distinta si no existe.',fuentes:[`https://rateyourmusic.com${row.href}`]};}
  writeFileSync(MANIFEST,JSON.stringify(decisions,null,2)+'\n');
 }
 console.log(JSON.stringify({phase,batch:start/10+1,ok:result.ok.length,errors:result.errors.length}));
}
writeFileSync(`${DIR}/resultado-${phase}-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify(result,null,2));
await closeDb();
if(result.errors.length)process.exitCode=1;
