import assert from 'node:assert/strict';
import {getPool,closeDb} from '../src/db/client.js';
import {withOperatorRun,createEntity} from '../src/merge/operator.js';
import {withLockedTrackWriteSnapshot,rememberCreatedTrackInSnapshot,loadResolutionCandidates,withCandidateSnapshot} from '../src/er/repository.js';
import {resolveEntityDeterministically} from '../src/er/scoring.js';
const pool=getPool();
try{
 const result=await withOperatorRun({name:'hermes-track-snapshot-probe',operator:'codex',note:'Prueba reversible del bloqueo concurrente y del alta incremental.'},async ctx=>withLockedTrackWriteSnapshot(ctx.client,async()=>{
  const outsider=await pool.connect();let lockCode='';
  try{await outsider.query('BEGIN');await outsider.query("SET LOCAL lock_timeout='100ms'");await outsider.query('LOCK TABLE public.tracks IN ROW EXCLUSIVE MODE');}
  catch(e){lockCode=String((e as {code?:string}).code);}
  finally{await outsider.query('ROLLBACK');outsider.release();}
  assert.equal(lockCode,'55P03');
  const title='Hermes revisión reversible '+crypto.randomUUID();
  const saved=await createEntity(ctx,'track',{title,track_number:9999,disc_number:1},{albumId:34052});
  await rememberCreatedTrackInSnapshot(ctx.client,saved.id);
  const input={kind:'TRACK' as const,name:title,album:{id:34052},disc:1,trackNumber:9999};
  const incremental=resolveEntityDeterministically(input,await loadResolutionCandidates(input,ctx.client));
  const fresh=await withCandidateSnapshot(async()=>resolveEntityDeterministically(input,await loadResolutionCandidates(input,ctx.client)));
  assert.equal(incremental.action,fresh.action);assert.equal(incremental.candidateId,saved.id);assert.equal(fresh.candidateId,saved.id);
  return {blockedConcurrentWriter:true,sameDecision:true,temporaryTrackId:saved.id};
 }),{rollbackOnly:true});
 console.log(JSON.stringify({...result,rolledBack:true}));
}finally{await closeDb();}
