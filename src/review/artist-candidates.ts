// CRV · Detector de duplicados de ARTISTA por capas (Brian, 2026-10-29).
//
// POR QUÉ EXISTE: el ER compara nombres, y dos fichas de la misma banda pueden
// escribir el nombre con un conector de más («La Kámara De la Tortura» frente a
// «Kámara de Tortura»). En ese caso ni la clave primaria ni la variante sin
// artículo ni la compacta coinciden, así que la ficha nueva no llega a carearse
// con la vieja y el duplicado entra al catálogo. El caso real 3230/8576 tiene
// además el mismo disco con la misma lista de pistas, los mismos músicos y la
// misma página de evidencia: la identidad está en los datos, no en el nombre.
//
// PROPONE, NO DECIDE. Este módulo escribe únicamente en `ingest.review_queue`
// (kind `possible_duplicate`, lados `artist_a_id`/`artist_b_id`) y pasa por
// `withOperatorRun`, como el resto de las corridas humanas. Nunca fusiona ni
// toca el core: la decisión y la fusión siguen siendo de una persona, con la
// previsualización de `GET /artists/:id/merge-preview`.
//
// CAPAS, de la más barata a la más cara:
//   0. Guardas. No se propone «Various Artists», ni un par con el mismo nombre
//      canónico (eso ya lo resuelve `crv review duplicates`), ni dos fichas de
//      épocas separadas por ≥15 años con ciudades distintas y sin ninguna ancla
//      documental (disco, pista, integrante, página o ID externo).
//   1. Señales deterministas. La misma página de evidencia (cuando la comparten
//      exactamente dos fichas: una página de directorio con 3+ no es señal),
//      el mismo ID externo, la misma huella de tracklist, la misma foto y un
//      alias que ya pertenece a la otra ficha. Cada una basta para abrir una
//      revisión, nunca para fusionar.
//   2. Señales probabilísticas con evidencia explicable: contención de tokens,
//      Jaro-Winkler contra nombre y alias, clave fonética española (K/C, B/V,
//      S/Z, H muda), solapamiento de discografía e integrantes por NOMBRE
//      normalizado + instrumento (no por `person_id`: el mismo músico también
//      puede estar duplicado en `persons`).
//   3. Evidencia: el comparador que ya existe (`startComparison`) para el top
//      del lote, solo cuando la CLI lo pide con `--compare-top`.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { instrumentsOf, type InstrumentKey } from "../discography/instruments.js";
import { jaroWinkler } from "../er/scoring.js";
import { withOperatorRun } from "../merge/operator.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import { getComparisonJob, startComparison } from "../verification/comparison-store.js";
import { nameWithoutNickname } from "./person-names.js";

/** 0,45: por debajo, dos señales débiles no bastan para abrir una revisión. */
export const ARTIST_CANDIDATE_MIN_SCORE = 0.45;
/** 0,60: el par entra con prioridad alta (3) y es candidato a la capa 3. */
export const ARTIST_CANDIDATE_STRONG_SCORE = 0.6;

/** El artista de recopilatorios no identifica a nadie: ni se compara. */
const VARIOUS_ARTISTS = /^(?:v\.?\s*a\.?|various(?:\s+artists?)?|varios(?:\s+artistas)?)$/iu;

/** Conectores y artículos que no distinguen un nombre de otro. */
const CONNECTORS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "the", "and", "a", "an", "un", "una", "of"]);

/** Prefijo público de las imágenes del catálogo (ver `src/merge/image-inspection.ts`). */
const LOCAL_MEDIA = "/crv/media/";
const MEDIA_ROOT = path.resolve("web/public/media");

// Plataformas cuyo `external_id` identifica al ARTISTA. YouTube y Bandcamp
// quedan fuera: sus IDs de canal pueden ser Vevo/Topic y sus enlaces de
// Bandcamp suelen ser de un álbum, no de la ficha.
const EXTERNAL_ID_PLATFORMS: ReadonlySet<string> = new Set([
  "spotify", "apple_music", "deezer", "tidal", "amazon_music", "discogs", "musicbrainz", "lastfm", "soundcloud",
]);

// Cuentas de plataforma que agrupan a muchos artistas: compartirlas no prueba
// identidad. Se excluyen del bloqueo y del scoring.
const GENERIC_ACCOUNT = /(^|\/)(vevo|topic|various-?artists?)(\/|$)|@(vevo|topic)$/iu;

/** Claves de la capa 1, para contar señales deterministas del par. */
const DETERMINISTIC_KEYS = new Set([
  "shared_external_id", "shared_official_link", "shared_evidence_url", "tracklist_equal", "alias_claimed", "picture_equal",
]);

/** Datos mínimos de un artista para puntuar un par, cargados sin N+1. */
export interface ArtistFacts {
  id: number;
  name: string;
  artistType: string;
  aliases: string[];
  originCity: string | null;
  originCountry: string | null;
  formedYear: number | null;
  disbandedYear: number | null;
  /** Claves `título|año` de sus discos (sin recopilatorios de varios artistas). */
  albumKeys: Set<string>;
  /** Huella de la lista de pistas ordenada → «Título (año)», solo discos de ≥3 pistas. */
  tracklistHashes: Map<string, string>;
  /** Integrantes agrupados por nombre normalizado, con sus instrumentos. */
  members: Array<{ key: string; name: string; role: string; instruments: InstrumentKey[] }>;
  /** Páginas que sostienen la ficha y cuántas fichas las comparten. */
  evidenceUrls: Array<{ url: string; artists: number }>;
  /** Redes y plataformas oficiales a nivel de artista, con cuántas fichas las comparten. */
  officialLinks: Array<{ url: string; platform: string; artists: number }>;
  /** `namespace:identificador` de identidades externas verificadas. */
  externalIds: string[];
  pictureUrl: string | null;
}

