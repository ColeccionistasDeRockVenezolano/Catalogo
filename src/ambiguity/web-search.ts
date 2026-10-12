import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Pool } from "pg";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { assertPublicPageUrl,publicPageFetch } from "../verification/documents/public-url.js";
export {assertPublicPageUrl} from "../verification/documents/public-url.js";
import { contentHash,recoverSourceCapture,preserveCapture,loadCapture,readCaptureOriginal,saveExtraction,ensureSourceSpace,SourceReadError,type SourceCapture } from "../verification/documents/capture.js";
import { extractDocument,readBoundedResponse } from "../verification/documents/reader.js";
import { needsRendering } from "../verification/documents/html.js";
import { renderDocument } from "../verification/documents/render.js";
import { DOCUMENT_EXTRACTION_VERSION,type DocumentMetadata,type DocumentReadOptions } from "../verification/documents/types.js";
import { localArchivePage } from "./archive-records.js";
import { type SourceProvenance, type AcquisitionMethod } from "../evidence/provenance.js";
import { rememberEvidenceDocument } from "../evidence/inventory.js";

export interface SearchHit { url: string; title: string; snippet: string; engine: string; capturedAt?: string | null; }
export interface WebPage extends SourceProvenance { url: string; title: string; content: string; contentHash: string; /** Compatibility alias for capturedAt; empty when unknown. */ fetchedAt: string; origin?: "page" | "search_snippet"; document?:DocumentMetadata; }
type Queryable = Pick<Pool, "query">;
const hitSchema = z.object({ url: z.string().url(), title: z.string().default(""), content: z.string().default(""), engine: z.string().default("searxng") });
const searchSchema = z.object({ results: z.array(hitSchema).default([]), unresponsive_engines: z.array(z.array(z.unknown())).default([]) });
// Los buscadores suspenden a SearXNG (CAPTCHA, 429) ante ráfagas: una consulta a la vez, espaciadas.
const SEARCH_GAP_MS = 1500;
const EXTRACTION_VERSION = `[Extracción de documento v${DOCUMENT_EXTRACTION_VERSION}]`;
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
export class WebSearchBroker {
  constructor(private readonly db: Queryable = getPool(), private readonly searxngUrl = getEnv().CRV_SEARXNG_URL, private readonly fetcher = fetch) {}

