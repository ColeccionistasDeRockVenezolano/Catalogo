import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';

const root='reports/reproductores-pendientes-2026-10-18';
const originalProfiles=process.argv.includes('--original-profiles');
const input=`${root}/${originalProfiles?'revisiones-perfiles-originales':'revisiones-plan'}.json`;
interface Review {artistId:number;artistName:string;profileUrls:string[];reason:string;sourceStatus:string;operation:string}
async function main(){
  const rows=JSON.parse(readFileSync(input,'utf8')) as Review[];
  const present=new Set((await getPool().query<{id:number}>("SELECT DISTINCT artist_a_id::int id FROM ingest.review_queue WHERE payload->>'operation'='artist_player_identity_recovery'")).rows.map(x=>x.id));
  const pending=rows.filter(row=>!present.has(row.artistId));
  if(!process.argv.includes('--confirm')||!pending.length){console.log(JSON.stringify({pending:pending.length,existing:rows.length-pending.length}));return;}
  const applied=await withOperatorRun({name:'catalogo:revision-reproductores-sin-identidad',operator:'Codex (encargo de Brian: resolver reproductores pendientes)',
    note:'Conservar por ficha la evidencia y el motivo por el que no se puede asignar una fuente musical. No declarar identidades por nombre/país ni sustituir enlaces verificados.',
    params:{planHash:createHash('sha256').update(readFileSync(input)).digest('hex'),artists:pending.map(row=>row.artistId)}},async context=>{
      const ids=[];
      for(const row of pending){
        const current=(await context.client.query<{name:string}>('SELECT name FROM public.artists WHERE id=$1 FOR SHARE',[row.artistId])).rows[0];
        if(!current||current.name!==row.artistName)throw new Error('Cambió el artista de la revisión');
        const result=await context.client.query<{id:number}>(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,payload,notes)
          SELECT 'manual_review','open',2,$1,$2::jsonb,$3 WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE artist_a_id=$1 AND payload->>'operation'='artist_player_identity_recovery') RETURNING id::int`,
          [row.artistId,JSON.stringify(row),row.reason]);
        if(result.rows[0])ids.push(result.rows[0].id);
      }
      return {created:ids.length,reviewIds:ids};
    });
  writeFileSync(`${root}/revisiones-${originalProfiles?'perfiles-originales-':''}aplicadas.json`,JSON.stringify({runId:applied.runId,...applied.result},null,2)+'\n');console.log(JSON.stringify(applied));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
