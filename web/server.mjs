// CRV · gateway de producción mínimo para publicar la SPA bajo un prefijo
// Tailscale Funnel. Mantiene Fastify y PostgreSQL en loopback: solamente
// reenvía /crv/api/* al API local y sirve el build público de Vite
// (`dist-public/`, el de `npm run build:public`) en /crv/*. El build de
// verificación (`npm run build`) escribe `dist/` y NO toca lo publicado.
//
// Endurecimiento 2026-10-13 (anti-scraping y picos de tráfico):
// - Techo de solicitudes por IP y minuto (CRV_WEB_RATE_LIMIT, 0 lo apaga);
//   el tráfico local sin X-Forwarded-For (pruebas) no se limita.
// - Las imágenes llevan caché larga + ETag/304 (antes: 5 minutos, o sea que
//   cada visita repercutía el mismo tráfico de portadas).
// - robots.txt y sitemap.xml dinámicos, con el host real que ven los
//   buscadores (Funnel hoy, un dominio propio cuando se monte).
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(directory, "dist-public");
const media = path.join(directory, "public", "media");
const host = process.env.CRV_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.CRV_WEB_PORT ?? "3120");
const apiHost = process.env.CRV_API_HOST ?? "127.0.0.1";
const apiPort = Number(process.env.CRV_API_PORT ?? "8080");
const basePath = `/${(process.env.CRV_PUBLIC_PATH ?? "crv").replace(/^\/+|\/+$/g, "")}`;
const apiPath = `${basePath}/api`;

// Techo por IP y minuto para TODO lo que sirve el gateway (estáticos, media y
// el proxy al API). Holgado para navegación humana (una ficha son ~20
// solicitudes) y estrecho para un volcado: recorrer las 18.000 imágenes pasa
// de segundos a horas. Una var mal escrita no lo apaga en silencio.
const configuredRateLimit = Number(process.env.CRV_WEB_RATE_LIMIT ?? "1200");
const requestsPerMinute = Number.isFinite(configuredRateLimit) ? configuredRateLimit : 1200;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 5_000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function reply(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
  res.end(text);
}

/** Ruta pública bajo el prefijo montado (basePath puede ser «/»). */
function publicPath(sub) {
  return basePath === "/" ? sub : `${basePath}${sub}`;
}

/**
 * IP de la conexión para el techo por IP: la ÚLTIMA entrada del
 * X-Forwarded-For (la añade el Funnel). El cliente puede inventar entradas
 * previas; la última la escribe el hop de confianza y no se puede falsear.
 */
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1].trim();
    if (last.length > 0) return last;
  }
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/** Tráfico local de pruebas (sin proxy delante): fuera del techo. */
function isLocalRequest(req) {
  if (req.headers["x-forwarded-for"] !== undefined) return false;
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

const rateBuckets = new Map();
function rateLimited(ip) {
  if (requestsPerMinute <= 0) return false;
  const now = Date.now();
  const entry = rateBuckets.get(ip);
  if (!entry || entry.resetAt <= now) {
    if (!entry && rateBuckets.size >= MAX_RATE_KEYS) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest !== undefined) rateBuckets.delete(oldest);
    }
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > requestsPerMinute;
}

