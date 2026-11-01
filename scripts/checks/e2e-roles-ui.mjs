/* global document, location -- las funciones de page.evaluate corren en la página */
// CRV · Matriz de roles por INTERFAZ (aceptación Fases 1 y 2).
//
// Para admin, community, curator y colaborador abre /crv/curaduria/roadmap y
// lee la barra lateral y la barra de 13 herramientas: lo que el rol no puede
// usar no se muestra (el servidor ya lo rechaza; ver e2e-flujos.mts). Escritorio
// 1440 en español y móvil 390 en inglés.
//
// Uso: node scripts/checks/e2e-roles-ui.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BASE, entrar, ipDePrueba } from "./lib/sesion.mjs";
import { prepararFixtures, limpiarFixtures } from "./lib/fixtures.mjs";

const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/e2e-roles");
await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const CUENTAS = [
  { rol: "admin", usuario: "fase1-admin", clave: "Fase1Admin2026", tools: 13, comunidad: true, ajustes: true },
  { rol: "community", usuario: "fase1-community", clave: "Fase1Community2026", tools: 13, comunidad: true, ajustes: false },
  { rol: "curator", usuario: "fase1-curator", clave: "Fase1Curator2026", tools: 0, comunidad: false, ajustes: false },
  { rol: "colaborador", usuario: "fase1-admin", clave: "Fase1Admin2026", tools: 0, comunidad: false, ajustes: false, saltar: true },
];

const browser = await chromium.launch();
const IP = ipDePrueba("e2e-roles");
prepararFixtures();
for (const vista of [
  { nombre: "escritorio-es", viewport: { width: 1440, height: 900 }, lang: "es" },
  { nombre: "movil-en", viewport: { width: 390, height: 844 }, lang: "en", touch: true },
]) {
  for (const cuenta of CUENTAS) {
    if (cuenta.saltar) continue;
    const context = await browser.newContext({ viewport: vista.viewport, hasTouch: Boolean(vista.touch), locale: vista.lang === "en" ? "en-US" : "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
    await context.addInitScript((valor) => localStorage.setItem("crv-lang", valor), vista.lang);
    const page = await context.newPage();
    const errores = [];
    page.on("pageerror", (error) => errores.push(String(error).slice(0, 160)));
    await entrar(page, { base: BASE, usuario: cuenta.usuario, clave: cuenta.clave });
    await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);

    const estado = await page.evaluate(() => ({
      url: location.pathname,
      nav: [...document.querySelectorAll(".cside__link, .cside__nav a")].map((n) => (n.textContent ?? "").trim()),
      tools: [...document.querySelectorAll(".roadmap-admin__tool")].map((n) => ({
        label: (n.textContent ?? "").trim(), disabled: n.hasAttribute("disabled"),
      })),
      titulo: document.querySelector("h1")?.textContent?.trim() ?? null,
    }));
    report.datos[`${cuenta.rol}-${vista.nombre}`] = estado;

    const etiqueta = `${cuenta.rol}/${vista.nombre}`;
    if (estado.url.includes("/curaduria/roadmap")) {
      const habilitadas = estado.tools.filter((t) => !t.disabled).length;
      if (habilitadas === cuenta.tools) ok(`${etiqueta}: ${cuenta.tools} herramientas habilitadas`);
      else fallo(`${etiqueta}: herramientas`, `${habilitadas} de ${estado.tools.length}`);
      const tieneComunidad = estado.nav.some((texto) => /Personas|Pendientes|Candidaturas|Métricas|Metrics|People|Applications/i.test(texto));
      if (tieneComunidad === cuenta.comunidad) ok(`${etiqueta}: comunidad ${cuenta.comunidad ? "visible" : "oculta"}`);
      else fallo(`${etiqueta}: comunidad`, tieneComunidad ? "visible" : "oculta");
      const tieneAjustes = estado.nav.some((texto) => /Ajustes|Settings/i.test(texto));
      if (tieneAjustes === cuenta.ajustes) ok(`${etiqueta}: ajustes ${cuenta.ajustes ? "visible" : "oculto"}`);
      else fallo(`${etiqueta}: ajustes`, tieneAjustes ? "visible" : "oculto");
    } else {
      fallo(`${etiqueta}: acceso`, `acabó en ${estado.url}`);
    }
    if (errores.length === 0) ok(`${etiqueta}: sin errores de página`); else fallo(`${etiqueta}: errores`, errores[0]);
    await page.screenshot({ path: path.join(OUT, `${cuenta.rol}-${vista.nombre}.png`), fullPage: false });
    report.capturas.push(path.join(OUT, `${cuenta.rol}-${vista.nombre}.png`));
    await context.close();
  }
}

// El colaborador (cuenta de comunidad aprobada) no entra a curaduría: la API lo rechaza.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE", extraHTTPHeaders: { "x-forwarded-for": IP } });
  const page = await context.newPage();
  const comunidad = await entrar(page, { base: BASE, usuario: "fase1-community", clave: "Fase1Community2026" });
  report.datos["rol-community"] = comunidad?.role;
  const respuesta = await page.evaluate(async () => {
    const r = await fetch("/crv/api/curation/emotions/tags", { credentials: "include" });
    return r.status;
  });
  if (respuesta === 403) ok("community: la API de catálogo responde 403"); else fallo("community API catálogo", respuesta);
  await context.close();
}

await browser.close();
try {
  report.datos.limpieza = limpiarFixtures();
  ok("fixtures de rol retirados con sus sesiones");
} catch (error) {
  report.datos.limpieza = String(error).slice(0, 300);
  fallo("limpieza de fixtures", String(error).slice(0, 200));
}
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
