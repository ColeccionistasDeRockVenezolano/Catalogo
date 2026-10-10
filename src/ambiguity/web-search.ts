import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import { z } from "zod";
import type { Pool } from "pg";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { pageImageResources, VISUAL_RESOURCES_MARKER } from "./page-images.js";
import { localArchivePage } from "./archive-records.js";

export interface SearchHit { url: string; title: string; snippet: string; engine: string; }
export interface WebPage { url: string; title: string; content: string; contentHash: string; fetchedAt: string; origin?: "page" | "search_snippet"; }
type Queryable = Pick<Pool, "query">;
const hitSchema = z.object({ url: z.string().url(), title: z.string().default(""), content: z.string().default(""), engine: z.string().default("searxng") });
const searchSchema = z.object({ results: z.array(hitSchema).default([]), unresponsive_engines: z.array(z.array(z.unknown())).default([]) });
// Los buscadores suspenden a SearXNG (CAPTCHA, 429) ante ráfagas: una consulta a la vez, espaciadas.
const SEARCH_GAP_MS = 1500;
const EXTRACTION_VERSION = "[Extracción de página v3]";
let searchQueue: Promise<unknown> = Promise.resolve();
let lastSearchAt = 0;

function clean(text: string): string { return text.replace(/\s+/gu, " ").trim(); }

function folded(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Los buscadores ignoran una frase entre comillas cuando les resulta rara («"Francisco González" "Niuno Niotro"
 * Venezuela» devolvía abogados y políticos). Primero los resultados que traen todas las frases.
 */
export function relevantFirst(query: string, hits: SearchHit[]): { hits: SearchHit[]; relevant: number } {
  const phrases = [...query.matchAll(/"([^"]+)"/gu)].map((match) => folded(match[1]!)).filter(Boolean);
  if (!phrases.length) return { hits, relevant: hits.length };
  const has = (hit: SearchHit) => { const text = ` ${folded(`${hit.title} ${hit.snippet} ${decodeURIComponent(hit.url).replace(/[-_/]/gu, " ")}`)} `;
    return phrases.every((phrase) => text.includes(` ${phrase} `)); };
  const good = hits.filter(has);
  return { hits: [...good, ...hits.filter((hit) => !has(hit))], relevant: good.length };
}

/**
 * Basura de plantilla que parece dato: Lobotoradio pone «Gordon 296» tras cada nombre
 * («José Romero Gordon 296»), y el modelo lo leía como apellido. Se quita al leer, también del caché.
 */
export function cleanPageContent(url: string, content: string): string {
  let host: string;
  try { host = new URL(url).hostname; } catch { return content; }
  if (host.endsWith("lobotoradio.com")) return content.replace(/ Gordon \d+(?= tipo:)/gu, "");
  return content;
}
function isSincopa(url: URL): boolean { return url.hostname === "sincopa.com" || url.hostname.endsWith(".sincopa.com"); }
function decodedHtml(bytes: Uint8Array, contentType: string, url: URL): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const declared = /charset\s*=\s*["']?([a-z\d_-]+)/iu.exec(contentType)?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?([a-z\d_-]+)/iu.exec(head)?.[1]
    ?? /<meta[^>]+content\s*=\s*["'][^"']*charset=([a-z\d_-]+)/iu.exec(head)?.[1];
  const preferred = declared ?? (isSincopa(url) ? "windows-1252" : "utf-8");
  try { return new TextDecoder(preferred, { fatal: true }).decode(bytes); }
  catch {
    if (isSincopa(url)) return new TextDecoder("windows-1252").decode(bytes);
    return new TextDecoder("utf-8").decode(bytes);
  }
}
export function decodeWebPage(bytes: Uint8Array, contentType: string, url: string): string {
  return decodedHtml(bytes, contentType, new URL(url));
}
function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(":")) return ip === "::" || ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("::ffff:");
  const p = ip.split(".").map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0]! >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1]! >= 64 && p[1]! <= 127);
}

/** Las páginas de resultados no pueden hacer que la API lea servicios internos. */
export async function assertPublicPageUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocolo de página no permitido");
  if (url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("URL de página no permitida");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) throw new Error("host interno no permitido");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("dirección interna no permitida");
  return url;
}

export class WebSearchBroker {
  constructor(private readonly db: Queryable = getPool(), private readonly searxngUrl = getEnv().CRV_SEARXNG_URL, private readonly fetcher = fetch) {}

