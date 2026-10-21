// CRV · Absorción de Venciclopedia (2026-10-20).
//
// El motor de fusión resuelve cada claim con una llamada al ER: 11.680 claims
// a 6/min son 32 h. Las campañas masivas de este repo (Aqustico, Musicavenezuela,
// Spotify, Metal Archives) usan la otra puerta: la evidencia se persiste como
// claims y la escritura va por un run de operador, con el diario por trigger
// (`crv_journal`), así que sigue siendo reversible con `runs undo`.
//
// Reglas duras:
//   · solo se rellena lo vacío: ningún valor previo se pisa, y si otra fuente
//     ya afirmó el campo (fila en `ingest.merge_audit`) tampoco se toca;
//   · un artista o un disco ambiguo no se toca (se reporta);
//   · un disco solo se crea si el artista existe, trae año y NO se parece a
//     ninguno de sus discos (similitud < 0,60); el resto queda propuesto;
//   · las pistas no se crean ni se renumeran: solo se rellena la duración.
//
//   ./scripts/with-node22.sh npx tsx scripts/venciclopedia-absorb.mts [--confirm]
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { VenciclopediaAdapter } from "../src/adapters/venciclopedia.js";
import { loadStoredAdapterPages } from "../src/ingest/runner.js";
import { normalizeRecord, normalizeIdentity } from "../src/normalization/claims.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";
import { persistClaim } from "../src/claims/persistence.js";
import type { PoolClient } from "pg";
import { getPool, closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { projectRoot } from "../src/config/project-root.js";

const SLUG = "venciclopedia";
const OPERATOR = "hermes-agent";
const NOTE = "Absorción de Venciclopedia (fuente trust=high aprobada por Brian el 2026-10-20): relleno de huecos de artistas, discos y duraciones; solo valores vacíos";
const ROOT = projectRoot(import.meta.url);
const OUT = path.join(ROOT, "reports", "venciclopedia-2026-10-20");
const CONFIRM = process.argv.includes("--confirm");
/**
 * Fichas que la fuente documenta pero NO son un disco del artista que la
 * categoría sugiere. Se revisaron una a una: `40 años siendo la emisora de
 * Venezuela` es el aniversario de Radio Rumbos y la wiki lo enlaza desde la
 * ficha de Simón Díaz por navegación, no por titularidad.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  "Simón Díaz::40 años siendo la emisora de Venezuela": "el disco es de Radio Rumbos; aparece por navegación en la ficha de Simón Díaz",
};

function titleKey(value: string): string {
  return value
    .normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .replace(/^(los|las|el|la)\s+/u, "")
    .replace(/[^a-z0-9]+/g, "");
}

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "a", "con", "por", "para", "un", "una", "al", "su", "sus", "vol", "no"]);

/** Palabras significativas de un título (sin artículos ni preposiciones). */
function titleWords(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .split(/[^a-z0-9]+/u).filter((word) => word.length > 0 && !STOPWORDS.has(word)));
}

/**
 * ¿El título ya está en el catálogo con otra grafía? La wiki y el catálogo
 * escriben distinto el mismo disco («Simón Díaz '69» vs «Simón 69») y también
 * hay títulos con el nombre del grupo pegado delante («El Trabuco Venezolano
 * Imagen Latina»). Un alta duplicada cuesta más que un hueco.
 */
function looksDuplicate(title: string, existing: Array<{ title: string; artist: string | null; year: number | null }>): string | undefined {
  const target = titleKey(title);
  const words = titleWords(title);
  for (const row of existing) {
    const other = titleKey(row.title);
    if (!other) continue;
    if (other === target) return `idéntico a «${row.title}» (${row.artist ?? "?"}, ${row.year ?? "s/f"})`;
    const otherWords = titleWords(row.title);
    if (words.size >= 2 && [...words].every((word) => otherWords.has(word))) {
      return `contenido en «${row.title}» (${row.artist ?? "?"}, ${row.year ?? "s/f"})`;
    }
  }
  return undefined;
}

