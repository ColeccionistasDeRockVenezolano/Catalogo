import type { PoolClient } from 'pg';
/** Reaplica decisiones por video y ocurrencia sin trasladarlas al respaldo general. */
export async function applyEditorialVideoTimes(client:PoolClient,videoDbId?:number) {
 const decisions=(await client.query<{video_id:string;track_id:string;original_start:number;start_seconds:number;end_seconds:number|null;suppressed:boolean;reason:string;duration_seconds:number|null}>(`SELECT d.*,v.duration_seconds FROM ingest.video_track_decisions d JOIN media.youtube_videos v ON v.id=d.video_id WHERE ($1::bigint IS NULL OR d.video_id=$1) ORDER BY d.id`,[videoDbId??null])).rows;
 for(const d of decisions) {
  if(!d.suppressed && d.duration_seconds!==null && (d.start_seconds>=d.duration_seconds || (d.end_seconds!==null&&d.end_seconds>d.duration_seconds))) {
   await client.query(`INSERT INTO ingest.review_queue(kind,video_id,priority,payload,notes) SELECT 'manual_review',$1,4,$2::jsonb,$3 WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE payload->>'via'='editorial-video-time' AND payload->>'decisionKey'=$4)`,[d.video_id,JSON.stringify({via:'editorial-video-time',decisionKey:`${d.video_id}:${d.track_id}:${d.original_start}`,trackId:Number(d.track_id),startSeconds:d.start_seconds,endSeconds:d.end_seconds}),`La duración actual del video contradice una corrección humana: ${d.reason}`,`${d.video_id}:${d.track_id}:${d.original_start}`]);
   continue;
  }
  if(d.suppressed || d.original_start!==d.start_seconds) await client.query('DELETE FROM media.video_tracks WHERE video_id=$1 AND track_id=$2 AND start_seconds=$3',[d.video_id,d.track_id,d.original_start]);
  if(d.suppressed) {await client.query('DELETE FROM media.video_tracks WHERE video_id=$1 AND track_id=$2 AND start_seconds=$3',[d.video_id,d.track_id,d.start_seconds]);continue;}
  await client.query(`INSERT INTO media.video_tracks(video_id,track_id,start_seconds,end_seconds,confidence,notes) VALUES($1,$2,$3,$4,'high',$5) ON CONFLICT(video_id,track_id,start_seconds) DO UPDATE SET end_seconds=EXCLUDED.end_seconds,confidence='high',notes=EXCLUDED.notes`,[d.video_id,d.track_id,d.start_seconds,d.end_seconds,d.reason]);
 }
}