export interface ArtistFeature {
  key: string;
  /** Positivo suma; negativo resta. */
  value: number;
  evidence: string;
}

export interface ArtistPairScore {
  /** 0..1. Respaldo de correspondencia, no probabilidad ni permiso de fusión. */
  score: number;
  features: ArtistFeature[];
  /** Alguna señal de la capa 1 presente y con peso. */
  deterministic: boolean;
  /** Motivo por el que el par no se propone (guarda de la capa 0). */
  blocked: string | null;
}

export interface ArtistCandidate {
  a: { id: number; name: string };
  b: { id: number; name: string };
  score: number;
  deterministic: boolean;
  /** Cuántas señales de la capa 1 trae el par (desempata el orden). */
  signals: number;
  features: ArtistFeature[];
  /** 8: señal determinista · 6: score ≥ 0,60 · 4: resto de la capa 2 (la cola ordena por prioridad DESC). */
  priority: 4 | 6 | 8;
}

export interface ArtistCandidateScan {
  candidates: ArtistCandidate[];
  /** Artistas cargados con nombre utilizable. */
  artists: number;
  /** Pares realmente puntuados (comparten alguna clave de bloqueo). */
  comparedPairs: number;
  /** Pares propuestos que traen al menos una señal determinista. */
  deterministicPairs: number;
}

export interface ArtistCandidateOptions {
  /** Score mínimo para proponer (por defecto 0,45). */
  minScore?: number;
  /** Tope de candidatos devueltos (por defecto, sin tope). */
  limit?: number;
  /** Una clave de bloqueo con más artistas que esto no es señal (por defecto 80). */
  maxBlockSize?: number;
  queryable?: Pick<PoolClient, "query">;
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** Tokens que distinguen: sin conectores, sin artículos, sin una letra suelta. */
function significantTokens(value: string): string[] {
  return normalizeEntityName(value).secondaryKey.split(" ").filter((token) => token.length > 1 && !CONNECTORS.has(token));
}

/**
 * Clave fonética española aproximada: K/C/QU y C ante E/I, Z/S, B/V, LL/Y,
 * G ante E/I, H muda. «Kámara» y «Cámara» comparten esqueleto; no afirma nada
 * por sí sola, solo acota candidatos y suma cuando además hay tokens en común.
 */
function phoneticToken(token: string): string {
  const mapped = token
    .replace(/qu/gu, "k")
    .replace(/c(?=[ei])/gu, "s")
    .replace(/c/gu, "k")
    .replace(/z/gu, "s")
    .replace(/v/gu, "b")
    .replace(/ll/gu, "y")
    .replace(/h/gu, "")
    .replace(/g(?=[ei])/gu, "j");
  const head = mapped.slice(0, 1);
  const tail = mapped.slice(1).replace(/[aeiou]/gu, "");
  return `${head}${tail}`.replace(/(.)\1+/gu, "$1");
}

function phoneticKey(name: string): string {
  return significantTokens(name).map(phoneticToken).sort().join("·");
}

function cityKey(city: string | null): string | null {
  if (!city) return null;
  const tokens = significantTokens(city);
  return tokens[0] ?? null;
}

function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function sharedValues(left: Iterable<string>, right: Iterable<string>): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((item) => rightSet.has(item));
}

function bestJaroWinkler(a: ArtistFacts, b: ArtistFacts): { value: number; evidence: string } {
  const left = [a.name, ...a.aliases];
  const right = [b.name, ...b.aliases];
  let best = { value: 0, evidence: "" };
  for (const one of left) {
    for (const other of right) {
      const value = jaroWinkler(normalizeEntityName(one).secondaryKey, normalizeEntityName(other).secondaryKey);
      if (value <= best.value) continue;
      best = {
        value,
        evidence: value === 1 && one === a.name && other === b.name
          ? "el nombre coincide exactamente"
          : `Jaro-Winkler=${value.toFixed(3)} entre «${one}» y «${other}»`,
      };
    }
  }
  return best;
}

/** El nombre de una ficha figura como alias declarado de la otra (sin ser el mismo nombre). */
function aliasCrossMatch(a: ArtistFacts, b: ArtistFacts): string | null {
  const collapsed = (one: string, other: string) => {
    const x = normalizeEntityName(one);
    const y = normalizeEntityName(other);
    return x.primaryKey === y.primaryKey
      || (Boolean(x.articlelessPrimaryKey) && x.articlelessPrimaryKey === y.articlelessPrimaryKey)
      || x.compactPrimaryKey === y.compactPrimaryKey;
  };
  if (collapsed(a.name, b.name)) return null;
  for (const alias of b.aliases) {
    if (collapsed(a.name, alias)) return `«${a.name}» figura como alias «${alias}» de «${b.name}»`;
  }
  for (const alias of a.aliases) {
    if (collapsed(b.name, alias)) return `«${b.name}» figura como alias «${alias}» de «${a.name}»`;
  }
  return null;
}

/**
 * ¿Los dos roles describen el mismo instrumento? Un rol sin instrumento
 * («Integrante») no contradice nada: se considera compatible.
 */
