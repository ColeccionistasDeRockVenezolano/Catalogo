// CRV · Fase 3: la radio de la portada servida por CRV, con un navegador real.
// Solo contra un ensayo (gateway con CRV_RADIO_SOURCE=crv y API dueña en una carpeta
// de estado propia). Comprueba que el cliente único habla solo con CRV y que cada
// ruta responde con lo que le toca, incluido el relleno por país y la cuña.
//
//   node scripts/checks/radio-crv-browser.mjs http://127.0.0.1:3152 [http://127.0.0.1:3130/crv] [salida]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { limpiarFixtures, prepararFixtures } from "./lib/fixtures.mjs";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3152").replace(/\/$/u, "");
const CATALOGO = process.argv[3]?.replace(/\/$/u, "");
const SALIDA = process.argv[4];
if (!/^http:\/\/(127\.0\.0\.1|localhost):/u.test(BASE)) { console.error("solo contra un ensayo local"); process.exit(2); }

const ok = [];
const fallos = [];
const cumple = (condicion, nombre, detalle = "") => (condicion ? ok : fallos).push(detalle && !condicion ? `${nombre}: ${detalle}` : nombre);
const origen = new URL(BASE).origin;

// API por el gateway
const ahora = async (pais) => {
  const respuesta = await fetch(`${BASE}/api/radio/now`, { headers: { accept: "application/json", ...(pais ? { "cf-ipcountry": pais } : {}) } });
  return { status: respuesta.status, cache: respuesta.headers.get("cache-control"), datos: await respuesta.json() };
};
const general = await ahora(null);
cumple(general.status === 200 && general.cache === "no-store", "/api/radio/now 200 sin caché");
cumple(Boolean(general.datos.sweeper), "la emisión lleva su cuña");
const post = (ruta, cuerpo, cabeceras = { origin: origen }) => fetch(`${BASE}/api/radio/${ruta}`, {
  method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo),
});
cumple((await post("listener", { sessionId: "ensayoensayoensayo", active: true }, { origin: "https://evil.example" })).status === 403, "latido desde otro origen 403");
cumple((await post("unavailable", { videoId: general.datos.current.videoId }, { origin: "https://evil.example" })).status === 403, "aviso desde otro origen 403");
cumple((await post("diagnostic", { kind: "stall", sessionId: "ensayoensayoensayo" }, { origin: "https://evil.example" })).status === 403, "diagnóstico desde otro origen 403");
const verificado = await post("unavailable", { videoId: general.datos.current.videoId });
cumple(verificado.status === 200 && (await verificado.json()).excluded === false, "un aviso de lo que suena se verifica y no lo retira");
cumple((await post("unavailable", { videoId: "zzzzzzzzzzz" })).status === 404, "aviso de algo que no está al aire 404");
cumple((await post("unavailable", { videoId: "corto" })).status === 400, "aviso con video inválido 400");
cumple((await post("diagnostic", { kind: "inventado", sessionId: "ensayoensayoensayo" })).status === 400, "diagnóstico de tipo desconocido 400");
cumple((await post("diagnostic", { kind: "stall", sessionId: "ensayoensayoensayo", silenceMs: 31000, trace: [{ e: "x" }] })).status === 204, "diagnóstico válido 204");
const latido = await post("listener", { sessionId: "ensayoensayoensayo", active: true });
cumple(latido.status === 200 && (await latido.json()).listeners >= 1, "latido cuenta un oyente");
await post("listener", { sessionId: "ensayoensayoensayo", active: false });

