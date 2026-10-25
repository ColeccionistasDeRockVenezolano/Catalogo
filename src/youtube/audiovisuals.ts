import type { PoolClient } from "pg";
import { audiovisualAlbumException, audiovisualKey, audiovisualKind, audiovisualTitle, type AudiovisualKind } from "./audiovisual-rules.js";
import { parseYouTubeTitle } from "./parsers.js";

interface Seed {
  id: string; artist_name_raw: string | null; album_name_raw: string | null; album_year_raw: number | null;
  type_raw: string | null; video_id: string | null;
}
interface Video { id: string; video_id: string; title: string | null; description: string | null; }
export interface AudiovisualSyncResult {
  saved: number; exceptions: string[]; unresolved: Array<{ title: string; artist: string | null; reason: string }>;
}

/** Resolución exacta por nombre/alias o vínculos existentes; nunca por parecido. */
export async function syncArtistAudiovisuals(client: PoolClient, options: { videoDbId?: number } = {}): Promise<AudiovisualSyncResult> {
  const seeds = (await client.query<Seed>(`SELECT id::text,artist_name_raw,album_name_raw,album_year_raw,type_raw,video_id
    FROM ingest.seed_uploads ORDER BY id`)).rows;
  // Un video entra a audiovisuales por tener canal confirmado (propio o ajeno)
  // o por venir de la hoja; y solo se coloca una vez: lo ya colocado —capturas
  // editoriales incluidas— es curaduría hecha y no se vuelve a derivar.
  const videos = (await client.query<Video>(`SELECT v.id::text,v.video_id,v.title,v.description FROM media.youtube_videos v
    WHERE ($1::bigint IS NULL OR v.id=$1) AND (v.channel_id IS NOT NULL OR v.seed_upload_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM media.artist_audiovisuals av WHERE av.video_id=v.id) ORDER BY v.id`, [options.videoDbId ?? null])).rows;
  const names = (await client.query<{ id: string; name: string }>(`SELECT id::text,name FROM public.artists
    UNION SELECT artist_id::text,alias FROM ingest.artist_aliases`)).rows;
  const byName = new Map<string, Set<number>>();
  for (const row of names) {
    const key = audiovisualKey(row.name); const ids = byName.get(key) ?? new Set<number>();
    ids.add(Number(row.id)); byName.set(key, ids);
  }
  const direct = (await client.query<{ video_id: string; artist_id: string }>(`SELECT video_id::text,artist_id::text FROM media.video_artists
    WHERE relation_kind IN ('performer','subject')`)).rows;
  const result: AudiovisualSyncResult = { saved: 0, exceptions: [], unresolved: [] };
  const handled = new Set<string>();
  async function save(input: { artist: string | null; title: string; year: number | null; kind: AudiovisualKind; seed: Seed | null; video: Video | null; sourceType: string | null }) {
    const { seed, video } = input;
    const musicalException = audiovisualAlbumException(input.artist ?? "", input.title, video?.video_id ?? seed?.video_id);
    if (musicalException) result.exceptions.push(`${input.artist}: ${input.title}`);
    let ids = [...byName.get(audiovisualKey(input.artist ?? "")) ?? []];
    if (!ids.length && input.artist) {
      // Una persona puede tener el perfil musical bajo otro nombre: solo su proyecto titular documentado.
      const titulars = (await client.query<{ artist_id: string; name: string }>(`SELECT am.artist_id::text,p.name
        FROM public.persons p JOIN public.artist_members am ON am.person_id=p.id WHERE am.role='Titular del proyecto'`)).rows;
      ids = [...new Set(titulars.filter(row => audiovisualKey(row.name) === audiovisualKey(input.artist!)).map(row => Number(row.artist_id)))];
    }
    if (!input.artist && video?.title) {
      const prefix = audiovisualTitle(video.title).split(":")[0]?.trim() ?? "";
      ids = [...byName.get(audiovisualKey(prefix)) ?? []];
      if (!ids.length) {
        // La hoja dejó el artista vacío, pero el título identifica exactamente un disco.
        const albums = (await client.query<{ artist_id: string; title: string }>("SELECT artist_id::text,title FROM public.albums")).rows;
        ids = [...new Set(albums.filter(album => audiovisualKey(album.title) === audiovisualKey(prefix)).map(album => Number(album.artist_id)))];
      }
    }
    if (ids.length !== 1 && video) ids = [...new Set(direct.filter(row => row.video_id === video.id).map(row => Number(row.artist_id)))];
    if (ids.length !== 1) {
      const reason = ids.length ? "identidad ambigua" : "artista sin identidad confirmada";
      result.unresolved.push({ title: input.title, artist: input.artist, reason });
      await client.query(`INSERT INTO ingest.review_queue(kind,video_id,priority,payload,notes)
        SELECT 'manual_review',$1,5,$2::jsonb,$3 WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue
          WHERE payload->>'via'='artist-audiovisuals' AND payload->>'sourceKey'=$4 AND status IN ('open','in_progress','dismissed'))`,
        [video?.id ?? null, JSON.stringify({ via: "artist-audiovisuals", sourceKey: seed ? `seed:${seed.id}` : `video:${video!.video_id}`, artist: input.artist, title: input.title, reason }),
          `Audiovisual sin artista resuelto: ${reason}`, seed ? `seed:${seed.id}` : `video:${video!.video_id}`]);
      return;
    }
    const artistId = ids[0]!;
    const sourceKey = seed ? `seed:${seed.id}` : `video:${video!.video_id}`;
    // Si el video se conoció antes que la fila de la hoja, se completa la misma obra.
    const existing = (await client.query<{ id: string }>(`SELECT id::text FROM media.artist_audiovisuals
      WHERE artist_id=$1 AND (source_key=$2 OR ($3::bigint IS NOT NULL AND video_id=$3)) ORDER BY id LIMIT 1`, [artistId, sourceKey, video?.id ?? null])).rows[0];
    const values = [artistId, sourceKey, video?.id ?? null, seed?.id ?? null, input.title, audiovisualKey(input.title), input.year, input.kind, video?.description ?? null, input.sourceType];
    if (existing) {
      await client.query(`UPDATE media.artist_audiovisuals SET artist_id=$1,source_key=$2,video_id=coalesce($3,video_id),seed_upload_id=coalesce($4,seed_upload_id),
        title=$5,title_key=$6,release_year=coalesce($7,release_year),kind=$8,description=coalesce($9,description),source_type=coalesce($10,source_type),updated_at=now()
        WHERE id=$11 AND NOT (metadata @> '{"editorial":true}'::jsonb) AND (video_id,seed_upload_id,title,title_key,release_year,kind,description,source_type) IS DISTINCT FROM
        (coalesce($3,video_id),coalesce($4,seed_upload_id),$5,$6,coalesce($7,release_year),$8,coalesce($9,description),coalesce($10,source_type))`, [...values, existing.id]);
    } else {
      await client.query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,seed_upload_id,title,title_key,release_year,kind,description,source_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, values);
    }
    if (musicalException) await client.query(`UPDATE media.artist_audiovisuals SET allows_music_release=true
      WHERE artist_id=$1 AND source_key=$2 AND NOT allows_music_release`, [artistId, sourceKey]);
    if (video) {
      await client.query(`INSERT INTO media.video_artists(video_id,artist_id,relation_kind,confidence)
        VALUES($1,$2,$3,'high') ON CONFLICT DO NOTHING`, [video.id, artistId, input.kind === "documentary" || input.kind === "interview" || input.kind === "short" ? "subject" : "performer"]);
    }
    result.saved += 1;
  }
  for (const seed of seeds) {
    const kind = audiovisualKind(seed.type_raw);
    if (!kind || !seed.album_name_raw?.trim()) continue;
    const candidates = videos.filter(v => seed.video_id ? v.video_id === seed.video_id
      : audiovisualKey(audiovisualTitle(v.title ?? "")) === audiovisualKey(`${seed.artist_name_raw ?? ""} ${seed.album_name_raw}`)
        || audiovisualKey(audiovisualTitle(v.title ?? "")) === audiovisualKey(seed.album_name_raw ?? ""));
    const video = candidates.length === 1 ? candidates[0]! : null;
    if (options.videoDbId !== undefined && !video) continue;
    if (video) handled.add(video.video_id);
    await save({ artist: seed.artist_name_raw, title: seed.album_name_raw.trim(), year: seed.album_year_raw, kind, seed, video, sourceType: seed.type_raw });
  }
  for (const video of videos) {
    if (handled.has(video.video_id)) continue;
    const parsed = parseYouTubeTitle(video.title ?? "");
    const kind = audiovisualKind(null, video.title ?? "");
    if (!kind) continue;
    const clean = audiovisualTitle(video.title ?? "");
    const colon = clean.indexOf(":");
    const artist = parsed.artist ?? (colon > 0 ? clean.slice(0, colon).trim() : null);
    const title = parsed.artist ? audiovisualTitle(parsed.title) : colon > 0 ? clean.slice(colon + 1).trim() : clean;
    await save({ artist, title, year: parsed.year, kind, seed: null, video, sourceType: null });
  }
  return result;
}

/** Bloquea recrear como disco una obra audiovisual sin edición musical acreditada. */
export async function audiovisualAlbumConflict(client: PoolClient, artistId: number, title: string): Promise<boolean> {
  return (await client.query(`SELECT 1 FROM media.artist_audiovisuals
    WHERE artist_id=$1 AND title_key=$2 AND NOT allows_music_release LIMIT 1`, [artistId, audiovisualKey(title)])).rows.length > 0;
}
