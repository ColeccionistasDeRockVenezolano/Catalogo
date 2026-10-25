import { applyEditorialVideoTimes } from "./editorial-times.js";
import type { PoolClient } from "pg";
import { albumYoutubeVideoId, youtubeVideoId } from "../shared/youtube-playback.js";
import { youtubeLinkKey } from "./linker.js";

/** Solo vincula pistas existentes al video elegido; nunca crea discos ni canciones. */
export async function syncAlbumVideoTrackTimes(client: PoolClient, options: { videoDbId?: number } = {}): Promise<{ inserted: number; albums: number; invalid: number }> {
  const albums = (await client.query<{id:string;youtube_url:string|null;youtube_status:string;links:Array<{videoId:string;kind:string;isPrimaryLink:boolean}>}>(`SELECT a.id::text,a.youtube_url,a.youtube_status,
    coalesce((SELECT jsonb_agg(jsonb_build_object('videoId',v.video_id,'kind',va.album_kind,'isPrimaryLink',va.is_primary_link) ORDER BY va.is_primary_link DESC,v.published_at)
      FROM media.video_albums va JOIN media.youtube_videos v ON v.id=va.video_id WHERE va.album_id=a.id AND v.publication_status NOT IN ('unpublished','copyright_blocked')),'[]') AS links
    FROM public.albums a WHERE EXISTS(SELECT 1 FROM media.video_albums va WHERE va.album_id=a.id AND ($1::bigint IS NULL OR va.video_id=$1))
      OR EXISTS(SELECT 1 FROM public.album_disc_links dl JOIN media.youtube_videos v ON strpos(dl.url,v.video_id)>0
        WHERE dl.album_id=a.id AND dl.platform='youtube' AND dl.verified AND ($1::bigint IS NULL OR v.id=$1))`, [options.videoDbId ?? null])).rows;
  const ids = albums.map(a=>a.id);
  if(!ids.length) {await applyEditorialVideoTimes(client,options.videoDbId);return {inserted:0,albums:0,invalid:0};}
  const tracks = (await client.query<{id:string;album_id:string;title:string;disc_number:number;track_number:number;aliases:string[]}>(`SELECT t.id::text,t.album_id::text,t.title,t.disc_number,t.track_number,
    coalesce((SELECT array_agg(ta.alias) FROM ingest.track_aliases ta WHERE ta.track_id=t.id),'{}') AS aliases
    FROM public.tracks t WHERE t.album_id=ANY($1::bigint[]) ORDER BY t.disc_number,t.track_number,t.id`, [ids])).rows;
  const discLinks = (await client.query<{album_id:string;disc_number:number;url:string}>(`SELECT dl.album_id::text,dl.disc_number,dl.url FROM public.album_disc_links dl
    WHERE dl.album_id=ANY($1::bigint[]) AND dl.platform='youtube' AND dl.verified AND NOT EXISTS(SELECT 1 FROM media.youtube_videos v WHERE strpos(dl.url,v.video_id)>0 AND v.publication_status IN ('unpublished','copyright_blocked'))`, [ids])).rows;
  const videos = (await client.query<{id:string;video_id:string;duration_seconds:number|null;chapters:Array<{position:number;title:string;startSeconds:number}>}>(`SELECT v.id::text,v.video_id,v.duration_seconds,
    coalesce((SELECT jsonb_agg(jsonb_build_object('position',e.position,'title',e.title,'startSeconds',e.start_seconds) ORDER BY e.position) FROM media.youtube_tracklist_entries e WHERE e.video_id=v.id),'[]') AS chapters
    FROM media.youtube_videos v WHERE v.publication_status NOT IN ('unpublished','copyright_blocked') AND ($1::bigint IS NULL OR v.id=$1)`, [options.videoDbId ?? null])).rows;
  const sourceId = (await client.query<{id:string}>("SELECT id::text FROM ingest.sources WHERE slug='youtube-data-api'")).rows[0]?.id ?? null;
  const existing = new Set((await client.query<{key:string}>("SELECT video_id||':'||track_id||':'||start_seconds AS key FROM media.video_tracks WHERE ($1::bigint IS NULL OR video_id=$1)", [options.videoDbId ?? null])).rows.map(row=>row.key));
  let inserted = 0, invalid = 0;
  for(const album of albums) {
    const primary = albumYoutubeVideoId({youtubeLinks:album.links,youtubeUrl:["unpublished","copyright_blocked"].includes(album.youtube_status)?null:album.youtube_url});
    const albumTracks = tracks.filter(t=>t.album_id===album.id);
    for(const video of videos) {
      const selected = albumTracks.filter(track=>{
        const own = discLinks.find(d=>d.album_id===album.id&&d.disc_number===track.disc_number);
        return (youtubeVideoId(own?.url??null)??primary)===video.video_id;
      });
      if(!selected.length) continue;
      for(const chapter of video.chapters) {
        if(chapter.startSeconds<0 || (video.duration_seconds!==null && chapter.startSeconds>=video.duration_seconds)) {
          invalid++;
          await client.query(`INSERT INTO ingest.review_queue(kind,video_id,priority,payload,notes)
            SELECT 'manual_review',$1,4,$2::jsonb,'Tiempo fuera de la duración del video; no se estima un reemplazo'
            WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE payload->>'via'='yt:track-playback' AND payload->>'sourceKey'=$3)`,
          [video.id,JSON.stringify({via:"yt:track-playback",sourceKey:`${video.video_id}:${chapter.position}`,title:chapter.title,startSeconds:chapter.startSeconds,durationSeconds:video.duration_seconds}),`${video.video_id}:${chapter.position}`]);
          continue;
        }
        const key = youtubeLinkKey(chapter.title);
        const candidates = selected.filter(t=>[t.title,...t.aliases].some(name=>youtubeLinkKey(name)===key));
        const track = candidates.length===1 ? candidates[0] : undefined;
        if(candidates.length>1) await client.query(`INSERT INTO ingest.review_queue(kind,video_id,priority,payload,notes) SELECT 'manual_review',$1,4,$2::jsonb,'Capítulo con varias pistas de título exacto; requiere asignación humana' WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE payload->>'via'='yt:ambiguous-chapter' AND payload->>'sourceKey'=$3)`,[video.id,JSON.stringify({via:'yt:ambiguous-chapter',sourceKey:`${video.video_id}:${chapter.position}`,title:chapter.title,candidateTrackIds:candidates.map(t=>Number(t.id))}),`${video.video_id}:${chapter.position}`]);
        if(!track) continue;
        const occurrenceKey = `${video.id}:${track.id}:${chapter.startSeconds}`;
        if(existing.has(occurrenceKey)) continue;
        const next = video.chapters.filter(c=>c.startSeconds>chapter.startSeconds && (video.duration_seconds===null||c.startSeconds<video.duration_seconds)).map(c=>c.startSeconds).sort((a,b)=>a-b)[0] ?? video.duration_seconds;
        const saved = await client.query(`INSERT INTO media.video_tracks(video_id,track_id,start_seconds,end_seconds,confidence,source_id,notes)
          VALUES($1,$2,$3,$4,'high',$5,'yt:track-playback: capítulo y pista exactos en el video seleccionado') ON CONFLICT(video_id,track_id,start_seconds) DO NOTHING`,
        [video.id,track.id,chapter.startSeconds,next,sourceId]);
        inserted += saved.rowCount ?? 0;
        existing.add(occurrenceKey);
      }
    }
  }
  await applyEditorialVideoTimes(client,options.videoDbId);
  return {inserted,albums:albums.length,invalid};
}
