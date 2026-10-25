import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, deleteEntity, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
import { rymReleaseClassifications, rymTrackPositions, type RymPublicationInput, type RymTrackInput } from '../src/verification/rym-release-plan.js';
import { validateRymCross } from '../src/verification/rym-identity.js';
import { tracklistFingerprint } from '../src/verification/tracklist-corrections.js';

const root='reports/aprovechamiento-1-5-2026-10-17';
const confirm=process.argv.includes('--confirm');
interface Release extends RymPublicationInput {slug:string;url:string;pistas:RymTrackInput[]}
interface Track {id:number;title:string;disc_number:number;track_number:number;duration_seconds:number|null;notes:string|null}
interface Snapshot {id:number;artist_id:number;title:string;album_type:string;tracks:Track[];classifications:string[]}
interface Created {albumId:number;artistId:number;slug:string;status:string;tracks:number}
interface RepairPlan {albumId:number;slug:string;before:Snapshot;removed:Track[];changed:Array<{id:number;before:Track;values:Record<string,string|number>}>;added:NonNullable<ReturnType<typeof rymTrackPositions>>;classify:boolean;classifications:NonNullable<ReturnType<typeof rymReleaseClassifications>>;wanted:NonNullable<ReturnType<typeof rymTrackPositions>>;sourceUrl:string;pins:Array<{path:string;sha256:string}>;sourceAttributes:NonNullable<RymPublicationInput['publication_attributes']>}
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=(row:{disc_number:number;track_number:number})=>`${row.disc_number}|${row.track_number}`;
const equalSet=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
async function snapshot(albumId:number):Promise<Snapshot>{
  const row=(await getPool().query<{snapshot:Snapshot}>(`SELECT json_build_object('id',a.id,'artist_id',a.artist_id,'title',a.title,'album_type',a.album_type,
    'tracks',coalesce((SELECT json_agg(json_build_object('id',t.id,'title',t.title,'disc_number',t.disc_number,'track_number',t.track_number,'duration_seconds',t.duration_seconds,'notes',t.notes) ORDER BY t.disc_number,t.track_number,t.id) FROM public.tracks t WHERE t.album_id=a.id),'[]'::json),
    'classifications',ARRAY(SELECT classification FROM ingest.effective_album_classifications WHERE album_id=a.id ORDER BY classification)) snapshot FROM public.albums a WHERE a.id=$1`,[albumId])).rows[0];
  if(!row)throw new Error('Falta un disco importado');return row.snapshot;
}
async function main(){
  const source=JSON.parse(readFileSync(`${root}/rym-resto/publicaciones-aplicado.json`,'utf8')) as {runs:number[];outcomes:Created[]};
  const rich=new Map(readFileSync(`${root}/rym-v4-resto/albumes.jsonl`,'utf8').trim().split('\n').map(line=>{const record=JSON.parse(line) as Release;return [record.slug,record] as const;}));
  const crossing=await validateRymCross(getPool(),`${root}/rym-resto-segunda-pasada`);
  const plans:RepairPlan[]=[];
  for(const created of source.outcomes.filter(row=>row.status==='created')){
    const release=rich.get(created.slug);const proof=crossing.get(created.slug);
    if(!release || !proof || proof.albumId!==created.albumId)throw new Error('Falta el cruce del alta');
    const before=await snapshot(created.albumId);
    if(before.artist_id!==created.artistId || before.title!==release.titulo)throw new Error('Cambió la identidad del alta');
    const wanted=rymTrackPositions(release.pistas);
    if(wanted===null && before.tracks.length)throw new Error(`La lista primaria ${created.albumId} sigue ambigua; requiere adjudicación antes de modificar`);
    const classifications=rymReleaseClassifications(release);
    if(!classifications || classifications.reviewReason)throw new Error('Tipo de publicación sin resolver');
    const desired=wanted ?? [];
    const byPosition=new Map(desired.map(track=>[key(track),track]));
    const removed=before.tracks.filter(track=>!byPosition.has(key(track)));
    const changed=before.tracks.flatMap(track=>{
      const next=byPosition.get(key(track));if(!next)return [];
      const values:Record<string,string|number>={};
      if(track.title!==next.title)values['title']=next.title;
      if(next.duration_seconds!==undefined && track.duration_seconds!==next.duration_seconds)values['duration_seconds']=next.duration_seconds;
      return Object.keys(values).length?[{id:track.id,before:track,values}]:[];
    });
    const currentPositions=new Set(before.tracks.map(key));
    const added=desired.filter(track=>!currentPositions.has(key(track)));
    const classify=before.album_type!==classifications.albumType || !equalSet(before.classifications,classifications.classifications);
    if(!removed.length && !changed.length && !added.length && !classify)continue;
    plans.push({albumId:created.albumId,slug:created.slug,before,removed,changed,added,classify,classifications,wanted:desired,
      sourceUrl:release.url,pins:proof.capturePins,sourceAttributes:release.publication_attributes ?? []});
  }
  if(!existsSync(`${root}/rym-reconciliacion-plan.json`))
    writeFileSync(`${root}/rym-reconciliacion-plan.json`,JSON.stringify(plans,null,2)+'\n');
  writeFileSync(`${root}/rym-reconciliacion-pendientes.json`,JSON.stringify(plans,null,2)+'\n');
  const outcomes:Array<Record<string,unknown>>=[];
  for(const plan of plans){
    const result=await withOperatorRun({name:'catalogo:rym-lista-primaria-y-caracteristicas',operator:'Codex (encargo de Brian: puntos 1–5)',
      note:'Corregir exclusivamente altas de esta campaña: lista de la edición seleccionada (#tracks), títulos completos y características de publicación. Excluir listas de ejemplares del catálogo de usuarios.',
      params:{albumId:plan.albumId,sourceUrl:plan.sourceUrl,sourcePins:plan.pins,planHash:fingerprint(plan),sourceAttributes:plan.sourceAttributes}},async context=>{
      await context.client.query("SET LOCAL lock_timeout='5s'");
      const album=(await context.client.query<{artist_id:number;title:string;album_type:string}>('SELECT artist_id::int,title,album_type FROM public.albums WHERE id=$1 FOR UPDATE',[plan.albumId])).rows[0];
      if(!album || album.artist_id!==plan.before.artist_id || album.title!==plan.before.title || album.album_type!==plan.before.album_type)throw new Error('Cambió la ficha antes de corregir');
      for(const pin of plan.pins)if(createHash('sha256').update(readFileSync(pin.path)).digest('hex')!==pin.sha256)throw new Error('Cambió la captura primaria');
      const live=(await context.client.query<Track>('SELECT id::int,title,disc_number,track_number,duration_seconds,notes FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id FOR UPDATE',[plan.albumId])).rows;
      if(JSON.stringify(live)!==JSON.stringify(plan.before.tracks))throw new Error('Cambió la lista antes de corregir');
      const ids=plan.before.tracks.map(track=>track.id);
      const external=(await context.client.query(`SELECT 1 FROM ingest.claims WHERE track_id=ANY($1::bigint[]) AND (run_id IS NULL OR NOT(run_id=ANY($2::bigint[]))) AND status='accepted' LIMIT 1`,[ids,source.runs])).rowCount;
      if(external)throw new Error('Una pista tiene afirmaciones nuevas de otra operación; revisión necesaria');
      const unexpected=(await context.client.query(`SELECT 1 FROM public.tracks t WHERE t.id=ANY($1::bigint[]) AND
        (t.lyrics IS NOT NULL OR EXISTS(SELECT 1 FROM public.track_credits c WHERE c.track_id=t.id) OR EXISTS(SELECT 1 FROM media.video_tracks v WHERE v.track_id=t.id) OR EXISTS(SELECT 1 FROM public.entity_metrics m WHERE m.track_id=t.id)) LIMIT 1`,[plan.removed.map(track=>track.id)])).rowCount;
      if(unexpected)throw new Error('Una pista a retirar tiene información dependiente; revisión necesaria');
      const oldFingerprint=tracklistFingerprint(plan.before.tracks.map(track=>track.title));
      if(oldFingerprint!==tracklistFingerprint(plan.wanted.map(track=>track.title)) && plan.before.tracks.length)await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,album_id,payload,notes,resolved_at,resolved_by,resolution_note)
        SELECT 'manual_review','dismissed',3,$1,$2::jsonb,'Lista anterior rechazada: títulos incompletos o pistas de otros ejemplares',now(),'human','Sustituida por la lista primaria de la edición documentada'
        WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE album_id=$1 AND payload->>'operation'='tracklist_source_rejected' AND payload->>'fingerprint'=$3)`,
      [plan.albumId,JSON.stringify({operation:'tracklist_source_rejected',fingerprint:oldFingerprint,titles:plan.before.tracks.map(track=>track.title),sourcePins:plan.pins,sourceUrls:[plan.sourceUrl]}),oldFingerprint]);
      for(const track of plan.removed)await deleteEntity(context,'track',track.id);
      for(const change of plan.changed)await updateEntity(context,'track',change.id,change.values);
      for(const track of plan.added)await createEntity(context,'track',track,{albumId:plan.albumId,allowSimilar:true});
      if(plan.classify){
        const externalDecision=(await context.client.query('SELECT 1 FROM ingest.album_classification_decisions WHERE album_id=$1 AND (run_id IS NULL OR NOT(run_id=ANY($2::bigint[]))) LIMIT 1',[plan.albumId,source.runs])).rowCount;
        if(externalDecision)throw new Error('Hay una decisión de clasificación ajena al lote original');
        if(plan.before.album_type!==plan.classifications.albumType)await updateEntity(context,'album',plan.albumId,{album_type:plan.classifications.albumType});
        await writeAlbumClassifications(context,plan.albumId,plan.classifications.classifications);
      }
      await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
        SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 ON CONFLICT DO NOTHING`,[context.runId,plan.sourceUrl,'Lista primaria de la publicación (#tracks); características declaradas a nivel de publicación, sin trasladar las de una pista.',fingerprint(plan.pins)]);
      if(plan.wanted.length)await context.client.query(`UPDATE ingest.review_queue SET status='approved',resolved_at=now(),resolved_by='human',resolution_note='Numeración recuperada de la lista primaria de la edición seleccionada; excluidas copias del catálogo de usuarios',updated_at=now()
        WHERE album_id=$1 AND payload->>'operation'='rym_track_positions' AND status='open'`,[plan.albumId]);
      return {albumId:plan.albumId,removed:plan.removed.length,renamed:plan.changed.filter(row=>row.values['title']!==undefined).length,added:plan.added.length,classificationsChanged:plan.classify,tracksAfter:plan.wanted.length};
    },{rollbackOnly:!confirm});
    outcomes.push({runId:confirm?result.runId:null,...result.result});
    writeFileSync(`${root}/rym-reconciliacion-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify({dryRun:!confirm,outcomes},null,2)+'\n');
  }
  if(!plans.length)writeFileSync(`${root}/rym-reconciliacion-repeticion.json`,JSON.stringify({pending:0},null,2)+'\n');
  console.log(JSON.stringify({plans:plans.length,outcomes}));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
