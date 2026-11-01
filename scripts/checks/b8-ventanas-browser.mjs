/* global document -- las funciones de page.evaluate corren en la página */
// CRV · B8 · Ventanas 3.8 (formulario de colaboración) y 3.9 (enlaces de
// registro) en el panel del roadmap, con efecto real en /colaborar.
//
// Uso: node scripts/checks/b8-ventanas-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/b8-ventanas-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => { report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`); };
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();

async function open(viewport, lang, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, locale: lang === "en" ? "en-US" : "es-VE" });
  await context.addInitScript((value) => localStorage.setItem("crv-lang", value), lang);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errors.push(message.text().slice(0, 200));
  });
  await page.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
  if (await page.locator("#op-username").count()) {
    await page.fill("#op-username", USER);
    await page.fill("#op-password", PASS);
    await page.click("form button");
    await page.waitForTimeout(1500);
  }
  return { context, page, errors };
}

async function abrirHerramienta(page, nombre) {
  await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=${nombre}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rw-window", { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function shoot(page, name, fullPage = false) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  report.capturas.push(file);
}

/** Espera activa hasta que la condición se cumpla (máx. `timeoutMs`). */
async function esperarA(fn, timeoutMs = 8_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** /colaborar se sirve de la caché anónima del gateway (30 s). */
async function esperarColaborar(page, comprobar, timeoutMs = 45_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await page.goto(`${BASE}/crv/colaborar`, { waitUntil: "domcontentloaded" });
    if (await comprobar(page)) return Math.round((Date.now() - inicio) / 1000);
    await page.waitForTimeout(3_000);
  }
  return -1;
}

// ------------------------------------------------- escritorio: ventanas y efecto
let sesion = null;
{
  const { context, page, errors } = await open({ width: 1440, height: 900 }, "es");
  try {
  await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
  await page.waitForSelector(".roadmap-admin__tool");

  const botones = await page.evaluate(() => [...document.querySelectorAll(".roadmap-admin__tool")]
    .map((node) => ({ texto: node.textContent?.trim() ?? "", disabled: node.hasAttribute("disabled") })));
  report.datos.herramientas = botones;
  for (const nombre of ["Formulario de colaboración", "Enlaces de registro", "Candidaturas"]) {
    const boton = botones.find((item) => item.texto.startsWith(nombre));
    if (boton && !boton.disabled) ok(`herramienta habilitada: ${nombre}`);
    else fallo(`herramienta ${nombre}`, boton ? "deshabilitada" : "no está");
  }

  // ---- 3.8 formulario
  await abrirHerramienta(page, "formulario");
  report.datos.urlFormulario = page.url();
  const pestañas = await page.locator(".rw-tabs button").allTextContents();
  if (["Campos", "Textos", "Categorías de perfil"].every((texto) => pestañas.includes(texto))) {
    ok("3.8: tres pestañas", pestañas.join(" · "));
  } else fallo("3.8: pestañas", pestañas.join(" · "));

  const filas = await page.locator(".rw-segrow").count();
  report.datos.filasCampos = filas;
  if (filas >= 15) ok("3.8: filas de campos con su segmentado", `${filas} filas`);
  else fallo("3.8: filas", String(filas));

  // Ciudad -> No pedir
  const filaCiudad = page.locator(".rw-segrow", { hasText: "Ciudad" }).first();
  await filaCiudad.getByRole("button", { name: "No pedir" }).click();
  await page.locator(".rw-foot").getByRole("button", { name: /Guardar formulario/ }).click();
  await page.waitForTimeout(1800);

  const segundosIda = await esperarColaborar(page, async (target) => await target.locator("#f-city, [name=f-city], [name=city]").count() === 0);
  report.datos.colaborarSinCiudad = segundosIda;
  if (segundosIda >= 0) ok("3.8: /colaborar deja de pedir Ciudad", `${segundosIda}s`);
  else fallo("3.8: efecto en /colaborar", "Ciudad seguía apareciendo tras 45s");

  // Se restaura
  await abrirHerramienta(page, "formulario");
  const filaCiudad2 = page.locator(".rw-segrow", { hasText: "Ciudad" }).first();
  await filaCiudad2.getByRole("button", { name: "Opcional" }).click();
  await page.locator(".rw-foot").getByRole("button", { name: /Guardar formulario/ }).click();
  await page.waitForTimeout(1800);
  const segundosVuelta = await esperarColaborar(page, async (target) => await target.locator("[name=city]").count() > 0);
  report.datos.colaborarConCiudad = segundosVuelta;
  if (segundosVuelta >= 0) ok("3.8: Ciudad vuelve a pedirse", `${segundosVuelta}s`);
  else fallo("3.8: restauración", "Ciudad no volvió tras 45s");

  // Categorías: cifras reales del catálogo
  await abrirHerramienta(page, "formulario");
  await page.getByRole("tab", { name: "Categorías de perfil" }).click();
  await page.waitForTimeout(400);
  const columnas = await page.locator(".rw-termcol h3").allTextContents();
  report.datos.columnasCategorias = columnas.map((texto) => texto.replace(/\s+/gu, " ").trim());
  if (columnas.length === 3) ok("3.8: tres columnas de categorías", report.datos.columnasCategorias.join(" · "));
  else fallo("3.8: columnas de categorías", String(columnas.length));
  await shoot(page, "b8-formulario-categorias-escritorio-es", true);

  await page.getByRole("tab", { name: "Textos" }).click();
  await page.waitForTimeout(300);
  const camposTexto = await page.locator(".rw-field input, .rw-field textarea").count();
  report.datos.camposTexto = camposTexto;
  if (camposTexto >= 30) ok("3.8: pestaña Textos con portada, pasos, etiquetas y avisos", `${camposTexto} campos`);
  else fallo("3.8: campos de texto", String(camposTexto));
  await shoot(page, "b8-formulario-textos-escritorio-es", true);

  await page.getByRole("tab", { name: "Campos" }).click();
  await page.waitForTimeout(300);
  await shoot(page, "b8-formulario-campos-escritorio-es", true);

  // ---- 3.9 enlaces
  await abrirHerramienta(page, "enlaces");
  const textoNota = (await page.locator(".rw-window").innerText()).replace(/\s+/gu, " ");
  if (/vence 30 minutos/.test(textoNota)) ok("3.9: la nota dice 30 minutos");
  else fallo("3.9: nota", textoNota.slice(0, 120));

  await page.getByRole("button", { name: /Generar enlace/ }).click();
  await esperarA(async () => await page.locator(".rw-copybox").count() > 0, 8_000);
  const caja = await page.locator(".rw-copybox").count();
  const enlace = caja ? await page.locator(".rw-copybox code").innerText() : "";
  report.datos.enlaceGenerado = enlace;
  if (caja && /\/crv\/registro\?token=/.test(enlace)) ok("3.9: enlace generado y visible con Copiar", enlace.slice(0, 48));
  else fallo("3.9: enlace generado", enlace);

  await esperarA(async () => await page.locator(".rw-row").count() === 1, 8_000);
  const filasActivas = await page.locator(".rw-row").count();
  if (filasActivas === 1) ok("3.9: un enlace activo en la lista");
  else fallo("3.9: lista de activos", String(filasActivas));
  await shoot(page, "b8-enlaces-escritorio-es", true);

  await page.locator(".rw-row").first().getByRole("button", { name: /Revocar/ }).click();
  await page.waitForSelector("[role=alertdialog]", { timeout: 5000 });
  await page.getByRole("button", { name: "Revocar enlace" }).click();
  await esperarA(async () => await page.locator(".rw-row").count() === 0, 8_000);
  const vacio = await page.locator(".community-empty").count();
  report.datos.enlacesTrasRevocar = await page.locator(".rw-row").count();
  if (vacio === 1 && report.datos.enlacesTrasRevocar === 0) ok("3.9: revocar deja la lista vacía");
  else fallo("3.9: revocar", `${report.datos.enlacesTrasRevocar} filas`);

  // EN: los títulos del panel cambian de idioma
  await page.evaluate(() => localStorage.setItem("crv-lang", "en"));
  // El proveedor de i18n lee localStorage al montar: se recarga.
  await abrirHerramienta(page, "formulario");
  const tituloEn = (await page.locator("[role=dialog] h1, [role=dialog] .modal__title").first().textContent().catch(() => "")) ?? "";
  const botonesEn = await page.locator(".rw-tabs button").allTextContents();
  report.datos.en = { titulo: tituloEn.trim(), pestañas: botonesEn };
  await shoot(page, "b8-formulario-escritorio-en", true);
  ok("EN: captura de la ventana con el panel en inglés", botonesEn.join(" · "));

  if (errors.length === 0) ok("escritorio: consola sin errores");
  else fallo("consola escritorio", errors.slice(0, 3).join(" | "));
  sesion = await context.storageState();
  } catch (error) {
    fallo("escritorio: bloque interrumpido", String(error).slice(0, 300));
    await shoot(page, "b8-error-escritorio", false).catch(() => {});
  } finally {
    await context.close();
  }
}

