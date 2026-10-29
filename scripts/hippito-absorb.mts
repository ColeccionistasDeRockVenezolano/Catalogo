// CRV · Absorción de Hippito y sus Chatarritas desde la captura completa del
// 2026-10-25 (data/raw/deep-hippito-2026-10-25, 1.063 entradas leídas con el
// adaptador del pipeline por scripts/hippito-posts-parse.mts).
//
// Los claims de 2026-09 se rechazaron casi todos por el alcance de entonces
// (recopilatorios sin artista del catálogo, artistas aún ausentes). Este paso
// vuelve a cruzar cada ficha con el catálogo de HOY y solo completa:
//
//   · Hippito nunca crea artistas: la ficha entra si su artista ya está en el
//     catálogo (nombre, alias o variante predecible, sin ambigüedad);
//   · un recopilatorio «VA -» entra solo si alguna de sus pistas la toca un
//     artista del catálogo; el disco va a Various Artists (257) y quien toca
//     cada pista, a track_credits (intérprete), como ya hace el adaptador;
//   · cruce de discos por título exacto (sin tildes ni artículos) o por el mismo
//     número de catálogo; casi idéntico y mismo año (±1) es el mismo disco; un
//     parecido menor queda propuesto y no se crea;
//   · solo se rellena lo vacío (año, sello, catálogo, portada; pistas si el disco
//     no tiene); la portada distinta va a Curaduría; cada ficha deja su edición en
//     ingest.album_versions con su sello (0068);
//   · compositores en gris → track_credits (composer / writer / other), sin
//     repetir los que la pista ya tiene;
//   · D4: en discos ≤1989 Hippito manda frente a Sincopa, pero un año distinto
//     NO se sobrescribe aquí: se informa para revisión.
//
//   HIPPITO_FICHAS=…/fichas.jsonl HIPPITO_OUT=…/dir ./scripts/with-node22.sh npx tsx scripts/hippito-absorb.mts [--confirm]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { persistClaim, type ClaimToPersist } from "../src/claims/persistence.js";
import { normalizeIdentity, normalizeIdentitySecondary } from "../src/normalization/claims.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";
import { proposeImageCandidate } from "../src/merge/image-candidates.js";
import { audiovisualAlbumConflict } from "../src/youtube/audiovisuals.js";

const TAG = "hippito-2026-10-25";
const SLUG = "hippito-y-sus-chatarritas";
const CAPTURE = "raw/deep-hippito-2026-10-25";
const VARIOUS = 257;
const OPERATOR = "claude-code (encargo de Brian)";
const NOTE = "Absorción de Hippito y sus Chatarritas (captura 2026-10-25): completa discos de artistas del catálogo y recopilatorios con artistas del catálogo; solo rellena vacíos";
const FICHAS = process.env["HIPPITO_FICHAS"];
const OUT = process.env["HIPPITO_OUT"];
const CONFIRM = process.argv.includes("--confirm");
if (!FICHAS || !OUT) throw new Error("faltan HIPPITO_FICHAS y HIPPITO_OUT");

interface Track { n: number; title: string; performer: string | null; credits: Array<{ name: string; role: string }> }
interface Ficha {
  url: string; title: string; parsed: boolean; artist: string; various?: boolean; album: string; year: string | null;
  label: string | null; catalog: string | null; cover: string | null; tracks: Track[];
}
// El original primero: una reedición posterior cruza con él y queda como edición (ingest.album_versions).
const fichas = readFileSync(FICHAS, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Ficha).filter((ficha) => ficha.parsed)
  .sort((a, b) => Number(a.year ?? 9999) - Number(b.year ?? 9999));