// Navegador real: portada
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const contexto = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-VE" });
// YouTube rechaza reproducir para 127.0.0.1: se simula el origen del dominio. Las
// peticiones nunca salen a él: se atienden contra el gateway del ensayo.
const PUBLICO = "https://coleccionistasderockvenezolano.com";
await contexto.route(`${PUBLICO}/**`, async (ruta) => {
  const peticion = ruta.request();
  const url = new URL(peticion.url());
  const respuesta = await ruta.fetch({ url: `${BASE}${url.pathname}${url.search}`, headers: { ...peticion.headers(), origin: origen, host: new URL(BASE).host } });
  await ruta.fulfill({ response: respuesta });
});
const pagina = await contexto.newPage();
const pedidas = [];
const errores = [];
pagina.on("request", (peticion) => { if (peticion.url().includes("/radio/")) pedidas.push(`${peticion.method()} ${new URL(peticion.url()).pathname}`); });
pagina.on("pageerror", (error) => errores.push(error.message));
pagina.on("response", (respuesta) => {
  const url = new URL(respuesta.url());
  // /api/roadmap/me responde 401 a un visitante: es como la portada sabe que no hay sesión.
  if (url.origin === PUBLICO && respuesta.status() >= 400 && url.pathname !== "/api/roadmap/me") errores.push(`${respuesta.status()} ${url.pathname}`);
});
await pagina.goto(`${PUBLICO}/`, { waitUntil: "load" });
const tarjeta = pagina.locator("#radio");
cumple(await tarjeta.count() === 1, "la portada pinta la tarjeta");
cumple(await tarjeta.getAttribute("data-radio-diagnostic-api") === "/api/radio/diagnostic", "la tarjeta declara el diagnóstico");
await pagina.waitForFunction(() => document.getElementById("radio")?.getAttribute("data-radio-requested") === "true", null, { timeout: 15000 });
const sync = pagina.locator("[data-radio-sync]");
await pagina.waitForTimeout(3000);
if (await sync.isVisible().catch(() => false)) await sync.click({ timeout: 5000 }).catch(() => undefined);
const enVivo = await pagina.waitForFunction(() => document.getElementById("radio")?.getAttribute("data-radio-state") === "live", null, { timeout: 60000 }).then(() => true, () => false);
const estado = await tarjeta.getAttribute("data-radio-state");
cumple(enVivo, "el reproductor llega al aire", `estado ${estado}`);
await pagina.waitForTimeout(32000);
cumple(pedidas.includes("GET /api/radio/now"), "el cliente consulta /api/radio/now", pedidas.join(", "));
cumple(pedidas.includes("POST /api/radio/listener"), "el cliente envía su latido", pedidas.join(", "));
const oyentes = (await ahora(null)).datos.listeners;
cumple(oyentes >= 1, "el servidor cuenta al oyente del navegador", String(oyentes));
const reproductor = await pagina.evaluate(() => {
  const marco = document.getElementById("radioPlayer");
  return marco ? { src: marco.getAttribute("src") ?? "", visible: marco.getBoundingClientRect().width > 0 } : null;
});
cumple(Boolean(reproductor?.src.includes("youtube")), "hay un reproductor de YouTube cargado", JSON.stringify(reproductor));
const texto = (await pagina.locator("#radio").innerText()).replace(/\s+/gu, " ");
const enAire = (await ahora(null)).datos;
cumple(texto.includes(enAire.current.title) || texto.includes(enAire.next.title) || texto.includes(general.datos.current.title), "la tarjeta dice lo que emite el servidor", texto.slice(0, 160));
cumple((await fetch(`${BASE}/landing/radio/sweeper-v2.wav`)).status === 200, "la cuña se sirve");
cumple(errores.length === 0, "sin errores en la página", errores.join(" | "));

// Modo cine y móvil
await pagina.locator("[data-radio-cinema]").click();
cumple(await tarjeta.evaluate((nodo) => nodo.classList.contains("is-cinema")), "modo cine entra");
await pagina.keyboard.press("Escape");
cumple(!(await tarjeta.evaluate((nodo) => nodo.classList.contains("is-cinema"))), "modo cine sale con Escape");
if (SALIDA) { await mkdir(SALIDA, { recursive: true }); await pagina.screenshot({ path: path.join(SALIDA, "portada.png") }); }
await pagina.close();