function rolesCompatible(left: ArtistFacts["members"][number], right: ArtistFacts["members"][number]): boolean {
  if (left.instruments.length === 0 || right.instruments.length === 0) return true;
  const rightSet = new Set(right.instruments);
  return left.instruments.some((instrument) => rightSet.has(instrument));
}

/**
 * Puntúa un par de artistas (0..1) con features explicables. `pictureHashes`
 * trae la huella de las fotos locales ya resuelta (la capa de E/S vive en
 * `findArtistCandidates`, no aquí).
 */
export function scoreArtistPair(
  a: ArtistFacts,
  b: ArtistFacts,
  pictureHashes: ReadonlyMap<string, string | null> = new Map(),
): ArtistPairScore {
  const features: ArtistFeature[] = [];
  let score = 0;
  let deterministic = false;
  const add = (key: string, value: number, evidence: string) => {
    features.push({ key, value: round(value), evidence });
    score += value;
  };
  /** Señal de la capa 1: basta para abrir revisión por sí sola. */
  const addDeterministic = (key: string, value: number, evidence: string) => {
    deterministic = true;
    add(key, value, evidence);
  };
  const blocked = (reason: string): ArtistPairScore => ({ score: 0, features, deterministic: false, blocked: reason });

  if (VARIOUS_ARTISTS.test(a.name.trim()) || VARIOUS_ARTISTS.test(b.name.trim())) {
    return blocked("una de las fichas es «Various Artists», que no identifica a nadie");
  }

  // ── Señales compartidas, calculadas una vez ──────────────────────────────
  const sharedTracklists = [...a.tracklistHashes.keys()].filter((hash) => b.tracklistHashes.has(hash));
  const sharedAlbums = sharedValues(a.albumKeys, b.albumKeys);
  const memberKeysA = new Map(a.members.map((member) => [member.key, member]));
  const sharedMembers = b.members.filter((member) => memberKeysA.has(member.key))
    .map((member) => ({ left: memberKeysA.get(member.key)!, right: member }));
  const urlsA = new Map(a.evidenceUrls.map((item) => [item.url, item.artists]));
  const sharedUrls = b.evidenceUrls.filter((item) => urlsA.has(item.url));
  const linksA = new Map(a.officialLinks.map((item) => [item.url, item.platform]));
  const sharedLinks = b.officialLinks.filter((item) => linksA.has(item.url));
  const uniqueLinks = sharedLinks.filter((item) => item.artists <= 2);
  const sharedIds = sharedValues(a.externalIds, b.externalIds);
  const nameA = normalizeEntityName(a.name);
  const nameB = normalizeEntityName(b.name);
  const tokensA = new Set(significantTokens(a.name));
  const tokensB = new Set(significantTokens(b.name));
  const sharedTokens = sharedValues(tokensA, tokensB);
  const aliasHit = aliasCrossMatch(a, b);
  const uniqueUrls = sharedUrls.filter((item) => item.artists <= 2);
  const directoryUrls = sharedUrls.filter((item) => item.artists > 2);

  // ── Capa 0 · guardas ─────────────────────────────────────────────────────
  // Épocas separadas sin ninguna ancla documental y con ciudades distintas:
  // dos homónimos, no una banda que cambió de nombre. Una reunión con la misma
  // ciudad o con un disco/pista/integrante/página en común no se bloquea.
  const pictureA = a.pictureUrl ? pictureHashes.get(a.pictureUrl) ?? null : null;
  const pictureB = b.pictureUrl ? pictureHashes.get(b.pictureUrl) ?? null : null;
  const anchors = sharedTracklists.length + sharedAlbums.length + sharedMembers.length
    + uniqueUrls.length + sharedIds.length + uniqueLinks.length + (aliasHit ? 1 : 0)
    + (pictureA && pictureB && pictureA === pictureB ? 1 : 0);
  const cityA = cityKey(a.originCity);
  const cityB = cityKey(b.originCity);
  if (anchors === 0 && cityA && cityB && cityA !== cityB) {
    const gaps: number[] = [];
    if (a.formedYear !== null && b.formedYear !== null) gaps.push(Math.abs(a.formedYear - b.formedYear));
    if (a.disbandedYear !== null && b.formedYear !== null) gaps.push(b.formedYear - a.disbandedYear);
    if (b.disbandedYear !== null && a.formedYear !== null) gaps.push(a.formedYear - b.disbandedYear);
    const gap = gaps.length ? Math.max(...gaps) : 0;
    if (gap >= 15) return blocked(`trayectorias separadas por ${gap} años, ciudades distintas y ninguna ancla documental en común`);
  }

  // ── Capa 1 · señales deterministas ───────────────────────────────────────
  if (sharedIds.length) {
    addDeterministic("shared_external_id", 0.6, `identidad externa compartida: ${sharedIds.slice(0, 3).join(", ")}`);
  } else {
    // El mismo namespace con identificadores distintos no es prueba de nada
    // distinto, pero resta: dos MBID/Discogs diferentes apuntan a dos fichas.
    const clashing = a.externalIds.filter((id) => {
      const namespace = id.split(":")[0];
      return b.externalIds.some((other) => other.split(":")[0] === namespace);
    });
    if (clashing.length) {
      add("external_id_clash", -0.25, `misma identidad externa con valores distintos: ${clashing.slice(0, 2).join(", ")}`);
    }
  }
  if (uniqueUrls.length) {
    addDeterministic("shared_evidence_url", 0.5, `misma página de evidencia: ${uniqueUrls[0]!.url}`);
  } else if (directoryUrls.length) {
    add("shared_evidence_url", 0.12, `página de directorio compartida por ${directoryUrls[0]!.artists} fichas: ${directoryUrls[0]!.url}`);
  }
  if (uniqueLinks.length) {
    addDeterministic("shared_official_link", 0.5, `misma cuenta oficial en ${uniqueLinks[0]!.platform}: ${uniqueLinks[0]!.url}`
      + (uniqueLinks.length > 1 ? ` y ${uniqueLinks.length - 1} enlace(s) más` : ""));
  } else if (sharedLinks.length) {
    add("shared_official_link", 0.12, `cuenta de plataforma compartida por ${sharedLinks[0]!.artists} fichas: ${sharedLinks[0]!.url}`);
  }
  if (sharedTracklists.length) {
    const hash = sharedTracklists[0]!;
    const album = a.tracklistHashes.get(hash) ?? b.tracklistHashes.get(hash) ?? "disco sin título";
    addDeterministic("tracklist_equal", 0.45, `misma lista de pistas en «${album}»${sharedTracklists.length > 1 ? ` y ${sharedTracklists.length - 1} disco(s) más` : ""}`);
  }
  if (aliasHit) addDeterministic("alias_claimed", 0.45, aliasHit);
  if (pictureA && pictureB && pictureA === pictureB) {
    addDeterministic("picture_equal", 0.45, `la misma imagen (${pictureA.slice(0, 12)}…) en las dos fichas`);
  }

  // ── Capa 2 · señales probabilísticas ─────────────────────────────────────
  const albumOverlap = jaccard(a.albumKeys, b.albumKeys);
  if (sharedAlbums.length) {
    add("album_overlap", 0.25 * albumOverlap, `discografía compartida: ${sharedAlbums.length} de ${new Set([...a.albumKeys, ...b.albumKeys]).size} (${sharedAlbums[0]!.replace("|", " · ")})`);
  }
  const memberOverlap = jaccard(memberKeysA.keys(), b.members.map((member) => member.key));
  if (sharedMembers.length) {
    const compatible = sharedMembers.filter((pair) => rolesCompatible(pair.left, pair.right));
    const value = 0.15 * memberOverlap + (compatible.length ? 0.15 * memberOverlap : 0);
    add("member_overlap", value, `integrantes con el mismo nombre en ambas fichas: ${sharedMembers.slice(0, 3).map((pair) => pair.left.name).join(", ")}`
      + (compatible.length ? ` (${compatible.length} con el mismo instrumento)` : " (sin instrumento coincidente)"));
  }
  const containment = sharedTokens.length >= 2 && (sharedTokens.length === tokensA.size || sharedTokens.length === tokensB.size);
  if (containment) {
    add("name_token_containment", 0.2, `los tokens de un nombre contienen al otro: ${sharedTokens.join(" ")}`);
  }
  const jw = bestJaroWinkler(a, b);
  if (jw.value >= 0.9) add("name_jaro_winkler", 0.15, jw.evidence);
  else if (jw.value >= 0.8) add("name_jaro_winkler", 0.1, jw.evidence);
  else if (jw.value >= 0.76) add("name_jaro_winkler", 0.06, jw.evidence);
  const phonetic = nameA.primaryKey !== nameB.primaryKey && phoneticKey(a.name) !== "" && phoneticKey(a.name) === phoneticKey(b.name);
  if (phonetic && sharedTokens.length >= 1) {
    add("name_phonetic", 0.1, `misma clave fonética española (${phoneticKey(a.name)}): K/C, B/V, S/Z o H muda`);
  }
  if (cityA && cityB && cityA === cityB) add("same_city", 0.04, `misma ciudad de origen: ${a.originCity} / ${b.originCity}`);
  if (a.formedYear !== null && a.formedYear === b.formedYear) add("same_formed_year", 0.06, `mismo año de formación: ${a.formedYear}`);
  if (a.originCountry && b.originCountry && normalizeEntityName(a.originCountry).secondaryKey !== normalizeEntityName(b.originCountry).secondaryKey) {
    add("country_clash", -0.15, `países distintos: ${a.originCountry} / ${b.originCountry}`);
  }
  if (a.artistType !== b.artistType) {
    add("type_mismatch", -0.08, `tipos distintos: ${a.artistType} / ${b.artistType}`);
  }

  const clamped = round(Math.max(0, Math.min(1, score)));
  return { score: clamped, features, deterministic, blocked: null };
}

