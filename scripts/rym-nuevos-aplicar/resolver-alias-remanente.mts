/** Cierra únicamente falsas colisiones creadas por los runs del remanente. */
import {writeFileSync} from 'node:fs';
import {withOperatorRun} from '../../src/merge/operator.js';
import {bindRun} from '../../src/db/run-binding.js';
import {closeDb} from '../../src/db/client.js';
const confirm=process.argv.includes('--confirm');
const out=await withOperatorRun({name:'RYM remanente: alias de títulos homónimos',operator:'Codex (autorizado por Brian)',note:'Los títulos de discos se distinguen por artista, año y tipo; las pistas por disco y posición. Se conservan las fichas independientes y se descartan las falsas colisiones globales.'},async c=>{
 await bindRun(c.client,c.runId);
 const rows=(await c.client.query(`SELECT DISTINCT q.id,q.claim_a_id,q.payload,cl.source_id,cl.raw_page_id,cl.confidence
 FROM ingest.review_queue q JOIN ingest.change_journal j ON j.table_name='ingest.review_queue' AND j.op='I' AND (j.row_pk->>'id')::bigint=q.id
 JOIN ingest.scrape_runs r ON r.id=j.run_id JOIN ingest.claims cl ON cl.id=q.claim_a_id
 WHERE r.params->>'action' LIKE 'RYM remanente%' AND q.kind='ambiguous_alias' AND q.status IN ('open','in_progress') ORDER BY q.id`)).rows;
 const decisions=[];
 for(const row of rows){
  const p=row.payload;const kind=p.entityKind;
  if(kind!=='album' && kind!=='track')throw Error('Colisión no musical: '+row.id);
  const table=kind==='album'?'public.albums':'public.tracks';
  const entities=(await c.client.query(`SELECT * FROM ${table} WHERE id=ANY($1::bigint[])`,[[p.targetId,p.conflictingTargetId]])).rows;
  const a=entities.find(r=>Number(r.id)===p.targetId);const b=entities.find(r=>Number(r.id)===p.conflictingTargetId);
  if(!a||!b)throw Error('Destino no encontrado: '+row.id);
  const distinct=kind==='track'?(a.album_id!==b.album_id || a.disc_number!==b.disc_number || a.track_number!==b.track_number):(a.artist_id!==b.artist_id || (a.release_year!==null && b.release_year!==null && a.release_year!==b.release_year) || a.album_type!==b.album_type);
  if(!distinct)throw Error('Colisión sin desambiguar: '+row.id);
  const aliasTable=kind==='album'?'ingest.album_aliases':'ingest.track_aliases';const col=kind==='album'?'album_id':'track_id';
  const scope=kind==='album'?`Artista/año/tipo ${a.artist_id}/${a.release_year}/${a.album_type} ≠ ${b.artist_id}/${b.release_year}/${b.album_type}`:`Disco/posición ${a.album_id}/${a.disc_number}/${a.track_number} ≠ ${b.album_id}/${b.disc_number}/${b.track_number}`;
  await c.client.query(`INSERT INTO ${aliasTable}(${col},alias,alias_type,normalized_alias,is_primary,confidence,source_id,raw_page_id,claim_id,notes) VALUES($1,$2,'alternate_title',$3,false,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[p.targetId,p.alias,p.normalizedAlias,row.confidence,row.source_id,row.raw_page_id,row.claim_a_id,scope]);
  await c.client.query("UPDATE ingest.review_queue SET status='dismissed',resolved_by='human',resolved_at=now(),resolution_note=$2,updated_at=now() WHERE id=$1 AND status IN ('open','in_progress')",[row.id,`[Codex, autorizado por Brian] Falsa colisión de títulos; se conservan ambas fichas. ${scope}.`]);
  decisions.push({reviewId:Number(row.id),kind,alias:p.alias,targetId:p.targetId,conflictingTargetId:p.conflictingTargetId,scope});
 }
 return {closed:decisions.length,decisions};
},{rollbackOnly:!confirm});
writeFileSync(`reports/rym-resolucion-2026-10-09/alias-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify(out,null,2));console.log(JSON.stringify({runId:out.runId,closed:out.result.closed,confirm}));await closeDb();