/** Coeficiente de pares de la cadena (Dice) más contención para títulos largos. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter)) return 0.9;
  const bigrams = (text: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const left = bigrams(longer);
  const right = bigrams(shorter);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size || 1);
}

interface AlbumWanted {
  identity: string; artist: string; title: string;
  releaseYear?: number; catalogId?: string; mediaFormat?: string; label?: string; albumType?: string;
}
interface ArtistWanted {
  name: string; artistType?: string; originCity?: string; formedYear?: number; disbandedYear?: number;
}
interface TrackWanted { albumIdentity: string; number: number; title: string; seconds?: number }

// ── 0. Fuente y run de evidencia ────────────────────────────────────────────
const pool = getPool();
const { rows: sourceRows } = await pool.query<{ id: string }>("SELECT id FROM ingest.sources WHERE slug=$1", [SLUG]);
if (!sourceRows[0]) throw new Error(`fuente desconocida: ${SLUG}`);
const SOURCE_ID = Number(sourceRows[0].id);
const { rows: runRows } = await pool.query<{ id: string }>(
  `INSERT INTO ingest.scrape_runs(kind, source_id, status, params, started_at)
   VALUES ('scrape_source', $1, 'running', $2::jsonb, now()) RETURNING id`,
  [SOURCE_ID, JSON.stringify({ mode: "absorb", sourceSlug: SLUG, operator: OPERATOR })],
);
const RUN_ID = Number(runRows[0]!.id);

// ── 1. Leer el crudo y agrupar por entidad ──────────────────────────────────
const adapter = new VenciclopediaAdapter();
const pages = await loadStoredAdapterPages(SLUG, adapter);
const artists = new Map<string, ArtistWanted>();
const albums = new Map<string, AlbumWanted>();
const tracks = new Map<string, TrackWanted>();
let records = 0;
let claimsPersisted = 0;
let claimsReused = 0;

for (const page of pages) {
  const extracted = adapter.extractSnapshot(page) ?? [];
  records += extracted.length;
  for (const record of extracted) {
    if (CONFIRM) {
      for (const claim of normalizeRecord(record)) {
        const persisted = await persistClaim({ ...claim, sourceId: SOURCE_ID, runId: RUN_ID, confidence: "high", rawPageId: page.rawPageId });
        if (persisted.inserted) claimsPersisted += 1; else claimsReused += 1;
      }
    }
    const value = (field: string): unknown => record.fields.find((item) => item.field === field)?.value;
    if (record.entityKind === "artist") {
      const name = String(value("name") ?? "");
      if (!name) continue;
      artists.set(normalizeIdentity(name), {
        name,
        ...(value("artist_type") === undefined ? {} : { artistType: String(value("artist_type")) }),
        ...(value("origin_city") === undefined ? {} : { originCity: String(value("origin_city")) }),
        ...(value("formed_year") === undefined ? {} : { formedYear: Number(value("formed_year")) }),
        ...(value("disbanded_year") === undefined ? {} : { disbandedYear: Number(value("disbanded_year")) }),
      });
      continue;
    }
    if (record.entityKind === "album") {
      const [artistName, ...rest] = record.identity.split("::");
      const title = String(value("title") ?? rest.join("::"));
      if (!artistName || !title) continue;
      albums.set(record.identity, {
        identity: record.identity, artist: artistName, title,
        ...(value("release_year") === undefined ? {} : { releaseYear: Number(value("release_year")) }),
        ...(value("catalog_id") === undefined ? {} : { catalogId: String(value("catalog_id")) }),
        ...(value("media_format") === undefined ? {} : { mediaFormat: String(value("media_format")) }),
        ...(value("label") === undefined ? {} : { label: String(value("label")) }),
        ...(value("album_type") === undefined ? {} : { albumType: String(value("album_type")) }),
      });
      continue;
    }
    if (record.entityKind === "track") {
      const [artistName, albumTitle, numberRaw] = record.identity.split("::");
      const number = Number(numberRaw);
      const title = String(value("title") ?? "");
      if (!artistName || !albumTitle || !title || !Number.isFinite(number)) continue;
      tracks.set(record.identity, {
        albumIdentity: `${artistName}::${albumTitle}`, number, title,
        ...(value("duration_seconds") === undefined ? {} : { seconds: Number(value("duration_seconds")) }),
      });
    }
  }
}

console.log(`crudo: ${pages.length} páginas · ${records} registros · ${artists.size} artistas · ${albums.size} discos · ${tracks.size} pistas`);
if (CONFIRM) console.log(`claims persistidos: ${claimsPersisted} nuevos / ${claimsReused} reutilizados (run ${RUN_ID})`);

// ── 2. Aplicación al catálogo ───────────────────────────────────────────────
interface Stats {
  artists: { matched: number; ambiguous: number; unmatched: number; filled: Record<string, number> };
  albums: { matched: number; ambiguous: number; unmatched: number; filled: Record<string, number>; created: number; createdList: { artist: string; title: string; year?: number }[]; proposed: { artist: string; title: string; year?: number; why: string }[]; noArtist: number; noArtistList: string[] };
  tracks: { filled: number; ambiguous: number; unmatched: number; noAlbum: number };
}

async function apply(client: PoolClient): Promise<Stats> {
  const stats: Stats = {
    artists: { matched: 0, ambiguous: 0, unmatched: 0, filled: {} },
    albums: { matched: 0, ambiguous: 0, unmatched: 0, filled: {}, created: 0, createdList: [], proposed: [], noArtist: 0, noArtistList: [] },
    tracks: { filled: 0, ambiguous: 0, unmatched: 0, noAlbum: 0 },
  };
  const bump = (bucket: Record<string, number>, key: string): void => { bucket[key] = (bucket[key] ?? 0) + 1; };
  {
    await client.query("SET LOCAL lock_timeout = '20s'");

    // Artistas en memoria, con sus dos claves.
    const { rows: artistRows } = await client.query<{ id: string; name: string; artist_type: string; origin_city: string | null; formed_year: number | null; disbanded_year: number | null }>(
      "SELECT id::text, name, artist_type::text AS artist_type, origin_city, formed_year, disbanded_year FROM public.artists");
    const byPrimary = new Map<string, number[]>();
    const byVariant = new Map<string, number[]>();
    const push = (map: Map<string, number[]>, key: string, id: number): void => {
      if (!key) return;
      const list = map.get(key) ?? []; list.push(id); map.set(key, list);
    };
    for (const row of artistRows) {
      push(byPrimary, normalizeIdentity(row.name), Number(row.id));
      // Variantes previsibles: «Oscar D' León» y «Oscar D'León» son el mismo
      // artista y la clave compacta los une sin abrir la puerta a parecidos.
      for (const variant of predictableNameVariants(row.name)) push(byVariant, variant, Number(row.id));
    }
    const resolveOne = (name: string): number[] => {
      const direct = byPrimary.get(normalizeIdentity(name)) ?? [];
      if (direct.length > 0) return [...new Set(direct)];
      const found: number[] = [];
      for (const variant of predictableNameVariants(name)) found.push(...(byVariant.get(variant) ?? []));
      return [...new Set(found)];
    };
    // La ficha puede acreditar varios artistas («Dimensión Latina, Oscar D'León»).
    // Se prueban todos y solo se acepta si UNO existe: dos existentes es una
    // colaboración y ahí no se elige por cuenta propia.
    const resolveArtist = (name: string): number[] => {
      const direct = resolveOne(name);
      if (direct.length > 0) return direct;
      const parts = name.split(/\s*,\s*|\s+y\s+|\s*&\s*/u).map((part) => part.trim()).filter((part) => part.length > 2);
      if (parts.length < 2) return [];
      const found = new Set<number>();
      for (const part of parts) for (const id of resolveOne(part)) found.add(id);
      return found.size === 1 ? [...found] : [];
    };
    const artistById = new Map(artistRows.map((row) => [Number(row.id), row]));

    // Álbumes y pistas.
    const { rows: albumRows } = await client.query<{ id: string; artist_id: string; title: string; release_year: number | null; catalog_id: string | null; media_format: string | null; label_id: string | null; album_type: string }>(
      "SELECT id::text, artist_id::text, title, release_year, catalog_id, media_format, label_id::text, album_type::text FROM public.albums");
    const albumByArtistTitle = new Map<string, number[]>();
    const albumIdsByArtist = new Map<number, number[]>();
    const albumById = new Map<number, typeof albumRows[number]>();
    for (const row of albumRows) {
      const id = Number(row.id); const artistId = Number(row.artist_id);
      albumById.set(id, row);
      push(albumByArtistTitle, `${artistId}|${titleKey(row.title)}`, id);
      const list = albumIdsByArtist.get(artistId) ?? []; list.push(id); albumIdsByArtist.set(artistId, list);
    }
    const { rows: trackRows } = await client.query<{ id: string; album_id: string; title: string; duration_seconds: number | null }>(
      "SELECT id::text, album_id::text, title, duration_seconds FROM public.tracks");
    const trackByAlbumTitle = new Map<string, number[]>();
    const durationById = new Map<number, number | null>();
    for (const row of trackRows) {
      push(trackByAlbumTitle, `${row.album_id}|${titleKey(row.title)}`, Number(row.id));
      durationById.set(Number(row.id), row.duration_seconds);
    }

    // Campos ya afirmados por otra fuente: no se vuelven a tocar.
    const { rows: assertedRows } = await client.query<{ album_id: string | null; artist_id: string | null; field: string }>(
      `SELECT album_id::text, artist_id::text, field FROM ingest.merge_audit
        WHERE field IN ('release_year','catalog_id','media_format','album_type','origin_city','formed_year','disbanded_year')`);
    const assertedAlbum = new Set(assertedRows.filter((row) => row.album_id).map((row) => `${row.album_id}|${row.field}`));
    const assertedArtist = new Set(assertedRows.filter((row) => row.artist_id).map((row) => `${row.artist_id}|${row.field}`));

    // ── Artistas
    for (const wanted of artists.values()) {
      const candidates = resolveArtist(wanted.name);
      const unique = [...new Set(candidates)];
      if (unique.length === 0) { stats.artists.unmatched += 1; continue; }
      if (unique.length > 1) { stats.artists.ambiguous += 1; continue; }
      const id = unique[0]!;
      const row = artistById.get(id);
      if (!row) continue;
      stats.artists.matched += 1;
      if (wanted.originCity && !row.origin_city && !assertedArtist.has(`${id}|origin_city`)) {
        await client.query("UPDATE public.artists SET origin_city=$2 WHERE id=$1 AND origin_city IS NULL", [id, wanted.originCity.slice(0, 120)]);
        bump(stats.artists.filled, "origin_city");
      }
      if (wanted.formedYear && !row.formed_year && !assertedArtist.has(`${id}|formed_year`)) {
        await client.query("UPDATE public.artists SET formed_year=$2 WHERE id=$1 AND formed_year IS NULL", [id, wanted.formedYear]);
        bump(stats.artists.filled, "formed_year");
      }
      if (wanted.disbandedYear && !row.disbanded_year && !assertedArtist.has(`${id}|disbanded_year`)) {
        await client.query("UPDATE public.artists SET disbanded_year=$2 WHERE id=$1 AND disbanded_year IS NULL", [id, wanted.disbandedYear]);
        bump(stats.artists.filled, "disbanded_year");
      }
      if (wanted.artistType && row.artist_type === "other" && !assertedArtist.has(`${id}|artist_type`)) {
        await client.query("UPDATE public.artists SET artist_type=$2 WHERE id=$1 AND artist_type='other'", [id, wanted.artistType]);
        bump(stats.artists.filled, "artist_type");
      }
    }

    // Sello: se resuelve contra organizaciones existentes, nunca se inventa.
    const { rows: orgRows } = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.organizations");
    const orgByKey = new Map<string, number[]>();
    for (const org of orgRows) push(orgByKey, titleKey(org.name), Number(org.id));

    // ── Discos existentes
    for (const wanted of albums.values()) {
      const artistCandidates = resolveArtist(wanted.artist);
      const artistIds = [...new Set(artistCandidates)];
      if (artistIds.length !== 1) { stats.albums.noArtist += 1; if (stats.albums.noArtistList.length < 25) stats.albums.noArtistList.push(wanted.artist); continue; }
      const artistId = artistIds[0]!;
      const matches = albumByArtistTitle.get(`${artistId}|${titleKey(wanted.title)}`) ?? [];
      if (matches.length > 1) { stats.albums.ambiguous += 1; continue; }
      if (matches.length === 1) {
        const albumId = matches[0]!;
        const row = albumById.get(albumId);
        if (!row) continue;
        stats.albums.matched += 1;
        if (wanted.releaseYear && !row.release_year && !assertedAlbum.has(`${albumId}|release_year`)) {
          await client.query("UPDATE public.albums SET release_year=$2 WHERE id=$1 AND release_year IS NULL", [albumId, wanted.releaseYear]);
          bump(stats.albums.filled, "release_year");
        }
        if (wanted.catalogId && !row.catalog_id && !assertedAlbum.has(`${albumId}|catalog_id`)) {
          await client.query("UPDATE public.albums SET catalog_id=$2 WHERE id=$1 AND catalog_id IS NULL", [albumId, wanted.catalogId.slice(0, 80)]);
          bump(stats.albums.filled, "catalog_id");
        }
        if (wanted.mediaFormat && !row.media_format && !assertedAlbum.has(`${albumId}|media_format`)) {
          await client.query("UPDATE public.albums SET media_format=$2 WHERE id=$1 AND media_format IS NULL", [albumId, wanted.mediaFormat.slice(0, 50)]);
          bump(stats.albums.filled, "media_format");
        }
        if (wanted.albumType && row.album_type === "other" && !assertedAlbum.has(`${albumId}|album_type`)) {
          await client.query("UPDATE public.albums SET album_type=$2::album_type WHERE id=$1 AND album_type='other'", [albumId, wanted.albumType]);
          bump(stats.albums.filled, "album_type");
        }
        if (wanted.label && !row.label_id) {
          const labels = [...new Set(orgByKey.get(titleKey(wanted.label)) ?? [])];
          if (labels.length === 1) {
            await client.query("UPDATE public.albums SET label_id=$2 WHERE id=$1 AND label_id IS NULL", [albumId, labels[0]!]);
            bump(stats.albums.filled, "label_id");
          }
        }
        continue;
      }
      // No existe: alta solo si es inequívoca.
      stats.albums.unmatched += 1;
      const excluded = EXCLUDED[wanted.identity];
      if (excluded) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}), why: excluded });
        continue;
      }
      // Un recopilatorio no es un disco de «Various Artists»: el marcador ocupa
      // la columna que la tabla exige, pero no identifica a nadie. Y si el
      // título es el nombre de un artista del catálogo, la ficha está mal
      // formada (la wiki la usa como disco homónimo): no se crea.
      if (titleKey(wanted.artist) === titleKey("Various Artists")) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}), why: "recopilatorio: el artista de la ficha es el marcador Various Artists" });
        continue;
      }
      if ((byPrimary.get(titleKey(wanted.title)) ?? []).length > 0) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}), why: "el título es el nombre de un artista del catálogo: ficha mal formada" });
        continue;
      }
      const siblings = (albumIdsByArtist.get(artistId) ?? []).map((id) => albumById.get(id)?.title ?? "");
      const worst = siblings.reduce((max, title) => Math.max(max, similarity(titleKey(wanted.title), titleKey(title))), 0);
      if (worst >= 0.6) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}), why: `título parecido a otro disco del artista (${worst.toFixed(2)})` });
        continue;
      }
      if (!wanted.releaseYear) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, why: "sin año en la fuente" });
        continue;
      }
      const allTitles = [...albumById.values()].map((row) => ({ title: row.title, artist: null, year: row.release_year }));
      const duplicate = looksDuplicate(wanted.title, allTitles);
      if (duplicate) {
        stats.albums.proposed.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}), why: `ya existe ${duplicate}` });
        continue;
      }
      await client.query(
        `INSERT INTO public.albums(artist_id, title, release_year, catalog_id, media_format)
         VALUES ($1,$2,$3,$4,$5)`,
        [artistId, wanted.title.slice(0, 250), wanted.releaseYear, wanted.catalogId?.slice(0, 80) ?? null, wanted.mediaFormat?.slice(0, 50) ?? null],
      );
      stats.albums.created += 1;
      stats.albums.createdList.push({ artist: wanted.artist, title: wanted.title, ...(wanted.releaseYear ? { year: wanted.releaseYear } : {}) });
    }

    // Recuento por álbum de la fuente: sirve para el emparejamiento por
    // posición cuando el título de la pista no coincide letra a letra (la
    // fuente y el catálogo suelen escribir distinto el mismo tema).
    const fuentePorAlbum = new Map<string, number>();
    for (const item of tracks.values()) fuentePorAlbum.set(item.albumIdentity, (fuentePorAlbum.get(item.albumIdentity) ?? 0) + 1);
    const crvPorAlbum = new Map<number, number[]>();
    for (const row of trackRows) {
      const albumId = Number(row.album_id);
      const list = crvPorAlbum.get(albumId) ?? []; list.push(Number(row.id)); crvPorAlbum.set(albumId, list);
    }

    // ── Duraciones de pista (solo relleno; nunca se crean ni renumeran)
    for (const wanted of tracks.values()) {
      if (!wanted.seconds) continue; // 0 es válido pero no aporta; null no se escribe
      const wantedAlbum = albums.get(wanted.albumIdentity);
      if (!wantedAlbum) { stats.tracks.noAlbum += 1; continue; }
      const artistCandidates = resolveArtist(wantedAlbum.artist);
      const artistIds = [...new Set(artistCandidates)];
      if (artistIds.length !== 1) { stats.tracks.noAlbum += 1; continue; }
      const albumIds = albumByArtistTitle.get(`${artistIds[0]}|${titleKey(wantedAlbum.title)}`) ?? [];
      if (albumIds.length !== 1) { stats.tracks.noAlbum += 1; continue; }
      const albumId = albumIds[0]!;
      const ids = trackByAlbumTitle.get(`${albumId}|${titleKey(wanted.title)}`) ?? [];
      if (ids.length > 1) { stats.tracks.ambiguous += 1; continue; }
      let trackId: number | undefined = ids[0];
      if (trackId === undefined) {
        // Fallback por posición: solo si el álbum tiene EXACTAMENTE el mismo
        // número de pistas que la fuente y el título se parece lo suficiente.
        const enFuente = fuentePorAlbum.get(wanted.albumIdentity) ?? 0;
        const enCrv = crvPorAlbum.get(albumId) ?? [];
        if (enFuente === enCrv.length && enCrv.length > 0) {
          const candidate = enCrv[wanted.number - 1];
          const row = candidate === undefined ? undefined : trackRows.find((item) => Number(item.id) === candidate);
          if (candidate !== undefined && row && similarity(titleKey(wanted.title), titleKey(row.title)) >= 0.5) trackId = candidate;
        }
      }
      if (trackId === undefined) { stats.tracks.unmatched += 1; continue; }
      if (durationById.get(trackId) !== null) continue;
      await client.query("UPDATE public.tracks SET duration_seconds=$2 WHERE id=$1 AND duration_seconds IS NULL", [trackId, wanted.seconds]);
      stats.tracks.filled += 1;
      durationById.set(trackId, wanted.seconds);
    }
    return stats;
  }
}

let stats: Stats;
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "venciclopedia:absorb", operator: OPERATOR, note: NOTE }, (context) => apply(context.client), { serializable: false });
  stats = outcome.result;
  console.log(`run de aplicación: ${outcome.runId}`);
} else {
  // El dry-run corre en la MISMA conexión que abre la transacción y siempre
  // revierte: la primera versión abría otra y commiteaba de verdad.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    stats = await apply(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

await pool.query("UPDATE ingest.scrape_runs SET status=$2, finished_at=now(), counters=$3::jsonb WHERE id=$1", [
  RUN_ID, CONFIRM ? "ok" : "ok", JSON.stringify({ mode: CONFIRM ? "absorb" : "dry-run", stats }),
]);

mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, CONFIRM ? "aplicacion.json" : "aplicacion-dry-run.json");
writeFileSync(file, JSON.stringify({ runId: RUN_ID, confirm: CONFIRM, stats }, null, 1));
console.log(JSON.stringify(stats, null, 1));
console.log(`-> ${file}`);
await closeDb();
