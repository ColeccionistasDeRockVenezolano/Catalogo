// CRV · Puerta de la Fase 2B: lista blanca del dominio.
//
// Comprueba que la instancia raíz sirve SOLO lo permitido (§5.1) y que todo lo
// demás responde 404. Se usa contra el ensayo (:3141) y, en la ventana, contra
// el dominio real:
//
//   node scripts/checks/fase2b-whitelist.mjs                       # :3141
//   node scripts/checks/fase2b-whitelist.mjs --base https://coleccionistasderockvenezolano.com
//
// No envía POST a /api/radio/listener ni /api/radio/unavailable: alteraría la
// emisión real de Herra. La radio se comprueba con GET /api/radio/now.
import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const baseArg = args.find((arg) => arg.startsWith("--base=")) ?? args[args.indexOf("--base") + 1];
const BASE = (baseArg && !baseArg.startsWith("--") ? baseArg : "http://127.0.0.1:3141").replace(/\/$/u, "");

const ok = [];
const fallos = [];

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    redirect: "manual",
    headers: { accept: opciones.accept ?? "text/html,application/xhtml+xml", ...(opciones.headers ?? {}) },
    method: opciones.method ?? "GET",
    ...(opciones.body ? { body: opciones.body } : {}),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, texto, tipo: respuesta.headers.get("content-type") ?? "" };
}

/**
 * Petición con la ruta cruda: `fetch` normaliza `//` y `/\`, justo los casos que
 * hay que probar. Envía exactamente lo que enviaría un cliente malicioso.
 */
function pedirCrudo(ruta) {
  const url = new URL(BASE);
  const modulo = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const solicitud = modulo.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: ruta,
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml" },
    }, (respuesta) => {
      let texto = "";
      respuesta.on("data", (trozo) => { texto += trozo; });
      respuesta.on("end", () => resolve({
        status: respuesta.statusCode ?? 0,
        texto,
        tipo: respuesta.headers["content-type"] ?? "",
      }));
    });
    solicitud.on("error", reject);
    solicitud.end();
  });
}

async function debe(ruta, esperado, extra = "") {
  const respuesta = await pedir(ruta);
  if (respuesta.status === esperado) ok.push(`${ruta} ${esperado}${extra ? ` (${extra})` : ""}`);
  else fallos.push(`${ruta}: esperaba ${esperado}, dio ${respuesta.status}`);
  return respuesta;
}

async function debeCrudo(ruta, esperado) {
  const respuesta = await pedirCrudo(ruta);
  if (respuesta.status === esperado) ok.push(`${ruta} ${esperado} (cruda)`);
  else fallos.push(`${ruta}: esperaba ${esperado}, dio ${respuesta.status}`);
  return respuesta;
}