// Retirada a mano (run 5971): la entrada es una nota biográfica, no un disco.
// Fichas del catálogo con origin_country='Venezuela' que no son venezolanas (revisado el 2026-10-25):
// Dúo Dinámico (España), Orquesta Aragón (Cuba), The New Vaudeville Band (Reino Unido), Los Prisioneros (Chile).
const FOREIGN_IN_CATALOG = new Set([7125, 4393, 4744, 4588]);
// Alias que no nombran a ese intérprete en estos recopilatorios: «Nena» (la alemana) ≠ Nenadeagua 6819;
// «Billy Ocean» → 6141 «Les Charles» (ficha del británico marcada como venezolana).
const PERFORMER_MISMATCH = new Set([6819, 6141]);
const HUMAN_REJECTED = new Set(["Trino Mora::Tributo 50 Aniversario de Vida Artística"]);
const manifest = new Map<string, string>();
for (const line of readFileSync(path.resolve("data", CAPTURE, "html_manifest.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const row = JSON.parse(line) as { url: string; file: string };
  manifest.set(row.url, row.file);
}

// ── Utilidades (las mismas claves que rhv-directorio-absorb) ──
const fold = (value: string): string => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
function titleKey(value: string): string {
  return fold(value).replace(/&|\band\b|\by\b/g, " ").replace(/^\s*(los|las|el|la|the)\s+/u, "").replace(/[^a-z0-9]+/g, "");
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter)) return 0.9;
  const grams = (text: string): Set<string> => { const set = new Set<string>(); for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2)); return set; };
  const left = grams(longer); const right = grams(shorter);
  let shared = 0; for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size || 1);
}
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, vi: 6, vii: 7, viii: 8, ix: 9, xi: 11, xii: 12 };
function numberSignature(title: string): string {
  const out = new Set<number>();
  for (const token of fold(title).split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) out.add(Number(token));
    else if (ROMAN[token] !== undefined) out.add(ROMAN[token]!);
  }
  return [...out].sort((a, b) => a - b).join(",");
}
const catalogKey = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const personKey = (name: string): string => fold(name).replace(/[«»"“”'’´`.]/g, "").replace(/\s+/g, " ").trim();
function fit(value: string, bytes: number): string {
  let out = value;
  while (Buffer.byteLength(out, "utf8") > bytes) out = out.slice(0, -1);
  return out;
}
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
/** «(Palacio 45-6677 / Venezuela 1968)» → «Venezuela»: país de la EDICIÓN, no del artista. */
const editionCountry = (title: string): string | null => {
  const inside = /\(([^()]*)\)\s*$/u.exec(title)?.[1] ?? "";
  const last = inside.split("/").pop()?.replace(/\b(19|20)\d{2}\b/g, "").trim() ?? "";
  return /^[A-ZÁÉÍÓÚ][\p{L} .]{2,30}$/u.test(last) ? last : null;
};
/**
 * «Philips Mono-1033» → {Philips, Mono-1033}; «Polydor SN» → Polydor; «Venezuela» o «1965» no son sello.
 * Siglas sueltas («GM», «DCM») no se convierten en organización.
 */
function cleanLabel(label: string | null, catalog: string | null): { label: string | null; catalog: string | null } {
  let value = (label ?? "").replace(/\s+/g, " ").trim();
  let number = catalog;
  value = value.replace(/\s+S\/?N$/i, "");
  const tail = /^(.*?[\p{L}.])\s+((?:Mono|Stereo|Est[eé]reo)?[-\s]?[A-Z]{0,4}[-\s.]?\d[\d.\-/ A-Z]*)$/u.exec(value);
  if (tail && tail[1]!.length >= 2) { value = tail[1]!.trim(); number = number ?? tail[2]!.trim(); }
  if (!value || /^(?:19|20)\d\d$/.test(value) || /^(?:venezuela|espa[nñ]a|usa|m[eé]xico|colombia|argentina|uk|inglaterra)$/i.test(value) || /^[A-Z]{1,3}$/.test(value)) value = "";
  return { label: value || null, catalog: number };
}

/** Rol del paréntesis gris → tipo de crédito del catálogo (como los claims ya promovidos). */
function creditOf(role: string): { type: "composer" | "writer" | "other" | "musician"; role: string } {
  const key = fold(role).replace(/[.]/g, "").trim();
  if (key === "composer" || key === "musica") return { type: "composer", role: "composer" };
  if (/^letra/.test(key)) return { type: "writer", role: "Letra" };
  if (/^canta/.test(key)) return { type: "musician", role: "Vocals" };
  return { type: "other", role: role.replace(/\.$/, "") };
}

const report = {
  mode: CONFIRM ? "confirm" : "dry-run", runId: 0, fichas: fichas.length,
  skipped: { artistAbsent: [] as string[], artistAmbiguous: [] as unknown[], variousWithoutCatalogArtist: 0, variousWithoutVenezuelan: [] as unknown[], humanRejected: 0, artistResolvedByAlbum: [] as unknown[] },
  albums: { matched: 0, matchedNear: [] as unknown[], matchedCatalog: [] as unknown[], created: [] as unknown[], proposed: [] as unknown[], ambiguous: [] as unknown[], audiovisualConflict: [] as unknown[],
    filled: {} as Record<string, number>, coverCandidates: 0, versions: 0, labels: 0, yearConflicts: [] as unknown[], tracklistDiffers: [] as unknown[] },
  tracks: { created: 0 },
  credits: { composer: 0, writer: 0, other: 0, musician: 0, performer: 0, trackUnmatched: 0 },
  persons: { reused: 0, created: 0 },
  organizations: { matched: 0, created: [] as string[] },
  claims: { inserted: 0, reused: 0 }, rawPages: 0,
};
const bump = (bucket: Record<string, number>, key: string): void => { bucket[key] = (bucket[key] ?? 0) + 1; };

async function apply(client: PoolClient, runId: number, sourceId: number): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '30s'");
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;

  // ── Índices ──
  const artistName = new Map<number, string>();
  const venezuelan = new Set((await q<{ id: string }>("SELECT id::text FROM public.artists WHERE origin_country='Venezuela'")).map((row) => Number(row.id)));
  const byVariant = new Map<string, Set<number>>();
  const addVariant = (name: string, id: number): void => {
    for (const variant of predictableNameVariants(name)) (byVariant.get(variant) ?? byVariant.set(variant, new Set()).get(variant)!).add(id);
  };
  for (const row of await q<{ id: string; name: string }>("SELECT id::text,name FROM public.artists")) { artistName.set(Number(row.id), row.name); addVariant(row.name, Number(row.id)); }
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) addVariant(row.alias, Number(row.artist_id));
  // Intérpretes de recopilatorio: solo nombre o alias exacto (sin tildes ni mayúsculas); las variantes
  // predecibles confunden «Darts» (Reino Unido) con Los Darts. «Hugo Blanco y su Conjunto» → «Hugo Blanco».
  const exact = new Map<string, Set<number>>();
  const addExact = (name: string, id: number): void => { const key = normalizeIdentity(name); (exact.get(key) ?? exact.set(key, new Set()).get(key)!).add(id); };
  for (const [id, name] of artistName) addExact(name, id);
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) addExact(row.alias, Number(row.artist_id));
  const resolvePerformer = (name: string): number[] => {
    for (const candidate of [name, name.replace(/\s+(?:y|con)\s+su[s]?\s+(?:conjunto|orquesta|combo|grupo|guitarra|saxo[\p{L} ]*|acordeones|violines)$/iu, "")]) {
      const ids = [...(exact.get(normalizeIdentity(candidate)) ?? [])].filter((id) => id !== VARIOUS);
      if (ids.length) return ids;
    }
    return [];
  };
  const resolveArtist = (name: string): number[] => {
    const found = new Set<number>();
    for (const variant of predictableNameVariants(name)) for (const id of byVariant.get(variant) ?? []) found.add(id);
    found.delete(VARIOUS);
    return [...found];
  };

  type AlbumRow = { id: string; artist_id: string; title: string; release_year: number | null; album_type: string; label_id: string | null; cover_url: string | null; catalog_id: string | null };
  const albumsByArtist = new Map<number, AlbumRow[]>();
  for (const row of await q<AlbumRow>("SELECT id::text,artist_id::text,title,release_year,album_type::text,label_id::text,cover_url,catalog_id FROM public.albums")) {
    (albumsByArtist.get(Number(row.artist_id)) ?? albumsByArtist.set(Number(row.artist_id), []).get(Number(row.artist_id))!).push(row);
  }
  const versionCatalogs = new Map<number, Set<string>>();
  for (const row of await q<{ album_id: string; catalog_number: string }>("SELECT album_id::text,catalog_number FROM ingest.album_versions WHERE catalog_number IS NOT NULL")) {
    for (const part of row.catalog_number.split("/")) (versionCatalogs.get(Number(row.album_id)) ?? versionCatalogs.set(Number(row.album_id), new Set()).get(Number(row.album_id))!).add(catalogKey(part));
  }

  const orgByVariant = new Map<string, Set<number>>();
  const addOrg = (name: string, id: number): void => { for (const variant of predictableNameVariants(name)) (orgByVariant.get(variant) ?? orgByVariant.set(variant, new Set()).get(variant)!).add(id); };
  for (const row of await q<{ id: string; name: string }>("SELECT id::text,name FROM public.organizations")) addOrg(row.name, Number(row.id));
  for (const row of await q<{ organization_id: string; alias: string }>("SELECT organization_id::text,alias FROM ingest.organization_aliases")) addOrg(row.alias, Number(row.organization_id));
  const orgCache = new Map<string, number | null>();
  const resolveLabel = async (name: string | null): Promise<number | null> => {
    const display = (name ?? "").replace(/\s+/g, " ").trim();
    if (!display || display.length > 120 || /^(?:independiente|n\/?a|s\/s)$/i.test(display)) return null;
    const key = normalizeIdentity(display);
    if (orgCache.has(key)) return orgCache.get(key)!;
    const ids = new Set<number>();
    for (const variant of predictableNameVariants(display)) for (const id of orgByVariant.get(variant) ?? []) ids.add(id);
    let id: number;
    if (ids.size) { id = Math.min(...ids); report.organizations.matched += 1; }
    else {
      id = Number((await q<{ id: string }>("INSERT INTO public.organizations(name,organization_type,notes) VALUES($1,'record_label',$2) RETURNING id::text",
        [fit(display, 200), `Sello citado en Hippito y sus Chatarritas (${TAG}).`]))[0]!.id);
      addOrg(display, id); report.organizations.created.push(display);
    }
    orgCache.set(key, id);
    return id;
  };

  // Personas: la ligada al artista manda; si no, un nombre único del catálogo; si no, se crea.
  const personsByKey = new Map<string, number[]>();
  for (const row of await q<{ id: string; name: string }>("SELECT id::text,name FROM public.persons UNION SELECT person_id::text,alias FROM ingest.person_aliases")) {
    const key = personKey(row.name);
    const list = personsByKey.get(key) ?? personsByKey.set(key, []).get(key)!;
    if (!list.includes(Number(row.id))) list.push(Number(row.id));
  }
  const linked = new Map<string, number>();
  for (const row of await q<{ artist_id: string; person_id: string; name: string }>(`
      SELECT al.artist_id::text, p.id::text person_id, p.name FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id JOIN public.persons p ON p.id=c.person_id
      UNION SELECT al.artist_id::text, p.id::text, p.name FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id JOIN public.persons p ON p.id=c.person_id
      UNION SELECT m.artist_id::text, p.id::text, p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id`)) {
    linked.set(`${row.artist_id}|${personKey(row.name)}`, Number(row.person_id));
  }
  const composerCount = new Map<number, number>();
  for (const row of await q<{ person_id: string; n: string }>("SELECT person_id::text, count(*)::text n FROM public.track_credits WHERE credit_type IN ('composer','writer') AND person_id IS NOT NULL GROUP BY 1")) {
    composerCount.set(Number(row.person_id), Number(row.n));
  }
  const resolvePerson = async (artistIds: number[], name: string, ficha: Ficha): Promise<number> => {
    const key = personKey(name);
    for (const artistId of artistIds) { const id = linked.get(`${artistId}|${key}`); if (id) { report.persons.reused += 1; return id; } }
    const known = personsByKey.get(key) ?? [];
    if (known.length >= 1) {
      report.persons.reused += 1;
      return [...known].sort((a, b) => (composerCount.get(b) ?? 0) - (composerCount.get(a) ?? 0) || a - b)[0]!;
    }
    const id = Number((await q<{ id: string }>("INSERT INTO public.persons(name,notes) VALUES($1,$2) RETURNING id::text",
      [fit(name, 200), `Compositor citado en Hippito y sus Chatarritas: ${ficha.url}`]))[0]!.id);
    personsByKey.set(key, [id]);
    report.persons.created += 1;
    return id;
  };

  // ── Crudo: la página HTML de cada entrada (procedencia de los claims) ──
  const rawPageId = new Map<string, number>();
  for (const ficha of fichas) {
    const file = manifest.get(ficha.url);
    if (!file) continue;
    const stored = `${CAPTURE}/${file}`;
    const absolute = path.resolve("data", stored);
    const content = readFileSync(absolute);
    const row = (await q<{ id: string }>(`
      INSERT INTO ingest.raw_pages(source_id,url,canonical_url,http_status,content_type,sha256,byte_size,stored_path,fetched_at,run_id)
      VALUES($1,$2,$2,200,'text/html; charset=UTF-8',$3,$4,$5,'2026-10-25T06:00:00Z',$6)
      ON CONFLICT (source_id,sha256) DO UPDATE SET url=EXCLUDED.url RETURNING id::text`,
    [sourceId, ficha.url, createHash("sha256").update(content).digest("hex"), statSync(absolute).size, stored, runId]))[0]!;
    rawPageId.set(ficha.url, Number(row.id));
    report.rawPages += 1;
  }
  const claim = async (ficha: Ficha, kind: ClaimToPersist["entityKind"], identity: string, field: string, value: unknown, targets: Partial<ClaimToPersist>): Promise<void> => {
    if (!CONFIRM || value === null || value === undefined || value === "") return;
    const persisted = await persistClaim({
      entityKind: kind, identity: normalizeIdentity(identity), identitySecondary: normalizeIdentitySecondary(identity), originalIdentity: identity,
      field, rawValue: value, normalizedValue: value, rawHash: sha(JSON.stringify([TAG, kind, identity, field, value])),
      extractor: "hippito-absorb", extractorVersion: "1", evidence: { url: ficha.url, excerpt: ficha.title.slice(0, 500) },
      sourceId, rawPageId: rawPageId.get(ficha.url) ?? null, runId, confidence: "medium", ...targets,
    } as ClaimToPersist, client);
    if (persisted.inserted) report.claims.inserted += 1; else report.claims.reused += 1;
  };

  // ── Recorrido ──
  const used = new Set<number>();
  for (const ficha of fichas) {
    if (HUMAN_REJECTED.has(`${ficha.artist}::${ficha.album}`)) { report.skipped.humanRejected += 1; continue; }
    ({ label: ficha.label, catalog: ficha.catalog } = cleanLabel(ficha.label, ficha.catalog));
    const various = Boolean(ficha.various);
    let ownerId: number;
    let performers = new Map<string, number>();
    if (various) {
      for (const performer of new Set(ficha.tracks.map((track) => track.performer).filter((name): name is string => Boolean(name)))) {
        const ids = resolvePerformer(performer);
        if (ids.length === 1 && !PERFORMER_MISMATCH.has(ids[0]!)) performers.set(performer, ids[0]!);
      }
      if (!performers.size) { report.skipped.variousWithoutCatalogArtist += 1; continue; }
      // Brian, 2026-09-13: un recopilatorio entra solo si lo toca una banda venezolana del catálogo.
      if (![...performers.values()].some((id) => venezuelan.has(id) && !FOREIGN_IN_CATALOG.has(id))) {
        report.skipped.variousWithoutVenezuelan.push({ album: ficha.album, performers: [...performers.keys()].slice(0, 5) });
        continue;
      }
      ownerId = VARIOUS;
    } else {
      const ids = resolveArtist(ficha.artist);
      if (ids.length === 0) { report.skipped.artistAbsent.push(ficha.artist); continue; }
      if (ids.length > 1) {
        // Homónimos del catálogo: decide el que ya tiene este disco (título exacto o mismo número de catálogo).
        const wanted = ficha.catalog ? catalogKey(ficha.catalog) : "";
        const holders = ids.filter((id) => (albumsByArtist.get(id) ?? []).some((row) => titleKey(row.title) === titleKey(ficha.album)
          || (wanted.length >= 4 && ((row.catalog_id && catalogKey(row.catalog_id) === wanted) || versionCatalogs.get(Number(row.id))?.has(wanted)))));
        if (holders.length !== 1) { report.skipped.artistAmbiguous.push({ artist: ficha.artist, ids, url: ficha.url }); continue; }
        report.skipped.artistResolvedByAlbum.push({ artist: ficha.artist, chosen: holders[0], album: ficha.album });
        ids.splice(0, ids.length, holders[0]!);
      }
      ownerId = ids[0]!;
      performers = new Map();
    }
    const owner = artistName.get(ownerId)!;
    const title = ficha.album.replace(/\s+/g, " ").trim();
    const key = titleKey(title);
    const year = ficha.year ? Number(ficha.year) : null;
    const existing = albumsByArtist.get(ownerId) ?? [];

    // Cruce: título exacto → número de catálogo → casi idéntico del mismo año.
    let target: AlbumRow | undefined;
    const sameTitle = existing.filter((row) => titleKey(row.title) === key && !used.has(Number(row.id)));
    const yearOk = (row: AlbumRow): boolean => year === null || row.release_year === null || Math.abs(row.release_year - year) <= 1;
    if (sameTitle.length === 1 && (!various || yearOk(sameTitle[0]!))) target = sameTitle[0];
    else if (sameTitle.length > 1) {
      const sameYear = sameTitle.filter((row) => year !== null && row.release_year === year);
      if (sameYear.length === 1) target = sameYear[0];
      else { report.albums.ambiguous.push({ artist: owner, title, year, candidates: sameTitle.map((row) => Number(row.id)), url: ficha.url }); continue; }
    }
    if (!target && ficha.catalog && catalogKey(ficha.catalog).length >= 4 && /\d/.test(ficha.catalog)) {
      const wanted = catalogKey(ficha.catalog);
      const byCatalog = existing.filter((row) => !used.has(Number(row.id)) && yearOk(row)
        && ((row.catalog_id && catalogKey(row.catalog_id) === wanted) || versionCatalogs.get(Number(row.id))?.has(wanted)));
      if (byCatalog.length === 1) { target = byCatalog[0]; report.albums.matchedCatalog.push({ artist: owner, title, catalog: target!.title, catalogId: ficha.catalog }); }
    }
    if (!target) {
      const signature = numberSignature(title);
      const near = existing.filter((row) => !used.has(Number(row.id)))
        .map((row) => ({ row, score: similarity(key, titleKey(row.title)) }))
        .filter((item) => item.score >= 0.6)
        .filter((item) => { const other = numberSignature(item.row.title); return !(signature && other && signature !== other); })
        .filter((item) => !(year !== null && item.row.release_year !== null && Math.abs(year - item.row.release_year) >= 2))
        .filter((item) => !(ficha.catalog && item.row.catalog_id && catalogKey(ficha.catalog) !== catalogKey(item.row.catalog_id)))
        .sort((a, b) => b.score - a.score)[0];
      if (near && near.score >= 0.9 && year !== null && near.row.release_year !== null) {
        target = near.row;
        report.albums.matchedNear.push({ artist: owner, title, year, catalog: near.row.title, catalogYear: near.row.release_year, score: Number(near.score.toFixed(2)) });
      } else if (near) {
        report.albums.proposed.push({ artist: owner, title, year, near: near.row.title, nearId: Number(near.row.id), nearYear: near.row.release_year, score: Number(near.score.toFixed(2)), url: ficha.url });
        continue;
      }
    }

    const identity = `${owner}::${title}`;
    let albumId: number;
    let created = false;
    if (target) {
      albumId = Number(target.id);
      report.albums.matched += 1;
      const labelId = target.label_id === null ? await resolveLabel(ficha.label) : null;
      const fills: Array<[string, unknown]> = [
        ["release_year", target.release_year === null ? year : null],
        ["label_id", labelId],
        ["catalog_id", target.catalog_id === null && ficha.catalog ? fit(ficha.catalog, 80) : null],
      ];
      for (const [column, value] of fills) {
        if (value === null || value === undefined) continue;
        await client.query(`UPDATE public.albums SET ${column}=$2 WHERE id=$1 AND ${column} IS NULL`, [albumId, value]);
        bump(report.albums.filled, column);
        await claim(ficha, "album", identity, column === "label_id" ? "label" : column === "catalog_id" ? "catalog_number" : column, column === "label_id" ? ficha.label : value, { albumId });
      }
      // D4: Hippito manda en discos ≤1989, pero el año distinto se revisa, no se pisa.
      if (year !== null && target.release_year !== null && target.release_year !== year && Math.min(year, target.release_year) <= 1989) {
        report.albums.yearConflicts.push({ albumId, artist: owner, title: target.title, catalogYear: target.release_year, hippitoYear: year, url: ficha.url });
      }
    } else {
      if (!various && await audiovisualAlbumConflict(client, ownerId, title)) { report.albums.audiovisualConflict.push({ artist: owner, title }); continue; }
      const labelId = await resolveLabel(ficha.label);
      albumId = Number((await q<{ id: string }>(`
        INSERT INTO public.albums(artist_id,title,release_year,album_type,label_id,catalog_id,notes)
        VALUES($1,$2,$3,$4::album_type,$5,$6,$7) RETURNING id::text`,
      [ownerId, fit(title, 250), year, various ? "compilation" : "other", labelId, ficha.catalog ? fit(ficha.catalog, 80) : null,
        `Fuente: Hippito y sus Chatarritas — ${ficha.url}`]))[0]!.id);
      created = true;
      const row: AlbumRow = { id: String(albumId), artist_id: String(ownerId), title, release_year: year, album_type: various ? "compilation" : "other", label_id: labelId === null ? null : String(labelId), cover_url: null, catalog_id: ficha.catalog };
      (albumsByArtist.get(ownerId) ?? albumsByArtist.set(ownerId, []).get(ownerId)!).push(row);
      report.albums.created.push({ id: albumId, artist: owner, title, year, tracks: ficha.tracks.length, performers: [...performers.keys()].slice(0, 5) });
      await claim(ficha, "album", identity, "title", title, { albumId });
      if (year !== null) await claim(ficha, "album", identity, "release_year", year, { albumId });
    }
    used.add(albumId);

    // Portada: vacía → la de Hippito; distinta → candidata en Curaduría.
    if (ficha.cover) {
      const current = (await q<{ cover_url: string | null }>("SELECT cover_url FROM public.albums WHERE id=$1", [albumId]))[0]?.cover_url ?? null;
      if (!current) {
        await client.query("UPDATE public.albums SET cover_url=$2 WHERE id=$1 AND cover_url IS NULL", [albumId, ficha.cover]);
        bump(report.albums.filled, "cover_url");
        await claim(ficha, "album", identity, "cover_url", ficha.cover, { albumId });
      } else if (current !== ficha.cover && await proposeImageCandidate(client, { kind: "album", targetId: albumId, currentUrl: current, candidateUrl: ficha.cover, sourceId, pageUrl: ficha.url, origin: TAG, runId, context: ficha.title }) === "proposed") {
        report.albums.coverCandidates += 1;
      }
    }

    // Edición citada por Hippito (sello y catálogo de esa prensa).
    if (!(await q("SELECT 1 FROM ingest.album_versions WHERE album_id=$1 AND source=$2 AND source_ref=$3", [albumId, SLUG, ficha.url])).length) {
      const position = Number((await q<{ n: string }>("SELECT (COALESCE(max(position),0)+1)::text n FROM ingest.album_versions WHERE album_id=$1", [albumId]))[0]!.n);
      const version = Number((await q<{ id: string }>(`
        INSERT INTO ingest.album_versions(album_id,position,title,catalog_number,country,release_year,cover_url,notes,is_primary,source,source_ref,run_id,edition_types)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,'{}') RETURNING id::text`,
      [albumId, position, fit(title, 500), ficha.catalog ? fit(ficha.catalog, 120) : null, editionCountry(ficha.title), year, ficha.cover, ficha.title.slice(0, 2000), SLUG, ficha.url, runId]))[0]!.id);
      report.albums.versions += 1;
      const orgId = await resolveLabel(ficha.label);
      if (orgId !== null) {
        const inserted = await client.query("INSERT INTO ingest.album_labels(album_id,version_id,organization_id,role,position,source_text,run_id) VALUES($1,$2,$3,'label',0,$4,$5) ON CONFLICT DO NOTHING",
          [albumId, version, orgId, ficha.title.slice(0, 500), runId]);
        report.albums.labels += inserted.rowCount ?? 0;
      }
    }

    // Pistas: solo en discos nuevos o vacíos; nunca se renumeran.
    const trackIds = new Map<string, number[]>();
    const has = Number((await q<{ n: string }>("SELECT count(*)::text n FROM public.tracks WHERE album_id=$1", [albumId]))[0]!.n);
    if (has === 0 && ficha.tracks.length) {
      const taken = new Set<number>();
      let next = 0;
      for (const track of ficha.tracks) {
        let number = Number.isInteger(track.n) && track.n > 0 && !taken.has(track.n) ? track.n : 0;
        if (!number) { do next += 1; while (taken.has(next)); number = next; }
        taken.add(number); next = Math.max(next, number);
        const trackTitle = fit(track.title, 200);
        const id = Number((await q<{ id: string }>("INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes) VALUES($1,1,$2,$3,$4) RETURNING id::text",
          [albumId, number, trackTitle, `Hippito y sus Chatarritas — ${ficha.url}`]))[0]!.id);
        (trackIds.get(titleKey(trackTitle)) ?? trackIds.set(titleKey(trackTitle), []).get(titleKey(trackTitle))!).push(id);
        report.tracks.created += 1;
        await claim(ficha, "track", `${identity}::${number}`, "title", trackTitle, { trackId: id });
      }
    } else {
      for (const row of await q<{ id: string; title: string }>("SELECT id::text,title FROM public.tracks WHERE album_id=$1", [albumId])) {
        (trackIds.get(titleKey(row.title)) ?? trackIds.set(titleKey(row.title), []).get(titleKey(row.title))!).push(Number(row.id));
      }
      if (has > 0 && ficha.tracks.length && has !== ficha.tracks.length) report.albums.tracklistDiffers.push({ albumId, artist: owner, title, catalog: has, hippito: ficha.tracks.length });
    }

    // Créditos de pista: intérprete (recopilatorios) y compositores en gris.
    const existingCredits = new Set((await q<{ k: string }>(`
      SELECT tc.track_id||'|'||COALESCE('p'||tc.person_id,'a'||tc.artist_id)||'|'||tc.credit_type k FROM public.track_credits tc JOIN public.tracks t ON t.id=tc.track_id WHERE t.album_id=$1`, [albumId])).map((row) => row.k));
    for (const track of ficha.tracks) {
      const ids = trackIds.get(titleKey(track.title)) ?? [];
      if (!ids.length) { if (track.credits.length || track.performer) report.credits.trackUnmatched += 1; continue; }
      if (ids.length > 1) continue; // título repetido en el disco: no se adivina cuál
      const trackId = ids[0]!;
      const performerId = track.performer ? performers.get(track.performer) : undefined;
      if (performerId && !existingCredits.has(`${trackId}|a${performerId}|musician`)) {
        await client.query("INSERT INTO public.track_credits(track_id,artist_id,credit_type,role,notes) VALUES($1,$2,'musician','intérprete',$3)",
          [trackId, performerId, `Intérprete según Hippito y sus Chatarritas: ${ficha.url}`]);
        existingCredits.add(`${trackId}|a${performerId}|musician`); report.credits.performer += 1;
      }
      const context = [ownerId, ...(performerId ? [performerId] : [])];
      for (const credit of track.credits) {
        const kind = creditOf(credit.role);
        const personId = await resolvePerson(context, credit.name, ficha);
        const k = `${trackId}|p${personId}|${kind.type}`;
        if (existingCredits.has(k)) continue;
        const creditId = Number((await q<{ id: string }>("INSERT INTO public.track_credits(track_id,person_id,credit_type,role,notes) VALUES($1,$2,$3,$4,$5) RETURNING id::text",
          [trackId, personId, kind.type, fit(kind.role, 200), `Hippito y sus Chatarritas: ${ficha.url}`]))[0]!.id);
        existingCredits.add(k); report.credits[kind.type] += 1;
        await claim(ficha, "track_credit", `${title}::${track.title}::${kind.role}::${credit.name}`, "credited_name", credit.name, { trackCreditId: creditId });
      }
    }
    if (created) await claim(ficha, "album", identity, "source_url", ficha.url, { albumId });
  }
}