// Catálogo: el mismo cliente en su iframe
if (CATALOGO) {
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-VE", hasTouch: true, isMobile: true });
  for (const [nombre, ctx] of [["escritorio", contexto], ["móvil", movil]]) {
    const hoja = await ctx.newPage();
    const fallosHoja = [];
    hoja.on("pageerror", (error) => fallosHoja.push(error.message));
    hoja.on("console", (mensaje) => { if (mensaje.type() === "error" && /Content Security|Refused to frame/u.test(mensaje.text())) fallosHoja.push(mensaje.text().slice(0, 160)); });
    const catalogoUrl = new URL(CATALOGO);
    await ctx.route(`${PUBLICO}${catalogoUrl.pathname}/**`, async (ruta) => {
      const peticion = ruta.request();
      const url = new URL(peticion.url());
      const respuesta = await ruta.fetch({ url: `${catalogoUrl.origin}${url.pathname}${url.search}`, headers: { ...peticion.headers(), origin: catalogoUrl.origin, host: catalogoUrl.host } });
      await ruta.fulfill({ response: respuesta });
    });
    await hoja.goto(`${PUBLICO}${catalogoUrl.pathname}/radio`, { waitUntil: "load" });
    const iframe = hoja.locator("iframe.radio-embed__frame");
    await iframe.waitFor({ timeout: 20000 });
    const interior = hoja.frameLocator("iframe.radio-embed__frame");
    await interior.locator("#radio").waitFor({ timeout: 20000 });
    await interior.locator("#radio[data-radio-state='live']").waitFor({ timeout: 60000 }).then(
      () => cumple(true, `catálogo ${nombre}: el reproductor llega al aire dentro del marco`),
      async () => cumple(false, `catálogo ${nombre}: el reproductor llega al aire dentro del marco`, String(await interior.locator("#radio").getAttribute("data-radio-state"))),
    );
    const mensajes = (await interior.locator("#radio").innerText());
    cumple(!/radio\.[a-z]/iu.test(mensajes), `catálogo ${nombre}: los textos del reproductor están traducidos`, mensajes.slice(0, 200));
    const caja = await iframe.boundingBox();
    const alto = await interior.locator("#radio").evaluate((nodo) => nodo.getBoundingClientRect().height);
    cumple(caja && Math.abs(caja.height - alto) <= 2, `catálogo ${nombre}: el marco mide lo que la tarjeta`, `${caja?.height} frente a ${alto}`);
    cumple(caja && caja.x >= 0 && caja.x + caja.width <= (nombre === "móvil" ? 390 : 1280), `catálogo ${nombre}: sin desbordar`);
    cumple(await hoja.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `catálogo ${nombre}: sin scroll horizontal`);
    await interior.locator("[data-radio-cinema]").click();
    await hoja.waitForFunction(() => document.querySelector("iframe.radio-embed__frame")?.classList.contains("is-cinema"));
    const cine = await iframe.boundingBox();
    cumple(cine && cine.width >= (nombre === "móvil" ? 380 : 1200), `catálogo ${nombre}: el modo cine ocupa la ventana`);
    await interior.locator("[data-radio-cinema]").click();
    await hoja.waitForFunction(() => !document.querySelector("iframe.radio-embed__frame")?.classList.contains("is-cinema"));
    cumple(true, `catálogo ${nombre}: el modo cine vuelve`);
    if (SALIDA) await hoja.screenshot({ path: path.join(SALIDA, `catalogo-${nombre}.png`) });
    // Salir de la ruta apaga el reproductor: el iframe desaparece.
    await hoja.evaluate(() => { window.history.pushState({}, "", window.location.pathname.replace(/radio$/u, "")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await hoja.waitForTimeout(800);
    cumple(await hoja.locator("iframe.radio-embed__frame").count() === 0, `catálogo ${nombre}: salir de la ruta lo apaga`);
    cumple(fallosHoja.length === 0, `catálogo ${nombre}: sin errores`, fallosHoja.join(" | "));
    await hoja.close();
  }
  await movil.close();

  // Panel: lo que el motor sabe de vetos, exclusiones y diagnósticos llega a la pantalla.
  prepararFixtures();
  try {
    const hoja = await contexto.newPage();
    const entrada = await hoja.request.post(`${new URL(CATALOGO).origin}${new URL(CATALOGO).pathname}/api/auth/login`, {
      headers: { "content-type": "application/json", origin: new URL(CATALOGO).origin },
      data: { username: "fase1-admin", password: "Fase1Admin2026" },
    });
    cumple(entrada.ok(), "panel: la cuenta de prueba entra", String(entrada.status()));
    await hoja.goto(`${CATALOGO}/curaduria/radio`, { waitUntil: "load" });
    await hoja.getByText("Diagnóstico de escucha").waitFor({ timeout: 20000 });
    const panel = (await hoja.locator(".community-page").innerText()).replace(/\s+/gu, " ");
    for (const texto of ["con relleno por país", "fuera por veto en el país base", "retiradas por no estar disponibles", "Países con más vetos", "Quién barre"]) {
      cumple(panel.toLowerCase().includes(texto.toLowerCase()), `panel: muestra «${texto}»`, panel.slice(0, 900));
    }
    cumple(/[1-9]\d*\s*con relleno por país/iu.test(panel), "panel: cuenta las piezas con relleno del catálogo real", panel.slice(0, 200));
    if (SALIDA) await hoja.screenshot({ path: path.join(SALIDA, "panel.png"), fullPage: true });
    await hoja.close();
  } finally {
    limpiarFixtures();
  }
}
await browser.close();
for (const linea of ok) console.log(`✓ ${linea}`);
for (const linea of fallos) console.log(`✗ ${linea}`);
console.log(`\n${ok.length} correctas, ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