  async search(query: string): Promise<SearchHit[]> {
    const q = clean(query).slice(0, 250);
    const cached = await this.db.query<{ results: SearchHit[]; stale: boolean }>(
      "SELECT results, fetched_at < now() - interval '6 hours' AS stale FROM ingest.person_web_search_cache WHERE query=$1 AND fetched_at > now()-($2::int * interval '1 day')", [q, getEnv().CRV_WEB_SEARCH_CACHE_DAYS]);
    const old = cached.rows[0];
    // Una respuesta guardada sin ningún resultado con las frases se vuelve a pedir (hay más buscadores que antes).
    if (old && (relevantFirst(q, old.results).relevant > 0 || !old.stale || !this.searxngUrl)) return relevantFirst(q, old.results).hits;
    if (!this.searxngUrl) return [];
    const endpoint = new URL("search", this.searxngUrl.endsWith("/") ? this.searxngUrl : `${this.searxngUrl}/`);
    endpoint.searchParams.set("q", q);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("language", "es");
    let hits: SearchHit[] = [];
    // Un buscador suspendido devuelve vacío: se espera y se reintenta una vez antes de rendirse.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const turn = searchQueue.then(async () => {
        const wait = lastSearchAt + SEARCH_GAP_MS * (attempt + 1) - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        try { return await this.fetcher(endpoint, { signal: AbortSignal.timeout(20000) }); } finally { lastSearchAt = Date.now(); }
      });
      searchQueue = turn.catch(() => undefined);
      const response = await turn;
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
        throw new Error(`SearXNG HTTP ${response.status}`);
      }
      const parsed = searchSchema.parse(await response.json());
      hits = parsed.results.slice(0, 12).map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.content, engine: hit.engine }));
      // Un vacío por buscadores suspendidos no es una respuesta: no se guarda, y se avisa.
      if (!hits.length && parsed.unresponsive_engines.length) {
        if (attempt === 0) continue;
        throw new Error(`SearXNG sin resultados: ${parsed.unresponsive_engines.map((engine) => engine.join(" ")).join("; ")}`);
      }
      break;
    }
    if (!hits.length) return old ? relevantFirst(q, old.results).hits : hits;
    await this.db.query(`INSERT INTO ingest.person_web_search_cache(query,engine,results) VALUES($1,'searxng',$2::jsonb)
      ON CONFLICT(query) DO UPDATE SET engine='searxng',results=EXCLUDED.results,fetched_at=now()`, [q, JSON.stringify(hits)]);
    return relevantFirst(q, hits).hits;
  }

  async page(rawUrl: string): Promise<WebPage | null> {
    const url = await assertPublicPageUrl(rawUrl);
    const cached = await this.db.query<{ url: string; title: string; content: string; content_hash: string; fetched_at: string }>(
      "SELECT url,title,content,content_hash,fetched_at::text FROM ingest.person_web_page_cache WHERE url=$1 AND fetched_at > now()-($2::int * interval '1 day')", [url.toString(), getEnv().CRV_WEB_PAGE_CACHE_DAYS]);
    if (cached.rows[0]) {
      const row = cached.rows[0];
      if (!row.content.includes("�") && row.content.includes(VISUAL_RESOURCES_MARKER) && row.content.includes(EXTRACTION_VERSION)) return { url: row.url, title: row.title, content: cleanPageContent(row.url, row.content), contentHash: row.content_hash, fetchedAt: row.fetched_at };
    }
    let current = url;
    let response: Response | null = null;
    try {
      for (let redirects = 0; redirects < 4; redirects += 1) {
        response = await this.fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "user-agent": getEnv().CRAWL_USER_AGENT, accept: "text/html,text/plain" } });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) return null;
          current = await assertPublicPageUrl(new URL(location, current).toString());
          continue;
        }
        break;
      }
    } catch { response = null; }
    let bytes: Uint8Array | null = null;
    let contentType = response?.headers.get("content-type") ?? "";
    if (response?.ok && !contentType.match(/^(?!text\/html|text\/plain)/iu) && Number(response.headers.get("content-length") ?? 0) <= 1_000_000) {
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes) {
      // Metal Archives, RYM o Discogs responden 403 a una descarga directa; si el proyecto ya
      // guardó esa página al ingerirla (ingest.raw_pages), se lee la copia guardada.
      const stored = await this.storedPage(url.toString());
      if (!stored) return null;
      bytes = stored.bytes; contentType = stored.contentType;
    }
    if (bytes.length > 1_000_000) return null;
    const body = decodedHtml(bytes, contentType, current);
    const $ = load(body);
    const visualResources = pageImageResources($, current.toString());
    $("script,style,nav,footer,header,noscript").remove();
    const title = clean($("title").first().text()).slice(0, 300);
    // Preserva el destino de enlaces de escucha y redes: el texto visible por sí
    // solo pierde el vínculo que permite comprobar un perfil oficial.
    const links: string[] = [];
    $("a[href]").each((_index, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      try {
        const destination = new URL(href, current);
        if (!/^https?:$/u.test(destination.protocol)) return;
        if (!/(?:instagram|facebook|twitter|x|tiktok|threads|bsky|spotify|bandcamp|soundcloud|youtube)\.com$|music\.apple\.com$/iu.test(destination.hostname) && !/\/(?:album|albums|disco|release|releases|discografia)\//iu.test(destination.pathname)) return;
        const link = `Enlace: ${clean($(element).text())} ${destination.toString()}`;
        if (!links.includes(link)) links.push(link);
      } catch { /* href no válido */ }
    });
    const content = cleanPageContent(url.toString(), clean($("body").text() || body).slice(0, 55_000) + (links.length ? ` Enlaces de la página: ${links.slice(0, 50).join(" · ")}` : "") + ` ${visualResources} ${EXTRACTION_VERSION}`);
    if (content.length < 100) return null;
    const contentHash = createHash("sha256").update(content).digest("hex");
    await this.db.query(`INSERT INTO ingest.person_web_page_cache(url,title,content,content_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(url) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,fetched_at=now()`, [url.toString(), title, content, contentHash]);
    return { url: url.toString(), title, content, contentHash, fetchedAt: new Date().toISOString() };
  }

  private async storedPage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const row = (await this.db.query<{ stored_path: string; content_type: string | null }>(
      `SELECT stored_path, content_type FROM ingest.raw_pages WHERE (url=$1 OR canonical_url=$1) AND http_status=200
        ORDER BY fetched_at DESC LIMIT 1`, [url])).rows[0];
    if (!row) {
      // Cosechas guardadas fuera de raw_pages (las páginas de músicos de Metal Archives).
      const local = localArchivePage(url);
      if (!local) return null;
      try { return { bytes: new Uint8Array(await readFile(local)), contentType: "text/html; charset=utf-8" }; } catch { return null; }
    }
    const root = resolve(getEnv().DATA_DIR);
    const path = resolve(join(root, row.stored_path));
    if (!path.startsWith(`${root}/`)) return null;
    try { return { bytes: new Uint8Array(await readFile(path)), contentType: row.content_type ?? "text/html" }; } catch { return null; }
  }
}
