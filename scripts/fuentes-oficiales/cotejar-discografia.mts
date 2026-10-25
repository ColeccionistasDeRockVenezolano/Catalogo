// CRV · Cotejo de discografía contra las páginas oficiales de Bandcamp (Brian, 2026-10-13).
//
// Sin IA: las páginas de disco de Bandcamp traen datos estructurados (JSON-LD MusicAlbum) con
// título, artista (byArtist), fecha, pistas con posición y duración, «about» y «credits». Se leen
// de las capturas de la campaña de fuentes oficiales y se cruzan con el catálogo:
//
//   sin pistas      disco del catálogo (título EXACTO o alias) que no tiene ninguna pista
//   duraciones      pistas del catálogo sin duración cuya posición y título coinciden
//   distinto        número o títulos de pistas que no cuadran (informe, no se toca)
//   faltante        disco del artista en Bandcamp que el catálogo no tiene (informe para revisión)
//   año             año distinto (informe: Bandcamp a veces fecha la subida, no la edición)
//
// Identidad: el disco tiene que estar publicado por el artista (byArtist = nombre o alias) y la
// ficha tiene que estar confirmada: cotejo de trayectoria «same_artist», o al menos un disco de
// Bandcamp que coincide con uno del catálogo. Las fichas que el cotejo marcó como homónimo se saltan.
// Solo lectura. Uso: tsx scripts/fuentes-oficiales/cotejar-discografia.mts [--cases=…] [--out=…] [--ids=…]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { loadCases } from "./cotejar-trayectoria.mjs";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const CAMPAIGN = "reports/official-enrichment-2026-10-13";
const CASE_DIRS = (arg("cases") ?? `${CAMPAIGN}/cases,${CAMPAIGN}/expanded/cases`).split(",");
const OUT = arg("out") ?? "reports/fuentes-oficiales-2026-10-13/discografia.jsonl";
const TRAJECTORY = arg("trayectoria") ?? "reports/fuentes-oficiales-2026-10-13/trayectoria.jsonl";
const ONLY = arg("ids")?.split(",").map(Number);

export const fold = (text: string | null | undefined) => (text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/&/gu, " y ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** «Ancestros (2022)» → «ancestros»: algunos artistas ponen el año en el título de Bandcamp. */
const bare = (title: string) => fold(title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, ""));

