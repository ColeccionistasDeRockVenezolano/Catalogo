// Expediente de solo lectura para profundizar la auditoría de tracklists.
import { readFileSync, writeFileSync } from "node:fs";
import { getPool, closeDb } from "../src/db/client.js";

const dir = "reports/discos-tracklist-2026-10-15";
const audit = JSON.parse(readFileSync(`${dir}/evaluacion.json`, "utf8")) as {
  results: Array<{ pair: string; category: string; albums: Array<{ id: number }> }>;
};
const focus = audit.results.filter(r => ["coincidencia_fuerte", "tracklist_con_variantes", "tracklist_igual_revisar_contexto", "decision_previa_distintos"].includes(r.category));
const ids = [...new Set(focus.flatMap(r => r.albums.map(a => a.id)))];
const client = await getPool().connect();
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='90s'");
  const query = async (sql: string) => (await client.query(sql, [ids])).rows as unknown[];
  const albums = await query(`
    SELECT to_jsonb(a) album, to_jsonb(ar) artist, o.name label,
      (SELECT count(*)::int FROM public.album_credits c WHERE c.album_id=a.id) album_credits,
      (SELECT count(*)::int FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE t.album_id=a.id) track_credits
    FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id
    LEFT JOIN public.organizations o ON o.id=a.label_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id`);
  const tracks = await query("SELECT * FROM public.tracks WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,disc_number,track_number");
  const claims = await query(`
    SELECT c.id,c.album_id,c.field,c.raw_value,c.normalized_value,c.status,c.confidence,c.extractor,c.run_id,c.notes,
      s.slug source,p.id page_id,p.url,p.stored_path,p.sha256,
      (SELECT jsonb_agg(jsonb_build_object('url',e.url,'excerpt',e.excerpt,'selector',e.selector)) FROM ingest.claim_evidence e WHERE e.claim_id=c.id) evidence
    FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id LEFT JOIN ingest.raw_pages p ON p.id=c.raw_page_id
    WHERE c.album_id=ANY($1::bigint[]) AND c.entity_kind='album' ORDER BY c.album_id,c.id`);
  const trackOrigins = await query(`
    SELECT t.album_id,s.slug source,p.id page_id,p.url,p.stored_path,c.extractor,c.status,
      count(*)::int claims,count(DISTINCT t.id)::int tracks,
      array_agg(DISTINCT c.field) fields
    FROM public.tracks t JOIN ingest.claims c ON c.track_id=t.id JOIN ingest.sources s ON s.id=c.source_id
    LEFT JOIN ingest.raw_pages p ON p.id=c.raw_page_id
    WHERE t.album_id=ANY($1::bigint[]) GROUP BY t.album_id,s.slug,p.id,p.url,p.stored_path,c.extractor,c.status
    ORDER BY t.album_id,s.slug,p.id`);
  const links = await query("SELECT * FROM public.streaming_links WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,platform");
  const discs = await query("SELECT * FROM public.album_discs WHERE album_id=ANY($1::bigint[]) ORDER BY album_id,disc_number");
  const video = await query(`
    SELECT va.album_id,to_jsonb(va) relation,v.video_id,v.title,v.description,v.duration_seconds,v.channel_title
    FROM media.video_albums va JOIN media.youtube_videos v ON v.id=va.video_id WHERE va.album_id=ANY($1::bigint[])`);
  const artistAliases = await query(`SELECT * FROM ingest.artist_aliases WHERE artist_id IN (SELECT artist_id FROM public.albums WHERE id=ANY($1::bigint[]))`);
  const distinct = await query("SELECT * FROM ingest.curation_distinct_pairs WHERE kind='album' AND (a_id=ANY($1::bigint[]) OR b_id=ANY($1::bigint[]))");
  const meta = (await client.query("SELECT transaction_timestamp()::text snapshot_at,current_setting('transaction_read_only') read_only")).rows[0] as unknown;
  writeFileSync(`${dir}/expediente-base.json`, JSON.stringify({ meta, focusPairs: focus.map(r => r.pair), albums, tracks, claims, trackOrigins, links, discs, video, artistAliases, distinct }, null, 2) + "\n");
  console.log(JSON.stringify({ albums: albums.length, tracks: tracks.length, albumClaims: claims.length, trackOrigins: trackOrigins.length, links: links.length, video: video.length }));
  await client.query("ROLLBACK");
} finally { client.release(); await closeDb(); }
