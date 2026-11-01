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
//
// Imágenes optimizadas 2026-10-14: `/crv/media/…?w=320` sirve una copia WebP
// reducida (media-variants.mjs). Si aún no existe se entrega el original y la
// copia se encarga en segundo plano al optimizador de BrandForge.
import net from "node:net";
import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MEDIA_WIDTHS, OPTIMIZABLE_EXTENSIONS, optimizerAvailable, optimizerCommand, runOptimizer, variantPath } from "./media-variants.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const webMode = process.env.CRV_WEB_MODE ?? "catalog";
if (webMode !== "catalog" && webMode !== "landing") {
  throw new Error(`CRV_WEB_MODE inválido: ${webMode}. Valores: catalog | landing.`);
}
const redirectUnprefixed = process.env.CRV_WEB_REDIRECT_UNPREFIXED === "1"
  || process.env.CRV_WEB_REDIRECT_UNPREFIXED === "true";
const dist = path.join(directory, process.env.CRV_WEB_DIST ?? "dist-public");
const media = path.join(directory, "public", "media");
const host = process.env.CRV_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.CRV_WEB_PORT ?? "3120");
const apiHost = process.env.CRV_API_HOST ?? "127.0.0.1";
const apiPort = Number(process.env.CRV_API_PORT ?? "8080");
// El chat corre en su propio proceso: /api/chat/* y su WebSocket van allí.
const chatPort = Number(process.env.CRV_CHAT_PORT ?? "8081");
const basePath = `/${(process.env.CRV_PUBLIC_PATH ?? "crv").replace(/^\/+|\/+$/g, "")}`;
// En la raíz el API vive en `/api` (las portadas llaman a `api/...` relativas a
// `<base href="/">`); bajo `/crv`, en `/crv/api`.
const apiPath = basePath === "/" ? "/api" : `${basePath}/api`;
const landingCache = new Map();