/** Claves de bloqueo: solo se puntúan pares que comparten alguna. */
function blockingKeys(facts: ArtistFacts): string[] {
  const keys = new Set<string>();
  for (const name of [facts.name, ...facts.aliases]) {
    const normalized = normalizeEntityName(name);
    for (const token of significantTokens(name)) if (token.length >= 4) keys.add(`t:${token}`);
    keys.add(`k:${normalized.articlelessSecondaryKey || normalized.secondaryKey}`);
  }
  const phonetic = phoneticKey(facts.name);
  if (phonetic) keys.add(`p:${phonetic}`);
  for (const album of facts.albumKeys) keys.add(`a:${album}`);
  for (const hash of facts.tracklistHashes.keys()) keys.add(`h:${hash}`);
  // Una página que comparten 4+ fichas es un directorio: bloquea, pero no pesa.
  for (const item of facts.evidenceUrls) if (item.artists <= 3) keys.add(`u:${item.url}`);
  for (const link of facts.officialLinks) keys.add(`l:${link.url}`);
  for (const id of facts.externalIds) keys.add(`x:${id}`);
  for (const member of facts.members) keys.add(`m:${member.key}`);
  return [...keys];
}

function normalizeEvidenceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$|mc_|ref$)/iu.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
  return url.toString().replace(/\/$/u, "");
}

