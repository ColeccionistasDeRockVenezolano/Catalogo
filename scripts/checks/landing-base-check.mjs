/* global document, window, getComputedStyle -- las funciones de page.evaluate corren en la página */
// CRV · comprobación de la base 1.1.39 en la portada pública.
//
// Verifica que /crv/roadmap sirve el radio.js de CRV y los assets de 1.1.39 (CSS con
// ?v=1.1.39), que la tarjeta de radio se pinta, que no hay errores de consola y
// que no se pide /api/radio/diagnostic (CRV no la tiene hasta la Fase 3).
// Escritorio 1440 y móvil 390, ES y EN.
//
// Uso: node scripts/checks/landing-base-check.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/p3-base");
await mkdir(OUT, { recursive: true });

const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
for (const vista of [
  { nombre: "escritorio-es", viewport: { width: 1440, height: 900 }, lang: "es" },
  { nombre: "escritorio-en", viewport: { width: 1440, height: 900 }, lang: "en" },
  { nombre: "movil-es", viewport: { width: 390, height: 844 }, lang: "es", touch: true },
  { nombre: "movil-en", viewport: { width: 390, height: 844 }, lang: "en", touch: true },
]) {
  const context = await browser.newContext({ viewport: vista.viewport, hasTouch: Boolean(vista.touch), locale: vista.lang === "en" ? "en-US" : "es-VE" });
  const page = await context.newPage();
  const errores = [];
  const peticiones = [];
  page.on("pageerror", (error) => errores.push(`pageerror: ${String(error).slice(0, 160)}`));
  page.on("console", (message) => {
    // El 401 de /auth/me antes de entrar es la comprobación normal del shell.
    if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errores.push(`${message.text().slice(0, 160)} [${message.location().url.slice(0, 80)}]`);
  });
  page.on("response", (respuesta) => {
    if (respuesta.status() >= 400) peticiones.push(`${respuesta.status()} ${respuesta.url().replace(BASE, "")}`);
  });

  const respuesta = await page.goto(`${BASE}/crv/roadmap?lang=${vista.lang}`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  if (respuesta?.status() === 200) ok(`${vista.nombre}: portada 200`); else fallo(`${vista.nombre}: portada`, respuesta?.status());

  const assets = await page.evaluate(() => ({
    // radio.js se carga bajo demanda al pulsar el control: el documento solo
    // declara su URL en data-radio-client.
    radio: [...document.querySelectorAll("[data-radio-client]")].map((n) => n.getAttribute("data-radio-client")),
    css: [...document.querySelectorAll('link[rel="stylesheet"]')].map((n) => n.getAttribute("href")),
    radioCard: document.querySelectorAll("#radio").length,
    play: document.querySelectorAll("#radio [data-radio-identifier-toggle], #radio .radio-card__action").length,
    online: (() => {
      const nodo = document.getElementById("visitCounter");
      if (!nodo) return null;
      const estilo = getComputedStyle(nodo);
      return { display: estilo.display, clases: nodo.className };
    })(),
  }));
  report.datos[vista.nombre] = assets;
  if (assets.radio.some((src) => /radio\.js\?v=crv-2026-11-03b/.test(src ?? ""))) ok(`${vista.nombre}: radio.js propio de CRV`);
  else fallo(`${vista.nombre}: radio.js`, JSON.stringify(assets.radio));
  if (assets.css.some((href) => /roadmap-public\.min\.css\?v=1\.1\.39/.test(href ?? ""))) ok(`${vista.nombre}: CSS de 1.1.39`);
  else fallo(`${vista.nombre}: CSS`, JSON.stringify(assets.css));
  if (assets.radioCard === 1) ok(`${vista.nombre}: tarjeta de radio`); else fallo(`${vista.nombre}: tarjeta`, assets.radioCard);
  if (assets.play >= 1) ok(`${vista.nombre}: control de reproducción`); else fallo(`${vista.nombre}: control`, assets.play);

  const diagnostico = peticiones.filter((linea) => /radio\/diagnostic/.test(linea));
  if (diagnostico.length === 0) ok(`${vista.nombre}: sin peticiones a /radio/diagnostic`);
  else fallo(`${vista.nombre}: diagnóstico`, diagnostico.join(" · "));

  const noEncontradas = peticiones.filter((linea) => /^404/.test(linea));
  if (noEncontradas.length === 0) ok(`${vista.nombre}: sin 404`);
  else fallo(`${vista.nombre}: 404`, noEncontradas.slice(0, 3).join(" · "));

  if (errores.length === 0) ok(`${vista.nombre}: consola sin errores`);
  else fallo(`${vista.nombre}: consola`, errores.slice(0, 2).join(" · "));

  await page.screenshot({ path: path.join(OUT, `roadmap-${vista.nombre}.png`), fullPage: false });
  report.capturas.push(path.join(OUT, `roadmap-${vista.nombre}.png`));
  await context.close();
}

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
