/* global document -- las funciones de page.evaluate corren en la página */
// CRV · B9 · Ventanas 3.10 (identidad), 3.11 (idiomas) y 3.12 (configuración y
// tema) con efecto real en la portada pública.
//
// Uso: node scripts/checks/b9-ventanas-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/b9-ventanas-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => { report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`); };
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
await context.addInitScript(() => localStorage.setItem("crv-lang", "es"));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errors.push(message.text().slice(0, 200));
});

async function esperarA(fn, timeoutMs = 10_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function abrir(nombre) {
  await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=${nombre}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rw-window", { timeout: 20000 });
  await page.waitForTimeout(700);
}

async function shoot(name, fullPage = true) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  report.capturas.push(file);
}

const siteConfig = () => page.evaluate(async () => {
  const response = await fetch("/crv/api/site-config");
  return response.ok ? await response.json() : { error: response.status };
});

/** La portada anónima se cachea 30 s en el gateway. */
async function esperarPortada(comprobar, timeoutMs = 45_000, url = `${BASE}/crv/roadmap`) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (await comprobar()) return Math.round((Date.now() - inicio) / 1000);
    await page.waitForTimeout(2_500);
  }
  return -1;
}

await page.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
if (await page.locator("#op-username").count()) {
  await page.fill("#op-username", USER);
  await page.fill("#op-password", PASS);
  await page.click("form button");
  await page.waitForTimeout(1500);
}

await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
await page.waitForSelector(".roadmap-admin__tool");
const botones = await page.evaluate(() => [...document.querySelectorAll(".roadmap-admin__tool")]
  .map((node) => ({ texto: node.textContent?.trim() ?? "", disabled: node.hasAttribute("disabled") })));
for (const nombre of ["Identidad y compartir", "Idiomas del proyecto", "Configuración del proyecto"]) {
  const boton = botones.find((item) => item.texto.startsWith(nombre));
  if (boton && !boton.disabled) ok(`herramienta habilitada: ${nombre}`);
  else fallo(`herramienta ${nombre}`, boton ? "deshabilitada" : "no está");
}