// --------------------------------------------------------------------- móvil
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: "es-VE", ...(sesion ? { storageState: sesion } : {}) });
  await context.addInitScript(() => localStorage.setItem("crv-lang", "es"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errors.push(message.text().slice(0, 200));
  });
  try {
  await abrirHerramienta(page, "formulario");
  const desbordeFormulario = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.datos.desbordeMovilFormulario = desbordeFormulario;
  if (desbordeFormulario <= 1) ok("móvil: formulario sin desborde horizontal");
  else fallo("móvil: desborde formulario", `${desbordeFormulario}px`);
  await shoot(page, "b8-formulario-movil-es", true);

  await abrirHerramienta(page, "enlaces");
  await page.getByRole("button", { name: /Generar enlace/ }).click();
  await esperarA(async () => await page.locator(".rw-copybox").count() > 0, 8_000);
  const desbordeEnlaces = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.datos.desbordeMovilEnlaces = desbordeEnlaces;
  if (desbordeEnlaces <= 1) ok("móvil: enlaces sin desborde horizontal");
  else fallo("móvil: desborde enlaces", `${desbordeEnlaces}px`);
  await shoot(page, "b8-enlaces-movil-es", true);
  // Se revoca el enlace de la prueba móvil para no dejar basura.
  const filas = await page.locator(".rw-row").count();
  if (filas > 0) {
    await page.locator(".rw-row").first().getByRole("button", { name: /Revocar/ }).click();
    await page.waitForSelector("[role=alertdialog]");
    await page.getByRole("button", { name: "Revocar enlace" }).click();
    await esperarA(async () => await page.locator(".rw-row").count() === 0, 8_000);
  }
  report.datos.enlacesMovilRestantes = await page.locator(".rw-row").count();
  if (report.datos.enlacesMovilRestantes === 0) ok("móvil: enlaces de prueba revocados");
  else fallo("móvil: limpieza de enlaces", String(report.datos.enlacesMovilRestantes));

  if (errors.length === 0) ok("móvil: consola sin errores");
  else fallo("consola móvil", errors.slice(0, 3).join(" | "));
  } catch (error) {
    fallo("móvil: bloque interrumpido", String(error).slice(0, 300));
    await shoot(page, "b8-error-movil", false).catch(() => {});
  } finally {
    await context.close();
  }
}

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