async function serveLanding(req, res, page, lang, searchParams) {
  const prefix = basePath === "/" ? "" : basePath;
  const key = `${page}:${lang}`;
  const token = (page === "registro" || page === "activar") ? searchParams.get("token") : null;
  const cookie = req.headers.cookie;
  const privateResponse = Boolean(token || cookie);
  let entry = privateResponse ? undefined : landingCache.get(key);
  if (!entry || entry.expires < Date.now()) {
    try {
      const params = new URLSearchParams({ lang });
      if (token) params.set("token", token);
      const response = await fetch(`http://${apiHost}:${apiPort}/landing/${page}?${params}`, {
        signal: AbortSignal.timeout(5000), ...(cookie ? { headers: { cookie } } : {}),
      });
      if (response.status === 404) return reply(res, 404, "Página no disponible.");
      if (!response.ok) throw new Error(`API ${response.status}`);
      entry = { html: await response.text(), expires: Date.now() + 30_000 };
      if (!privateResponse) landingCache.set(key, entry);
    } catch {
      return serveFile(req, res, `${prefix}/landing/${page}-${lang}.html`, searchParams);
    }
  }
  const baseHref = prefix ? `${prefix}/` : "/";
  let html = entry.html.replace("<head>", `<head><base href="${baseHref}"><meta name="crv-api-base" content="${apiPath}">`)
    .replaceAll("/static/", `${prefix}/landing/`)
    .replaceAll('data-visits-url="/api/visit"', `data-visits-url="${apiPath}/roadmap/visit"`)
    .replaceAll('data-presence-url="/api/presence"', "")
    .replaceAll('"/api/', `"${apiPath}/`)
    .replaceAll("/media/favicon?", `${apiPath}/landing-media/favicon?`)
    .replaceAll("/media/share?", `${apiPath}/landing-media/share?`)
    .replaceAll('href="/theme.css"', `href="${prefix}/landing/theme.css"`)
    .replaceAll('href="/register"', `href="${prefix}/registro"`)
    .replaceAll('href="/account"', `href="${prefix}/cuenta"`)
    .replaceAll('href="/admin"', `href="${prefix}/curaduria/roadmap"`)
    .replaceAll('href="/login"', `href="${prefix}/login"`)
    .replaceAll('href="/colaborar"', `href="${prefix}/colaborar"`)
    .replaceAll('href="/"', `href="${prefix}/roadmap"`)
    .replaceAll('href="/roadmap?', `href="${prefix}/roadmap?`)
    .replaceAll('href="/colaborar?', `href="${prefix}/colaborar?`)
    .replaceAll('href="/login?', `href="${prefix}/login?`)
    .replaceAll('href="/registro?', `href="${prefix}/registro?`)
    .replaceAll('href="/activar?', `href="${prefix}/activar?`);
  html = html.replace(/<li><a(?: class="[^"]*")? href="\/kanban">[\s\S]*?<\/a><\/li>/g, "");
  const scripts = page === "login" ? ["login.js"] : page === "colaborar" ? ["collaborate-submit.js", "landing-session.js"] : page === "roadmap" ? ["roadmap-collab.js", "landing-session.js", "visits-mobile.js"] : ["registro-activar.js"];
  html = html.replace("</body>", `${scripts.map((src) => `<script src="${prefix}/landing/${src}" defer></script>`).join("")}</body>`);
  const body = Buffer.from(html);
  res.writeHead(200, { "content-type": MIME_TYPES[".html"], "content-length": body.length, "cache-control": privateResponse ? "no-store" : "no-cache", ...SECURITY_HEADERS });
  return res.end(req.method === "HEAD" ? undefined : body);
}

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
  // `base-uri 'self'`: las portadas insertan <base href="/crv/"> para que sus
  // rutas relativas resuelvan siempre bajo el prefijo. `base-uri 'none'`
  // bloqueaba esa etiqueta (y con ella document.baseURI), así que se permite
  // el mismo origen y se sigue rechazando una base ajena.
  "content-security-policy": "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com https://w.soundcloud.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com https://widget.deezer.com https://embed.music.apple.com https://embed.tidal.com https://w.soundcloud.com https://bandcamp.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

// --- Copias optimizadas bajo demanda -------------------------------------
// Cola en memoria, deduplicada y con tope: una ráfaga de visitas encarga cada
// copia una sola vez. Las peticiones de una misma página se agrupan en un
// lote; corre un solo optimizador a la vez, con prioridad baja (nice 15).
const VARIANT_WIDTHS = new Set(MEDIA_WIDTHS);
const MAX_PENDING_VARIANTS = 3_000;
const VARIANT_BATCH = 48;
const VARIANT_RETRY_MS = 6 * 3_600_000;
const pendingVariants = new Map();
const failedVariants = new Map();
let optimizerBusy = false;
let optimizerReady = false;
optimizerAvailable().then((ok) => {
  optimizerReady = ok;
  console.log(ok
    ? `Imágenes optimizadas: ${optimizerCommand}`
    : `Imágenes optimizadas desactivadas (no se encontró ${optimizerCommand}); se sirven los originales.`);
});

function requestVariant(src, dst, width) {
  if (!optimizerReady || pendingVariants.has(dst) || pendingVariants.size >= MAX_PENDING_VARIANTS) return;
  const failedAt = failedVariants.get(dst);
  if (failedAt !== undefined && Date.now() - failedAt < VARIANT_RETRY_MS) return;
  pendingVariants.set(dst, { src, dst, max_side: width });
  if (!optimizerBusy) {
    optimizerBusy = true;
    setTimeout(drainVariants, 400);
  }
}

async function drainVariants() {
  const orders = [...pendingVariants.values()].slice(0, VARIANT_BATCH);
  if (orders.length === 0) {
    optimizerBusy = false;
    return;
  }
  const { unanswered, error } = await runOptimizer(orders, {
    onResult: (result) => {
      pendingVariants.delete(result.dst);
      if (!result.ok) failedVariants.set(result.dst, Date.now());
    },
  });
  for (const order of unanswered) {
    pendingVariants.delete(order.dst);
    failedVariants.set(order.dst, Date.now());
  }
  if (error) console.error(`Optimizador de imágenes: ${error.message}`);
  if (failedVariants.size > 20_000) failedVariants.clear();
  setImmediate(drainVariants);
}

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

/**
 * X-Forwarded-For hacia los procesos de atrás: la cadena que trajo el Funnel
 * o, si la petición llegó directa, la dirección del socket. Así el último
 * elemento —el que leen API y chat— es siempre la IP real del cliente.
 */
function forwardedFor(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded;
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/** Tráfico local de pruebas (sin proxy delante): fuera del techo. */
function isLocalRequest(req) {
  if (req.headers["x-forwarded-for"] !== undefined) return false;
  return isLoopbackPeer(req);
}

/** ¿La conexión llega de un proceso local (cloudflared, server.mjs, scripts)? */
function isLoopbackPeer(req) {
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
  const isChat = upstreamPath === "/chat" || upstreamPath.startsWith("/chat?") || upstreamPath.startsWith("/chat/");
  const upstreamPort = isChat ? chatPort : apiPort;
  // Cloudflare escribe CF-Connecting-IP/CF-IPCountry; nadie más debe poder
  // inyectarlas. Solo se reenvían cuando la conexión viene del túnel local;
  // desde un peer remoto se descartan antes de llegar a la API.
  const headers = {
    ...req.headers,
    host: `${apiHost}:${upstreamPort}`,
    "x-forwarded-host": req.headers.host,
    "x-forwarded-proto": "https",
  };
  if (!isLoopbackPeer(req)) {
    delete headers["cf-connecting-ip"];
    delete headers["cf-ipcountry"];
  }
  const upstream = http.request({
    host: apiHost,
    port: upstreamPort,
    method: req.method,
    path: upstreamPath,
    headers,
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, { ...upstreamResponse.headers, ...SECURITY_HEADERS });
    upstreamResponse.pipe(res);
  });
  upstream.on("error", () => reply(res, 502, isChat
    ? "El chat de CRV no está disponible."
    : "La API CRV no está disponible."));
  req.pipe(upstream);
}

/**
 * WebSocket del chat. El gateway reenvía el upgrade al proceso crv-chat, que
 * es el único que habla WS; sin esto el chat funcionaría por HTTP pero nunca
 * recibiría mensajes en vivo detrás del dominio público.
 */
function proxyChatUpgrade(req, socket, head) {
  let url;
  try { url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`); }
  catch { socket.destroy(); return; }
  const virtualPath = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
    ? url.pathname
    : `${basePath}${url.pathname}`;
  if (virtualPath !== `${apiPath}/chat/ws`) { socket.destroy(); return; }

  const upstream = net.connect(chatPort, apiHost, () => {
    const path = virtualPath.slice(apiPath.length) + url.search;
    const headers = {
      host: `${apiHost}:${chatPort}`,
      // Sin estas dos cabeceras el upstream responde 400: el upgrade no es
      // solo sec-websocket-*, también Connection/Upgrade.
      connection: "Upgrade",
      upgrade: "websocket",
      origin: req.headers.origin,
      cookie: req.headers.cookie,
      "user-agent": req.headers["user-agent"],
      "sec-websocket-key": req.headers["sec-websocket-key"],
      "sec-websocket-version": req.headers["sec-websocket-version"],
      "sec-websocket-protocol": req.headers["sec-websocket-protocol"],
      "sec-websocket-extensions": req.headers["sec-websocket-extensions"],
      // El chat limita y banea por IP: sin esto todas las conexiones
      // llegaban como 127.0.0.1 (el gateway) y una IP baneada era todas.
      // Se conserva la cadena del Funnel; sin proxy delante, la del socket.
      "x-forwarded-for": forwardedFor(req),
      // El chat compara Origin con el host público para aceptar el upgrade.
      "x-forwarded-host": req.headers.host,
      "x-forwarded-proto": "https",
    };
    const lines = [`GET ${path} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) lines.push(`${key}: ${value}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

async function serveFile(req, res, pathname, searchParams) {
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

  // Los documentos de la landing usan rutas relativas a la base del servidor.
  // Se inyecta <base> y la base de API para que funcionen igual en /crv y en
  // la raíz del dominio, sin `../` que se escapen al host equivocado.
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html" && relativePath.startsWith("landing/")) {
    const html = await readFile(file, "utf8");
    const baseHref = basePath === "/" ? "/" : `${basePath}/`;
    const injected = html.replace("<head>",
      `<head><base href="${baseHref}"><meta name="crv-api-base" content="${apiPath}">`);
    const body = Buffer.from(injected);
    res.writeHead(200, {
      "content-type": MIME_TYPES[".html"],
      "content-length": body.length,
      "cache-control": "no-cache",
      ...SECURITY_HEADERS,
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
    return;
  }

  // ?w=N: copia optimizada si ya existe, es más nueva que el original y pesa
  // menos; si no, el original (con caché corta, para recoger luego la copia).
  let pendingVariant = false;
  const width = isMedia ? Number(searchParams?.get("w")) : NaN;
  if (VARIANT_WIDTHS.has(width) && OPTIMIZABLE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    const variant = variantPath(path.relative(media, file), width);
    const variantStat = await stat(variant).catch(() => null);
    if (variantStat?.isFile() && variantStat.mtimeMs >= fileStat.mtimeMs) {
      if (variantStat.size < fileStat.size) {
        file = variant;
        fileStat = variantStat;
      }
    } else {
      pendingVariant = optimizerReady;
      requestVariant(file, variant, width);
    }
  }

  // ETag barato (tamaño + mtime): revalidar no cuesta releer la imagen.
  const etag = `W/"${fileStat.size.toString(16)}-${Math.round(fileStat.mtimeMs).toString(16)}"`;
  const cacheControl = pendingVariant ? "public, max-age=300"
    : isMedia
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

// Ventana 3.7 (Métricas): aviso de cada documento público a la API, que lo
// clasifica (persona, IA, buscador, bot) y lo agrega en traffic_daily. Va
// detrás de CRV_TRAFFIC_REPORT=1 y de un token compartido; sin ellos, el
// gateway no llama a nadie. Es «fire and forget»: la página no espera.
const trafficEnabled = process.env.CRV_TRAFFIC_REPORT === "1";
const trafficToken = process.env.CRV_TRAFFIC_TOKEN ?? "";
const TRAFFIC_PAGES = {
  "/": "roadmap",
  "/roadmap": "roadmap",
  "/colaborar": "collaborate",
  "/login": "login",
  "/registro": "register",
  "/activar": "activate",
  "/robots.txt": "robots",
  "/sitemap.xml": "sitemap",
  "/llms.txt": "llms",
};

function reportTraffic(req, literalPath) {
  if (!trafficEnabled || !trafficToken) return;
  const page = TRAFFIC_PAGES[literalPath === "" ? "/" : literalPath];
  if (!page) return;
  const headers = {
    "content-type": "application/json",
    "x-crv-traffic-token": trafficToken,
  };
  // La IP real la escribe Cloudflare; solo se reenvía si el peer es el túnel
  // local, igual que en el proxy del API.
  if (typeof req.headers["cf-connecting-ip"] === "string" && isLoopbackPeer(req)) {
    headers["cf-connecting-ip"] = req.headers["cf-connecting-ip"];
  }
  fetch(`http://${apiHost}:${apiPort}/traffic/page`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      page,
      userAgent: String(req.headers["user-agent"] ?? ""),
      accept: String(req.headers.accept ?? ""),
      acceptLanguage: String(req.headers["accept-language"] ?? ""),
      secFetchMode: String(req.headers["sec-fetch-mode"] ?? ""),
      secFetchSite: String(req.headers["sec-fetch-site"] ?? ""),
      signatureAgent: String(req.headers["signature-agent"] ?? ""),
      country: String(req.headers["cf-ipcountry"] ?? ""),
    }),
  }).catch(() => undefined);
}