try {
  // ---------------------------------------------------------- 3.10 identidad
  await abrir("identidad");
  const pestanas = await page.locator(".rw-tabs button").allTextContents();
  report.datos.pestanasIdentidad = pestanas;
  if (pestanas.length === 6) ok("3.10: seis pestañas", pestanas.join(" · "));
  else fallo("3.10: pestañas", pestanas.join(" · "));
  await shoot("b9-identidad-vista-escritorio-es");

  await page.getByRole("tab", { name: "Imágenes" }).click();
  await page.waitForTimeout(300);
  const imagenes = await page.locator(".rw-images__preview").count();
  const elegir = await page.getByText("Elegir imagen").count();
  report.datos.imagenes = { previsualizaciones: imagenes, botones: elegir };
  if (imagenes >= 1 && elegir >= 2) ok("3.10: imágenes con previsualización y selector", `${imagenes} previsualizaciones`);
  else fallo("3.10: imágenes", JSON.stringify(report.datos.imagenes));

  const metaOriginal = (await siteConfig()).site.branding.metaTitle ?? "";
  report.datos.metaOriginal = metaOriginal;
  await page.getByRole("tab", { name: "Metadatos" }).click();
  await page.waitForTimeout(300);
  const campoMeta = page.locator(".rw-field input").first();
  await campoMeta.fill("CRV B9 PRUEBA");
  await page.getByRole("button", { name: /Guardar identidad/ }).click();
  await page.waitForTimeout(1800);
  const metaNueva = (await siteConfig()).site.branding.metaTitle;
  report.datos.metaNueva = metaNueva;
  if (metaNueva === "CRV B9 PRUEBA") ok("3.10: metaTitle llega a /site-config");
  else fallo("3.10: metaTitle en site-config", String(metaNueva));
  const segundosTitulo = await esperarPortada(async () => (await page.title()) === "CRV B9 PRUEBA");
  report.datos.tituloPortada = { segundos: segundosTitulo, titulo: await page.title() };
  if (segundosTitulo >= 0) ok("3.10: el título de la portada cambia", `${segundosTitulo}s`);
  else fallo("3.10: título de la portada", await page.title());

  // restaura el título
  await abrir("identidad");
  await page.getByRole("tab", { name: "Metadatos" }).click();
  await page.waitForTimeout(300);
  await page.locator(".rw-field input").first().fill(metaOriginal);
  await page.getByRole("button", { name: /Guardar identidad/ }).click();
  await page.waitForTimeout(1600);
  const metaVuelta = (await siteConfig()).site.branding.metaTitle;
  if (metaVuelta === metaOriginal) ok("3.10: metaTitle restaurado", metaOriginal.slice(0, 40));
  else fallo("3.10: restauración del título", String(metaVuelta));

  // ------------------------------------------------------------- 3.11 idiomas
  await abrir("idiomas");
  const tabsIdiomas = await page.locator(".rw-tabs button").allTextContents();
  report.datos.pestanasIdiomas = tabsIdiomas;
  if (tabsIdiomas.length === 3) ok("3.11: tres pestañas", tabsIdiomas.join(" · "));
  else fallo("3.11: pestañas", tabsIdiomas.join(" · "));
  const camposProyecto = await page.locator(".rw-field input").count();
  if (camposProyecto >= 25) ok("3.11: campos del proyecto", String(camposProyecto));
  else fallo("3.11: campos del proyecto", String(camposProyecto));
  await shoot("b9-idiomas-proyecto-escritorio-es");

  const subtitulo = page.locator(".rw-field", { hasText: "Entrada de portada" }).first().locator("input");
  await subtitulo.fill("B9 ENGLISH SUBTITLE");
  await page.getByRole("button", { name: /Guardar traducciones/ }).click();
  await page.waitForTimeout(1800);
  const segundosEn = await esperarPortada(async () => (await page.evaluate(() => document.body.innerText)).includes("B9 ENGLISH SUBTITLE"), 45_000, `${BASE}/crv/roadmap?lang=en`);
  report.datos.subtituloEn = segundosEn;
  if (segundosEn >= 0) ok("3.11: la portada en inglés aplica el texto", `${segundosEn}s`);
  else fallo("3.11: traducción en portada", "no apareció en 45s");

  await abrir("idiomas");
  await page.locator(".rw-field", { hasText: "Entrada de portada" }).first().locator("input").fill("");
  await page.getByRole("button", { name: /Guardar traducciones/ }).click();
  await page.waitForTimeout(1600);
  const segundosVueltaEn = await esperarPortada(async () => !(await page.evaluate(() => document.body.innerText)).includes("B9 ENGLISH SUBTITLE"), 45_000, `${BASE}/crv/roadmap?lang=en`);
  if (segundosVueltaEn >= 0) ok("3.11: vaciar vuelve al español", `${segundosVueltaEn}s`);
  else fallo("3.11: volver al español", "el texto de prueba siguió apareciendo");

  // Roadmap: título de la primera etapa
  await abrir("idiomas");
  await page.getByRole("tab", { name: "Roadmap" }).click();
  await page.waitForTimeout(400);
  const etapas = await page.locator(".rw-field input").count();
  report.datos.camposRoadmap = etapas;
  if (etapas >= 60) ok("3.11: etapas y actividades traducibles", `${etapas} campos`);
  else fallo("3.11: campos del roadmap", String(etapas));
  const primeraEtapa = page.locator(".rw-field input").first();
  const originalEtapa = await primeraEtapa.inputValue();
  await primeraEtapa.fill("STAGE B9 EN");
  await page.getByRole("button", { name: /Guardar títulos/ }).click();
  await page.waitForTimeout(1800);
  const segundosEtapa = await esperarPortada(async () => (await page.evaluate(() => document.body.innerText)).includes("STAGE B9 EN"), 45_000, `${BASE}/crv/roadmap?lang=en`);
  report.datos.etapaEn = segundosEtapa;
  if (segundosEtapa >= 0) ok("3.11: el título de la etapa cambia en inglés", `${segundosEtapa}s`);
  else fallo("3.11: etapa en inglés", "no apareció");
  await abrir("idiomas");
  await page.getByRole("tab", { name: "Roadmap" }).click();
  await page.waitForTimeout(400);
  await page.locator(".rw-field input").first().fill(originalEtapa);
  await page.getByRole("button", { name: /Guardar títulos/ }).click();
  await page.waitForTimeout(1500);
  await shoot("b9-idiomas-roadmap-escritorio-es");

  // ---------------------------------------------- 3.12 configuración y tema
  await abrir("ajustes");
  const tabsAjustes = await page.locator(".rw-tabs button").allTextContents();
  report.datos.pestanasAjustes = tabsAjustes;
  if (tabsAjustes.length === 2) ok("3.12: General y Tema", tabsAjustes.join(" · "));
  else fallo("3.12: pestañas", tabsAjustes.join(" · "));
  const idiomaOriginal = (await siteConfig()).defaultLang;
  await page.locator("select").filter({ hasText: "Español" }).first().selectOption("en");
  await page.getByRole("button", { name: /Guardar configuración general/ }).click();
  await page.waitForTimeout(1600);
  const idiomaNuevo = (await siteConfig()).defaultLang;
  report.datos.idioma = { original: idiomaOriginal, nuevo: idiomaNuevo };
  if (idiomaNuevo === "en") ok("3.12: idioma por defecto cambia en /site-config");
  else fallo("3.12: idioma por defecto", String(idiomaNuevo));
  await page.locator("select").filter({ hasText: "Inglés" }).first().selectOption(idiomaOriginal);
  await page.getByRole("button", { name: /Guardar configuración general/ }).click();
  await page.waitForTimeout(1400);
  if ((await siteConfig()).defaultLang === idiomaOriginal) ok("3.12: idioma por defecto restaurado");
  else fallo("3.12: restauración del idioma", "no volvió");

  await page.getByRole("tab", { name: "Tema del proyecto" }).click();
  await page.waitForTimeout(400);
  const colores = await page.locator(".rw-color").count();
  report.datos.colores = colores;
  if (colores === 12) ok("3.12: doce colores con muestra y hex");
  else fallo("3.12: colores", String(colores));
  const fondoOriginal = (await siteConfig()).site.theme.colors.bg;
  const hexInput = page.locator(".rw-color input:not([type=color])").first();
  await hexInput.fill("#123456");
  await page.getByRole("button", { name: /Guardar tema/ }).click();
  await page.waitForTimeout(1800);
  const fondoNuevo = (await siteConfig()).site.theme.colors.bg;
  report.datos.fondo = { original: fondoOriginal, nuevo: fondoNuevo };
  if (fondoNuevo === "#123456") ok("3.12: el color del tema llega a /site-config");
  else fallo("3.12: color del tema", String(fondoNuevo));
  const segundosColor = await esperarPortada(async () => await page.evaluate(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    return value.toLowerCase() === "#123456";
  }));
  report.datos.colorPortada = segundosColor;
  if (segundosColor >= 0) ok("3.12: la portada aplica el color", `${segundosColor}s`);
  else fallo("3.12: color en la portada", "no se aplicó");
  await abrir("ajustes");
  await page.getByRole("tab", { name: "Tema del proyecto" }).click();
  await page.waitForTimeout(400);
  await page.locator(".rw-color input:not([type=color])").first().fill(fondoOriginal ?? "#0a0a0a");
  await page.getByRole("button", { name: /Guardar tema/ }).click();
  await page.waitForTimeout(1500);
  const fondoVuelta = (await siteConfig()).site.theme.colors.bg;
  if (fondoVuelta === fondoOriginal) ok("3.12: color restaurado", String(fondoOriginal));
  else fallo("3.12: restauración del color", String(fondoVuelta));
  await shoot("b9-ajustes-tema-escritorio-es");

  // Inglés de la interfaz del panel
  await page.evaluate(() => localStorage.setItem("crv-lang", "en"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".roadmap-admin__tool");
  await page.waitForTimeout(500);
  await shoot("b9-panel-escritorio-en", false);
  ok("EN: captura del panel en inglés");

  if (errors.length === 0) ok("escritorio: consola sin errores");
  else fallo("consola escritorio", errors.slice(0, 3).join(" | "));
} catch (error) {
  fallo("bloque de escritorio interrumpido", String(error).slice(0, 300));
  await shoot("b9-error-escritorio", false).catch(() => {});
}