// Rutas de trabajo que no deben rastrearse (el API las protege y la SPA las
// pide tras el login; aquí se declaran para los buscadores). NO se bloquea
// /api/* entero: el render de la SPA depende de las lecturas públicas.
const ROBOTS_DISALLOW = [
  "/api/review-queue", "/api/audit", "/api/curation", "/api/runs/",
  "/api/changes", "/api/claims", "/api/sources", "/api/credit-sources",
  "/api/catalog-model", "/api/catalog-links", "/api/evidence-inventory",
  "/api/discovery", "/api/entity-verification",
  "/curaduria",
];
const SITEMAP_TTL_MS = 60 * 60 * 1000;
/** kind del sitemap (ruta) → grupos de ids del API. */
const SITEMAP_CHILDREN = {
  "/sitemap-catalogo.xml": ["artists", "albums"],
  "/sitemap-personas.xml": ["persons"],
};
let sitemapIdsCache; // { value, expiresAt } — una sola fuente para los hijos
const sitemapXmlCache = new Map(); // `${origin}|${path}` → { body, expiresAt }

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function originOf(req) {
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${hostHeader}`;
}

function robotsBody(req) {
  const lines = ["User-agent: *"];
  for (const sub of ROBOTS_DISALLOW) lines.push(`Disallow: ${publicPath(sub)}`);
  lines.push("Allow: /", "", `Sitemap: ${originOf(req)}${publicPath("/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
}

/** Ids de las fichas públicas desde el API (cache 1 h aquí también). */
async function sitemapIds() {
  if (sitemapIdsCache && sitemapIdsCache.expiresAt > Date.now()) return sitemapIdsCache.value;
  const response = await fetch(`http://${apiHost}:${apiPort}/sitemap-ids`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`la API respondió ${response.status}`);
  sitemapIdsCache = { value: await response.json(), expiresAt: Date.now() + SITEMAP_TTL_MS };
  return sitemapIdsCache.value;
}

function sitemapIndexBody(req) {
  const origin = originOf(req);
  const items = Object.keys(SITEMAP_CHILDREN)
    .map((sub) => `<sitemap><loc>${xmlEscape(origin + publicPath(sub))}</loc></sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

async function sitemapChildBody(req, childPath) {
  const origin = originOf(req);
  const cacheKey = `${origin}|${childPath}`;
  const cached = sitemapXmlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const ids = await sitemapIds();
  const prefix = { artists: "/artistas/", albums: "/discos/", persons: "/personas/" };
  const urls = [];
  for (const group of SITEMAP_CHILDREN[childPath]) {
    for (const id of ids[group] ?? []) urls.push(`${origin}${publicPath(prefix[group])}${id}`);
  }
  const items = urls.map((loc) => `<url><loc>${xmlEscape(loc)}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
  sitemapXmlCache.set(cacheKey, { body, expiresAt: Date.now() + SITEMAP_TTL_MS });
  return body;
}

function sendText(req, res, status, contentType, body, cacheControl) {
  res.writeHead(status, {
    "content-type": contentType,
    ...(body === undefined ? {} : { "content-length": Buffer.byteLength(body) }),
    ...(cacheControl ? { "cache-control": cacheControl } : {}),
    ...SECURITY_HEADERS,
  });
  if (req.method === "HEAD" || body === undefined) return res.end();
  res.end(body);
}

function proxyApi(req, res, requestUrl) {
  const upstreamPath = `${requestUrl.pathname.slice(apiPath.length) || "/"}${requestUrl.search}`;
  const upstream = http.request({
    host: apiHost,
    port: apiPort,
    method: req.method,
    path: upstreamPath,
    headers: {
      ...req.headers,
      host: `${apiHost}:${apiPort}`,
      "x-forwarded-host": req.headers.host,
      "x-forwarded-proto": "https",
    },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, { ...upstreamResponse.headers, ...SECURITY_HEADERS });
    upstreamResponse.pipe(res);
  });
  upstream.on("error", () => reply(res, 502, "La API CRV no está disponible."));
  req.pipe(upstream);
}

async function serveFile(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405, "Método no permitido.");
  let relativePath;
  try { relativePath = decodeURIComponent(pathname.slice(basePath.length)).replace(/^\/+/, ""); }
  catch { return reply(res, 400, "Ruta inválida."); }
  if (relativePath.split("/").includes("..")) return reply(res, 403, "Ruta no permitida.");

  // Las imágenes canónicas viven en public/media. Vite vacía y reconstruye
  // dist-public en cada publicación; servirlas desde ese build deja solicitudes
  // sin archivo (o con una copia aún en curso) mientras se publica.
  const isMedia = relativePath === "media" || relativePath.startsWith("media/");
  const requested = isMedia
    ? path.join(media, relativePath.slice("media".length))
    : path.join(dist, relativePath || "index.html");
  let file = requested;
  let fileStat;
  try {
    fileStat = await stat(file);
    if (!fileStat.isFile()) throw new Error("not-a-file");
  } catch {
    // Las rutas del router de React no son archivos: devuelven la SPA.
    if (isMedia || path.extname(relativePath)) return reply(res, 404, "Archivo no encontrado.");
    file = path.join(dist, "index.html");
    try { fileStat = await stat(file); }
    catch { return reply(res, 503, "La aplicación no está disponible."); }
  }

  const ext = path.extname(file).toLowerCase();
  // ETag barato (tamaño + mtime): revalidar no cuesta releer la imagen.
  const etag = `W/"${fileStat.size.toString(16)}-${Math.round(fileStat.mtimeMs).toString(16)}"`;
  const cacheControl = isMedia
    // Las imágenes del catálogo casi nunca cambian: antes valían 5 minutos y
    // cada visita repercutía las mismas portadas. El revalidate diario corrige
    // una portada reemplazada.
    ? "public, max-age=604800, stale-while-revalidate=86400"
    : file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable"
      : "no-cache";
  const ifNoneMatch = req.headers["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch.split(",").some((value) => value.trim() === etag)) {
    res.writeHead(304, { etag, "cache-control": cacheControl, ...SECURITY_HEADERS });
    return res.end();
  }
  res.writeHead(200, {
    "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
    "content-length": fileStat.size,
    etag,
    "last-modified": fileStat.mtime.toUTCString(),
    "cache-control": cacheControl,
    ...SECURITY_HEADERS,
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).on("error", (error) => res.destroy(error)).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  if (ip.length > 0 && !isLocalRequest(req) && rateLimited(ip)) {
    res.writeHead(429, { "content-type": "text/plain; charset=utf-8", "retry-after": "60", ...SECURITY_HEADERS });
    res.end("Demasiadas solicitudes desde esta conexión. Espera un minuto y vuelve a intentarlo.");
    return;
  }
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
  // Funnel elimina el prefijo configurado antes de enviar la petición al
  // destino local. Para pruebas directas también aceptamos la ruta completa.
  const virtualPath = requestUrl.pathname === basePath || requestUrl.pathname.startsWith(`${basePath}/`)
    ? requestUrl.pathname
    : `${basePath}${requestUrl.pathname}`;
  const virtualUrl = new URL(requestUrl);
  virtualUrl.pathname = virtualPath;
  if (virtualUrl.pathname === apiPath || virtualUrl.pathname.startsWith(`${apiPath}/`)) return proxyApi(req, res, virtualUrl);
  // robots.txt y sitemap los sirve el gateway, no el build: responden con el
  // host real que ve el buscador (hoy el Funnel; mañana el dominio propio).
  const literalPath = virtualUrl.pathname === basePath ? "/" : virtualUrl.pathname.slice(basePath.length);
  if (req.method === "GET" || req.method === "HEAD") {
    if (literalPath === "/robots.txt") return sendText(req, res, 200, "text/plain; charset=utf-8", robotsBody(req), "public, max-age=3600");
    try {
      if (literalPath === "/sitemap.xml") {
        return sendText(req, res, 200, "application/xml; charset=utf-8", sitemapIndexBody(req), "public, max-age=3600");
      }
      if (Object.hasOwn(SITEMAP_CHILDREN, literalPath)) {
        return sendText(req, res, 200, "application/xml; charset=utf-8", await sitemapChildBody(req, literalPath), "public, max-age=3600");
      }
    } catch {
      return sendText(req, res, 503, "text/plain; charset=utf-8", "El sitemap no está disponible.", "no-store");
    }
  }
  // El basename del router de React exige la barra final: sin redirect la
  // app carga (el gateway sirve index.html igual) pero queda en blanco
  // porque el pathname "/crv" no matchea el basename "/crv/".
  if (virtualUrl.pathname === basePath && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(301, { location: `${basePath}/${requestUrl.search}` });
    return res.end();
  }
  return serveFile(req, res, virtualUrl.pathname);
});

server.listen(port, host, () => console.log(`CRV público local: http://${host}:${port}${basePath}/`));
server.on("error", (error) => { console.error(error); process.exitCode = 1; });
