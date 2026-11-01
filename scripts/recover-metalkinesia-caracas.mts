/** Primary-source cross-check of the existing 32-track compilation; no new tracks. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, createRelation, updateEntity } from "../src/merge/operator.js";
import { persistClaim } from "../src/claims/persistence.js";
import { appearanceTrackTitle, sourceTitleKey as key } from "../src/discography/source-appearances.js";
import { sourceReviewFingerprint, shouldReopenEvidenceCase } from "../src/review/evidence-closure.js";
const out = process.argv[2];
if (!out || !path.resolve(out).startsWith(`${process.env["HOME"]}/crv-staging/`)) throw new Error("Indica staging SSD");
const input = JSON.parse(readFileSync(path.join(out, "metalkinesia-tracklist.json"), "utf8")) as { url: string; tracks: Array<{ number: number; artist: string; title: string; durationSeconds: number }> };
if (input.tracks.length !== 32 || input.url !== "https://cerebrosexprimidos.com.ve/metalkinesia-9/") throw new Error("Fuente inesperada");
const confirm = process.argv.includes("--confirm");
try {
  const result = await withOperatorRun({ name: "rhv:metalkinesia-primary", operator: "codex", note: "Brian: completar Kashmir y las participaciones faltantes. Lista original de Napoleón Sánchez / Prensa Cerebros Exprimidos, 16-09-2019", params: { report: "reports/rhv-participaciones-2026-10-29" } }, async ctx => {
    const album = (await ctx.client.query("SELECT title,release_year,artist_id FROM ingest.catalog_albums WHERE id=1295")).rows[0];
    if (!album || album.release_year !== 2019 || Number(album.artist_id) !== 257) throw new Error("El recopilatorio cambió");
    await ctx.client.query(`INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,notes)
      VALUES('cerebros-exprimidos','Cerebros Exprimidos — prensa','https://cerebrosexprimidos.com.ve/','website','high',false,'Fuente primaria: equipo de Metalkinesia Caracas') ON CONFLICT(slug) DO NOTHING`);
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='cerebros-exprimidos'")).rows[0].id);
    const fullTitle = "Metalkinesia. Capítulo Caracas";
    if (![key("Capitulo Caracas"), key(fullTitle)].includes(key(String(album.title)))) throw new Error("Título inesperado del recopilatorio");
    if (key(String(album.title)) !== key(fullTitle)) await updateEntity(ctx, "album", 1295, { title: fullTitle });
    const titleEvidence = await persistClaim({ entityKind: "album", albumId: 1295, field: "title", rawValue: fullTitle, normalizedValue: fullTitle,
      identity: "metalkinesia-caracas:title", identitySecondary: "metalkinesia-caracas:title", originalIdentity: fullTitle,
      rawHash: createHash("sha256").update(fullTitle).digest("hex"), sourceId, runId: ctx.runId, confidence: "high", createdBy: "human",
      extractor: "metalkinesia-original-tracklist", extractorVersion: "1", evidence: { url: input.url, excerpt: "METALKINESIA — Capitulo Caracas [9no. Compilado]" } }, ctx.client);
    await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [titleEvidence.id]);
    const artists = (await ctx.client.query<{ id: number; name: string; names: string[] }>(`SELECT a.id::int,a.name,ARRAY[a.name] || ARRAY(SELECT alias FROM ingest.artist_aliases WHERE artist_id=a.id) names FROM ingest.catalog_artists a`)).rows;
    const tracks = (await ctx.client.query<{ id: number; number: number; title: string; duration: number | null }>("SELECT id::int,track_number number,title,duration_seconds duration FROM ingest.catalog_tracks WHERE album_id=1295 ORDER BY disc_number,track_number")).rows;
    const aliases = (await ctx.client.query<{ trackId: number; alias: string }>("SELECT a.track_id::int \"trackId\",a.alias FROM ingest.track_aliases a JOIN public.tracks t ON t.id=a.track_id WHERE t.album_id=1295")).rows;
    const creditedNames = (await ctx.client.query<{ trackId: number; artistId: number; name: string }>(`SELECT tc.track_id::int "trackId",tc.artist_id::int "artistId",c.raw_value #>> '{}' name
      FROM ingest.claims c JOIN public.track_credits tc ON tc.id=c.track_credit_id JOIN public.tracks t ON t.id=tc.track_id
      WHERE t.album_id=1295 AND c.field='credited_name' AND c.status='accepted' AND tc.artist_id IS NOT NULL`)).rows;
    if (tracks.length !== 32) throw new Error("No coincide la extensión del tracklist");
    const recovered = []; const pending = [];
    for (const t of input.tracks) {
      const track = tracks.find(row => row.number === t.number);
      const scopedIds = new Set(creditedNames.filter(c => c.trackId === track?.id && key(c.name) === key(t.artist)).map(c => c.artistId));
      const candidates = scopedIds.size === 1 ? artists.filter(a => scopedIds.has(a.id)) : artists.filter(a => a.names.some(name => key(name) === key(t.artist)));
      const trackNames = [...candidates[0]?.names ?? [], ...creditedNames.filter(c => c.trackId === track?.id && c.artistId === candidates[0]?.id).map(c => c.name)];
      if (candidates.length !== 1 || !track || ![track.title, ...aliases.filter(a => a.trackId === track.id).map(a => a.alias)].some(title => key(appearanceTrackTitle(title, trackNames)) === key(t.title)) || track.duration !== t.durationSeconds) {
        pending.push({ ...t, candidates, catalogTrack: track }); continue;
      }
      const artist = candidates[0]!;
      const credit = await createRelation(ctx, "track_credit", { trackId: track.id, artistId: artist.id }, { credit_role: "Intérprete", credit_type: "musician", notes: `Lista del organizador: ${input.url}` });
      const excerpt = `${String(t.number).padStart(2, "0")}. ${t.artist} – ${t.title}`;
      const identity = `metalkinesia-caracas:track:${track.id}:performer:${artist.id}`;
      const evidence = await persistClaim({ entityKind: "track_credit", trackCreditId: credit.id, field: "credit_role", rawValue: "Intérprete", normalizedValue: "Intérprete",
        identity, identitySecondary: identity, originalIdentity: excerpt, rawHash: createHash("sha256").update(identity).digest("hex"),
        sourceId, runId: ctx.runId, confidence: "high", createdBy: "human", extractor: "metalkinesia-original-tracklist", extractorVersion: "1", evidence: { url: input.url, excerpt } }, ctx.client);
      await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [evidence.id]);
      recovered.push({ trackId: track.id, artistId: artist.id, artist: artist.name, created: credit.created });
    }
    for (const item of pending) {
      const marker = `metalkinesia-caracas:${item.number}`;
      const existing = (await ctx.client.query<{ id: number; status: string; payload: Record<string, unknown> }>("SELECT id::int,status::text,payload FROM ingest.review_queue WHERE payload->>'primaryTrackKey'=$1 FOR UPDATE", [marker])).rows[0];
      if (existing) {
        if (["approved", "dismissed"].includes(existing.status) && shouldReopenEvidenceCase(existing.payload, sourceReviewFingerprint(existing.payload, { albums: input.tracks }))) {
          await ctx.client.query(`UPDATE ingest.review_queue SET status='open',resolved_by=NULL,resolved_at=NULL,resolution_note=NULL,updated_at=now(),payload=$2::jsonb WHERE id=$1`,
            [existing.id, JSON.stringify({ ...item, primaryTrackKey: marker, sourceUrl: input.url, runId: ctx.runId, previousClosure: existing.payload["rhvClosure"] })]);
        }
        continue;
      }
      await ctx.client.query(`INSERT INTO ingest.review_queue(kind,album_id,payload,notes)
        SELECT 'manual_review',1295,$1::jsonb,'Contrastar discrepancia con la lista primaria de Metalkinesia Caracas'
        WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE payload->>'primaryTrackKey'=$2)`, [JSON.stringify({ ...item, primaryTrackKey: marker, sourceUrl: input.url, runId: ctx.runId }), marker]);
    }
    return { recovered, created: recovered.filter(r => r.created).length, pending };
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(out, confirm ? "metalkinesia-applied.json" : "metalkinesia-rehearsal.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: result.runId, verified: result.result.recovered.length, created: result.result.created, pending: result.result.pending.length }));
} finally { await closeDb(); }
