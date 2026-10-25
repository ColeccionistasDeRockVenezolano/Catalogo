import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { getAlbumDetail } from "../../src/api/repositories/albums.js";
import { persistDerivedDescription, persistVideoPayload } from "../../src/youtube/pipeline.js";
import { syncAlbumVideoTrackTimes } from "../../src/youtube/track-playback.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";
import { CRV_CHANNEL_ID } from "../../src/youtube/home-channel.js";

describe("tiempos del video que reproduce la ficha del disco", () => {
  let pg: PgContainer, albumId: number;
  let trackIds: string[], videoIds: string[];
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    const pool = getPool();
    const artist = (await pool.query("INSERT INTO public.artists(name) VALUES('Prueba de tiempos') RETURNING id")).rows[0].id;
    albumId = Number((await pool.query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Disco con dos videos') RETURNING id", [artist])).rows[0].id);
    trackIds = (await pool.query<{id:string}>(`INSERT INTO public.tracks(album_id,disc_number,track_number,title,youtube_start_seconds)
      VALUES($1,1,1,'Primera',NULL),($1,1,2,'Segunda',400),($1,2,1,'Lado B',NULL),($1,1,3,'Tiempo imposible',5000),($1,1,4,'Bonus sin video',NULL) RETURNING id::text`, [albumId])).rows.map(x => x.id);
    videoIds = (await pool.query<{id:string}>(`INSERT INTO media.youtube_videos(video_id,duration_seconds,publication_status)
      VALUES('primary0001',1000,'published'),('otherVid001',120,'published'),('sideBvideo1',600,'published'),('blocked0001',1000,'copyright_blocked') RETURNING id::text`)).rows.map(x => x.id);
    await pool.query(`INSERT INTO media.video_albums(video_id,album_id,album_kind,is_primary_link)
      VALUES($1,$3,'full_album',true),($2,$3,'music_video',false)`, [videoIds[0], videoIds[1], albumId]);
    await pool.query(`INSERT INTO public.album_disc_links(album_id,disc_number,platform,url,verified,method,source) VALUES($1,2,'youtube','https://youtu.be/sideBvideo1',true,'manual','test')`, [albumId]);
    for (const [video, track, start] of [[0,0,0],[0,0,250],[0,1,100],[0,2,999],[1,0,50],[2,2,25],[3,0,88]]) {
      await pool.query("INSERT INTO media.video_tracks(video_id,track_id,start_seconds,confidence) VALUES($1,$2,$3,'high')", [videoIds[video!], trackIds[track!], start]);
    }
  });
  afterAll(async () => { await closeDb(); await pg?.stop(); });
  it("expone las marcas guardadas en video_tracks, incluido cero y la primera repetición", async () => {
    const detail = await getAlbumDetail(albumId);
    expect(detail!.tracklist.find(t => t.title === "Primera")!.youtubeStartSeconds).toBe(0);
    expect(detail!.tracklist.find(t => t.title === "Segunda")!.youtubeStartSeconds).toBe(100);
    expect((await getPool().query("SELECT youtube_start_seconds FROM public.tracks WHERE id=$1", [trackIds[0]])).rows[0].youtube_start_seconds).toBeNull();
  });
  it("usa el video del segundo disco sin mezclar sus tiempos con el principal", async () => {
    expect((await getAlbumDetail(albumId))!.tracklist.find(t => t.title === "Lado B")!.youtubeStartSeconds).toBe(25);
  });
  it("omite tiempos fuera de la duración y no inventa marcas para los bonus ausentes", async () => {
    const detail = await getAlbumDetail(albumId);
    expect(detail!.tracklist.find(t => t.title === "Tiempo imposible")!.youtubeStartSeconds).toBeNull();
    expect(detail!.tracklist.find(t => t.title === "Bonus sin video")!.youtubeStartSeconds).toBeNull();
  });
  it("cambia las marcas cuando cambia el principal; un video bloqueado no aporta tiempos", async () => {
    const pool = getPool();
    await pool.query("UPDATE media.video_albums SET is_primary_link=false WHERE album_id=$1", [albumId]);
    await pool.query("UPDATE media.video_albums SET is_primary_link=true WHERE album_id=$1 AND video_id=$2", [albumId, videoIds[1]]);
    try {
      const detail = await getAlbumDetail(albumId);
      expect(detail!.tracklist.find(t => t.title === "Primera")!.youtubeStartSeconds).toBe(50);
      expect(detail!.tracklist.find(t => t.title === "Segunda")!.youtubeStartSeconds).toBeNull();
    } finally {
      await pool.query("UPDATE media.video_albums SET is_primary_link=false WHERE album_id=$1", [albumId]);
      await pool.query("UPDATE media.video_albums SET is_primary_link=true WHERE album_id=$1 AND video_id=$2", [albumId, videoIds[0]]);
    }
  });
  it("hidratar un concierto vinculado sincroniza títulos y alias sin crear pistas ni estimar tiempos", async () => {
    const pool = getPool();
    const artist = (await pool.query("SELECT artist_id FROM public.albums WHERE id=$1", [albumId])).rows[0].artist_id;
    const edition = (await pool.query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Edición musical') RETURNING id", [artist])).rows[0].id;
    const added = (await pool.query<{id:string}>("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,1,'First'),($1,2,'Second') RETURNING id::text", [edition])).rows;
    await pool.query("INSERT INTO ingest.track_aliases(track_id,alias,normalized_alias) VALUES($1,'Segunda','segunda')", [added[1]!.id]);
    const video = (await pool.query("INSERT INTO media.youtube_videos(video_id) VALUES('ytlive00001') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO media.video_albums(video_id,album_id,album_kind,is_primary_link) VALUES($1,$2,'live_concert',true)", [video, edition]);
    const { result } = await withOperatorRun({name:"test-track-sync",operator:"test",note:"Concierto documentado con edición musical"}, async ({client}) => {
      await persistVideoPayload(client, {id:"ytlive00001",snippet:{channelId:CRV_CHANNEL_ID,title:"Prueba de tiempos - Edición musical || Full Concert ||",
        description:"Tracklist:\nFirst 00:00\nSegunda 01:00\nTiempo imposible 02:00"},contentDetails:{duration:"PT2M"},status:{privacyStatus:"public"}});
      return syncAlbumVideoTrackTimes(client,{videoDbId:Number(video)});
    });
    expect(result.inserted).toBe(0); // La hidratación ya lo sincronizó; repetir es idempotente.
    expect(result.invalid).toBe(1);
    const detail = await getAlbumDetail(Number(edition));
    expect(detail!.tracklist.map(t=>t.youtubeStartSeconds)).toEqual([0,60]);
    expect(detail!.tracklist).toHaveLength(2);
    expect((await pool.query("SELECT youtube_start_seconds FROM public.tracks WHERE album_id=$1", [edition])).rows.every(t=>t.youtube_start_seconds===null)).toBe(true);
    expect(Number((await pool.query("SELECT count(*) FROM ingest.review_queue WHERE payload->>'via'='yt:track-playback' AND video_id=$1", [video])).rows[0].count)).toBe(1);
  });
  it("conserva una marca confirmada por una persona al rederivar y no la aplica a otro video", async () => {
    await withOperatorRun({name:"test-confirm-time",operator:"test",note:"Confirmación de un segundo exacto"}, async context => {
      await updateEntity(context,"track",Number(trackIds[0]),{youtube_start_seconds:74});
      const claim = (await context.client.query<{id:string}>("SELECT id::text FROM ingest.claims WHERE run_id=$1 AND track_id=$2 AND field='youtube_start_seconds' AND status='accepted' ORDER BY id DESC LIMIT 1", [context.runId,trackIds[0]])).rows[0]!;
      await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,selector,position,evidence_hash)
        VALUES($1,'https://www.youtube.com/watch?v=primary0001','youtube:chapter-start',0,repeat('b',64))`, [claim.id]);
      const description = "Tracklist:\nPrimera 20:00";
      await persistDerivedDescription(context.client,Number(videoIds[0]),description);
      await persistDerivedDescription(context.client,Number(videoIds[0]),description);
      await syncAlbumVideoTrackTimes(context.client,{videoDbId:Number(videoIds[0])});
      expect((await context.client.query("SELECT start_seconds FROM media.youtube_tracklist_entries WHERE video_id=$1", [videoIds[0]])).rows[0].start_seconds).toBe(74);
      await persistDerivedDescription(context.client,Number(videoIds[1]),description);
      expect((await context.client.query("SELECT start_seconds FROM media.youtube_tracklist_entries WHERE video_id=$1", [videoIds[1]])).rows[0].start_seconds).toBe(1200);
    });
    expect((await getAlbumDetail(albumId))!.tracklist.find(t=>t.title==="Primera")!.youtubeStartSeconds).toBe(74);
  });
});
