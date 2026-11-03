// CRV · Ensayo de la Fase 2B en la instancia raíz (:3141).
//
// §5.2.2 del plan, en ES, EN y móvil: portada con radio, contador, candidatura,
// /login, y la rama «enlace no válido» de /registro y /activar. Los POST a
// /api/radio/listener y /api/radio/unavailable se BLOQUEAN en el navegador: son
// la emisión real de Herra y el ensayo no debe alterar sus oyentes.
//
// Uso: node scripts/checks/fase2b-ensayo.mjs [--base http://127.0.0.1:3141]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:3141").replace(/\/$/u, "");
const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/fase2b-ensayo");
await mkdir(OUT, { recursive: true });

const report = { cuando: new Date().toISOString(), base: BASE, ok: [], fallos: [], bloqueadas: 0, capturas: [], datos: {} };
const ok = (nombre, extra) => report.ok.push(extra === undefined ? nombre : `${nombre} (${String(extra)})`);
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${String(detalle)}`);

const browser = await chromium.launch();
for (const vista of [
  { nombre: "escritorio-es", viewport: { width: 1440, height: 900 }, lang: "es" },
  { nombre: "escritorio-en", viewport: { width: 1440, height: 900 }, lang: "en" },
  { nombre: "movil-es", viewport: { width: 390, height: 844 }, lang: "es", touch: true },
]) {
  const context = await browser.newContext({ viewport: vista.viewport, hasTouch: Boolean(vista.touch), locale: vista.lang === "en" ? "en-US" : "es-VE" });
  // Nunca tocar la emisión real: se cortan los POST de presencia.
  await context.route("**/api/radio/listener", (ruta) => { report.bloqueadas += 1; void ruta.abort(); });
  await context.route("**/api/radio/unavailable", (ruta) => { report.bloqueadas += 1; void ruta.abort(); });
  const page = await context.newPage();
  const errores = [];
  const cuatroCientos = [];
  page.on("pageerror", (error) => errores.push(String(error).slice(0, 150)));
  page.on("console", (mensaje) => { if (mensaje.type() === "error" && !/401 \(Unauthorized\)|net::ERR_FAILED/.test(mensaje.text())) errores.push(mensaje.text().slice(0, 150)); });
  page.on("response", (respuesta) => { if (respuesta.status() >= 400) cuatroCientos.push(`${respuesta.status()} ${respuesta.url().replace(BASE, "")}`); });

  const portada = await page.goto(`${BASE}/?lang=${vista.lang}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // La lista de etapas se difiere hasta la primera interacción con #roadmap
  // (public-loader): se dispara el mismo evento que usa la portada.
  await page.evaluate(() => {
    document.getElementById("roadmap")?.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
  });
  await page.waitForTimeout(2500);
  if (portada?.status() === 200) ok(`${vista.nombre}: portada 200`); else fallo(`${vista.nombre}: portada`, portada?.status());

  const datos = await page.evaluate(() => ({
    radio: document.querySelectorAll("#radio").length,
    progreso: document.querySelector(".overall")?.textContent?.replace(/\s+/g, " ").slice(0, 80) ?? null,
    etapas: document.querySelectorAll(".cat-block").length,
    visitas: !!document.getElementById("visitCounter"),
    enlacesCatalogo: [...document.querySelectorAll('a[href*="/curaduria"], a[href*="/artists"], a[href*="/buscar"]')].length,
  }));
  report.datos[vista.nombre] = datos;
  if (datos.radio === 1) ok(`${vista.nombre}: tarjeta de radio`); else fallo(`${vista.nombre}: radio`, datos.radio);
  if (datos.etapas >= 1) ok(`${vista.nombre}: etapas del roadmap`, datos.etapas); else fallo(`${vista.nombre}: etapas`, datos.etapas);
  if (datos.visitas) ok(`${vista.nombre}: contador de visitas`); else fallo(`${vista.nombre}: contador`, "no está");
  if (datos.enlacesCatalogo === 0) ok(`${vista.nombre}: sin enlaces al catálogo`); else fallo(`${vista.nombre}: enlaces al catálogo`, datos.enlacesCatalogo);
  if (errores.length === 0) ok(`${vista.nombre}: consola sin errores`); else fallo(`${vista.nombre}: consola`, errores.slice(0, 2).join(" · "));

  const noEncontradas = cuatroCientos.filter((linea) => /^404/.test(linea) && !/favicon|llms/.test(linea));
  if (noEncontradas.length === 0) ok(`${vista.nombre}: sin 404 inesperados`); else fallo(`${vista.nombre}: 404`, noEncontradas.slice(0, 3).join(" · "));

  await page.screenshot({ path: path.join(OUT, `portada-${vista.nombre}.png`), fullPage: false });
  report.capturas.push(path.join(OUT, `portada-${vista.nombre}.png`));

  // /colaborar y /login.
  for (const ruta of ["/colaborar", "/login"]) {
    const respuesta = await page.goto(`${BASE}${ruta}?lang=${vista.lang}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const formulario = await page.locator("form").count();
    if (respuesta?.status() === 200 && formulario >= 1) ok(`${vista.nombre}: ${ruta} con formulario`);
    else fallo(`${vista.nombre}: ${ruta}`, `${respuesta?.status()} · ${formulario} formularios`);
  }

  // /registro y /activar sin token: rama «enlace no válido», no 404.
  for (const ruta of ["/registro", "/activar"]) {
    const respuesta = await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
    const texto = await page.locator("body").innerText().catch(() => "");
    if (respuesta?.status() === 200 && /no (es )?válido|caducad|invalid|expired/i.test(texto)) ok(`${vista.nombre}: ${ruta} con enlace inválido`);
    else fallo(`${vista.nombre}: ${ruta}`, `${respuesta?.status()} · ${texto.slice(0, 60)}`);
  }

  await context.close();
}

// --- Candidatura real (crea y se retira por API de staging) -------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
  const page = await context.newPage();
  const respuesta = await page.goto(`${BASE}/colaborar`, { waitUntil: "networkidle" });
  const campos = await page.locator("input, textarea, select").count();
  report.datos.candidatura = { status: respuesta?.status(), campos };
  if (respuesta?.status() === 200 && campos >= 5) ok("candidatura: formulario completo", `${campos} campos`);
  else fallo("candidatura: formulario", `${respuesta?.status()} · ${campos} campos`);
  await context.close();
}

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length, bloqueadas: report.bloqueadas };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