export interface BandcampTrack { position: number; title: string; durationSeconds: number | null }
export interface BandcampAlbum { url: string; title: string; byArtist: string; datePublished: string | null; year: number | null; tracks: BandcampTrack[]; about: string | null; credits: string | null; capturedAt: string; contentHash: string }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const text = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})/u.exec(value);
  if (text && MONTHS[text[2]!.toLowerCase()]) return `${text[3]}-${String(MONTHS[text[2]!.toLowerCase()]).padStart(2, "0")}-${text[1]!.padStart(2, "0")}`;
  return null;
}
const seconds = (value: string | undefined) => {
  const match = /^P(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(value?.replace(/^P00H/u, "P0H") ?? "") ?? /^P(\d+)H(\d+)M(\d+)S$/u.exec(value ?? "");
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
};

/** Datos estructurados de una página de disco de Bandcamp capturada por la campaña. */
export function parseBandcampAlbum(page: { url: string; content: string; capturedAt?: string; fetchedAt?: string; contentHash: string }): BandcampAlbum | null {
  const content = page.content;
  if (!/^JSON-LD 1 \/@type: MusicAlbum$/mu.test(content)) return null;
  const get = (field: string) => new RegExp(`^JSON-LD 1 /${field.replace(/[/]/gu, "\\/")}: (.*)$`, "mu").exec(content)?.[1]?.trim() ?? null;
  const title = get("name"), byArtist = get("byArtist/name");
  if (!title || !byArtist) return null;
  const tracks: BandcampTrack[] = [];
  for (const match of content.matchAll(/^JSON-LD 1 \/track\/itemListElement\/(\d+)\/position: (\d+)$/gmu)) {
    const index = match[1]!;
    const name = get(`track/itemListElement/${index}/item/name`);
    if (!name) continue;
    tracks.push({ position: Number(match[2]), title: name, durationSeconds: seconds(get(`track/itemListElement/${index}/item/duration`) ?? undefined) });
  }
  const datePublished = isoDate(get("datePublished"));
  const body = content.split("Enlaces de la página:")[0] ?? "";
  const section = (name: string, next: string) => {
    const start = body.search(new RegExp(`\\n\\s*${name}\\s*\\n`, "u"));
    if (start < 0) return null;
    const rest = body.slice(start).replace(new RegExp(`^\\s*${name}\\s*`, "u"), "");
    const end = rest.search(new RegExp(`\\n\\s*(?:${next})\\s*\\n`, "u"));
    const text = (end < 0 ? rest.slice(0, 4000) : rest.slice(0, end)).replace(/[ \t]+/gu, " ").replace(/\n\s*\n+/gu, "\n").trim();
    return text || null;
  };
  return {
    url: page.url, title, byArtist, datePublished, year: datePublished ? Number(datePublished.slice(0, 4)) : null,
    tracks: tracks.sort((a, b) => a.position - b.position),
    about: section("about", "credits|license|tags|supported by"),
    credits: section("credits", "license|tags|supported by|about"),
    capturedAt: page.capturedAt ?? page.fetchedAt ?? "", contentHash: page.contentHash,
  };
}

interface CatalogAlbum { id: number; title: string; year: number | null; type: string; aliases: string[]; tracks: Array<{ id: number; disc: number; position: number; title: string; duration: number | null }> }
export interface DiscographyRow {
  artistId: number; name: string; identity: "trayectoria" | "disco-en-comun" | "sin-confirmar" | "homonimo";
  matched: Array<{ albumId: number; title: string; url: string; catalogYear: number | null; sourceYear: number | null; datePublished: string | null;
    action: "sin-pistas" | "con-pistas"; tracks: BandcampTrack[]; durations: Array<{ trackId: number; position: number; title: string; durationSeconds: number }>;
    trackDiffs: string[] }>;
  missing: BandcampAlbum[];
  foreign: Array<{ url: string; title: string; byArtist: string }>;
}

async function catalogAlbums(artistId: number): Promise<CatalogAlbum[]> {
  return (await getPool().query(`SELECT al.id::int, al.title, al.release_year AS year, al.album_type::text AS type,
      coalesce((SELECT array_agg(alias) FROM ingest.album_aliases x WHERE x.album_id=al.id), '{}') AS aliases,
      coalesce((SELECT json_agg(json_build_object('id', t.id, 'disc', t.disc_number, 'position', t.track_number, 'title', t.title, 'duration', t.duration_seconds) ORDER BY t.disc_number, t.track_number) FROM public.tracks t WHERE t.album_id=al.id), '[]') AS tracks
    FROM public.albums al WHERE al.artist_id=$1`, [artistId])).rows as CatalogAlbum[];
}

async function main(): Promise<void> {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const trajectory = new Map<number, string>();
  if (existsSync(TRAJECTORY)) for (const line of readFileSync(TRAJECTORY, "utf8").split("\n").filter((l) => l.trim())) {
    const row = JSON.parse(line) as { artistId: number; result: { identity: string } };
    trajectory.set(row.artistId, row.result.identity);
  }
  const cases = [...loadCasesWithPages(CASE_DIRS).values()].filter((state) => !ONLY || ONLY.includes(state.artistId));
  const out: DiscographyRow[] = [];
  const totals = { fichas: 0, discosLeidos: 0, sinPistas: 0, pistasNuevas: 0, duraciones: 0, faltantes: 0, homonimos: 0, sinConfirmar: 0 };
  for (const state of cases) {
    const artist = (await getPool().query<{ name: string; aliases: string[] }>(`SELECT a.name, coalesce((SELECT array_agg(alias) FROM ingest.artist_aliases x WHERE x.artist_id=a.id), '{}') AS aliases FROM public.artists a WHERE a.id=$1`, [state.artistId])).rows[0];
    if (!artist) continue;
    const names = new Set([artist.name, ...artist.aliases].map(fold));
    const seen = new Set<string>();
    const albums: BandcampAlbum[] = [];
    const foreign: DiscographyRow["foreign"] = [];
    for (const page of state.pages) {
      const album = parseBandcampAlbum(page);
      if (!album || seen.has(fold(album.title))) continue;
      seen.add(fold(album.title));
      if (!names.has(fold(album.byArtist))) { foreign.push({ url: album.url, title: album.title, byArtist: album.byArtist }); continue; }
      albums.push(album);
    }
    if (!albums.length) continue;
    totals.discosLeidos += albums.length;
    const catalog = await catalogAlbums(state.artistId);
    const find = (album: BandcampAlbum) => catalog.find((item) => [item.title, ...item.aliases].some((title) => fold(title) === fold(album.title) || bare(title) === bare(album.title)));
    const verdict = trajectory.get(state.artistId);
    const inCommon = albums.some((album) => find(album));
    const identity: DiscographyRow["identity"] = verdict && verdict !== "same_artist" ? "homonimo" : verdict === "same_artist" ? "trayectoria" : inCommon ? "disco-en-comun" : "sin-confirmar";
    const row: DiscographyRow = { artistId: state.artistId, name: artist.name, identity, matched: [], missing: [], foreign };
    if (identity === "homonimo") { totals.homonimos += 1; out.push(row); continue; }
    if (identity === "sin-confirmar") totals.sinConfirmar += 1;
    for (const album of albums) {
      const match = find(album);
      if (!match) { row.missing.push(album); totals.faltantes += 1; continue; }
      const trackDiffs: string[] = [];
      const durations: DiscographyRow["matched"][number]["durations"] = [];
      if (match.tracks.length) {
        if (match.tracks.length !== album.tracks.length) trackDiffs.push(`catálogo ${match.tracks.length} pistas, Bandcamp ${album.tracks.length}`);
        for (const track of album.tracks) {
          const same = match.tracks.find((item) => fold(item.title) === fold(track.title));
          if (!same) { trackDiffs.push(`no está en el catálogo: ${track.position}. ${track.title}`); continue; }
          if (same.duration === null && track.durationSeconds) durations.push({ trackId: same.id, position: track.position, title: track.title, durationSeconds: track.durationSeconds });
        }
      }
      const action = match.tracks.length ? "con-pistas" : "sin-pistas";
      if (action === "sin-pistas" && album.tracks.length) { totals.sinPistas += 1; totals.pistasNuevas += album.tracks.length; }
      totals.duraciones += durations.length;
      row.matched.push({ albumId: match.id, title: match.title, url: album.url, catalogYear: match.year, sourceYear: album.year, datePublished: album.datePublished, action, tracks: album.tracks, durations, trackDiffs });
    }
    totals.fichas += 1;
    out.push(row);
  }
  writeFileSync(OUT, out.map((row) => JSON.stringify(row)).join("\n") + "\n");
  console.log(JSON.stringify(totals, null, 2));
}

/** Como loadCases, pero conserva todas las fichas con páginas (la discografía no depende de los hechos de la IA). */
function loadCasesWithPages(dirs: readonly string[]) {
  const byId = loadCases(dirs, { requireFacts: false }) as unknown as Map<number, { artistId: number; name: string; pages: Array<{ url: string; content: string; capturedAt?: string; fetchedAt?: string; contentHash: string }> }>;
  return byId;
}

if (process.argv[1]?.endsWith("cotejar-discografia.mts")) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