  async search(query: string): Promise<SearchHit[]> {
    const q = clean(query);
    const cached = await this.db.query<{ results: SearchHit[]; stale: boolean; captured_at: string }>(
      "SELECT results, fetched_at::text AS captured_at, fetched_at < now() - interval '6 hours' AS stale FROM ingest.person_web_search_cache WHERE query=$1 AND fetched_at > now()-($2::int * interval '1 day')", [q, getEnv().CRV_WEB_SEARCH_CACHE_DAYS]);
    const old = cached.rows[0];
    if (old) old.results = old.results.map(hit => ({ ...hit, capturedAt: hit.capturedAt ?? old.captured_at ?? null }));
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
      const capturedAt = new Date().toISOString();
      hits = parsed.results.map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.content, engine: hit.engine, capturedAt }));
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

  private async resource(raw:string):Promise<{response:Response;finalUrl:string}>{
    let url=await assertPublicPageUrl(raw);
    for(let index=0;index<5;index++){
      const response=this.fetcher===fetch?await publicPageFetch(url):await this.fetcher(url,{redirect:"manual",signal:AbortSignal.timeout(getEnv().CRV_RESEARCH_RENDER_TIMEOUT_MS),headers:{"user-agent":getEnv().CRAWL_USER_AGENT,accept:"text/html,application/json,application/pdf,image/*,text/plain"}});
      if(response.status>=300&&response.status<400){
        await response.body?.cancel();
        const location=response.headers.get("location");if(!location)throw new SourceReadError("La redirección no informa su destino.","inaccessible");
        url=await assertPublicPageUrl(new URL(location,url).href);continue;
      }
      return {response,finalUrl:url.href};
    }
    throw new SourceReadError("Se excedió el límite de redirecciones de la fuente.","inaccessible");
  }
  async page(rawUrl:string,options:DocumentReadOptions={}):Promise<WebPage|null>{
    const url=await assertPublicPageUrl(rawUrl);
    const cached=(await this.db.query<{url:string;title:string;content:string;content_hash:string;captured_at:string|null;acquisition_method:AcquisitionMethod;document_metadata:DocumentMetadata|null}>(
      "SELECT url,title,content,content_hash,captured_at::text,acquisition_method,document_metadata FROM ingest.person_web_page_cache WHERE url=$1 AND fetched_at>now()-($2::int*interval '1 day')",[url.href,getEnv().CRV_WEB_PAGE_CACHE_DAYS])).rows[0];
    let capture:SourceCapture|null=null;
    if(cached?.document_metadata){
      capture=await loadCapture(this.db,cached.document_metadata.captureId);
      if(capture){
        if(capture.rawHash!==cached.document_metadata.rawHash||capture.url!==url.href)throw new SourceReadError("El original no coincide con la versión del documento en caché.","failed",capture.id);
        await readCaptureOriginal(capture);
        if(cached.document_metadata.complete&&cached.document_metadata.extractionVersion===DOCUMENT_EXTRACTION_VERSION){
          const readAt=new Date().toISOString(),content=cleanPageContent(url.href,cached.content);
          const page:WebPage={url:url.href,title:cached.title,content,contentHash:contentHash(content),fetchedAt:cached.captured_at??"",capturedAt:cached.captured_at,readAt,acquisitionMethod:cached.acquisition_method,document:cached.document_metadata};
          await this.db.query("UPDATE ingest.person_web_page_cache SET read_at=$2::timestamptz WHERE url=$1",[url.href,readAt]);await rememberEvidenceDocument(this.db,page);return page;
        }
        if(!capture.complete)capture=null;
      }
    }
    if(!capture)capture=await recoverSourceCapture(this.db,url.href);
    if(!capture){
      await ensureSourceSpace();
      let response:Response|null=null,error:string|null=null,finalUrl=url.href;
      try{const fetched=await this.resource(url.href);response=fetched.response;finalUrl=fetched.finalUrl;}catch(cause){error=cause instanceof Error?cause.message:"Error de red";}
      if(response){
        const downloaded=await readBoundedResponse(response);
        capture=await preserveCapture(this.db,{url:url.href,finalUrl,contentType:response.headers.get("content-type")??"application/octet-stream",capturedAt:new Date().toISOString(),method:"http",status:response.status,complete:downloaded.complete,reason:downloaded.reason,parentId:null},downloaded.bytes);
        if(!response.ok)error=`HTTP ${response.status}`;
      }
      if(!capture||error){
        const archived=await this.storedPage(url.href);
        if(!archived){throw new SourceReadError(error??"No se obtuvo una fuente legible.","inaccessible",capture?.id);}
        capture=await preserveCapture(this.db,{url:url.href,finalUrl:url.href,contentType:archived.contentType,capturedAt:archived.capturedAt,method:archived.acquisitionMethod,status:200,complete:true,reason:null,parentId:null},archived.bytes);
      }
    }
    const bytes=await readCaptureOriginal(capture);
    const checkpoint:NonNullable<DocumentReadOptions["checkpoint"]>=async extraction=>{
      await saveExtraction(this.db,capture!,extraction);await options.checkpoint?.(extraction);
    };
    let extraction;
    try{extraction=await extractDocument(bytes,capture.contentType,capture.finalUrl,decodeWebPage,{...options,...(capture.extraction?{resume:capture.extraction}:{}),checkpoint});}
    catch(cause){throw new SourceReadError(`Lectura pendiente del original ${capture.id}: ${cause instanceof Error?cause.message:"Error de extracción"}`,"failed",capture.id);}
    if(extraction.format==="html"&&needsRendering(decodeWebPage(bytes,capture.contentType,capture.finalUrl),extraction)){
      if(getEnv().CRV_RESEARCH_RENDER_ENABLED){
        try{
          const rendered=await renderDocument(capture.finalUrl,decodeWebPage(bytes,capture.contentType,capture.finalUrl),async raw=>(await this.resource(raw)).response);
          if(!rendered.acquired)throw new Error(rendered.warnings.join("; "));
          const parent=capture.id,parentKey=capture.key;
          capture=await preserveCapture(this.db,{url:url.href,finalUrl:capture.finalUrl,contentType:"text/html; charset=utf-8",capturedAt:new Date().toISOString(),method:"rendered",status:200,complete:rendered.complete,reason:rendered.complete?null:rendered.warnings.join("; "),parentId:parent,parentKey},Buffer.from(rendered.html,"utf8"));
          extraction=await extractDocument(Buffer.from(rendered.html),capture.contentType,capture.finalUrl,decodeWebPage,options);
          extraction.format="rendered_html";extraction.method="rendered_dom";extraction.complete&&=rendered.complete;extraction.warnings.push(...rendered.warnings);
          if(!rendered.complete)extraction.unreadParts.push("Renderizado pendiente de completar");
        }catch(cause){extraction.complete=false;extraction.unreadParts.push(`Renderizado pendiente: ${cause instanceof Error?cause.message:"Error de navegador"}`);}
      }else{extraction.complete=false;extraction.unreadParts.push("La fuente requiere renderizado; el lector de navegador está deshabilitado.");}
    }
    if(!capture.complete){extraction.complete=false;extraction.unreadParts.push(capture.reason??"La captura original quedó incompleta.");}
    await saveExtraction(this.db,capture,extraction);
    const content=cleanPageContent(url.href,`${extraction.content}\n${EXTRACTION_VERSION}`),readAt=new Date().toISOString();
    const method:AcquisitionMethod=capture.method==="rendered"?"http":capture.method;
    // The existing source-template correction removes bytes. Translate the
    // transcript ranges through those removals instead of keeping stale offsets.
    const originalText=`${extraction.content}\n${EXTRACTION_VERSION}`;
    const removed:Array<{start:number;end:number}>=[];
    if(content!==originalText)for(const match of originalText.matchAll(/ Gordon \d+(?= tipo:)/gu)){
      const start=Buffer.byteLength(originalText.slice(0,match.index),"utf8");removed.push({start,end:start+Buffer.byteLength(match[0],"utf8")});
    }
    const translated=(offset:number)=>offset-removed.reduce((sum,range)=>sum+Math.max(0,Math.min(offset,range.end)-range.start),0);
    const locations=extraction.locations.map(location=>({...location,start:translated(location.start),end:translated(location.end)})).filter(location=>location.end>location.start);
    const document:DocumentMetadata={captureId:capture.id,rawHash:capture.rawHash,format:extraction.format,method:extraction.method,extractionVersion:extraction.version,complete:extraction.complete,unreadParts:extraction.unreadParts,warnings:extraction.warnings,locations,followLinks:extraction.followLinks};
    const page:WebPage={url:url.href,title:extraction.title,content,contentHash:contentHash(content),fetchedAt:capture.capturedAt??"",capturedAt:capture.capturedAt,readAt,acquisitionMethod:method,document};
    await this.db.query(`INSERT INTO ingest.person_web_page_cache(url,title,content,content_hash,captured_at,read_at,acquisition_method,document_metadata) VALUES($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8::jsonb)
      ON CONFLICT(url) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,fetched_at=now(),captured_at=EXCLUDED.captured_at,read_at=EXCLUDED.read_at,acquisition_method=EXCLUDED.acquisition_method,document_metadata=EXCLUDED.document_metadata`,[page.url,page.title,page.content,page.contentHash,capture.capturedAt,readAt,method,JSON.stringify(document)]);
    await rememberEvidenceDocument(this.db,page);return page;
  }

  private async storedPage(url: string): Promise<{ bytes: Uint8Array; contentType: string; capturedAt: string | null; acquisitionMethod: "raw_archive"|"local_archive" } | null> {
    const row = (await this.db.query<{ stored_path: string; content_type: string | null; captured_at: string | null; sha256: string }>(
      `SELECT stored_path, content_type, fetched_at::text AS captured_at, sha256 FROM ingest.raw_pages WHERE (url=$1 OR canonical_url=$1) AND http_status=200
        ORDER BY fetched_at DESC LIMIT 1`, [url])).rows[0];
    if (!row) {
      // Cosechas guardadas fuera de raw_pages (las páginas de músicos de Metal Archives).
      const local = localArchivePage(url);
      if (!local) return null;
      try { return { bytes: new Uint8Array(await readFile(local)), contentType: "text/html; charset=utf-8", capturedAt: null, acquisitionMethod: "local_archive" }; } catch { return null; }
    }
    const root = resolve(getEnv().DATA_DIR);
    const path = resolve(join(root, row.stored_path));
    if (!path.startsWith(`${root}/`)) return null;
    try {
      const bytes = new Uint8Array(await readFile(path));
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return null;
      return { bytes, contentType: row.content_type ?? "text/html", capturedAt: row.captured_at ?? null, acquisitionMethod: "raw_archive" };
    } catch { return null; }
  }
}
