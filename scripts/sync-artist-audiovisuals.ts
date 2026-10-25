import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, deleteEntity, deleteRelation } from "../src/merge/operator.js";
import { audiovisualKey, audiovisualKind } from "../src/youtube/audiovisual-rules.js";
import { syncArtistAudiovisuals } from "../src/youtube/audiovisuals.js";
import { canonicalVideoUrl, classifySheetRow, extractYouTubeVideoId } from "../src/youtube/normalization.js";

interface SheetSnapshot { spreadsheetId: string; sheet: string; rows: Array<{ rowNumber: number; values: string[] }>; }
const confirm = process.argv.includes("--confirm");
const snapshotPath = process.argv.find(arg => arg.startsWith("--sheet="))?.slice(8);
const snapshot = snapshotPath ? JSON.parse(await readFile(snapshotPath, "utf8")) as SheetSnapshot : null;
const note = "Audiovisuales en los perfiles: documentales, conciertos, sesiones, videoclips y piezas editoriales separados de los discos. Gasolina / Blues Criollo permanece como disco por decisión expresa de Brian (2026-10-15).";

try {
  const { runId, result } = await withOperatorRun({ name: "artist-audiovisuals", operator: "codex (encargo de Brian)", note,
    params: { spreadsheetId: snapshot?.spreadsheetId ?? null, confirm } }, async context => {
    const { client } = context;
    let sheetRows = 0;
    if (snapshot) {
      // Solo las filas audiovisuales: no reimporta ni reordena la discografía.
      const old = (await client.query<{ id: string; video_id: string | null; artist_name_raw: string | null; album_name_raw: string | null }>(
        "SELECT id::text,video_id,artist_name_raw,album_name_raw FROM ingest.seed_uploads ORDER BY id")).rows;
      for (const row of snapshot.rows) {
        const [order, artist, title, yearText, type, url, status] = row.values;
        if (!audiovisualKind(type) || !title?.trim()) continue;
        const videoId = extractYouTubeVideoId(url);
        const existing = old.find(item => videoId && item.video_id === videoId)
          ?? old.find(item => audiovisualKey(item.artist_name_raw ?? "") === audiovisualKey(artist ?? "") && audiovisualKey(item.album_name_raw ?? "") === audiovisualKey(title));
        const year = yearText && /^\d{4}$/u.test(yearText) ? Number(yearText) : null;
        const classification = classifySheetRow({ artistName: artist, albumName: title, type });
        const values = [artist || null, title, year, type, url || null, status || null, videoId, row.rowNumber,
          createHash("sha256").update(JSON.stringify(row.values)).digest("hex"), classification.kind, classification.normalizedType, classification.reason, context.runId];
        const saved = existing
          ? await client.query<{ id: string }>(`UPDATE ingest.seed_uploads SET artist_name_raw=$1,album_name_raw=$2,album_year_raw=$3,type_raw=$4,
            url_raw=$5,status_raw=$6,video_id=$7,row_number=$8,row_hash=$9,content_kind=$10,normalized_type=$11,classification_reason=$12,run_id=$13,imported_at=now() WHERE id=$14 RETURNING id::text`, [...values, existing.id])
          : await client.query<{ id: string }>(`INSERT INTO ingest.seed_uploads(artist_name_raw,album_name_raw,album_year_raw,type_raw,url_raw,status_raw,
            video_id,row_number,row_hash,content_kind,normalized_type,classification_reason,run_id,upload_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text`, [...values, order && /^\d+$/u.test(order) ? Number(order) : null]);
        if (videoId) await client.query(`INSERT INTO media.youtube_videos(video_id,url,seed_upload_id)
          VALUES($1,$2,$3) ON CONFLICT(video_id) DO UPDATE SET seed_upload_id=coalesce(media.youtube_videos.seed_upload_id,EXCLUDED.seed_upload_id)`,
        [videoId, canonicalVideoUrl(videoId), saved.rows[0]!.id]);
        sheetRows += 1;
      }
    }
    const sync = await syncArtistAudiovisuals(client);
    // Obras del canal creadas como discos sin edición musical independiente.
    const retired: number[] = [];
    for (const [albumId, expectedArtist, expectedTitle] of [[5119, 259, "Tiempo Nos Queda"], [5120, 266, "Detrás De La Puerta"], [5123, 2946, "Live Sessions At ViveConCancha"], [529, 109, "Smells Like Teen Spirit"]] as const) {
      const album = (await client.query<{ artist_id: string; title: string; description: string | null }>("SELECT artist_id::text,title,description FROM public.albums WHERE id=$1 FOR UPDATE", [albumId])).rows[0];
      if (!album) continue;
      if (Number(album.artist_id) !== expectedArtist || audiovisualKey(album.title) !== audiovisualKey(expectedTitle)) throw new Error(`La ficha ${albumId} cambió de identidad; se cancela el retiro`);
      const av = (await client.query<{ id: string }>("SELECT id::text FROM media.artist_audiovisuals WHERE artist_id=$1 AND title_key=$2", [expectedArtist, audiovisualKey(expectedTitle)])).rows[0];
      if (!av) throw new Error(`No se retira ${albumId}: falta la obra audiovisual de destino`);
      const links = (await client.query("SELECT * FROM media.video_albums WHERE album_id=$1", [albumId])).rows as unknown[];
      const tracks = (await client.query<{ id: string }>("SELECT * FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number", [albumId])).rows;
      const videoTracks = (await client.query("SELECT vt.* FROM media.video_tracks vt JOIN public.tracks t ON t.id=vt.track_id WHERE t.album_id=$1", [albumId])).rows as unknown[];
      const albumCredits = (await client.query<{ id: string }>("SELECT * FROM public.album_credits WHERE album_id=$1", [albumId])).rows;
      const trackCredits = (await client.query<{ id: string }>("SELECT tc.* FROM public.track_credits tc JOIN public.tracks t ON t.id=tc.track_id WHERE t.album_id=$1", [albumId])).rows;
      const formats = (await client.query<{ id: string }>("SELECT * FROM public.album_formats WHERE album_id=$1", [albumId])).rows;
      await client.query(`UPDATE media.artist_audiovisuals SET description=coalesce(description,$2),metadata=metadata || $3::jsonb,updated_at=now() WHERE id=$1`,
        [av.id, album.description, JSON.stringify({ formerAlbumId: albumId, formerVideoAlbumLinks: links, formerTracks: tracks, formerVideoTracks: videoTracks,
          formerAlbumCredits: albumCredits, formerTrackCredits: trackCredits, formerFormats: formats, migrationNote: note })]);
      await client.query("DELETE FROM media.video_albums WHERE album_id=$1", [albumId]);
      for (const credit of trackCredits) await deleteRelation(context, "track_credit", Number(credit.id));
      for (const credit of albumCredits) await deleteRelation(context, "album_credit", Number(credit.id));
      for (const format of formats) await deleteRelation(context, "album_format", Number(format.id));
      for (const track of tracks) {
        await client.query("DELETE FROM media.video_tracks WHERE track_id=$1", [track.id]);
        await deleteEntity(context, "track", Number(track.id));
      }
      await deleteEntity(context, "album", albumId);
      retired.push(albumId);
    }
    await client.query(`UPDATE media.artist_audiovisuals SET allows_music_release=false WHERE metadata->>'formerAlbumId' IN ('5119','5120','5123','529') AND allows_music_release`);
    // Una edición musical ya existente puede convivir con el video. No autoriza altas nuevas por el video.
    await client.query(`UPDATE media.artist_audiovisuals av SET allows_music_release=true WHERE NOT allows_music_release
      AND EXISTS (SELECT 1 FROM public.albums a WHERE a.artist_id=av.artist_id
        AND (EXISTS (SELECT 1 FROM ingest.album_aliases aa WHERE aa.album_id=a.id AND lower(aa.alias)=lower(av.title))
          OR lower(a.title)=lower(av.title)))`);
    const inventory = (await client.query(`SELECT av.id,av.artist_id,a.name AS artist,av.title,av.release_year,av.kind,v.video_id,
      coalesce(v.publication_status::text,'unknown') AS publication_status,av.metadata->>'formerAlbumId' AS former_album_id
      FROM media.artist_audiovisuals av JOIN public.artists a ON a.id=av.artist_id
      LEFT JOIN media.youtube_videos v ON v.id=av.video_id ORDER BY a.name,av.title`)).rows as Array<{ artist_id: string; kind: string }>;
    return { sheetRows, ...sync, retired, total: inventory.length, artists: new Set(inventory.map(item => item.artist_id)).size, inventory };
  }, { rollbackOnly: !confirm });
  const output = { confirm, runId, ...result };
  await writeFile(`reports/audiovisuales-${confirm ? "aplicado" : "preview"}-2026-10-15.json`, JSON.stringify(output, null, 2) + "\n");
  const { inventory: _inventory, ...summary } = output;
  console.log(JSON.stringify(summary, null, 2));
} finally { await closeDb(); }
