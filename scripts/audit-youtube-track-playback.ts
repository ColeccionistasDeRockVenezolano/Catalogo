/** Lee cada video CRV vinculado y contrasta sus capítulos con la proyección pública de las pistas. */
import { writeFile, mkdir } from "node:fs/promises";
import { getPool, closeDb } from "../src/db/client.js";
import { getAlbumDetail } from "../src/api/repositories/albums.js";
import { albumYoutubeVideoId, youtubeVideoId } from "../src/shared/youtube-playback.js";
import { CRV_CHANNEL_ID } from "../src/youtube/home-channel.js";
import { youtubeLinkKey } from "../src/youtube/linker.js";

type Chapter = { title: string; startSeconds: number };
interface Video {
  id: string; video_id: string; title: string | null; duration_seconds: number | null; publication_status: string;
  albums: Array<{ id: number; title: string; artist: string; primary: boolean; kind: string }>;
  chapters: Chapter[]; audiovisuals: Array<{ artist: string; title: string }>;
}
const prefix = process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? "reports/youtube-track-playback-2026-10-15";
try {
  const videos = (await getPool().query<Video>(`SELECT v.id::text,v.video_id,v.title,v.duration_seconds,v.publication_status,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'artist',ar.name,'primary',va.is_primary_link,'kind',va.album_kind))
      FROM media.video_albums va JOIN public.albums a ON a.id=va.album_id JOIN public.artists ar ON ar.id=a.artist_id WHERE va.video_id=v.id),'[]') AS albums,
    coalesce((SELECT jsonb_agg(jsonb_build_object('title',e.title,'startSeconds',e.start_seconds) ORDER BY e.position)
      FROM media.youtube_tracklist_entries e WHERE e.video_id=v.id),'[]') AS chapters,
    coalesce((SELECT jsonb_agg(jsonb_build_object('artist',a.name,'title',av.title)) FROM media.artist_audiovisuals av JOIN public.artists a ON a.id=av.artist_id WHERE av.video_id=v.id),'[]') AS audiovisuals
    FROM media.youtube_videos v WHERE (v.channel_id=$1 OR (v.channel_id IS NULL AND v.seed_upload_id IS NOT NULL))
      AND (EXISTS(SELECT 1 FROM media.video_albums va WHERE va.video_id=v.id) OR EXISTS(SELECT 1 FROM media.artist_audiovisuals av WHERE av.video_id=v.id))
    ORDER BY v.id`, [CRV_CHANNEL_ID])).rows;
  const byVideo = new Map(videos.map(v => [v.video_id, v]));
  const albumIds = [...new Set(videos.flatMap(v => v.albums.map(a => a.id)))];
  const raw = (await getPool().query<{id:string;youtube_start_seconds:number|null}>("SELECT id::text,youtube_start_seconds FROM public.tracks WHERE album_id=ANY($1::bigint[])", [albumIds])).rows;
  const rawStarts = new Map(raw.map(t => [Number(t.id), t.youtube_start_seconds]));
  const albumReports: Array<{
    id: number; artist: string; title: string; tracks: number; playable: number;
    restored: Array<{id:number;title:string;videoId:string;startSeconds:number}>;
    withoutTime: Array<{id:number;title:string;discNumber:number;videoId:string|null;reason:string}>;
  }> = [];
  let cursor = 0;
  await Promise.all(Array.from({length: 4}, async () => {
    while(cursor < albumIds.length) {
      const id = albumIds[cursor++]!;
      const album = await getAlbumDetail(id);
      if (!album) continue;
      const primary = albumYoutubeVideoId(album);
      const restored: typeof albumReports[number]["restored"] = [], withoutTime: typeof albumReports[number]["withoutTime"] = [];
      let playable = 0;
      for(const track of album.tracklist) {
        const disc = album.discs.find(d => d.discNumber === track.discNumber);
        const videoId = youtubeVideoId(disc?.platforms.find(p => p.platform === "youtube")?.url ?? null) ?? primary;
        const video = videoId ? byVideo.get(videoId) : null;
        if (!video) continue;
        if (track.youtubeStartSeconds !== null) {
          playable++;
          if(rawStarts.get(track.id) === null) restored.push({id:track.id,title:track.title,videoId:video.video_id,startSeconds:track.youtubeStartSeconds});
        } else {
          const chapters = video.chapters.filter(c => youtubeLinkKey(c.title) === youtubeLinkKey(track.title));
          const invalid = chapters.some(c => c.startSeconds < 0 || (video.duration_seconds !== null && c.startSeconds >= video.duration_seconds));
          const repeated = album.tracklist.filter(t=>youtubeLinkKey(t.title)===youtubeLinkKey(track.title)).length > 1;
          withoutTime.push({id:track.id,title:track.title,discNumber:track.discNumber,videoId:video.video_id,
            reason:invalid ? "marca inválida en la descripción de YouTube" : chapters.length && repeated
              ? "otro CD, versión o repetición con el mismo título, sin marca propia en este video"
              : chapters.length ? "capítulo sin identidad de pista resuelta" : "la descripción de este video no incluye esta pista"});
        }
      }
      albumReports.push({id,artist:album.artist.name,title:album.title,tracks:album.tracklist.length,playable,restored,withoutTime});
      if(albumReports.length % 100 === 0) console.log(`${albumReports.length}/${albumIds.length} fichas verificadas`);
    }
  }));
  albumReports.sort((a,b) => a.id-b.id);
  const invalidChapters = videos.flatMap(v => v.chapters.filter(c => c.startSeconds < 0 || (v.duration_seconds !== null && c.startSeconds >= v.duration_seconds))
    .map(c => ({videoId:v.video_id,title:v.title,chapter:c.title,startSeconds:c.startSeconds,durationSeconds:v.duration_seconds})));
  const summary = {videos:videos.length,albums:albumReports.length,chapters:videos.reduce((n,v)=>n+v.chapters.length,0),
    playableTracks:albumReports.reduce((n,a)=>n+a.playable,0),restoredTracks:albumReports.reduce((n,a)=>n+a.restored.length,0),
    albumsRestored:albumReports.filter(a=>a.restored.length).length,withoutTime:albumReports.reduce((n,a)=>n+a.withoutTime.length,0),invalidChapters:invalidChapters.length};
  const output = {checkedAt:new Date().toISOString(),channelId:CRV_CHANNEL_ID,summary,invalidChapters,albums:albumReports,videos};
  await mkdir("reports",{recursive:true});
  await writeFile(`${prefix}.json`,JSON.stringify(output,null,2)+"\n");
  const lines = ["# Verificación de tiempos y reproducción del canal CRV", "", `Verificados individualmente ${summary.videos} videos vinculados a ${summary.albums} fichas de discos y a los audiovisuales de artistas.`, "",
    `La proyección pública ofrece ${summary.playableTracks} pistas con tiempo. Se recuperaron ${summary.restoredTracks} tiempos en ${summary.albumsRestored} discos a partir de las marcas verificadas de cada video.`, "",
    "## Tiempos recuperados", "", "| Artista | Disco | Pistas |", "| --- | --- | ---: |",
    ...albumReports.filter(a=>a.restored.length).map(a=>`| ${a.artist} | ${a.title} | ${a.restored.length} |`), "",
    "## Pistas sin tiempo en el video elegido", "", "Los bonus, otros CD y versiones ausentes de la descripción conservan su ficha y no reciben un segundo inventado. Las marcas erróneas de la fuente requieren corrección o evidencia nueva.", "",
    "| Artista | Disco | Pista | Motivo |", "| --- | --- | --- | --- |",
    ...albumReports.flatMap(a=>a.withoutTime.map(t=>`| ${a.artist} | ${a.title} | ${t.title.replaceAll("|","/")} | ${t.reason} |`)), "",
    "## Capítulos fuera de la duración del video", "", ...invalidChapters.map(c=>`- ${c.videoId} / ${c.chapter}: ${c.startSeconds}s, video de ${c.durationSeconds}s.`), "",
    "El JSON adjunto contiene el resultado de cada video, sus capítulos y sus asociaciones. La consulta live completa y la actualización de metadatos se documentan en youtube-crv-verificacion-live-2026-10-15.json y youtube-crv-metadatos-aplicados-2026-10-15.json. No se modificaron los videos ni sus descripciones en YouTube."];
  await writeFile(`${prefix}.md`,lines.join("\n")+"\n"); console.log(JSON.stringify(summary));
} finally {await closeDb();}
