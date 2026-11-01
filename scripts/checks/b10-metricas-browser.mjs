/* global document, window -- las funciones de page.evaluate corren en la página */
// CRV · B10 · Ventana 3.7 «Métricas» (C7) en un navegador real.
//
// Comprueba la estructura de la ventana, el cambio de periodo, las barras SVG,
// la tabla de agentes, el conmutador «Ver como tabla», la apertura del diálogo
// de «Poner a cero» (sin confirmarlo: borraría el histórico de staging) y el
// móvil sin desbordes. Deja capturas e informe en el staging del SSD.
//
// Uso: node scripts/checks/b10-metricas-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BASE, entrar } from "./lib/sesion.mjs";

const OUT = path.join(os.homedir(), "crv-staging/reports/b10-metricas-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
await entrar(await context.newPage(), { base: BASE, usuario: USER, clave: PASS });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errors.push(message.text().slice(0, 200));
});

await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=metricas`, { waitUntil: "networkidle" });
await page.waitForSelector(".metrics", { timeout: 25000 });

const titulo = (await page.locator(".metrics__head h3").innerText()).trim();
report.datos.titulo = titulo;
if (titulo.toLowerCase() === "personas y bots") ok("título «Personas y bots»"); else fallo("título", titulo);

const sub = (await page.locator(".metrics__head p").innerText()).trim();
if (/Solo las personas suman/.test(sub)) ok("descripción de la ventana"); else fallo("descripción", sub);

const rangos = await page.locator(".metrics__ranges button").allTextContents();
report.datos.rangos = rangos;
if (rangos.join("|") === "7 días|30 días|90 días") ok("periodos 7/30/90"); else fallo("periodos", rangos.join("|"));

await page.waitForSelector(".metrics__confirmed strong");
const confirmadas = (await page.locator(".metrics__confirmed strong").innerText()).trim();
report.datos.confirmadas = confirmadas;
if (/^\d/.test(confirmadas)) ok("tarjeta de personas confirmadas", confirmadas); else fallo("confirmadas", confirmadas);

const tarjetas = await page.locator(".metrics__card span").allTextContents();
report.datos.tarjetas = tarjetas;
const esperadas = ["Personas probables", "IA", "Buscadores", "Otros bots", "Sospechosos"];
if (esperadas.every((nombre) => tarjetas.includes(nombre))) ok("cinco tarjetas por tipo", tarjetas.length);
else fallo("tarjetas", tarjetas.join(" · "));

const barras = await page.locator(".metrics__chart rect").count();
report.datos.barras = barras;
if (barras > 10) ok("barras SVG propias", barras); else fallo("barras", barras);

// Cambio de periodo: la API devuelve otro rango y la serie se vuelve a pintar.
await page.locator(".metrics__ranges button", { hasText: "7 días" }).click();
await page.waitForTimeout(1200);
const meta = await page.locator(".metrics__meta").innerText();
report.datos.meta7 = meta.replace(/\s+/g, " ").slice(0, 120);
if (/Del \d{4}-\d{2}-\d{2} al/.test(meta)) ok("periodo de 7 días aplicado"); else fallo("meta de periodo", meta);

// Conmutador Peticiones y vista de tabla.
await page.locator(".metrics__toggle button", { hasText: "Peticiones" }).click();
const activo = await page.locator(".metrics__toggle button.is-active").first().innerText();
if (/Peticiones/.test(activo)) ok("conmutador Visitantes/Peticiones"); else fallo("conmutador", activo);
await page.locator(".metrics__toggle button", { hasText: "Ver como tabla" }).click();
await page.waitForSelector(".metrics__table");
const filasTabla = await page.locator(".metrics__table").first().locator("tbody tr").count();
report.datos.filasTabla = filasTabla;
if (filasTabla === 7) ok("vista de tabla por día", filasTabla); else fallo("tabla diaria", filasTabla);
await page.locator(".metrics__toggle button", { hasText: "Ver como tabla" }).click();

// Pestañas de agentes y columnas de la tabla.
const tabs = await page.locator(".metrics__toggle").nth(1).locator("button").allTextContents();
report.datos.tabs = tabs;
if (tabs.some((t) => /^Todos/.test(t)) && tabs.some((t) => /^IA/.test(t))) ok("pestañas de agentes", tabs.join(" | "));
else fallo("pestañas", tabs.join(" | "));
const cabeceras = await page.locator(".metrics__table thead th").last().locator("xpath=..").locator("th").allTextContents();
report.datos.cabecerasAgentes = cabeceras;
const requeridas = ["Agente", "Uso", "Verificación", "Peticiones", "Visitantes", "Ejecutó JS", "Última visita"];
if (requeridas.every((nombre) => cabeceras.some((c) => c.trim() === nombre))) ok("columnas de agentes");
else fallo("columnas de agentes", cabeceras.join(" | "));

const pantallas = await page.locator(".metrics__pages li span").allTextContents();
report.datos.pantallas = pantallas;
if (pantallas.length > 0) ok("pantallas más pedidas", pantallas.slice(0, 3).join(", ")); else fallo("pantallas", "vacío");

const paises = await page.locator(".metrics__countries-title").allTextContents();
if (paises.length === 2) ok("países en dos columnas", paises.join(" · ")); else fallo("países", paises.join(" · "));

await page.locator(".metrics__how summary").click();
const comoSeDecide = await page.locator(".metrics__how ol li").count();
report.datos.comoSeDecide = comoSeDecide;
if (comoSeDecide >= 8) ok("«Cómo se decide y qué se guarda»", comoSeDecide); else fallo("cómo se decide", comoSeDecide);

await page.screenshot({ path: path.join(OUT, "metricas-escritorio.png"), fullPage: true });
report.capturas.push(path.join(OUT, "metricas-escritorio.png"));

// «Poner a cero»: se abre el diálogo y se cancela (no se borra el histórico).
await page.locator(".metrics__danger").click();
await page.waitForSelector(".modal-panel");
const dialogo = await page.locator(".modal-panel").last().innerText();
report.datos.dialogo = dialogo.replace(/\s+/g, " ").slice(0, 160);
if (/Poner el contador a cero/.test(dialogo)) ok("diálogo de confirmación de «Poner a cero»");
else fallo("diálogo", dialogo);
await page.screenshot({ path: path.join(OUT, "metricas-cero.png"), fullPage: false });
report.capturas.push(path.join(OUT, "metricas-cero.png"));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Escape cierra la ventana y el foco vuelve a la barra de herramientas.
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const ventanaCerrada = (await page.locator(".metrics").count()) === 0;
if (ventanaCerrada) ok("Escape cierra la ventana"); else fallo("Escape", "la ventana sigue abierta");

if (errors.length === 0) ok("consola sin errores"); else fallo("consola", errors.slice(0, 3).join(" | "));

// ------------------------------------------------------------------- móvil
const movil = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, locale: "es-VE",
  storageState: await context.storageState(),
});
const paginaMovil = await movil.newPage();
const erroresMovil = [];
paginaMovil.on("pageerror", (error) => erroresMovil.push(String(error).slice(0, 200)));
await paginaMovil.goto(`${BASE}/crv/curaduria/roadmap?herramienta=metricas`, { waitUntil: "networkidle" });
await paginaMovil.waitForSelector(".metrics", { timeout: 25000 });
const desborde = await paginaMovil.evaluate(() => ({
  pagina: document.documentElement.scrollWidth - window.innerWidth,
  panel: (() => {
    const panel = document.querySelector(".modal-panel");
    return panel ? Math.round(panel.getBoundingClientRect().right - window.innerWidth) : null;
  })(),
}));
report.datos.movil = desborde;
if (desborde.pagina <= 1 && (desborde.panel ?? 0) <= 1) ok("móvil sin desborde horizontal", JSON.stringify(desborde));
else fallo("móvil: desborde", JSON.stringify(desborde));
await paginaMovil.screenshot({ path: path.join(OUT, "metricas-movil.png"), fullPage: true });
report.capturas.push(path.join(OUT, "metricas-movil.png"));
if (erroresMovil.length === 0) ok("móvil: sin errores de página"); else fallo("móvil: errores", erroresMovil.slice(0, 2).join(" | "));
await movil.close();

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