// ---- Modo raíz (Fase 2B): lista blanca estricta ------------------------------
//
// En `CRV_WEB_MODE=landing` el dominio sirve SOLO la portada, /colaborar,
// /login, /registro y /activar, sus estáticos y las APIs indicadas en el plan
// (§5.1). Todo lo demás responde 404: ni el catálogo, ni /curaduria, ni el chat,
// ni las rutas del SPA. La radio se reenvía a Herra mientras la Fase 3 no cumpla.
const radioProxyUrl = process.env.CRV_RADIO_PROXY_URL ?? "";
const LANDING_DOCS = ["/", "/roadmap", "/colaborar", "/login", "/registro", "/activar"];
const LANDING_API = [
  /^\/roadmap$/u,
  /^\/roadmap\/(visit|visits|me)$/u,
  /^\/roadmap\/tasks\/\d+\/status$/u,
  /^\/community\/(form-options|applications)$/u,
  /^\/community\/invite\/[A-Za-z0-9_-]+$/u,
  /^\/community\/register$/u,
  /^\/community\/activate(\/[A-Za-z0-9_-]+)?$/u,
  /^\/site-config$/u,
  /^\/auth\/(login|logout|me)$/u,
  /^\/landing-media\/(favicon|share)$/u,
];
const LANDING_RADIO = /^\/radio\/(now|listener|unavailable)$/u;
const LANDING_STATICS = ["/landing/", "/favicon.ico", "/favicon.png", "/theme.css", "/media/favicon", "/media/share"];