/** Tracklist normalizada: el orden importa, las tildes y mayúsculas no. */
function tracklistHash(titles: string[]): string {
  return createHash("sha1").update(titles.map((title) => normalizeEntityName(title).secondaryKey).join("\n")).digest("hex");
}

function addMember(facts: ArtistFacts, name: string, role: string): void {
  const key = nameWithoutNickname(name);
  if (!key) return;
  const existing = facts.members.find((member) => member.key === key);
  const instruments = instrumentsOf(role);
  if (!existing) {
    facts.members.push({ key, name: name.trim(), role: role.trim(), instruments });
    return;
  }
  const merged = new Set([...existing.instruments, ...instruments]);
  existing.instruments = [...merged];
  if (!existing.role.includes(role.trim())) existing.role = `${existing.role}, ${role.trim()}`;
}

/** Datos de todos los artistas para puntuar pares (una consulta plana por tabla). */
export async function loadArtistFacts(queryable: Pick<PoolClient, "query">): Promise<ArtistFacts[]> {
  const artists = (await queryable.query<{
    id: string; name: string; artist_type: string; origin_city: string | null; origin_country: string | null;
    formed_year: number | null; disbanded_year: number | null; picture_url: string | null;
  }>(`SELECT id::text, name, artist_type::text, origin_city, origin_country, formed_year, disbanded_year, picture_url
        FROM public.artists ORDER BY id`)).rows;
  const aliases = (await queryable.query<{ artist_id: string; alias: string }>(
    "SELECT artist_id::text, alias FROM ingest.artist_aliases ORDER BY artist_id, alias")).rows;
  const albums = (await queryable.query<{ id: string; artist_id: string; title: string; release_year: number | null; album_type: string }>(
    "SELECT id::text, artist_id::text, title, release_year, album_type::text FROM public.albums ORDER BY id")).rows;
  const tracks = (await queryable.query<{ album_id: string; title: string }>(
    "SELECT album_id::text, title FROM public.tracks ORDER BY album_id, track_number NULLS LAST, id")).rows;
  const members = (await queryable.query<{ artist_id: string; name: string; role: string }>(`
    SELECT m.artist_id::text, p.name, m.role
      FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id
     ORDER BY m.artist_id, m.from_year NULLS FIRST, m.id`)).rows;
  const evidence = (await queryable.query<{ artist_id: string; url: string }>(`
    SELECT c.artist_id::text, e.url
      FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id
     WHERE c.artist_id IS NOT NULL AND e.url IS NOT NULL AND e.url <> ''
     GROUP BY 1,2`)).rows;
  const identifiers = (await queryable.query<{ artist_id: string; namespace: string; identifier: string }>(
    "SELECT artist_id::text, namespace, identifier FROM ingest.artist_editorial_identifiers")).rows;
  // Redes y plataformas oficiales del artista. Las de disco se excluyen: un
  // enlace de álbum compartido es catálogo compartido, no la misma identidad.
  const links = [
    ...(await queryable.query<{ artist_id: string; platform: string; url: string; external_id: string | null }>(
      "SELECT artist_id::text, platform, url, NULL::text AS external_id FROM public.social_links WHERE artist_id IS NOT NULL")).rows,
    ...(await queryable.query<{ artist_id: string; platform: string; url: string; external_id: string | null }>(
      "SELECT artist_id::text, platform, url, external_id FROM public.streaming_links WHERE artist_id IS NOT NULL AND album_id IS NULL")).rows,
  ];

  const byId = new Map<number, ArtistFacts>();
  for (const artist of artists) {
    byId.set(Number(artist.id), {
      id: Number(artist.id), name: artist.name, artistType: artist.artist_type, aliases: [],
      originCity: artist.origin_city, originCountry: artist.origin_country,
      formedYear: artist.formed_year, disbandedYear: artist.disbanded_year,
      albumKeys: new Set(), tracklistHashes: new Map(), members: [], evidenceUrls: [], officialLinks: [], externalIds: [],
      pictureUrl: artist.picture_url,
    });
  }
  for (const alias of aliases) byId.get(Number(alias.artist_id))?.aliases.push(alias.alias);
  for (const identifier of identifiers) {
    byId.get(Number(identifier.artist_id))?.externalIds.push(`${identifier.namespace.trim().toLowerCase()}:${identifier.identifier.trim()}`);
  }
  const perLink = new Map<string, Set<number>>();
  for (const link of links) {
    const url = normalizeEvidenceUrl(link.url);
    if (!url) continue;
    const artistId = Number(link.artist_id);
    if (!perLink.has(url)) perLink.set(url, new Set());
    perLink.get(url)!.add(artistId);
  }
  for (const link of links) {
    const facts = byId.get(Number(link.artist_id));
    if (!facts) continue;
    const url = normalizeEvidenceUrl(link.url);
    if (!url || GENERIC_ACCOUNT.test(url) || facts.officialLinks.some((item) => item.url === url)) continue;
    facts.officialLinks.push({ url, platform: link.platform, artists: perLink.get(url)?.size ?? 1 });
    if (link.external_id?.trim() && EXTERNAL_ID_PLATFORMS.has(link.platform.trim().toLowerCase())) {
      facts.externalIds.push(`${link.platform.trim().toLowerCase()}:${link.external_id.trim()}`);
    }
  }

  // Discos y tracklists. Un recopilatorio de varios artistas no identifica a
  // quien lo firma, así que ni entra en la clave ni en la huella.
  const tracksByAlbum = new Map<number, string[]>();
  for (const track of tracks) {
    const albumId = Number(track.album_id);
    if (!tracksByAlbum.has(albumId)) tracksByAlbum.set(albumId, []);
    tracksByAlbum.get(albumId)!.push(track.title);
  }
  for (const album of albums) {
    const facts = byId.get(Number(album.artist_id));
    if (!facts || VARIOUS_ARTISTS.test(facts.name.trim())) continue;
    if (album.album_type === "compilation") continue;
    facts.albumKeys.add(`${normalizeEntityName(album.title).secondaryKey}|${album.release_year ?? ""}`);
    const titles = tracksByAlbum.get(Number(album.id)) ?? [];
    if (titles.length >= 3) {
      facts.tracklistHashes.set(tracklistHash(titles), `${album.title}${album.release_year ? ` (${album.release_year})` : ""}`);
    }
  }

  for (const member of members) {
    const facts = byId.get(Number(member.artist_id));
    if (facts) addMember(facts, member.name, member.role);
  }

  // Evidencia: se cuenta cuántas fichas comparten cada página para no tomar un
  // directorio (un listado de 40 bandas) por una prueba de identidad.
  const perUrl = new Map<string, Set<number>>();
  for (const row of evidence) {
    const url = normalizeEvidenceUrl(row.url);
    if (!url) continue;
    const artistId = Number(row.artist_id);
    if (!perUrl.has(url)) perUrl.set(url, new Set());
    perUrl.get(url)!.add(artistId);
    byId.get(artistId)?.evidenceUrls.push({ url, artists: 0 });
  }
  for (const facts of byId.values()) {
    const unique = new Map<string, number>();
    for (const item of facts.evidenceUrls) unique.set(item.url, perUrl.get(item.url)?.size ?? 1);
    facts.evidenceUrls = [...unique.entries()].map(([url, artists]) => ({ url, artists }));
  }
  return [...byId.values()];
}

