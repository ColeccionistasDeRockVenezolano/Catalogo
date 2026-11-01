/** RHV: audit by default; --confirm applies an additive, journaled recovery.
 * The source lists appearances, not complete tracklists. Never invent track numbers.
 * Usage: scripts/with-node22.sh tsx scripts/recover-rhv-appearances.mts <SSD-report-dir> [--confirm]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { withOperatorRun, createEntity, createRelation } from "../src/merge/operator.js";
import { persistClaim, type ClaimToPersist, type ClaimTargets } from "../src/claims/persistence.js";
import { normalizeIdentity } from "../src/normalization/claims.js";
import { withCandidateSnapshot } from "../src/er/repository.js";
import { instrumentsOf } from "../src/discography/instruments.js";
import { biographyMembershipContext, cleanBiographyPersonName, evidenceHash, shouldReopenEvidenceCase, sourceReviewFingerprint } from "../src/review/evidence-closure.js";
import { appearanceTrackTitle, matchingAppearanceTracks, sourcePerformerIsArtist, sourceTitleKey as key } from "../src/discography/source-appearances.js";

interface Entry { title: string; years_raw: string; appearance: string | null; header: string; tracks: Array<{ title: string }>; covers: string[]; formats: string[] }
interface Ficha { url: string; name: string; bio: string[]; bio_roles: Record<string, string[]>; albums: Entry[] }
interface Album { id: number; title: string; artistId: number; year: number | null; type: string }
interface Artist { id: number; name: string; type: string; names: string[] }
interface Appearance { artistId: number; artist: string; performer: string; names: string[]; url: string; title: string; catalogTitle: string | null; year: number | null; tracks: string[]; covers: string[]; formats: string[]; albumId: number | null }
interface Membership { artistId: number; artist: string; personId: number; name: string; role: string; url: string }
interface Pending { reason: string; artistId?: number; artist?: string; url: string; title?: string; name?: string; candidates?: unknown; tracks?: string[] }
const out = process.argv[2];
if (!out || !path.resolve(out).startsWith(`${process.env["HOME"]}/crv-staging/`)) throw new Error("Indica una campaña de staging SSD");
const confirm = process.argv.includes("--confirm");
const rehearse = process.argv.includes("--rehearse");
const base = "reports/rhv-directorio-2026-10-25";
const fichas = readFileSync(process.env["RHV_FICHAS"] ?? `${base}/fichas.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line) as Ficha);
const oldIds = (JSON.parse(readFileSync(`${base}/aplicacion.json`, "utf8")) as { artistIds: Record<string, number> }).artistIds;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const albumKey = (title: string) => key(title.replace(/^(?:el|la|los|las|the)\s+/iu, ""));
const yearOf = (raw: string): number | null => { const years = raw.match(/(?:19|20)\d{2}/gu); return years?.length === 1 ? Number(years[0]) : null; };
const pending: Pending[] = [];
const coverManifest = path.join(out, "covers.json");
const localizedCovers = new Map((existsSync(coverManifest) ? JSON.parse(readFileSync(coverManifest, "utf8")) as Array<{ sourceUrl: string; localUrl?: string }> : [])
  .filter(c => c.localUrl).map(c => [c.sourceUrl, c.localUrl!]));
const appearances: Appearance[] = [];
const memberships: Membership[] = [];
const pool = getPool();
try {
  const snapshot = await pool.connect();
  let artists: Artist[]; let albums: Album[];
  let docs: Array<{ artistId: number; url: string }>;
  let persons: Array<{ id: number; name: string }>;
  let personAliases: Array<{ id: number; name: string }>;
  let memberRows: Array<{ artistId: number; personId: number; role: string }>;
  let creditRows: Array<{ albumId: number; personId: number; role: string }>;
  let vaTracks: Array<{ albumId: number; title: string; performerIds: number[] }>;
  try {
    await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    artists = (await snapshot.query<Artist>(`SELECT a.id::int,a.name,a.artist_type::text type,
      ARRAY[a.name] || ARRAY(SELECT alias FROM ingest.artist_aliases WHERE artist_id=a.id) names FROM ingest.catalog_artists a`)).rows;
    albums = (await snapshot.query<Album>(`SELECT id::int,title,artist_id::int "artistId",release_year AS "year",album_type::text type FROM ingest.catalog_albums`)).rows;
    docs = (await snapshot.query<{ artistId: number; url: string }>(`SELECT artist_id::int "artistId",source_url url FROM media.artist_documents WHERE source_url LIKE 'https://rockhechovenezuela.com/%'`)).rows;
    persons = (await snapshot.query<{ id: number; name: string }>("SELECT id::int,name FROM public.persons")).rows;
    personAliases = (await snapshot.query<{ id: number; name: string }>("SELECT person_id::int id,alias name FROM ingest.person_aliases")).rows;
    memberRows = (await snapshot.query<{ artistId: number; personId: number; role: string }>(`SELECT artist_id::int "artistId",person_id::int "personId",role FROM public.artist_members`)).rows;
    creditRows = (await snapshot.query<{ albumId: number; personId: number; role: string }>(`SELECT album_id::int "albumId",person_id::int "personId",role FROM public.album_credits WHERE person_id IS NOT NULL AND credit_type='musician'`)).rows;
    vaTracks = (await snapshot.query<{ albumId: number; title: string; performerIds: number[] }>(`SELECT t.album_id::int "albumId",t.title,
      ARRAY(SELECT tc.artist_id::int FROM public.track_credits tc WHERE tc.track_id=t.id AND tc.credit_type IN ('musician','guest','other')) "performerIds"
      FROM ingest.catalog_tracks t JOIN ingest.catalog_albums a ON a.id=t.album_id JOIN ingest.catalog_artists ar ON ar.id=a.artist_id
      WHERE lower(ar.name) IN ('various artists','varios artistas')`)).rows;
    await snapshot.query("ROLLBACK");
  } finally { snapshot.release(); }
  const byArtist = new Map(artists.map(a => [a.id, a]));
  const personsByKey = new Map<string, typeof persons>();
  for (const person of [...persons, ...personAliases]) {
    const k = key(person.name); const rows = personsByKey.get(k) ?? [];
    if (!rows.some(p => p.id === person.id)) rows.push(person);
    personsByKey.set(k, rows);
  }
  const albumKeys = albums.map(a => ({ album: a, key: albumKey(a.title) }));
  const byAlbumKey = new Map<string, Album[]>();
  for (const album of albums) { const k = albumKey(album.title); byAlbumKey.set(k, [...byAlbumKey.get(k) ?? [], album]); }
  const vaIds = new Set(artists.filter(a => ["variousartists", "variosartistas"].includes(key(a.name))).map(a => a.id));
  if (vaIds.size !== 1) throw new Error("Titular Various Artists ambiguo");
  const vaId = [...vaIds][0]!;
  const resolved: Array<{ ficha: Ficha; artist: Artist }> = [];
  for (const ficha of fichas) {
    const fromUrl = [...new Set(docs.filter(d => d.url === ficha.url).map(d => d.artistId))];
    const old = byArtist.get(oldIds[ficha.url] ?? 0);
    const id = fromUrl.length === 1 ? fromUrl[0] : old?.names.some(n => key(n) === key(ficha.name)) ? old.id : undefined;
    const artist = id === undefined ? undefined : byArtist.get(id);
    if (!artist || fromUrl.length > 1) { pending.push({ reason: "artist_identity", artist: ficha.name, url: ficha.url, candidates: fromUrl }); continue; }
    resolved.push({ ficha, artist });
    const sourceAppearances = ficha.albums.filter(e => e.appearance);
    const sourceGroups = new Map<string, Entry[]>();
    for (const entry of sourceAppearances) {
      const groupKey = `${albumKey(entry.title)}|${yearOf(entry.years_raw)}`;
      sourceGroups.set(groupKey, [...sourceGroups.get(groupKey) ?? [], entry]);
    }
    const conflictingGroups = new Set<string>();
    for (const [groupKey, entries] of sourceGroups) {
      const distinctCovers = new Set(entries.map(e => e.covers[0]).filter(Boolean));
      const distinctTracks = new Set(entries.filter(e => e.tracks.length).map(e => JSON.stringify(e.tracks.map(t => key(t.title)).sort())));
      if (distinctCovers.size > 1 && distinctTracks.size > 1) {
        conflictingGroups.add(groupKey);
        pending.push({ reason: "source_same_title_multiple_editions", artistId: artist.id, artist: artist.name, url: ficha.url, title: entries[0]!.title,
          candidates: entries.map(e => ({ header: e.header, covers: e.covers, tracks: e.tracks })) });
      }
    }
    for (const entry of sourceAppearances) {
      if (conflictingGroups.has(`${albumKey(entry.title)}|${yearOf(entry.years_raw)}`)) continue;
      // The performer must identify this ficha, not a guest named in an unrelated section.
      if (!sourcePerformerIsArtist(entry.appearance!, [...artist.names, ficha.name])) {
        pending.push({ reason: "performer_identity", artistId: artist.id, artist: artist.name, url: ficha.url, title: entry.title, candidates: entry.appearance }); continue;
      }
      const year = yearOf(entry.years_raw);
      const exact = byAlbumKey.get(albumKey(entry.title)) ?? [];
      const va = exact.filter(a => vaIds.has(a.artistId) && (year === null || a.year === null || a.year === year));
      const foreign = exact.filter(a => !vaIds.has(a.artistId));
      let albumId: number | null = null;
      let reason: string | undefined;
      if (va.length === 1) albumId = va[0]!.id;
      else if (va.length > 1) reason = "album_ambiguous";
      else if (exact.length) reason = foreign.length ? "album_other_owner_or_year" : "album_year_conflict";
      else {
        const wanted = albumKey(entry.title);
        const near = albumKeys.filter(a => {
          const k = a.key;
          return (vaIds.has(a.album.artistId) || a.album.type === 'compilation') && k.length >= 6 && wanted.length >= 6 && (k.includes(wanted) || wanted.includes(k));
        }).map(a => a.album);
        const names = [...artist.names, ficha.name];
        const fingerprint = near.filter(a => vaIds.has(a.artistId) && year !== null && a.year === year && entry.tracks.length > 0 && entry.tracks.every(t => {
          const matches = matchingAppearanceTracks(vaTracks.filter(row => row.albumId === a.id), t.title, names);
          return matches.length === 1 && (matches[0]!.performerIds.includes(artist.id) || appearanceTrackTitle(matches[0]!.title, names) !== matches[0]!.title);
        }));
        if (fingerprint.length === 1) albumId = fingerprint[0]!.id;
        else if (near.length) {
          reason = "album_similar";
          pending.push({ reason: "album_similar", artistId: artist.id, artist: artist.name, url: ficha.url, title: entry.title, candidates: near });
        }
      }
      if (reason) {
        if (reason !== "album_similar") pending.push({ reason, artistId: artist.id, artist: artist.name, url: ficha.url, title: entry.title, candidates: exact });
        continue;
      }
      if (/DVD|VCD|Blu.?ray/iu.test(entry.formats.join(" ")) && !entry.formats.some(f => /^(?:LP|CD|Digital|Cassette)$/iu.test(f))) {
        pending.push({ reason: "audiovisual_not_audio", artistId: artist.id, artist: artist.name, url: ficha.url, title: entry.title }); continue;
      }
      appearances.push({ artistId: artist.id, artist: artist.name, performer: entry.appearance!, names: [...new Set([...artist.names, ficha.name])], url: ficha.url, title: entry.title, catalogTitle: albums.find(a => a.id === albumId)?.title ?? null, year,
        tracks: entry.tracks.map(t => t.title), covers: entry.covers, formats: entry.formats, albumId });
    }
  }
  // Recover memberships only with a documented person already connected to that
  // band's discography, with matching instrument. Never merge people by name.
  for (const { ficha, artist } of resolved) {
    if (!["band", "group", "ensemble", "orchestra", "duo"].includes(artist.type)) continue;
    const ownAlbums = new Set(albums.filter(a => a.artistId === artist.id).map(a => a.id));
    for (const a of appearances.filter(a => a.artistId === artist.id && a.albumId !== null)) ownAlbums.add(a.albumId!);
    const linked = creditRows.filter(c => ownAlbums.has(c.albumId));
    for (const [rawName, roles] of Object.entries(ficha.bio_roles ?? {})) {
      const name = cleanBiographyPersonName(rawName);
      const role = [...new Set(roles)].join(", ");
      const instruments = instrumentsOf(role);
      // Reject fragments and parentheticals the legacy bio parser mistakes for people.
      if (!instruments.length || name.trim().split(/\s+/u).length < 2 || name.length > 100) continue;
      if (biographyMembershipContext(name, ficha.bio) === "guest") continue;
      const exactPersons = personsByKey.get(key(name)) ?? [];
      const already = exactPersons.filter(p => memberRows.some(m => m.artistId === artist.id && m.personId === p.id));
      if (already.length) continue;
      const candidates = exactPersons.filter(p => linked.some(c => c.personId === p.id && instrumentsOf(c.role ?? "").some(i => instruments.includes(i))));
      if (candidates.length !== 1) {
        pending.push({ reason: "membership_identity", artistId: artist.id, artist: artist.name, name, url: ficha.url, candidates: exactPersons }); continue;
      }
      const mention = ficha.bio.find(paragraph => paragraph.includes(name)) ?? "";
      const beforeName = mention.slice(Math.max(0, mention.indexOf(name) - 80), mention.indexOf(name));
      if (/colaboraci[oó]n de|invitad[oa].{0,35}$/iu.test(beforeName)) {
        pending.push({ reason: "membership_collaborator", artistId: artist.id, artist: artist.name, name, url: ficha.url, candidates }); continue;
      }
      memberships.push({ artistId: artist.id, artist: artist.name, personId: candidates[0]!.id, name, role, url: ficha.url });
    }
  }
  const onlyArtist = process.argv.find(arg => arg.startsWith("--artist-id="))?.slice("--artist-id=".length);
  if (onlyArtist) {
    const id = Number(onlyArtist);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("artist-id inválido");
    appearances.splice(0, appearances.length, ...appearances.filter(a => a.artistId === id));
    memberships.splice(0, memberships.length, ...memberships.filter(m => m.artistId === id));
    pending.splice(0, pending.length, ...pending.filter(p => p.artistId === id));
  }
  const sincePath = process.argv.find(arg => arg.startsWith("--new-since="))?.slice("--new-since=".length);
  if (sincePath) {
    const prior = JSON.parse(readFileSync(sincePath, "utf8")) as { appearances: Appearance[]; pending: Pending[] };
    const appearanceKey = (a: Appearance) => JSON.stringify([a.artistId, a.url, a.title]);
    const pendingKey = (p: Pending) => JSON.stringify([p.reason, p.artistId, p.url, p.title, p.name]);
    const previous = new Set(prior.appearances.map(appearanceKey));
    const previousPending = new Set(prior.pending.map(pendingKey));
    appearances.splice(0, appearances.length, ...appearances.filter(a => !previous.has(appearanceKey(a))));
    pending.splice(0, pending.length, ...pending.filter(p => !previousPending.has(pendingKey(p))));
    memberships.splice(0);
  }
  const retryPath = process.argv.find(arg => arg.startsWith("--retry-sql-errors="))?.slice("--retry-sql-errors=".length);
  if (retryPath) {
    const prior = JSON.parse(readFileSync(retryPath, "utf8")) as { result: { failures: Array<{ artistId: number; url: string; title: string; error: string }> } };
    const retryKeys = new Set(prior.result.failures.filter(f => f.error.startsWith("inconsistent types deduced"))
      .map(f => JSON.stringify([f.artistId, f.url, f.title])));
    appearances.splice(0, appearances.length, ...appearances.filter(a => retryKeys.has(JSON.stringify([a.artistId, a.url, a.title]))));
    memberships.splice(0); pending.splice(0);
  }
  const plan = { queriedAt: new Date().toISOString(), fichas: fichas.length, resolvedArtists: resolved.length, appearances, memberships, pending };
  writeFileSync(path.join(out, "plan.json"), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ fichas: fichas.length, resolvedArtists: resolved.length, appearances: appearances.length,
    newAlbums: new Set(appearances.filter(a => a.albumId === null).map(a => `${albumKey(a.title)}|${a.year}`)).size,
    memberships: memberships.length, pending: pending.length, pendingReasons: Object.fromEntries([...new Set(pending.map(p => p.reason))].map(r => [r, pending.filter(p => p.reason === r).length])) }));
  if (!confirm && !rehearse) process.exitCode = 0;
  else {
    // Empty kinds keeps fresh reads for every write while compacting ER dossiers.
    const outcome = await withCandidateSnapshot(() => withOperatorRun({ name: "rhv:recover-appearances", operator: "codex", note: "Brian: Haz todo el trabajo. Recuperar participaciones y membresías documentadas de RHV; sin inventar posiciones ni fusionar identidades", params: { report: "reports/rhv-participaciones-2026-10-29", appearances: appearances.length } }, async ctx => {
      await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:recover-appearances'))");
      const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
      const pages = (await ctx.client.query<{ id: number; url: string }>("SELECT id::int,canonical_url url FROM ingest.raw_pages WHERE canonical_url LIKE 'https://rockhechovenezuela.com/%'")).rows;
      async function evidence(kind: ClaimToPersist["entityKind"], targets: ClaimTargets, field: string, value: unknown, url: string, excerpt: string) {
        const identity = `rhv-recovery:${kind}:${JSON.stringify(targets)}:${field}`;
        const rawPageId = pages.find(p => p.url === url)?.id;
        const persisted = await persistClaim({ entityKind: kind, ...targets, field, rawValue: value, normalizedValue: value,
          identity, identitySecondary: identity, originalIdentity: excerpt.slice(0, 250), rawHash: sha([identity, value, url]),
          sourceId, ...(rawPageId === undefined ? {} : { rawPageId }), runId: ctx.runId, confidence: "medium", createdBy: "human",
          extractor: "rhv-appearance-recovery", extractorVersion: "1", evidence: { url, excerpt: excerpt.slice(0, 1000) } }, ctx.client);
        await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [persisted.id]);
        return persisted.id;
      }
      const result = { albumsCreated: 0, albumCreditsCreated: 0, trackCreditsCreated: 0, membershipsCreated: 0, evidence: 0, reviewCreated: 0, failures: [] as unknown[], albumIds: {} as Record<string, number> };
      const cache = new Map<string, number>();
      let processed = 0;
      for (const a of appearances) {
        await ctx.client.query("SAVEPOINT appearance");
        const countsBefore = { albumsCreated: result.albumsCreated, albumCreditsCreated: result.albumCreditsCreated,
          trackCreditsCreated: result.trackCreditsCreated, evidence: result.evidence };
        try {
          const k = `${albumKey(a.title)}|${a.year}`;
          let albumId = a.albumId ?? cache.get(k);
          if (albumId === undefined || albumId === null) {
            const fresh = (await ctx.client.query<{ id: number; title: string; year: number | null }>(`SELECT id::int,title,release_year AS "year" FROM ingest.catalog_albums WHERE artist_id=$1`, [vaId])).rows
              .filter(row => albumKey(row.title) === albumKey(a.title));
            if (fresh.length > 1 || fresh.some(row => row.year !== null && a.year !== null && row.year !== a.year)) throw new Error("El disco cambió o tiene otra edición/año; revisar");
            if (fresh[0]) albumId = fresh[0].id;
            else {
              const created = await createEntity(ctx, "album", { title: a.title, release_year: a.year, album_type: "compilation",
                description: "Recopilatorio documentado en Rock Hecho en Venezuela. Las participaciones conocidas no constituyen una lista completa de pistas.",
                ...(a.covers[0] ? { cover_url: localizedCovers.get(new URL(a.covers[0], a.url).href) ?? new URL(a.covers[0], a.url).href } : {}), ...(a.formats[0] ? { media_format: a.formats[0] } : {}), notes: `Fuente: ${a.url}` }, { artistId: vaId });
              albumId = created.id; result.albumsCreated++;
            }
          }
          const liveAlbum = (await ctx.client.query<{ title: string; artistId: number; year: number | null }>(`SELECT title,artist_id::int "artistId",release_year AS "year" FROM ingest.catalog_albums WHERE id=$1 FOR SHARE`, [albumId])).rows[0];
          if (!liveAlbum || !vaIds.has(liveAlbum.artistId) || albumKey(liveAlbum.title) !== albumKey(a.catalogTitle ?? a.title) || (liveAlbum.year !== null && a.year !== null && liveAlbum.year !== a.year)) throw new Error("Disco cambió desde la auditoría");
          const relation = await createRelation(ctx, "album_credit", { albumId, artistId: a.artistId }, { credit_role: "Intérprete", credit_type: "musician", notes: `${a.url} — Intérprete según fuente: ${a.performer}. Temas documentados: ${a.tracks.join("; ")}` });
          if (relation.created) result.albumCreditsCreated++;
          await evidence("album_credit", { albumCreditId: relation.id }, "documented_tracks", a.tracks, a.url, `${a.title} (${a.year ?? "s/f"}). Temas interpretados por ${a.performer}: ${a.tracks.join(", ")}`);
          result.evidence++;
          const titleClaim = await evidence("album", { albumId }, "title", a.title, a.url, `${a.title} (${a.year ?? "s/f"})`);
          if (albumKey(liveAlbum.title) !== albumKey(a.title)) {
            await ctx.client.query(`INSERT INTO ingest.album_aliases(album_id,alias,alias_type,normalized_alias,confidence,source_id,claim_id,notes)
              SELECT $1,$2,'alternate_title',$3::text,'medium',$4,$5,$6 WHERE NOT EXISTS
              (SELECT 1 FROM ingest.album_aliases WHERE album_id=$1 AND normalized_alias=$3::text) ON CONFLICT DO NOTHING`,
              [albumId, a.title, normalizeIdentity(a.title), sourceId, titleClaim, `Título RHV contrastado con año e intérprete/pistas del catálogo: ${a.url}`]);
          }
          const rows = (await ctx.client.query<{ id: number; title: string }>("SELECT id::int,title FROM ingest.catalog_tracks WHERE album_id=$1", [albumId])).rows;
          for (const title of a.tracks) {
            const matches = matchingAppearanceTracks(rows, title, a.names);
            if (matches.length === 1) {
              const credit = await createRelation(ctx, "track_credit", { trackId: matches[0]!.id, artistId: a.artistId }, { credit_role: "Intérprete", credit_type: "musician", notes: `Según ${a.url}` });
              if (credit.created) result.trackCreditsCreated++;
              await evidence("track_credit", { trackCreditId: credit.id }, "credit_role", "Intérprete", a.url, `${a.artist}: ${title} en ${a.title}`);
            } else if (matches.length > 1) pending.push({ reason: "track_ambiguous", artistId: a.artistId, artist: a.artist, url: a.url, title: a.title, tracks: [title], candidates: matches });
          }
          cache.set(k, albumId); result.albumIds[k] = albumId;
          if (retryPath) {
            const reviewKey = sha(["apply_needs_review", a.artistId, a.url, a.title, undefined]);
            await ctx.client.query(`UPDATE ingest.review_queue SET status='approved',resolved_by='human',resolved_at=now(),updated_at=now(),
              resolution_note=$2 WHERE payload->>'rhvRecoveryKey'=$1 AND status='open'
              AND payload->'candidates'->>'message' LIKE 'inconsistent types deduced%'`,
              [reviewKey, `Consulta de alias corregida; participación recuperada con evidencia. Run ${ctx.runId}`]);
          }
          await ctx.client.query("RELEASE SAVEPOINT appearance");
        } catch (error) {
          await ctx.client.query("ROLLBACK TO SAVEPOINT appearance");
          Object.assign(result, countsBefore);
          const message = error instanceof Error ? error.message : String(error);
          const details = typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
          result.failures.push({ ...a, error: message, details });
          pending.push({ reason: "apply_needs_review", artistId: a.artistId, artist: a.artist, url: a.url, title: a.title, candidates: { message, details } });
        }
        processed++;
        if (processed % 25 === 0) console.log(JSON.stringify({ processed, total: appearances.length, albumsCreated: result.albumsCreated, failures: result.failures.length }));
      }
      for (const m of memberships) {
        const relation = await createRelation(ctx, "artist_membership", { artistId: m.artistId, personId: m.personId }, { role: m.role, notes: `Formación citada en ${m.url}; identidad contrastada con créditos de su discografía. Sin fechas ni vigencia inferidas.` });
        if (relation.created) result.membershipsCreated++;
        await evidence("artist_membership", { artistMembershipId: relation.id }, "role", m.role, m.url, `${m.name} (${m.role}) — ${m.artist}`);
        await ctx.client.query(`INSERT INTO ingest.membership_details(artist_member_id,instruments,run_id) VALUES($1,$2,$3) ON CONFLICT (artist_member_id) DO NOTHING`, [relation.id, instrumentsOf(m.role), ctx.runId]);
      }
      const knownReviews = (await ctx.client.query<{ id: number; key: string; status: string; payload: Record<string, unknown> }>("SELECT id::int,payload->>'rhvRecoveryKey' key,status::text,payload FROM ingest.review_queue WHERE payload ? 'rhvRecoveryKey'")).rows;
      const existingReviewKeys = new Map(knownReviews.map(r => [r.key, r]));
      const semanticKey = (item: Record<string, unknown>) => evidenceHash({ reason: item["reason"], artistId: item["artistId"], url: item["url"], title: item["title"] ?? null,
        name: typeof item["name"] === "string" ? cleanBiographyPersonName(item["name"]) : null });
      const semanticReviews = new Map(knownReviews.map(r => [semanticKey(r.payload), r]));
      for (const item of pending) {
        const reviewKey = sha([item.reason, item.artistId, item.url, item.title, item.name]);
        const previous = existingReviewKeys.get(reviewKey) ?? semanticReviews.get(semanticKey({ ...item }));
        if (previous) {
          const source = fichas.find(f => f.url === item.url);
          if (source && previous.status !== 'open' && previous.status !== 'in_progress' && shouldReopenEvidenceCase(previous.payload, sourceReviewFingerprint({ ...item }, source))) {
            await ctx.client.query(`UPDATE ingest.review_queue SET status='open',resolved_by=NULL,resolved_at=NULL,resolution_note=NULL,updated_at=now(),
              payload=(payload-'rhvClosure') || jsonb_build_object('previousClosure',payload->'rhvClosure','reopenedByRun',$2::bigint)
              WHERE id=$1`, [previous.id, ctx.runId]);
          }
          continue;
        }
        const inserted = await ctx.client.query(`INSERT INTO ingest.review_queue(kind,artist_a_id,payload,notes)
          VALUES('manual_review',$1,$2::jsonb,$3) RETURNING id`,
          [item.artistId ?? null, JSON.stringify({ ...item, rhvRecoveryKey: reviewKey, campaign: "rhv-participaciones-2026-10-29", runId: ctx.runId }), `RHV: ${item.reason}; conservar evidencia, sin resolver por nombre`]);
        result.reviewCreated += inserted.rowCount ?? 0;
        // Duplicate source references within this same batch are suppressed too.
        existingReviewKeys.set(reviewKey, { id: 0, key: reviewKey, status: 'open', payload: { ...item } });
      }
      return result;
    }, { rollbackOnly: !confirm }), { kinds: [] });
    writeFileSync(path.join(out, confirm ? "applied.json" : "rehearsal.json"), JSON.stringify(outcome, null, 2));
    console.log(JSON.stringify({ runId: outcome.runId, confirmed: confirm, ...outcome.result, albumIds: Object.keys(outcome.result.albumIds).length, failures: outcome.result.failures.length }));
  }
} finally { await closeDb(); }