/** Proxy a otro proceso local (la radio de Herra en la 2B). */
function proxyTo(req, res, target, upstreamPath) {
  const destino = new URL(target);
  const headers = {
    ...req.headers,
    host: destino.host,
    "x-forwarded-host": req.headers.host,
    "x-forwarded-proto": "https",
  };
  if (!isLoopbackPeer(req)) {
    delete headers["cf-connecting-ip"];
    delete headers["cf-ipcountry"];
  }
  const upstream = http.request({
    host: destino.hostname,
    port: Number(destino.port || 80),
    method: req.method,
    path: upstreamPath,
    headers,
  }, (respuesta) => {
    res.writeHead(respuesta.statusCode ?? 502, { ...respuesta.headers, ...SECURITY_HEADERS });
    respuesta.pipe(res);
  });
  upstream.on("error", () => reply(res, 502, "La radio no está disponible."));
  req.pipe(upstream);
}

/**
 * Devuelve true cuando la petición ya está resuelta (servida o rechazada).
 * En modo catálogo no se llama.
 */
function landingWhitelist(req, res, virtualUrl, acceptsHtml) {
  const metodo = req.method ?? "GET";
  const ruta = (virtualUrl.pathname.replace(/\/+$/u, "") || "/");
  const esLectura = metodo === "GET" || metodo === "HEAD";

  if (ruta === apiPath || ruta.startsWith(`${apiPath}/`)) {
    const dentro = ruta.slice(apiPath.length) || "/";
    if (LANDING_RADIO.test(dentro)) {
      if (!radioProxyUrl) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: { code: "radio_unavailable", message: "La radio aún no está enrutada." } }));
        return true;
      }
      // Herra sirve la radio bajo /api/radio/*: se reenvía con su prefijo.
      proxyTo(req, res, radioProxyUrl, `/api${dentro}${virtualUrl.search}`);
      return true;
    }
    if (LANDING_API.some((patron) => patron.test(dentro))) {
      proxyApi(req, res, virtualUrl);
      return true;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: { code: "not_found", message: `ruta inexistente: ${metodo} ${virtualUrl.pathname}` } }));
    return true;
  }

  if (esLectura && ruta === "/") {
    const lang = virtualUrl.searchParams.get("lang") === "en" ? "en" : "es";
    reportTraffic(req, "/");
    serveLanding(req, res, "roadmap", lang, virtualUrl.searchParams);
    return true;
  }
  // robots.txt propio de la portada: no anuncia el sitemap del catálogo ni
  // expone /curaduria ni las rutas de la API, que en este modo no existen.
  if (esLectura && ruta === "/robots.txt") {
    sendText(req, res, 200, "text/plain; charset=utf-8", "User-agent: *\nAllow: /\n", "public, max-age=3600");
    return true;
  }
  if (esLectura && LANDING_DOCS.includes(ruta)) return false; // la rama de landing ya las sirve
  if (LANDING_STATICS.some((prefijo) => ruta === prefijo || ruta.startsWith(prefijo))) return false;

  if (acceptsHtml) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
    res.end("<!doctype html><meta charset=\"utf-8\"><title>404</title><p>Esta página no existe.</p>");
  } else {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
    res.end("404");
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  if (ip.length > 0 && !isLocalRequest(req) && rateLimited(ip)) {
    res.writeHead(429, { "content-type": "text/plain; charset=utf-8", "retry-after": "60", ...SECURITY_HEADERS });
    res.end("Demasiadas solicitudes desde esta conexión. Espera un minuto y vuelve a intentarlo.");
    return;
  }
  // En modo raíz una ruta con doble barra o barra invertida no existe: el
  // parser de URL interpreta `//curaduria` como un host y serviría la portada
  // (200) en vez de 404, que es justo la puerta que no puede quedar abierta.
  // Se mira la ruta cruda, antes de normalizar, y también su forma decodificada.
  if (webMode === "landing") {
    const rutaCruda = (req.url ?? "/").split("?", 1)[0] ?? "/";
    let rutaDecodificada = rutaCruda;
    try { rutaDecodificada = decodeURIComponent(rutaCruda); } catch { /* se compara la cruda */ }
    if (rutaCruda.includes("\\") || rutaDecodificada.includes("\\")
        || /\/{2,}/u.test(rutaCruda) || /\/{2,}/u.test(rutaDecodificada)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
      res.end("404");
      return;
    }
  }
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
  // En staging la app vive bajo /crv. Si alguien entra por una ruta de la app
  // sin el prefijo (/roadmap, /curaduria/...), el gateway sirve el índice pero
  // el basename del router no coincide y la página queda en blanco. Las
  // navegaciones de documento se mandan al prefijo; las APIs y los assets no.
  const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
  if (redirectUnprefixed && basePath !== "/" && acceptsHtml && (req.method === "GET" || req.method === "HEAD")
      && requestUrl.pathname !== "/" && !requestUrl.pathname.startsWith(`${basePath}/`)) {
    res.writeHead(302, { location: `${basePath}${requestUrl.pathname}${requestUrl.search}` });
    return res.end();
  }
  // Funnel elimina el prefijo configurado antes de enviar la petición al
  // destino local. Para pruebas directas también aceptamos la ruta completa.
  // En la raíz (basePath "/") la ruta ya es la definitiva: prefijarla daba
  // "//api/..." y el proxy del API nunca casaba.
  const virtualPath = basePath === "/" || requestUrl.pathname === basePath || requestUrl.pathname.startsWith(`${basePath}/`)
    ? requestUrl.pathname
    : `${basePath}${requestUrl.pathname}`;
  const virtualUrl = new URL(requestUrl);
  virtualUrl.pathname = virtualPath;
  // Fase 2B: en modo raíz manda la lista blanca. Todo lo que no esté en ella
  // responde 404 antes de llegar al catálogo o al chat.
  if (webMode === "landing" && landingWhitelist(req, res, virtualUrl, acceptsHtml)) return;
  if (virtualUrl.pathname === apiPath || virtualUrl.pathname.startsWith(`${apiPath}/`)) return proxyApi(req, res, virtualUrl);
  // Las cinco páginas usan el documento renderizado por la API, con fallback
  // estático cuando no se puede contactar con ella.
  const landingPrefix = basePath === "/" ? "" : basePath;
  const landingPage = ["roadmap", "colaborar", "login", "registro", "activar"].find((page) => virtualUrl.pathname.replace(/\/+$/u, "") === `${landingPrefix}/${page}`);
  if ((req.method === "GET" || req.method === "HEAD") && landingPage) {
    const canonical = `${landingPrefix}/${landingPage}`;
    if (virtualUrl.pathname !== canonical) {
      res.writeHead(301, { location: `${canonical}${virtualUrl.search}` });
      return res.end();
    }
    const lang = virtualUrl.searchParams.get("lang") === "en" ? "en" : "es";
    reportTraffic(req, virtualUrl.pathname.slice(basePath.length) || "/");
    return serveLanding(req, res, landingPage, lang, virtualUrl.searchParams);
  }
  // robots.txt y sitemap los sirve el gateway, no el build: responden con el
  // host real que ve el buscador (hoy el Funnel; mañana el dominio propio).
  const literalPath = basePath === "/"
    ? virtualUrl.pathname
    : (virtualUrl.pathname === basePath ? "/" : virtualUrl.pathname.slice(basePath.length));
  if (req.method === "GET" || req.method === "HEAD") {
    if (literalPath === "/robots.txt") {
      reportTraffic(req, literalPath);
      return sendText(req, res, 200, "text/plain; charset=utf-8", robotsBody(req), "public, max-age=3600");
    }
    try {
      if (literalPath === "/sitemap.xml") {
        reportTraffic(req, literalPath);
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
  return serveFile(req, res, virtualUrl.pathname, virtualUrl.searchParams);
});

server.on("upgrade", proxyChatUpgrade);
server.listen(port, host, () => console.log(`CRV público local: http://${host}:${port}${basePath}/`));
server.on("error", (error) => { console.error(error); process.exitCode = 1; });
