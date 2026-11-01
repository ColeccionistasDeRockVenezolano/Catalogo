/* global document, window, getComputedStyle -- las funciones de page.evaluate corren en la página */
// CRV · B10 · Ventana 3.13 «Mi contraseña» (C12) y globo de visitas en móvil.
//
// Prueba real contra staging: clave actual incorrecta, clave débil, cambio
// correcto, inicio de sesión con la clave nueva y la regla de sesiones de Herra
// (la sesión que cambia la clave sigue dentro; las demás quedan fuera). Al
// final devuelve la clave original. Comprueba también que el globo «ONLINE» no
// tapa el reproductor en móvil.
//
// Uso: node scripts/checks/b10-clave-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BASE, entrar, estadoSesion, ipDePrueba } from "./lib/sesion.mjs";
import { prepararFixtures, limpiarFixtures } from "./lib/fixtures.mjs";

const OUT = path.join(os.homedir(), "crv-staging/reports/b10-clave-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const TEMP = "ClaveTemporal2026";

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const IP = ipDePrueba("b10-clave");
prepararFixtures();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
await entrar(page, { base: BASE, usuario: USER, clave: PASS });

// Segunda sesión con la misma cuenta, con su propio token: debe quedar fuera al
// cambiar la clave. (Copiar las cookies del primer contexto reutiliza la MISMA
// sesión, y esa se reestampa: no probaría la regla.)
const otra = await browser.newContext({ viewport: { width: 800, height: 600 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const otraPagina = await otra.newPage();
await entrar(otraPagina, { base: BASE, usuario: USER, clave: PASS, usarCache: false });
const antes = await estadoSesion(otraPagina);
report.datos.otraAntes = antes.status;

await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=clave`, { waitUntil: "networkidle" });
await page.waitForSelector(".password-window", { timeout: 20000 });
const titulo = (await page.locator(".modal-panel h2").first().innerText()).trim();
report.datos.titulo = titulo;
if (/Cambiar mi contraseña/.test(await page.locator(".password-window").innerText())) ok("ventana con el usuario en el título", titulo);
else fallo("título", titulo);

// 1) Clave actual incorrecta.
await page.fill("#pw-actual", "clave-que-no-es");
await page.fill("#pw-nueva", TEMP);
await page.getByRole("button", { name: /^Guardar$/ }).click();
await page.waitForTimeout(1200);
const errorActual = await page.locator(".rw-form__error").count()
  ? (await page.locator(".rw-form__error").innerText()).trim()
  : null;
report.datos.errorActual = errorActual;
if (errorActual && /clave|contraseña|incorrect/i.test(errorActual)) ok("clave actual incorrecta rechazada", errorActual.slice(0, 60));
else fallo("clave actual incorrecta", String(errorActual));

// 2) Clave débil (menos de 12): la ventana ni llama a la API.
await page.fill("#pw-actual", PASS);
await page.fill("#pw-nueva", "corta");
await page.getByRole("button", { name: /^Guardar$/ }).click();
await page.waitForTimeout(400);
const errorDebil = await page.locator(".rw-form__error").innerText().catch(() => "");
report.datos.errorDebil = errorDebil;
if (/12 caracteres/.test(errorDebil)) ok("clave débil rechazada antes de enviar");
else fallo("clave débil", errorDebil);

// 3) Cambio correcto.
await page.fill("#pw-actual", PASS);
await page.fill("#pw-nueva", TEMP);
await page.getByRole("button", { name: /^Guardar$/ }).click();
await page.waitForSelector(".password-window", { state: "detached", timeout: 15000 }).catch(() => null);
const cerrada = (await page.locator(".password-window").count()) === 0;
report.datos.cerrada = cerrada;
if (cerrada) ok("cambio correcto: la ventana se cierra"); else fallo("cambio correcto", "la ventana sigue abierta");

// La sesión que cambió la clave sigue dentro.
const propia = await estadoSesion(page);
report.datos.propia = propia.status;
if (propia.status === 200) ok("la sesión que cambia la clave sigue dentro"); else fallo("sesión propia", propia.status);

// Las demás sesiones de la cuenta quedan fuera.
await otraPagina.waitForTimeout(500);
const despues = await estadoSesion(otraPagina);
report.datos.otraDespues = despues.status;
if (antes.status === 200 && despues.status === 401) ok("las demás sesiones quedan fuera", `${antes.status} → ${despues.status}`);
else fallo("regla de sesiones", `${antes.status} → ${despues.status}`);
await otra.close();

// 4) Inicio de sesión con la clave nueva (contexto limpio).
const nuevo = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const paginaNueva = await nuevo.newPage();
const sesionNueva = await entrar(paginaNueva, { base: BASE, usuario: USER, clave: TEMP, usarCache: false });
report.datos.loginNueva = sesionNueva?.role ?? null;
if (sesionNueva?.role === "admin") ok("login con la clave nueva", USER); else fallo("login con la clave nueva", JSON.stringify(sesionNueva));

// 5) Se devuelve la clave original desde la ventana (deja constancia del camino inverso).
await paginaNueva.goto(`${BASE}/crv/curaduria/roadmap?herramienta=clave`, { waitUntil: "networkidle" });
await paginaNueva.waitForSelector(".password-window");
await paginaNueva.fill("#pw-actual", TEMP);
await paginaNueva.fill("#pw-nueva", PASS);
await paginaNueva.getByRole("button", { name: /^Guardar$/ }).click();
await paginaNueva.waitForSelector(".password-window", { state: "detached", timeout: 15000 }).catch(() => null);
// Se comprueba desde un contexto limpio: la sesión que cambió la clave sigue
// dentro y `entrar` en la misma página no probaría la clave restaurada.
const revision = await browser.newContext({ viewport: { width: 800, height: 600 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const paginaRevision = await revision.newPage();
const restaurada = await entrar(paginaRevision, { base: BASE, usuario: USER, clave: PASS, usarCache: false });
report.datos.claveRestaurada = restaurada?.role ?? null;
if (restaurada?.role === "admin") ok("clave original restaurada");
else fallo("restauración de la clave", "no se pudo volver a entrar con la original");
await revision.close();
await nuevo.close();

await page.screenshot({ path: path.join(OUT, "clave-escritorio.png"), fullPage: false });
report.capturas.push(path.join(OUT, "clave-escritorio.png"));
if (errors.length === 0) ok("consola sin errores"); else fallo("consola", errors.slice(0, 2).join(" | "));
await context.close();

// ------------------------------------------------- globo de visitas en móvil
const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const paginaMovil = await movil.newPage();
await paginaMovil.goto(`${BASE}/crv/roadmap`, { waitUntil: "networkidle" });
await paginaMovil.waitForTimeout(1500);
const globo = await paginaMovil.evaluate(() => {
  const widget = document.getElementById("visitCounter");
  const radio = document.getElementById("radio");
  if (!widget || !radio) return null;
  const a = widget.getBoundingClientRect();
  const b = radio.getBoundingClientRect();
  return {
    visible: getComputedStyle(widget).display !== "none",
    solapa: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
  };
});
report.datos.globo = globo;
if (globo && !globo.visible && globo.solapa === false) ok("móvil: el globo no tapa el reproductor");
else if (globo && !globo.visible) ok("móvil: el globo se oculta sobre la radio");
else fallo("globo sobre la radio", JSON.stringify(globo));
const boton = await paginaMovil.locator("#radio .radio-card__action, #radio button").first().boundingBox();
report.datos.botonRadio = boton ? { x: Math.round(boton.x), y: Math.round(boton.y), w: Math.round(boton.width) } : null;
await paginaMovil.screenshot({ path: path.join(OUT, "visitas-movil.png"), fullPage: false });
report.capturas.push(path.join(OUT, "visitas-movil.png"));
await paginaMovil.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await paginaMovil.waitForTimeout(1200);
const trasBajar = await paginaMovil.evaluate(() => getComputedStyle(document.getElementById("visitCounter")).display !== "none");
report.datos.globoTrasBajar = trasBajar;
if (trasBajar) ok("móvil: el globo vuelve al salir de la tarjeta"); else fallo("globo tras bajar", "sigue oculto");
await movil.close();
try {
  report.datos.limpieza = limpiarFixtures();
  ok("fixtures de rol retirados con sus sesiones");
} catch (error) {
  report.datos.limpieza = String(error).slice(0, 300);
  fallo("limpieza de fixtures", String(error).slice(0, 200));
}

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
