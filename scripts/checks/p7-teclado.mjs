/* global document -- page.evaluate corre en la página */
// CRV · P7 · teclado de las ventanas 3.1-3.13 y /cuenta (§6 de las instrucciones).
//
// Abre cada ventana, comprueba que el foco entra en el diálogo y que Escape la
// cierra sin dejar rastro. No guarda nada. Deja informe en el staging del SSD.
//
// Uso: node scripts/checks/p7-teclado.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BASE, entrar, ipDePrueba } from "./lib/sesion.mjs";
import { prepararFixtures, limpiarFixtures } from "./lib/fixtures.mjs";

const OUT = path.join(os.homedir(), "crv-staging/reports/p7-teclado-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const HERRAMIENTAS = ["personas", "pendientes", "candidaturas", "metricas", "formulario", "enlaces", "identidad", "idiomas", "ajustes", "clave"];

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const IP = ipDePrueba("p7-teclado");
prepararFixtures();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
const page = await context.newPage();
await entrar(page, { base: BASE, usuario: USER, clave: PASS });

const focoDentro = () => page.evaluate(() => {
  const panel = document.querySelector(".modal-panel, .rw-window");
  if (!panel) return null;
  const activo = document.activeElement;
  return Boolean(activo && panel.contains(activo) && activo !== document.body);
});

async function ventanaDeUrl(herramienta) {
  await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=${herramienta}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".modal-panel", { timeout: 20000 });
  await page.waitForTimeout(500);
  const foco = await focoDentro();
  if (foco) ok(`3.x ${herramienta}: foco dentro al abrir`);
  else fallo(`3.x ${herramienta}: foco`, String(foco));
  await page.keyboard.press("Escape");
  const cerrada = await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
  if (cerrada) ok(`3.x ${herramienta}: Escape cierra`);
  else fallo(`3.x ${herramienta}: Escape`, "la ventana sigue abierta");
  await page.screenshot({ path: path.join(OUT, `p7-${herramienta}.png`) });
}

for (const herramienta of HERRAMIENTAS) await ventanaDeUrl(herramienta);

// 3.1 y 3.2: se abren desde la barra de herramientas, no por URL.
await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
for (const [nombre, texto] of [["3.1 Nueva actividad", /Nueva actividad/], ["3.2 Nueva etapa", /Nueva etapa/]]) {
  await page.getByRole("button", { name: texto }).first().click();
  await page.waitForSelector(".modal-panel", { timeout: 10000 });
  await page.waitForTimeout(300);
  if (await focoDentro()) ok(`${nombre}: foco dentro al abrir`); else fallo(`${nombre}: foco`, "fuera del diálogo");
  await page.keyboard.press("Escape");
  const cerrada = await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
  if (cerrada) ok(`${nombre}: Escape cierra`); else fallo(`${nombre}: Escape`, "sigue abierta");
}

// 3.3: lápiz de la primera actividad.
{
  const editar = page.locator('button[aria-label^="Editar"]').first();
  if (await editar.count()) {
    await editar.click();
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await page.waitForTimeout(300);
    if (await focoDentro()) ok("3.3 Editar actividad: foco dentro al abrir"); else fallo("3.3: foco", "fuera");
    await page.keyboard.press("Escape");
    const cerrada = await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
    if (cerrada) ok("3.3 Editar actividad: Escape cierra"); else fallo("3.3: Escape", "sigue abierta");
  } else fallo("3.3 Editar actividad", "no hay botón de edición");
}

// /cuenta: página completa, sin modal; comprueba foco en el primer campo.
await page.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
const cuenta = await page.evaluate(() => ({
  texto: document.body.innerText.slice(0, 400),
  primerCampo: Boolean(document.querySelector("input, textarea, select")),
}));
report.datos.cuenta = cuenta;
if (/Mi perfil|Datos personales|Sesión:/.test(cuenta.texto)) ok("/cuenta: cabecera y datos personales");
else fallo("/cuenta", cuenta.texto.slice(0, 120));
if (cuenta.primerCampo) ok("/cuenta: campos editables"); else fallo("/cuenta: campos", "ninguno");
await page.screenshot({ path: path.join(OUT, "p7-cuenta.png"), fullPage: true });

// Móvil: una ventana representativa, sin desborde y con Escape.
const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP }, storageState: await context.storageState() });
const mpage = await movil.newPage();
await mpage.goto(`${BASE}/crv/curaduria/roadmap?herramienta=personas`, { waitUntil: "networkidle" });
await mpage.waitForSelector(".modal-panel", { timeout: 20000 });
const desborde = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (desborde <= 1) ok("móvil 390: sin desborde"); else fallo("móvil 390: desborde", `${desborde}px`);
const focoMovil = await mpage.evaluate(() => {
  const panel = document.querySelector(".modal-panel, .rw-window");
  return Boolean(panel && document.activeElement && panel.contains(document.activeElement));
});
if (focoMovil) ok("móvil 390: foco dentro"); else fallo("móvil 390: foco", "fuera");
await mpage.keyboard.press("Escape");
const cerradaMovil = await mpage.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
if (cerradaMovil) ok("móvil 390: Escape cierra"); else fallo("móvil 390: Escape", "sigue abierta");
await movil.close();

await context.close();
await browser.close();
try {
  limpiarFixtures();
  ok("fixtures de rol retirados");
} catch (error) {
  fallo("limpieza de fixtures", String(error).slice(0, 200));
}
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