// --- Documentos permitidos (ES y EN) -----------------------------------------
const CATALOGO = /(?:href|src|action)\s*=\s*["'][^"']*\/(?:crv|curaduria|artistas|discos|personas|album|artists|docs|chat)(?=[/?"'#]|$)/iu;
for (const ruta of ["/", "/roadmap", "/colaborar", "/login", "/registro", "/activar"]) {
  const respuesta = await debe(ruta, 200);
  if (respuesta.status === 200 && !/coleccionistasderockvenezolano|roadmap|colabor/i.test(respuesta.texto)) {
    fallos.push(`${ruta}: el documento no parece la portada`);
  }
  if (CATALOGO.test(respuesta.texto)) fallos.push(`${ruta}: enlaza al catálogo`);
  await debe(`${ruta}${ruta.includes("?") ? "&" : "?"}lang=en`, 200);
}

// --- TEMPORAL-PORTADA: la puerta del equipo (docs/independencia/PUERTA-TEMPORAL.md) --
// Sin sesión mandan a /login; las direcciones de Herra que ya circulan siguen vivas.
for (const [ruta, estado, destino] of [
  ["/account", 302, "/login"], ["/admin", 302, "/login"],
  ["/register?token=x", 301, "/registro?token=x"], ["/admin/login", 301, "/login"],
]) {
  const respuesta = await fetch(`${BASE}${ruta}`, { redirect: "manual", headers: { accept: "text/html" } });
  const lugar = respuesta.headers.get("location") ?? "";
  if (respuesta.status === estado && lugar.endsWith(destino)) ok.push(`${ruta} ${estado} → ${destino}`);
  else fallos.push(`${ruta}: esperaba ${estado} → ${destino}, dio ${respuesta.status} ${lugar}`);
}
// El panel responde, pero solo con sesión: sin ella no entrega ni un dato.
for (const ruta of ["/api/community/admin/panel/users", "/api/community/admin/panel/applications"]) {
  const respuesta = await pedir(ruta, { accept: "application/json" });
  if (respuesta.status === 401 || respuesta.status === 403) ok.push(`${ruta} ${respuesta.status} (sin sesión)`);
  else fallos.push(`${ruta}: sin sesión dio ${respuesta.status}`);
}
for (const ruta of ["/api/community/admin/panel/%2e%2e/metrics", "/api/community/admin/panel/../metrics"]) await debeCrudo(ruta, 404);

// --- Estáticos y metadatos ---------------------------------------------------
await debe("/landing/roadmap-public.min.css", 200);
await debe("/landing/radio.js", 200);
{
  const robots = await debe("/robots.txt", 200);
  if (/\/api\b|\/curaduria|sitemap/iu.test(robots.texto)) {
    fallos.push(`/robots.txt: anuncia rutas que no existen en modo portada: ${robots.texto.replace(/\s+/gu, " ").slice(0, 120)}`);
  }
}

// --- Radio: GET a Herra, sin tocar el contador de oyentes --------------------
{
  const respuesta = await pedir("/api/radio/now", { accept: "application/json" });
  if (respuesta.status === 200 && /"phase"/.test(respuesta.texto)) ok.push("/api/radio/now 200 (Herra)");
  else fallos.push(`/api/radio/now: ${respuesta.status} ${respuesta.texto.slice(0, 80)}`);
}

// --- APIs permitidas ---------------------------------------------------------
for (const ruta of ["/api/roadmap", "/api/roadmap/visits", "/api/site-config", "/api/community/form-options", "/api/auth/me"]) {
  const respuesta = await pedir(ruta, { accept: "application/json" });
  // /auth/me sin sesión responde 401: es correcto.
  const esperado = ruta === "/api/auth/me" ? [200, 401] : [200];
  if (esperado.includes(respuesta.status)) ok.push(`${ruta} ${respuesta.status}`);
  else fallos.push(`${ruta}: ${respuesta.status}`);
}

// --- Prohibidas: todo 404 ----------------------------------------------------
const prohibidas = [
  "/crv", "/crv/", "/crv/roadmap", "/curaduria", "/curaduria/roadmap", "/curaduria/visitas",
  "/docs", "/chat", "/chat/", "/historial", "/buscar", "/artists", "/album/1", "/artista/x",
  "/sitemap.xml", "/sitemap-catalogo.xml", "/sitemap-personas.xml", "/sitemap-otro.xml", "/llms.txt",
  "/api/community/admin/roadmap", "/api/community/admin/metrics", "/api/community/admin/collaborators",
  "/api/community/admin/applications", "/api/community/admin/invites", "/api/curation/emotions/tags",
  "/api/catalog", "/api/chat/session", "/api/account/profile", "/api/review-queue",
  "/api/radio/diagnostic",
];
for (const ruta of prohibidas) await debe(ruta, 404);

// Mayúsculas: el router es sensible a mayúsculas y debe fallar cerrado.
for (const ruta of ["/CRV", "/Curaduria", "/CURADURIA", "/Docs", "/SITEMAP.XML", "/Artists"]) {
  await debe(ruta, 404);
}

// Codificadas: se decodifican una sola vez y no deben colarse.
for (const ruta of ["/%63rv", "/%63uraduria", "/%43RV", "/%2Fcuraduria", "/%2f%2fcuraduria", "/%5ccuraduria", "/sitemap%2Exml"]) {
  await debeCrudo(ruta, 404);
}

// Doble barra y barra invertida, tal cual llegan al servidor: el parser de URL
// las convertiría en host (`//curaduria`) y serviría la portada.
for (const ruta of ["//curaduria", "///curaduria", "/\\curaduria", "//artistas", "//crv", "//docs", "/roadmap//", "//sitemap.xml"]) {
  await debeCrudo(ruta, 404);
}

console.log(JSON.stringify({ base: BASE, comprobaciones: ok.length + fallos.length, ok: ok.length, fallos: fallos.length }));
for (const linea of fallos) console.log("FALLO:", linea);
if (process.env["CRV_VERBOSE"] === "1") for (const linea of ok) console.log("OK:", linea);
process.exit(fallos.length === 0 ? 0 : 1);