// --------------------------------------------------------------------- móvil
try {
  const sesion = await context.storageState();
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: "es-VE", storageState: sesion });
  await movil.addInitScript(() => localStorage.setItem("crv-lang", "es"));
  const mpage = await movil.newPage();
  const mErrors = [];
  mpage.on("pageerror", (error) => mErrors.push(String(error).slice(0, 200)));
  for (const [nombre, vista] of [["identidad", "identidad-movil"], ["idiomas", "idiomas-movil"], ["ajustes", "ajustes-movil"]]) {
    await mpage.goto(`${BASE}/crv/curaduria/roadmap?herramienta=${nombre}`, { waitUntil: "networkidle" });
    await mpage.waitForSelector(".rw-window", { timeout: 20000 });
    await mpage.waitForTimeout(600);
    const desborde = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.datos[`desborde-${nombre}`] = desborde;
    if (desborde <= 1) ok(`móvil ${nombre}: sin desborde horizontal`);
    else fallo(`móvil ${nombre}: desborde`, `${desborde}px`);
    const file = path.join(OUT, `b9-${vista}.png`);
    await mpage.screenshot({ path: file, fullPage: true });
    report.capturas.push(file);
  }
  if (mErrors.length === 0) ok("móvil: consola sin errores");
  else fallo("consola móvil", mErrors.slice(0, 3).join(" | "));
  await movil.close();
} catch (error) {
  fallo("bloque móvil interrumpido", String(error).slice(0, 300));
}

await context.close();
await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
