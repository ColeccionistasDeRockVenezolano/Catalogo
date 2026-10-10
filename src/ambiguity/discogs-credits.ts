// Créditos de Discogs para verificar personas (2026-10-06). Cada crédito de una edición apunta a un artista
// de Discogs con número propio, y su perfil suele decir quién es («Venezuelan recording engineer», nombre
// real, padre de…). Con eso cada ficha queda documentada con lo suyo y hay hechos que citar.
//
// Discogs también junta homónimos: su «Francisco González» sin número es el ingeniero de Fidelis según el
// perfil, pero tiene acreditada además la guitarra de Recoveco. Por eso estas páginas documentan y aportan
// hechos, pero que una sola página de Discogs liste créditos de las dos fichas NO prueba que sean la misma
// persona (lo decide person-web-verification).
import { createHash } from "node:crypto";
import { getPool } from "../db/client.js";
import { sourceAuthHeaders } from "../genres/external/adapters.js";
import { createRateLimitedFetcher, fetchCachedJson, type FetchContext, type JsonFetcher } from "../genres/external/http.js";
import type { WebPage } from "./web-search.js";

const BASE = "https://api.discogs.com";
const MAX_ALBUMS = 6;
const MAX_ARTISTS = 3;

export interface DiscogsProject { name: string; album?: string | null; year: number | null; }
interface Credit { id: number; name: string; role: string; project: string; album: string; year: number | null; }

let fetcher: JsonFetcher | null = null;

export function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s*\(\d+\)\s*$/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Texto del perfil sin el marcado de Discogs: «[a2798944]» → «otro artista», «[l379649]» → «un sello», [url=…]x[/url] → x. */
export function profileText(profile: string): string {
  return profile.replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gu, "$1").replace(/\[a=([^\]]+)\]/gu, "$1").replace(/\[l=([^\]]+)\]/gu, "$1")
    .replace(/\[a\d+\]/gu, "otro artista").replace(/\[l\d+\]/gu, "un sello").replace(/\[\/?[biu]\]/gu, "")
    .replace(/\s+/gu, " ").trim();
}

/** Discos de la ficha repartidos entre sus artistas (no seis del mismo), sin recopilatorios. */
function pickAlbums(projects: readonly DiscogsProject[]): DiscogsProject[] {
  const byArtist = new Map<string, DiscogsProject[]>();
  for (const item of projects) {
    if (!item.album || item.name === "Various Artists") continue;
    const list = byArtist.get(item.name) ?? [];
    if (!list.some((old) => old.album === item.album)) list.push(item);
    byArtist.set(item.name, list);
  }
  const picked: DiscogsProject[] = [];
  for (let round = 0; picked.length < MAX_ALBUMS && round < MAX_ALBUMS; round += 1) {
    for (const list of byArtist.values()) if (list[round] && picked.length < MAX_ALBUMS) picked.push(list[round]!);
  }
  return picked;
}

interface Named { id?: number; name?: string; anv?: string; role?: string; }

/**
 * Páginas de Discogs de quien firma los créditos de la ficha en sus discos: una por artista de Discogs,
 * con su nombre, nombre real, perfil y los créditos encontrados. `forms` son las formas del nombre de la ficha.
 * Sin token o sin red devuelve lo que haya en caché.
 */
export interface DiscogsArtistPage { page: WebPage; projects: string[]; }

