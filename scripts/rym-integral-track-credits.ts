import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb,getPool} from '../src/db/client.js';
import {createRelation,updateRelation,withOperatorRun,OperatorError} from '../src/merge/operator.js';
import {creditTypeForRole} from '../src/merge/relations.js';
import {combineRoles,sameRole} from '../src/merge/membership-roles.js';
import {validateRymCross,readRymIdentityLedger,assertRymIdentity,rymHref,normalizeRymIdentity as norm,verifyRymPin} from '../src/verification/rym-identity.js';
import {planRymPerson} from '../src/verification/rym-person-resolution.js';
import type {PersonCandidate} from '../src/verification/person-source-plan.js';
import {rymCreditScope} from '../src/verification/rym-credit-scope.js';
import type {RymTrackInput} from '../src/verification/rym-release-plan.js';

const arg=(s:string)=>{const i=process.argv.indexOf(s);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const confirm=process.argv.includes('--confirm'),limit=Number(arg('--limit')??0);
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface Release{slug:string;url:string;pistas:RymTrackInput[];creditos:Array<{nombre:string;roles:string|null;href:string|null;positions:string|null}>}
interface Track{id:number;album_id:number;title:string;disc_number:number;track_number:number}
async function main(){
 const cross=await validateRymCross(getPool(),directory!);
 const ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
 const resolvedProfiles=new Map(ledger.identities.filter(e=>e.status==='resolved').map(e=>[rymHref(e.href),e]));
 const people=(await getPool().query<PersonCandidate>(`SELECT p.id::int,p.name,
  ARRAY(SELECT alias FROM ingest.person_aliases WHERE person_id=p.id) aliases,
  ARRAY(SELECT artist_id::int FROM public.artist_members WHERE person_id=p.id UNION
    SELECT a.artist_id::int FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id=p.id UNION
    SELECT artist_id::int FROM ingest.musical_identities WHERE person_id=p.id) projects FROM public.persons p`)).rows;
 const identities=(await getPool().query<{artist_id:number;person_id:number}>('SELECT artist_id::int,person_id::int FROM ingest.musical_identities')).rows;
 const collective=new Set((await getPool().query<{id:number}>("SELECT id::int FROM ingest.catalog_artists WHERE artist_type::text IN ('band','group','duo','orchestra','ensemble')")).rows.map(r=>r.id));
 const trackMap=new Map((await getPool().query<Track>('SELECT id::int,album_id::int,title,disc_number,track_number FROM ingest.catalog_tracks')).rows.map(t=>[`${t.album_id}|${t.disc_number}|${t.track_number}`,t]));
 const trackAliases=new Map<number,Set<string>>();
 for(const alias of (await getPool().query<{track_id:number;alias:string}>('SELECT track_id::int,alias FROM ingest.track_aliases')).rows){
  const names=trackAliases.get(alias.track_id)??new Set<string>();names.add(norm(alias.alias));trackAliases.set(alias.track_id,names);
 }
 const sources=readFileSync(path.join(directory!,'corpus/albumes.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as Release);
 const tasks=new Map<string,{track:Track;artistId:number;artistHref:string;kind:'person'|'artist';targetId:number;role:string;type:string;sourceUrl:string;pins:Array<{path:string;sha256:string}>;creditedHref?:string;titleAlias?:string}>();
 const held:Array<Record<string,unknown>>=[];
 for(const release of sources){
  const proof=cross.get(release.slug);if(!proof)continue;
  for(const credit of release.creditos??[]){
   if(!credit.positions||!credit.roles)continue;
   const scope=rymCreditScope(credit.positions,release.pistas);
   if(!scope){held.push({albumId:proof.albumId,name:credit.nombre,reason:'unresolved_literal_scope',scope:credit.positions});continue;}
   const credited=credit.href?resolvedProfiles.get(rymHref(credit.href)):undefined;
   const documented=credited?.artistId?identities.filter(i=>i.artist_id===credited.artistId):[];
   const personId=documented.length===1?documented[0]!.person_id:planRymPerson(credit.nombre,proof.artistId,people,false).personId;
   const kind=personId?'person':credited?.artistId&&collective.has(credited.artistId)?'artist':null;
   const targetId=personId??credited?.artistId;
   if(!kind||!targetId){held.push({albumId:proof.albumId,name:credit.nombre,reason:'credited_identity_unresolved'});continue;}
   for(const stated of scope){
    const track=trackMap.get(`${proof.albumId}|${stated.disc_number}|${stated.track_number}`);
    if(!track||norm(track.title)!==norm(stated.title)&&!trackAliases.get(track.id)?.has(norm(stated.title))){held.push({albumId:proof.albumId,name:credit.nombre,reason:'track_position_or_title_differs',title:stated.title});continue;}
    const type=creditTypeForRole(credit.roles),key=`${track.id}|${kind}|${targetId}|${type}`,old=tasks.get(key);
    if(old){old.role=combineRoles([old.role,credit.roles]);continue;}
    tasks.set(key,{track,artistId:proof.artistId,artistHref:proof.artistHref,kind,targetId,role:credit.roles,type,sourceUrl:release.url,pins:proof.capturePins,...(credited?{creditedHref:credited.href}:{}),...(norm(track.title)!==norm(stated.title)?{titleAlias:norm(stated.title)}:{})});
   }
  }
 }
 const jobs=[...tasks.values()].slice(0,limit||undefined),checked=new Set<string>();
 const report={runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>,held};
 for(let offset=0;offset<jobs.length;offset+=60){
  const batch=jobs.slice(offset,offset+60);
  const result=await withOperatorRun({name:'catalogo:rym-integral-track-credits',operator:'Codex (encargo de Brian: agotar RYM)',
   note:'Créditos RYM por pista: posiciones literales de la edición y títulos existentes contrastados; sin crear pistas ni personas desde el crédito.',
   params:{campaign:'rym-integral-2026-10-21',phase:'track_credits',offset,planHash:digest(batch),sourcePins:batch.flatMap(t=>t.pins)}},async ctx=>{
   const output:Array<Record<string,unknown>>=[];
   await ctx.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
   for(const task of batch){
    if(!checked.has(task.artistHref)){await assertRymIdentity(ctx.client,ledger,task.artistHref,task.artistId);checked.add(task.artistHref);}
    if(task.creditedHref&&!checked.has(task.creditedHref)){
     const credited=ledger.identities.find(i=>i.href===task.creditedHref)!;
     await assertRymIdentity(ctx.client,ledger,task.creditedHref,credited.artistId!);checked.add(task.creditedHref);
    }
    for(const pin of task.pins)verifyRymPin(pin);
    const live=(await ctx.client.query<Track>('SELECT id::int,album_id::int,title,disc_number,track_number FROM public.tracks WHERE id=$1 FOR UPDATE',[task.track.id])).rows[0];
    if(!live||JSON.stringify(live)!==JSON.stringify(task.track)){held.push({trackId:task.track.id,reason:'track_changed'});continue;}
    if(task.titleAlias&&!(await ctx.client.query<{alias:string}>('SELECT alias FROM ingest.track_aliases WHERE track_id=$1',[task.track.id])).rows.some(a=>norm(a.alias)===task.titleAlias)){held.push({trackId:task.track.id,reason:'track_alias_changed'});continue;}
    await ctx.client.query('SAVEPOINT integral_track_credit');
    try{
     const column=task.kind==='person'?'person_id':'artist_id';
     const old=(await ctx.client.query<{id:number;role:string}>(`SELECT id::int,role FROM public.track_credits WHERE track_id=$1 AND ${column}=$2 AND credit_type=$3 FOR UPDATE`,[task.track.id,task.targetId,task.type])).rows;
     let id:number|undefined;
     if(!old.length&&task.role.length<=200){
      const relation=await createRelation(ctx,'track_credit',{trackId:task.track.id,...(task.kind==='person'?{personId:task.targetId}:{artistId:task.targetId})},{credit_role:task.role,credit_type:task.type});id=relation.id;
     }else if(old.length===1){
      const role=combineRoles([old[0]!.role,task.role]);
      if(role.length<=200&&!sameRole(old[0]!.role,role)){await updateRelation(ctx,'track_credit',old[0]!.id,{role});id=old[0]!.id;}
     }
     if(id){
      output.push({trackId:task.track.id,albumId:task.track.album_id,targetId:task.targetId,kind:task.kind,creditId:id,created:!old.length});
      await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
       SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND track_credit_id=$5 ON CONFLICT DO NOTHING`,[ctx.runId,task.sourceUrl,`${task.role}; ${task.track.title}; posición ${task.track.disc_number}.${task.track.track_number}`,digest(task.pins),id]);
     }
     await ctx.client.query('RELEASE SAVEPOINT integral_track_credit');
    }catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT integral_track_credit');if(!(error instanceof OperatorError))throw error;held.push({trackId:task.track.id,reason:error.code,detail:error.message});}
   }
   return output;
  },{rollbackOnly:!confirm});
  if(confirm){report.runs.push(result.runId);writeFileSync(path.join(directory!,`run-${result.runId}-track-credits.json`),JSON.stringify(result,null,2)+'\n');}
  report.outcomes.push(...result.result);
  writeFileSync(path.join(directory!,`track-credits-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`Créditos por pista ${offset+batch.length}/${jobs.length}; aportes=${report.outcomes.length}`);
 }
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