/**
 * Clave comparable de una foto sin leer el archivo: si el nombre es
 * content-addressed devuelve el sha256; si no, la propia URL. Permite comparar
 * fotos en un detector puro y síncrono (la lectura del archivo se reserva para
 * la CLI, que sí puede esperar).
 */
export function pictureComparableKey(url: string | null): string | null {
  if (!url) return null;
  if (!url.startsWith(LOCAL_MEDIA)) return url;
  const relative = decodeURIComponent(url.slice(LOCAL_MEDIA.length).split(/[?#]/u)[0] ?? "");
  const file = path.basename(path.resolve(MEDIA_ROOT, relative));
  const contentAddressed = /^([a-f0-9]{64})\.[a-z0-9]+$/u.exec(file);
  return contentAddressed?.[1] ?? url;
}

/** Huella de la foto local; una URL remota no se descarga en un barrido. */
async function pictureHashOf(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith(LOCAL_MEDIA)) return null;
  const relative = decodeURIComponent(url.slice(LOCAL_MEDIA.length).split(/[?#]/u)[0] ?? "");
  const file = path.resolve(MEDIA_ROOT, relative);
  if (!file.startsWith(MEDIA_ROOT + path.sep)) return null;
  const contentAddressed = /^([a-f0-9]{64})\.[a-z0-9]+$/u.exec(path.basename(file));
  if (contentAddressed?.[1]) return contentAddressed[1];
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

async function resolvePictureHashes(facts: ArtistFacts[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const item of facts) {
    if (!item.pictureUrl || out.has(item.pictureUrl)) continue;
    out.set(item.pictureUrl, await pictureHashOf(item.pictureUrl));
  }
  return out;
}

/** Pares ya careados: con revisión viva o cerrada como «son distintas». */
async function settledPairs(queryable: Pick<PoolClient, "query">): Promise<{ live: Set<string>; dismissed: Set<string> }> {
  const rows = (await queryable.query<{ a: string; b: string; live: boolean; dismissed: boolean }>(`
    SELECT LEAST(artist_a_id, artist_b_id)::text AS a,
           GREATEST(artist_a_id, artist_b_id)::text AS b,
           bool_or(status IN ('open','in_progress')) AS live,
           bool_or(status = 'dismissed') AS dismissed
      FROM ingest.review_queue
     WHERE kind::text = 'possible_duplicate' AND artist_a_id IS NOT NULL AND artist_b_id IS NOT NULL
     GROUP BY 1,2`)).rows;
  const live = new Set<string>();
  const dismissed = new Set<string>();
  for (const row of rows) {
    const key = `${row.a}|${row.b}`;
    if (row.live) live.add(key);
    if (row.dismissed) dismissed.add(key);
  }
  // Memoria única de Curaduría: un par declarado distinto tampoco se propone.
  const declared = (await queryable.query<{ a: string; b: string }>(`
    SELECT a_id::text AS a, b_id::text AS b FROM ingest.curation_distinct_pairs WHERE kind='artist'`)).rows;
  for (const row of declared) dismissed.add(`${row.a}|${row.b}`);
  return { live, dismissed };
}

const pairKey = (left: number, right: number) => `${Math.min(left, right)}|${Math.max(left, right)}`;

/**
 * Candidatos ordenados por score (desc) y prioridad. Un par se puntúa una sola
 * vez (`a.id < b.id`) y solo si comparte alguna clave de bloqueo o una página
 * de evidencia. El mismo nombre canónico no se propone aquí: ya lo resuelve el
 * detector exacto de `crv review duplicates`.
 */
export interface ArtistPairBlockOptions {
  maxBlockSize?: number;
  /** Pares ya resueltos que no deben volver a puntuarse. */
  skipPair?: (key: string) => boolean;
}

/** Pares candidatos por bloqueo, sin puntuar: la parte síncrona y pura del barrido. */
export function artistPairBlocks(
  facts: readonly ArtistFacts[], options: ArtistPairBlockOptions = {},
): { pairs: Array<[ArtistFacts, ArtistFacts]>; comparedPairs: number } {
  const maxBlockSize = options.maxBlockSize ?? 80;
  const blocks = new Map<string, ArtistFacts[]>();
  for (const artist of facts) {
    for (const key of blockingKeys(artist)) {
      blocks.set(key, [...(blocks.get(key) ?? []), artist]);
    }
  }
  const pairs: Array<[ArtistFacts, ArtistFacts]> = [];
  const seen = new Set<string>();
  let comparedPairs = 0;
  for (const group of blocks.values()) {
    if (group.length < 2 || group.length > maxBlockSize) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const [left, right] = group[i]!.id < group[j]!.id ? [group[i]!, group[j]!] : [group[j]!, group[i]!];
        const key = pairKey(left.id, right.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (options.skipPair?.(key)) continue;
        // Mismo nombre canónico: lo agrupa `findDuplicateGroups` con su propia
        // auditoría; repetirlo aquí solo llenaría la cola.
        if (normalizeEntityName(left.name).secondaryKey === normalizeEntityName(right.name).secondaryKey) continue;
        comparedPairs += 1;
        pairs.push([left, right]);
      }
    }
  }
  return { pairs, comparedPairs };
}

/** Puntúa los pares ya bloqueados. */
export function scoreArtistPairs(
  pairs: ReadonlyArray<readonly [ArtistFacts, ArtistFacts]>,
  options: { minScore?: number; pictures?: ReadonlyMap<string, string | null> } = {},
): ArtistCandidateScan {
  const minScore = options.minScore ?? ARTIST_CANDIDATE_MIN_SCORE;
  const pictures = options.pictures ?? new Map<string, string | null>();
  const candidates: ArtistCandidate[] = [];
  for (const [left, right] of pairs) {
    const scored = scoreArtistPair(left, right, pictures);
    if (scored.blocked || scored.score < minScore) continue;
    candidates.push({
      a: { id: left.id, name: left.name },
      b: { id: right.id, name: right.name },
      score: scored.score,
      deterministic: scored.deterministic,
      signals: scored.features.filter((feature) => feature.value > 0 && DETERMINISTIC_KEYS.has(feature.key)).length,
      features: scored.features,
      priority: scored.deterministic ? 8 : scored.score >= ARTIST_CANDIDATE_STRONG_SCORE ? 6 : 4,
    });
  }
  candidates.sort((left, right) => right.signals - left.signals || right.score - left.score
    || left.a.id - right.a.id || left.b.id - right.b.id);
  return {
    candidates,
    artists: 0,
    comparedPairs: pairs.length,
    deterministicPairs: candidates.filter((candidate) => candidate.deterministic).length,
  };
}

export async function findArtistCandidates(options: ArtistCandidateOptions = {}): Promise<ArtistCandidateScan> {
  const queryable = options.queryable ?? getPool();
  const minScore = options.minScore ?? ARTIST_CANDIDATE_MIN_SCORE;
  const facts = await loadArtistFacts(queryable);
  const settled = await settledPairs(queryable);
  const { pairs, comparedPairs } = artistPairBlocks(facts, {
    ...(options.maxBlockSize === undefined ? {} : { maxBlockSize: options.maxBlockSize }),
    skipPair: (key) => settled.live.has(key) || settled.dismissed.has(key),
  });

  const involved = new Map<number, ArtistFacts>();
  for (const [left, right] of pairs) {
    involved.set(left.id, left);
    involved.set(right.id, right);
  }
  const pictures = await resolvePictureHashes([...involved.values()]);
  const scan = scoreArtistPairs(pairs, { minScore, pictures });
  return {
    ...scan,
    artists: facts.length,
    comparedPairs,
    candidates: options.limit === undefined ? scan.candidates : scan.candidates.slice(0, options.limit),
  };
}

/**
 * Puntúa pares concretos —los de revisiones vivas— sin volver a barrer todo el
 * catálogo. Sirve para reanudar un lote y para reintentar un par señalado.
 */
export async function findArtistCandidatesForPairs(
  pairs: Array<[number, number]>, options: ArtistCandidateOptions = {},
): Promise<ArtistCandidateScan> {
  const queryable = options.queryable ?? getPool();
  const facts = await loadArtistFacts(queryable);
  const byId = new Map(facts.map((item) => [item.id, item]));
  const unique = [...new Map(pairs.map(([left, right]) => [pairKey(left, right), [left, right] as [number, number]])).values()];
  const involved = unique.flatMap(([left, right]) => [byId.get(left), byId.get(right)]).filter((item): item is ArtistFacts => Boolean(item));
  const pictures = await resolvePictureHashes(involved);
  const candidates: ArtistCandidate[] = [];
  for (const [left, right] of unique) {
    const a = byId.get(left);
    const b = byId.get(right);
    if (!a || !b) continue;
    if (normalizeEntityName(a.name).secondaryKey === normalizeEntityName(b.name).secondaryKey) continue;
    const scored = scoreArtistPair(a, b, pictures);
    if (scored.blocked || scored.score < (options.minScore ?? ARTIST_CANDIDATE_MIN_SCORE)) continue;
    candidates.push({
      a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name },
      score: scored.score, deterministic: scored.deterministic,
      signals: scored.features.filter((feature) => feature.value > 0 && DETERMINISTIC_KEYS.has(feature.key)).length,
      features: scored.features,
      priority: scored.deterministic ? 8 : scored.score >= ARTIST_CANDIDATE_STRONG_SCORE ? 6 : 4,
    });
  }
  candidates.sort((left, right) => right.signals - left.signals || right.score - left.score
    || left.a.id - right.a.id || left.b.id - right.b.id);
  return {
    candidates: options.limit === undefined ? candidates : candidates.slice(0, options.limit),
    artists: facts.length, comparedPairs: unique.length,
    deterministicPairs: candidates.filter((candidate) => candidate.deterministic).length,
  };
}

/** Pares de artistas con revisión viva, para reanudar un lote ya abierto. */
export async function openArtistPairIds(queryable: Pick<PoolClient, "query"> = getPool()): Promise<Array<[number, number]>> {
  const rows = (await queryable.query<{ a: string; b: string }>(`
    SELECT LEAST(artist_a_id, artist_b_id)::text AS a, GREATEST(artist_a_id, artist_b_id)::text AS b
      FROM ingest.review_queue
     WHERE kind::text='possible_duplicate' AND status IN ('open','in_progress')
       AND artist_a_id IS NOT NULL AND artist_b_id IS NOT NULL AND artist_a_id<>artist_b_id
     GROUP BY 1,2 ORDER BY 1,2`)).rows;
  return rows.map((row) => [Number(row.a), Number(row.b)]);
}

export interface OpenArtistCandidatesResult {
  runId: number;
  opened: number;
  skipped: number;
}

/**
 * Abre una revisión `possible_duplicate` por candidato, en un run `manual` con
 * nota. Idempotente por el índice parcial 0115: repetir la corrida no duplica
 * lo que sigue vivo (`ON CONFLICT DO NOTHING`).
 */
export async function openArtistCandidateReviews(
  candidates: ArtistCandidate[], note: string, operator: string,
): Promise<OpenArtistCandidatesResult> {
  const { runId, result } = await withOperatorRun({
    name: "cli:review:artist-candidates", operator, note,
    params: { detector: "artist-candidates", version: 1, proposed: candidates.length },
  }, async (context) => {
    let opened = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const signals = candidate.features.filter((feature) => feature.value > 0).slice(0, 4).map((feature) => feature.key);
      const inserted = await context.client.query(`
        INSERT INTO ingest.review_queue(kind,artist_a_id,artist_b_id,priority,status,payload,notes)
        VALUES('possible_duplicate',LEAST($1::bigint,$2::bigint),GREATEST($1::bigint,$2::bigint),$3,'open',$4::jsonb,$5)
        ON CONFLICT DO NOTHING`, [
        candidate.a.id, candidate.b.id, candidate.priority,
        JSON.stringify({
          detector: "artist-candidates", version: 1, entity: "artist",
          score: candidate.score, deterministic: candidate.deterministic, signals: candidate.signals,
          tier: candidate.deterministic ? "deterministic" : "probabilistic",
          features: candidate.features, runId: context.runId,
          pairKey: pairKey(candidate.a.id, candidate.b.id),
          profiles: { a: `/artistas/${candidate.a.id}`, b: `/artistas/${candidate.b.id}` },
        }),
        `${note} — «${candidate.a.name}» / «${candidate.b.name}» (score ${candidate.score.toFixed(2)}; ${signals.join(", ")})`.slice(0, 2000),
      ]);
      if (inserted.rowCount) opened += 1;
      else skipped += 1;
    }
    return { opened, skipped };
  });
  return { runId, ...result };
}

export interface ArtistComparisonResult {
  requested: number;
  done: number;
  failed: number;
}

/**
 * Capa 3 · pide al comparador existente un informe conjunto para el top del
 * lote. La CLI lo activa con `--compare-top=N`; aquí no se decide nada y se
 * espera a que cada trabajo termine (o venza) para no dejar jobs a medias.
 */
export async function requestArtistComparisons(
  candidates: ArtistCandidate[], operator: string,
  options: { limit?: number; pollMs?: number; timeoutMs?: number; onProgress?: (line: string) => void } = {},
): Promise<ArtistComparisonResult> {
  const selected = candidates.slice(0, options.limit ?? 5);
  const pollMs = options.pollMs ?? 4_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  let done = 0;
  let failed = 0;
  for (const [index, candidate] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${candidate.a.id} «${candidate.a.name}» / ${candidate.b.id} «${candidate.b.name}»`;
    options.onProgress?.(`${label}: comparando…`);
    try {
      const job = await startComparison({ kind: "artist", id: candidate.a.id }, { kind: "artist", id: candidate.b.id }, operator);
      const started = Date.now();
      for (;;) {
        const current = await getComparisonJob(job.id);
        if (!current) throw new Error(`el trabajo ${job.id} desapareció`);
        if (current.status === "done") { done += 1; options.onProgress?.(`${label}: informe listo (job ${job.id})`); break; }
        if (current.status === "failed") throw new Error(current.error ?? "el comparador falló");
        if (Date.now() - started > timeoutMs) throw new Error(`tiempo agotado (${Math.round(timeoutMs / 60_000)} min)`);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error) {
      failed += 1;
      options.onProgress?.(`${label}: sin informe — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { requested: selected.length, done, failed };
}