export async function discogsPages(forms: readonly string[], projects: readonly DiscogsProject[]): Promise<DiscogsArtistPage[]> {
  let headers: Record<string, string>;
  try { headers = { ...sourceAuthHeaders("discogs"), "user-agent": "CRV-Coleccionistas/1.0" }; } catch { return []; }
  const wanted = new Set(forms.map(fold));
  const matches = (name: string | undefined) => Boolean(name) && wanted.has(fold(name!));
  const pool = getPool();
  const source = (await pool.query<{ id: string }>("SELECT id::text FROM ingest.genre_external_sources WHERE slug='discogs'")).rows[0];
  if (!source) return [];
  const client = await pool.connect();
  fetcher ??= createRateLimitedFetcher(50, { maxRetries: 2 });
  const context: FetchContext = { client, sourceId: Number(source.id), fetcher, headers, ttlDays: 365 };
  const get = async (key: string, url: string): Promise<Record<string, unknown> | null> => {
    try { return (await fetchCachedJson(context, key.slice(0, 300), url)).payload as Record<string, unknown>; } catch { return null; }
  };
  try {
    const credits: Credit[] = [];
    for (const album of pickAlbums(projects)) {
      const search = await get(`person:release-search:${fold(album.name)}:${fold(album.album!)}`,
        `${BASE}/database/search?type=release&per_page=5&artist=${encodeURIComponent(album.name)}&release_title=${encodeURIComponent(album.album!)}`);
      // Solo ediciones de ese artista con ese título («Artista - Título»), no parecidas.
      const results = ((search?.["results"] ?? []) as Array<{ id?: number; title?: string }>)
        .filter((result) => result.id && fold(result.title ?? "") === `${fold(album.name)} ${fold(album.album!)}`).slice(0, 2);
      for (const result of results) {
        const release = await get(`person:release:${result.id}`, `${BASE}/releases/${result.id}`);
        if (!release) continue;
        const tracks = (release["tracklist"] ?? []) as Array<{ extraartists?: Named[] }>;
        const named = [...((release["extraartists"] ?? []) as Named[]), ...tracks.flatMap((track) => track.extraartists ?? [])];
        for (const person of named) {
          if (!person.id || !(matches(person.name) || matches(person.anv))) continue;
          credits.push({ id: person.id, name: person.name!, role: person.role ?? "", project: album.name, album: album.album!, year: album.year });
        }
      }
    }
    const counts = new Map<number, number>();
    for (const credit of credits) counts.set(credit.id, (counts.get(credit.id) ?? 0) + 1);
    const ids = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, MAX_ARTISTS).map(([id]) => id);
    const pages: DiscogsArtistPage[] = [];
    for (const id of ids) {
      const artist = await get(`person:artist:${id}`, `${BASE}/artists/${id}`);
      const name = String(artist?.["name"] ?? credits.find((credit) => credit.id === id)!.name);
      const realName = typeof artist?.["realname"] === "string" ? artist["realname"] : "";
      let raw = typeof artist?.["profile"] === "string" ? artist["profile"] : "";
      // «father of [a2798944]»: el nombre del otro artista es justo el dato (padre de quién).
      for (const ref of [...new Set([...raw.matchAll(/\[a(\d+)\]/gu)].map((match) => match[1]!))].slice(0, 4)) {
        const other = await get(`person:artist:${ref}`, `${BASE}/artists/${ref}`);
        if (typeof other?.["name"] === "string") raw = raw.replaceAll(`[a${ref}]`, other["name"].replace(/\s*\(\d+\)$/u, ""));
      }
      const profile = profileText(raw);
      const variations = Array.isArray(artist?.["namevariations"]) ? (artist["namevariations"] as string[]).join(", ") : "";
      const seen = new Set<string>();
      const lines = credits.filter((credit) => credit.id === id).flatMap((credit) => {
        const line = `${credit.role} – ${credit.project} – ${credit.album}${credit.year ? ` (${credit.year})` : ""}`;
        if (seen.has(line)) return [];
        seen.add(line);
        return [line];
      });
      const content = [`${name}.`, realName ? `Real Name: ${realName}.` : "", profile ? `Profile: ${profile}` : "",
        variations ? `Variations: ${variations}.` : "", `Credits: ${lines.join("; ")}.`].filter(Boolean).join(" ");
      pages.push({ page: { url: `https://www.discogs.com/artist/${id}`, title: `${name} | Discogs`, content,
        contentHash: createHash("sha256").update(content).digest("hex"), fetchedAt: new Date().toISOString() },
      projects: [...new Set(credits.filter((credit) => credit.id === id).map((credit) => credit.project))] });
    }
    return pages;
  } finally { client.release(); }
}
