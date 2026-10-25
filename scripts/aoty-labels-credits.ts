/** Enriquecimiento AOTY sobre entidades existentes. Sin --confirm solo prepara el plan.
 * Las identidades sin contexto, ediciones diferentes y sellos múltiples quedan en el informe.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { getPool, closeDb } from "../src/db/client.js";
import { normalizeIdentity } from "../src/normalization/claims.js";
import { persistClaim, type ClaimToPersist, type RelationEndpoints } from "../src/claims/persistence.js";
import { mergeClaim } from "../src/merge/engine.js";
import { creditEquivalenceKey, creditTypeForRole } from "../src/merge/relations.js";
import { withOperatorRun } from "../src/merge/operator.js";

const CAPTURE = "data/raw/aoty-2026-10-19";
const SOURCE = 31684;
const EXTRACTOR = "aoty-labels-credits";
type Link = { name: string; url: string };
interface Album {
  id: number; url: string; title: string; artist: string; artist_url: string;
  details: Record<string, { text?: string; links?: Link[] }>;
  credits: { full?: Array<{ name: string; url: string; role: string }> };
}
interface CatalogAlbum { id: number; artist_id: number; name: string; title: string; release_year: number | null; label_id: number | null }
interface Entity { id: number; name: string }
interface Credit { album_id: number; person_id: number | null; artist_id: number | null; credit_type: Parameters<typeof creditEquivalenceKey>[0]; role: string }
interface Snapshot {
  albums: CatalogAlbum[]; organizations: Array<Entity & { organization_type: string }>;
  persons: Entity[]; artists: Entity[];
  organizationAliases: Array<{ id: number; name: string }>;
  anchors: Array<{ artist_id: number; url: string }>;
  personContext: Array<{ person_id: number; artist_id: number }>;
  soloOwners: Array<{ person_id: number; artist_id: number }>;
  credits: Credit[];
}
interface LabelPlan { albumId: number; organizationId: number; name: string; url: string; title: string }
interface CreditPlan { albumId: number; endpoints: RelationEndpoints; name: string; role: string; creditType: Credit["credit_type"]; url: string; title: string }
interface Pending { kind: string; url: string; title: string; reason: string; value?: unknown }
const key = (value: string) => normalizeIdentity(value);
function index<T>(items: T[], identity: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) { const k = identity(item); out.set(k, [...(out.get(k) ?? []), item]); }
  return out;
}
function uniqueId(items: Entity[]): number | undefined {
  const ids = [...new Set(items.map(x => Number(x.id)))];
  return ids.length === 1 ? ids[0] : undefined;
}
export function editionMatches(album: Album, target: CatalogAlbum): boolean {
  const year = album.details["Release Date"]?.text?.match(/\b(19|20)\d{2}\b/)?.[0];
  return year !== undefined && target.release_year !== null && Number(year) === Number(target.release_year);
}
export function labelLinks(album: Album): Link[] {
  const label = album.details["Label"];
  // No Label, autoediciones y cadenas compuestas nunca se convierten en una organización.
  const text = (label?.text ?? "").replace(/\s*\/\s*Label\s*$/u, "").trim();
  if (!text || /^(?:no label|self[- ]released|independent|—|-)$/iu.test(text)) return [];
  const links = label?.links ?? [];
  return links.length === 1 && key(links[0]!.name) === key(text) && /^\/label\/\d+-/u.test(links[0]!.url) ? links : [];
}
export function buildPlan(raw: Album[], snapshot: Snapshot) {
  const albums = index(snapshot.albums, a => `${key(a.name)}|${key(a.title)}`);
  const artists = index(snapshot.artists, a => key(a.name));
  const persons = index(snapshot.persons, a => key(a.name));
  const labels = index([
    ...snapshot.organizations.filter(x => x.organization_type === "record_label"),
  ], a => key(a.name));
  const anchors = new Map<string, Set<number>>();
  for (const anchor of snapshot.anchors) {
    const url = new URL(anchor.url, "https://www.albumoftheyear.org").pathname;
    const ids = anchors.get(url) ?? new Set<number>(); ids.add(Number(anchor.artist_id)); anchors.set(url, ids);
  }
  // Las aprobaciones anteriores de AOTY documentan también qué artista posee cada disco.
  for (const album of raw) {
    const ids = anchors.get(new URL(album.url).pathname);
    if (ids?.size !== 1) continue;
    const path = new URL(album.artist_url, album.url).pathname;
    const prior = anchors.get(path) ?? new Set<number>(); for (const id of ids) prior.add(id); anchors.set(path, prior);
  }
  // Abreviaturas como XL → XL Recordings: dos discos de la misma edición
  // deben documentar un único sello existente. No usar aliases corporativos genéricos.
  const labelContext = new Map<string, { ids: Set<number>; albums: Set<number>; name: string }>();
  for (const album of raw) {
    const candidates = albums.get(`${key(album.artist)}|${key(album.title)}`) ?? [];
    const label = labelLinks(album)[0];
    if (candidates.length !== 1 || !label) continue;
    const target = candidates[0]!;
    const anchor = anchors.get(new URL(album.artist_url, album.url).pathname);
    if (!target.label_id || !editionMatches(album, target) || anchor?.size !== 1 || !anchor.has(Number(target.artist_id))) continue;
    if (!snapshot.organizations.some(x => x.id === target.label_id && x.organization_type === "record_label")) continue;
    const entry = labelContext.get(label.url) ?? { ids: new Set<number>(), albums: new Set<number>(), name: label.name };
    entry.ids.add(Number(target.label_id)); entry.albums.add(Number(target.id)); labelContext.set(label.url, entry);
  }
  for (const entry of labelContext.values()) {
    if (entry.ids.size === 1 && entry.albums.size >= 2 && !labels.has(key(entry.name))) {
      labels.set(key(entry.name), [{ id: [...entry.ids][0]!, name: entry.name, organization_type: "record_label" }]);
    }
  }
  const owners = index(snapshot.soloOwners, x => String(x.artist_id));
  const context = new Set(snapshot.personContext.map(x => `${x.person_id}|${x.artist_id}`));
  const seen = new Set(snapshot.credits.map(x => `${x.album_id}|${x.person_id ? `person:${x.person_id}` : `artist:${x.artist_id}`}|${creditEquivalenceKey(x.credit_type, x.role)}`));
  const labelPlan: LabelPlan[] = [], creditPlan: CreditPlan[] = [], pending: Pending[] = [];
  let matchedAlbums = 0, primarySkipped = 0, existingCredits = 0;
  for (const album of raw) {
    const matches = albums.get(`${key(album.artist)}|${key(album.title)}`) ?? [];
    if (matches.length !== 1) { pending.push({ kind: "album", url: album.url, title: `${album.artist} — ${album.title}`, reason: matches.length ? "disco ambiguo" : "sin coincidencia exacta" }); continue; }
    const target = matches[0]!;
    const anchor = anchors.get(new URL(album.artist_url, album.url).pathname);
    if (anchor?.size !== 1 || !anchor.has(Number(target.artist_id)) || !editionMatches(album, target)) {
      pending.push({ kind: "album", url: album.url, title: album.title, reason: "identidad sin aprobación AOTY previa o año de edición distinto/ausente", value: { artistId: target.artist_id, releaseYear: target.release_year, sourceDate: album.details["Release Date"]?.text } }); continue;
    }
    matchedAlbums++;
    if (!target.label_id) {
      const links = labelLinks(album);
      const id = links.length === 1 ? uniqueId(labels.get(key(links[0]!.name)) ?? []) : undefined;
      if (id !== undefined) labelPlan.push({ albumId: Number(target.id), organizationId: id, name: links[0]!.name, url: album.url, title: album.title });
      else pending.push({ kind: "label", url: album.url, title: album.title, reason: links.length ? "sello sin identidad única existente" : "sello ausente, compuesto o sin enlace individual", value: album.details["Label"] });
    }
    for (const credit of album.credits.full ?? []) {
      if (credit.role === "Primary") { primarySkipped++; continue; }
      const path = new URL(credit.url || "/", album.url).pathname;
      const linkedArtists = anchors.get(path);
      const artistId = linkedArtists?.size === 1 ? [...linkedArtists][0] : undefined;
      const personCandidates = persons.get(key(credit.name)) ?? [];
      const personId = uniqueId(personCandidates);
      let endpoints: RelationEndpoints | undefined;
      // Una URL AOTY aprobada identifica el proyecto; un nombre de persona necesita contexto musical.
      if (artistId !== undefined && (artists.get(key(credit.name)) ?? []).some(x => Number(x.id) === artistId)) {
        const owner = owners.get(String(artistId));
        endpoints = credit.role !== "Feature" && owner?.length === 1 ? { personId: Number(owner[0]!.person_id) } : { artistId };
      }
      else if (personId !== undefined && context.has(`${personId}|${target.artist_id}`)) endpoints = { personId };
      if (!endpoints) { pending.push({ kind: "credit", url: album.url, title: album.title, reason: "acreditado sin identidad documentada en este contexto", value: credit }); continue; }
      const creditType = credit.role === "Feature" ? "guest" : credit.role === "Songwriter" ? "writer" : creditTypeForRole(credit.role);
      const identity = `${target.id}|${endpoints.personId ? `person:${endpoints.personId}` : `artist:${endpoints.artistId}`}|${creditEquivalenceKey(creditType, credit.role)}`;
      if (seen.has(identity)) { existingCredits++; continue; }
      seen.add(identity);
      creditPlan.push({ albumId: Number(target.id), endpoints, name: credit.name, role: credit.role, creditType, url: album.url, title: album.title });
    }
  }
  return { labelPlan, creditPlan, pending, summary: { matchedAlbums, labels: labelPlan.length, credits: creditPlan.length, primarySkipped, existingCredits } };
}

async function snapshot(): Promise<Snapshot> {
  const pool = getPool();
  const [albums, organizations, persons, artists, organizationAliases, anchors, personContext, credits, soloOwners] = await Promise.all([
    pool.query("SELECT a.id::int,a.artist_id::int,ar.name,a.title,a.release_year,a.label_id::int FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id"),
    pool.query("SELECT id::int,name,organization_type FROM public.organizations"),
    pool.query("SELECT id::int,name FROM public.persons"),
    pool.query("SELECT id::int,name FROM public.artists"),
    pool.query("SELECT organization_id::int id,alias name FROM ingest.organization_aliases"),
    pool.query(`SELECT DISTINCT COALESCE(a.artist_id,c.artist_id)::int artist_id,e.url FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id LEFT JOIN public.albums a ON a.id=c.album_id WHERE c.source_id=$1 AND c.status='accepted' AND COALESCE(a.artist_id,c.artist_id) IS NOT NULL`, [SOURCE]),
    pool.query(`SELECT person_id::int,artist_id::int FROM public.artist_members UNION SELECT c.person_id::int,a.artist_id::int FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id IS NOT NULL UNION SELECT c.person_id::int,a.artist_id::int FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums a ON a.id=t.album_id WHERE c.person_id IS NOT NULL`),
    pool.query("SELECT album_id::int,person_id::int,artist_id::int,credit_type,role FROM public.album_credits"),
    pool.query("SELECT m.person_id::int,m.artist_id::int FROM public.artist_members m JOIN public.artists a ON a.id=m.artist_id WHERE a.artist_type='solo_artist' AND m.role='Titular del proyecto'"),
  ]);
  return { albums: albums.rows, organizations: organizations.rows, persons: persons.rows, artists: artists.rows, organizationAliases: organizationAliases.rows, anchors: anchors.rows, personContext: personContext.rows, credits: credits.rows, soloOwners: soloOwners.rows };
}

async function main() {
  const args = process.argv.slice(2), confirm = args.includes("--confirm"), rehearsal = args.includes("--rehearse");
  const output = args.find(x => x.startsWith("--report="))?.slice(9);
  if (confirm && rehearsal) throw new Error("--confirm y --rehearse son excluyentes");
  if ((confirm || rehearsal) && !output) throw new Error("--report=<ruta SSD> obligatorio al aplicar o ensayar");
  if (output && !resolve(output).startsWith(resolve(homedir(), "crv-staging/reports") + "/")) throw new Error("El informe debe escribirse primero en ~/crv-staging/reports/<campaña>");
  if (confirm || rehearsal || output) execFileSync("python3", ["scripts/shared-storage.py", "status"], { stdio: "pipe" });
  const raw: Album[] = readFileSync(`${CAPTURE}/albums.jsonl`, "utf8").trim().split("\n").map(x => JSON.parse(x) as Album);
  const plan = buildPlan(raw, await snapshot());
  const result: Record<string, unknown> = { ...plan, confirmed: confirm, rehearsal };
  if (confirm || rehearsal) {
    const run = await withOperatorRun({ name: EXTRACTOR, operator: "Brian (autorización: Implementa sellos y creditos)", note: "Incorporar sellos y créditos AOTY de entidades existentes, identidad contextual y edición coincidente; conservar ambigüedades.", params: { source: SOURCE, capture: CAPTURE, summary: plan.summary } }, async context => {
      await context.client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [EXTRACTOR]);
      const outcomes: unknown[] = [];
      const claim = (kind: "album" | "album_credit", identity: string, field: string, value: string | number, url: string, title: string, extra: Partial<ClaimToPersist> = {}): ClaimToPersist => ({
        entityKind: kind, identity, identitySecondary: identity, originalIdentity: title,
        field, rawValue: value, normalizedValue: value,
        rawHash: createHash("sha256").update(JSON.stringify([identity, field, value])).digest("hex"),
        extractor: EXTRACTOR, extractorVersion: "1", sourceId: SOURCE, runId: context.runId,
        confidence: "medium", createdBy: "human", evidence: { url, excerpt: `AOTY · ${title} · ${field}: ${value}` }, ...extra,
      });
      for (const item of plan.labelPlan) {
        const locked = await context.client.query("SELECT label_id FROM public.albums WHERE id=$1 FOR UPDATE", [item.albumId]);
        if (locked.rows[0]?.label_id != null) { outcomes.push({ kind: "label", albumId: item.albumId, action: "already_filled" }); continue; }
        const c = claim("album", `aoty:label:${item.albumId}`, "label_id", item.organizationId, item.url, item.title, { albumId: item.albumId });
        const persisted = await persistClaim(c, context.client);
        const outcome = await mergeClaim(c, persisted, { client: context.client });
        if (!["applied", "unchanged"].includes(outcome.action)) throw new Error(`sello ${item.albumId}: ${outcome.detail}`);
        outcomes.push({ kind: "label", albumId: item.albumId, claimId: persisted.id, ...outcome });
      }
      for (const item of plan.creditPlan) {
        const identity = `aoty:credit:${item.albumId}:${item.endpoints.personId ? `person:${item.endpoints.personId}` : `artist:${item.endpoints.artistId}`}:${key(item.role)}`;
        const endpoints = { albumId: item.albumId, ...item.endpoints };
        let primary: { c: ClaimToPersist; persisted: Awaited<ReturnType<typeof persistClaim>> } | undefined;
        for (const [field, value] of Object.entries({ credited_name: item.name, credit_type: item.creditType, credit_role: item.role })) {
          const c = claim("album_credit", identity, field, value, item.url, item.title, { endpoints });
          const persisted = await persistClaim(c, context.client);
          if (field === "credit_role") primary = { c, persisted };
        }
        const outcome = await mergeClaim(primary!.c, primary!.persisted, { client: context.client });
        if (!["applied", "unchanged"].includes(outcome.action)) throw new Error(`crédito ${identity}: ${outcome.detail}`);
        outcomes.push({ kind: "credit", albumId: item.albumId, claimId: primary!.persisted.id, ...outcome });
      }
      return outcomes;
    }, { rollbackOnly: rehearsal && !confirm });
    result["run"] = run;
  }
  if (output) writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  const run = result["run"] as { runId: number; result: unknown[] } | undefined;
  console.log(JSON.stringify({ ...plan.summary, pending: plan.pending.length, runId: run?.runId, operations: run?.result.length, report: output }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
}