const pool = getPool();
const source = (await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SLUG])).rows[0];
if (!source) throw new Error(`fuente desconocida: ${SLUG}`);
const SOURCE_ID = Number(source.id);
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "hippito:absorb", operator: OPERATOR, note: NOTE, params: { campaign: TAG, fichas: fichas.length } },
    async (context) => { report.runId = context.runId; await apply(context.client, context.runId, SOURCE_ID); });
  report.runId = outcome.runId;
} else {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>("INSERT INTO ingest.scrape_runs(kind,source_id,status,params) VALUES('manual',$1,'running',$2::jsonb) RETURNING id::text",
      [SOURCE_ID, JSON.stringify({ action: "hippito:dry-run" })]);
    await apply(client, Number(run.rows[0]!.id), SOURCE_ID);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, CONFIRM ? "aplicacion.json" : "aplicacion-dry-run.json");
writeFileSync(file, JSON.stringify(report, null, 1));
const count = (value: unknown): unknown => Array.isArray(value) ? value.length : value;
console.log(JSON.stringify({
  ...report,
  skipped: { artistAbsent: report.skipped.artistAbsent.length, artistAmbiguous: report.skipped.artistAmbiguous.length, variousWithoutCatalogArtist: report.skipped.variousWithoutCatalogArtist,
    variousWithoutVenezuelan: report.skipped.variousWithoutVenezuelan.length, humanRejected: report.skipped.humanRejected, artistResolvedByAlbum: report.skipped.artistResolvedByAlbum.length },
  albums: Object.fromEntries(Object.entries(report.albums).map(([k, v]) => [k, count(v)])),
  organizations: { matched: report.organizations.matched, created: report.organizations.created.length },
}, null, 1));
console.log(`-> ${file}`);
await closeDb();
