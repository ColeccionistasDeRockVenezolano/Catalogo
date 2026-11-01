/** Apply explicit evidence decisions to the frozen RHV cohort; rehearsal by default. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { createRelation, createEntity } from "../src/merge/operator.js";
import { persistClaim } from "../src/claims/persistence.js";
import { normalizeIdentity } from "../src/normalization/claims.js";
import { closeEvidenceReview, closureSchema, evidenceHash, sourceReviewFingerprint } from "../src/review/evidence-closure.js";

const input = process.argv[2];
if (!input || !path.resolve(input).startsWith(`${process.env["HOME"]}/crv-staging/`)) throw new Error("Indica decisiones en staging SSD");
const root = path.dirname(input);
const snapshot = JSON.parse(readFileSync(path.join(root, "reviews-before.json"), "utf8")) as Array<{ id: number; artistId: number | null; payload: Record<string, unknown> }>;
const original = new Map(snapshot.map(row => [row.id, row]));
const fichas = readFileSync("reports/rhv-directorio-2026-10-25/fichas.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line) as { url: string; bio: string[]; bio_roles: Record<string, string[]>; albums: Array<{ title: string }> });
const primary = JSON.parse(readFileSync("reports/rhv-participaciones-2026-10-29/metalkinesia-tracklist.json", "utf8")) as { tracks: Array<{ title: string }> };
const raw = JSON.parse(readFileSync(input, "utf8")) as Array<Record<string, unknown>>;
const decisions = raw.map(row => {
  const prior = original.get(Number(row["reviewId"]));
  if (!prior) throw new Error(`Revisión fuera del corte de 923: ${row["reviewId"]}`);
  const source = fichas.find(f => f.url === prior.payload["url"]) ?? { albums: primary.tracks };
  return closureSchema.parse({ ...row, expectedPayloadHash: evidenceHash(prior.payload), sourceFingerprint: sourceReviewFingerprint(prior.payload, source) });
});
if (new Set(decisions.map(d => d.reviewId)).size !== decisions.length) throw new Error("Decisiones duplicadas");
const confirm = process.argv.includes("--confirm");
try {
  const outcome = await withOperatorRun({ name: "rhv:close-evidence-cases", operator: "codex", note: "Brian: encargarse del cierre de las 923 incidencias con evidencia, distinguiendo resueltas, falsos positivos y no verificables", params: { report: "reports/rhv-cierre-incidencias-2026-10-29", decisions: decisions.length } }, async context => {
    await context.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:close-evidence-cases'))");
    const result = [];
    for (const decision of decisions) {
      const review = (await context.client.query<{ status: string; payload: Record<string, unknown> }>("SELECT status::text,payload FROM ingest.review_queue WHERE id=$1 FOR UPDATE", [decision.reviewId])).rows[0];
      if (!review) throw new Error("Revisión inexistente");
      if (review.status !== "open" && review.status !== "in_progress") {
        result.push({ id: decision.reviewId, changed: false, verdict: decision.verdict }); continue;
      }
      if (evidenceHash(review.payload) !== decision.expectedPayloadHash) throw new Error(`La revisión cambió desde el cotejo: ${decision.reviewId}`);
      const action = raw.find(r => r["reviewId"] === decision.reviewId)?.["action"] as { type?: string; trackId?: number; artistId?: number; alias?: string; expectedTitle?: string; duration?: number; creditedName?: string; personId?: number; personName?: string; role?: string; albumId?: number; title?: string; year?: number; tracks?: string[]; coverUrl?: string; mediaFormat?: string } | undefined;
      if (action?.type === "compilation_credit") {
        if (decision.verdict !== "confirmed" || !action.artistId || !action.title || !action.year || !action.tracks?.length || original.get(decision.reviewId)?.artistId !== action.artistId) throw new Error("Participación incompleta");
        let albumId = action.albumId;
        const existing = (await context.client.query<{ id: number; title: string; release_year: number | null; artist_id: number }>("SELECT id::int,title,release_year,artist_id::int FROM ingest.catalog_albums WHERE artist_id=257")).rows.filter(a => normalizeIdentity(a.title) === normalizeIdentity(action.title!));
        if (!albumId && existing.length) {
          if (existing.length !== 1 || existing[0]!.release_year !== action.year) throw new Error("Edición existente ambigua");
          albumId = existing[0]!.id;
        }
        if (!albumId) albumId = (await createEntity(context, "album", { title: action.title, release_year: action.year, album_type: "compilation", ...(action.coverUrl ? { cover_url: action.coverUrl } : {}), media_format: action.mediaFormat ?? "Digital", description: "Recopilatorio documentado. Las participaciones acreditadas no constituyen un listado completo de pistas.", notes: decision.evidence.map(e => e.url).join(" · ") }, { artistId: 257, allowSimilar: true })).id;
        const album = (await context.client.query("SELECT title,release_year FROM ingest.catalog_albums WHERE id=$1 FOR SHARE", [albumId])).rows[0];
        if (!album || normalizeIdentity(album.title) !== normalizeIdentity(action.title) || album.release_year !== action.year) throw new Error("Cambió la edición de destino");
        const credit = await createRelation(context, "album_credit", { albumId, artistId: action.artistId }, { credit_role: "Intérprete", credit_type: "musician", notes: decision.reason + " · " + decision.evidence.map(e => e.url).join(" · ") });
        const source = decision.evidence.find(e => e.kind === "primary") ?? decision.evidence[0]!;
        const identity = `rhv-closure:album-credit:${credit.id}:documented-tracks`;
        const claim = await persistClaim({ entityKind: "album_credit", albumCreditId: credit.id, field: "documented_tracks", rawValue: action.tracks, normalizedValue: action.tracks,
          identity, identitySecondary: identity, originalIdentity: action.title, rawHash: evidenceHash([identity, action.tracks]), sourceId: context.sourceId, runId: context.runId,
          confidence: source.kind === "primary" ? "high" : "medium", createdBy: "human", extractor: "rhv-evidence-closure", extractorVersion: "1", evidence: { url: source.url, excerpt: source.quote } }, context.client);
        await context.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
        decision.target = { kind: "album_credit", id: credit.id, albumId, artistId: action.artistId };
      } else if (action?.type === "membership") {
        if (decision.verdict !== "confirmed" || !decision.identityClaim || !action.artistId || !action.personName || !action.role || original.get(decision.reviewId)?.artistId !== action.artistId) throw new Error("Membresía sin identidad contrastada");
        let personId = action.personId;
        if (personId) {
          const person = (await context.client.query("SELECT name FROM public.persons WHERE id=$1 FOR SHARE", [personId])).rows[0];
          if (!person || person.name !== action.personName) throw new Error("Cambió la identidad de la persona");
        } else {
          const matches = await context.client.query<{ id: number; name: string }>("SELECT id,name FROM public.persons UNION ALL SELECT person_id AS id,alias AS name FROM ingest.person_aliases");
          if (matches.rows.some(p => normalizeIdentity(p.name) === normalizeIdentity(action.personName!))) throw new Error("Existe un homónimo: requiere cotejo explícito por ID");
          personId = (await createEntity(context, "person", { name: action.personName, notes: decision.reason + " · " + decision.evidence.map(e => e.url).join(" · ") }, { allowSimilar: true })).id;
        }
        const membership = await createRelation(context, "artist_membership", { artistId: action.artistId, personId }, { role: action.role, notes: decision.reason + " · " + decision.evidence.map(e => e.url).join(" · ") });
        decision.target = { kind: "artist_membership", id: membership.id, personId, artistId: action.artistId };
      } else if (action?.type === "track_alias") {
        if (decision.verdict !== "confirmed" || !action.trackId || !action.artistId || !action.alias || !action.expectedTitle) throw new Error("Alias de pista incompleto");
        const track = (await context.client.query<{ title: string; duration: number | null }>(`SELECT t.title,t.duration_seconds duration FROM public.tracks t
          WHERE t.id=$1 AND EXISTS(SELECT 1 FROM public.track_credits c WHERE c.track_id=t.id AND c.artist_id=$2 AND c.credit_type IN ('musician','guest','other')) FOR SHARE`, [action.trackId, action.artistId])).rows[0];
        if (!track || track.title !== action.expectedTitle || track.duration !== action.duration) throw new Error("Cambió la pista a la que se atribuye el alias");
        const source = decision.evidence.find(e => e.kind === "primary");
        if (!source) throw new Error("El alias necesita fuente primaria");
        const identity = `rhv-closure:track:${action.trackId}:alias:${normalizeIdentity(action.alias)}`;
        const sourceId = Number((await context.client.query("SELECT id FROM ingest.sources WHERE slug='cerebros-exprimidos'")).rows[0]?.id);
        if (!sourceId) throw new Error("Fuente primaria sin registrar");
        const claim = await persistClaim({ entityKind: "track", trackId: action.trackId, field: "title", rawValue: action.alias, normalizedValue: action.alias,
          identity, identitySecondary: identity, originalIdentity: action.alias, rawHash: evidenceHash([identity, action.alias]), sourceId, runId: context.runId,
          confidence: "high", createdBy: "human", extractor: "rhv-evidence-closure", extractorVersion: "1", evidence: { url: source.url, excerpt: source.quote } }, context.client);
        await context.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
        await context.client.query(`INSERT INTO ingest.track_aliases(track_id,alias,alias_type,normalized_alias,confidence,source_id,claim_id,notes)
          SELECT $1,$2,'alternate_title',$3::text,'high',$4,$5,$6 WHERE NOT EXISTS
          (SELECT 1 FROM ingest.track_aliases WHERE track_id=$1 AND normalized_alias=$3::text) ON CONFLICT DO NOTHING`,
          [action.trackId, action.alias, normalizeIdentity(action.alias), sourceId, claim.id, decision.reason]);
        await createRelation(context, "track_credit", { trackId: action.trackId, artistId: action.artistId }, { credit_role: "Intérprete", credit_type: "musician", notes: source.url });
      } else if (action?.type === "track_credit") {
        if (decision.verdict !== "confirmed" || !action.trackId || !action.artistId || !action.expectedTitle || !action.creditedName) throw new Error("Crédito de pista incompleto");
        const track = (await context.client.query<{ title: string; duration: number | null }>("SELECT title,duration_seconds duration FROM public.tracks WHERE id=$1 FOR SHARE", [action.trackId])).rows[0];
        if (!track || track.title !== action.expectedTitle || track.duration !== action.duration) throw new Error("Cambió la pista a acreditar");
        const source = decision.evidence.find(e => e.kind === "primary");
        if (!source || decision.evidence.length < 2) throw new Error("Crédito sin contraste de fuentes");
        const credit = await createRelation(context, "track_credit", { trackId: action.trackId, artistId: action.artistId }, { credit_role: "Intérprete", credit_type: "musician", notes: `${decision.reason} · ${source.url}` });
        const sourceId = Number((await context.client.query("SELECT id FROM ingest.sources WHERE slug='cerebros-exprimidos'")).rows[0]?.id);
        const identity = `rhv-closure:track-credit:${credit.id}:credited-name`;
        const claim = await persistClaim({ entityKind: "track_credit", trackCreditId: credit.id, field: "credited_name", rawValue: action.creditedName, normalizedValue: action.creditedName,
          identity, identitySecondary: identity, originalIdentity: action.creditedName, rawHash: evidenceHash([identity, action.creditedName]), sourceId, runId: context.runId,
          confidence: "high", createdBy: "human", extractor: "rhv-evidence-closure", extractorVersion: "1", evidence: { url: source.url, excerpt: source.quote } }, context.client);
        await context.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
      } else if (action) throw new Error(`Acción no admitida: ${action.type}`);
      if (decision.verdict === "already_resolved" && decision.target?.["kind"] === "artist_membership") {
        const membership = (await context.client.query<{ artistId: number; personId: number }>("SELECT artist_id::int \"artistId\",person_id::int \"personId\" FROM public.artist_members WHERE id=$1", [decision.target["id"]])).rows[0];
        if (!membership || membership.artistId !== original.get(decision.reviewId)?.artistId || membership.personId !== decision.target["personId"]) throw new Error(`La membresía citada no corresponde al caso ${decision.reviewId}`);
      }
      if (decision.verdict === "already_resolved" && decision.target?.["kind"] === "album_credit") {
        const row = (await context.client.query("SELECT album_id::int,artist_id::int,credit_type FROM public.album_credits WHERE id=$1", [decision.target["id"]])).rows[0];
        if (!row || row.album_id !== decision.target["albumId"] || row.artist_id !== original.get(decision.reviewId)?.artistId || !["musician", "guest", "other"].includes(row.credit_type)) throw new Error("El crédito de álbum no corresponde al caso");
      }
      if (decision.verdict === "already_resolved" && decision.target?.["kind"] === "track_credit_set") {
        const ids = decision.target["trackIds"] as number[];
        if (!Array.isArray(ids) || !ids.length) throw new Error("Faltan las pistas ya acreditadas");
        const rows = (await context.client.query(`SELECT DISTINCT t.id::int FROM public.tracks t JOIN public.track_credits c ON c.track_id=t.id
          WHERE t.id=ANY($1::bigint[]) AND t.album_id=$2 AND c.artist_id=$3 AND c.credit_type IN ('musician','guest','other')`, [ids, decision.target["albumId"], original.get(decision.reviewId)?.artistId])).rows;
        if (rows.length !== ids.length) throw new Error("Cambió el conjunto de créditos existente");
      }
      result.push({ ...await closeEvidenceReview(context, decision), verdict: decision.verdict });
    }
    return result;
  }, { rollbackOnly: !confirm });
  const report = { confirmed: confirm, runId: outcome.runId, changed: outcome.result.filter(r => r.changed).length, decisions, results: outcome.result };
  writeFileSync(input.replace(/\.json$/u, confirm ? "-applied.json" : "-rehearsal.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: report.runId, changed: report.changed, verdicts: Object.fromEntries([...new Set(decisions.map(d => d.verdict))].map(verdict => [verdict, decisions.filter(d => d.verdict === verdict).length])) }));
} finally { await closeDb(); }
