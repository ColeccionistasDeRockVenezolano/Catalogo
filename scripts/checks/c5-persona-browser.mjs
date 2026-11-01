/* global document */
// CRV · C5 · Editor de persona, cambio de usuario y borrado de cuenta en la
// ventana «Personas y colaboradores» (3.4), con comprobación en la API.
//
// Uso: node scripts/checks/c5-persona-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/c5-persona-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const CUENTA = `c5-persona-${Date.now().toString(36).slice(-4)}`;

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => { report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`); };
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
page.on("console", (message) => {
  if (message.type() === "error" && !/401 \(Unauthorized\)|404 \(Not Found\)/.test(message.text())) errors.push(message.text().slice(0, 200));
});

async function api(fn, arg) {
  return page.evaluate(fn, arg);
}

await page.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
if (await page.locator("#op-username").count()) {
  await page.fill("#op-username", USER);
  await page.fill("#op-password", PASS);
  await page.click("form button");
  await page.waitForTimeout(1500);
}

// Cuenta de prueba por la API (misma que usa el alta de la ventana).
const creada = await api(async (nombre) => {
  const csrf = sessionStorage.getItem("crv-csrf") ?? "";
  const me = await fetch("/crv/api/auth/me", { credentials: "include" });
  const session = me.ok ? await me.json() : { csrf: "" };
  const response = await fetch("/crv/api/community/admin/collaborators", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json", "x-crv-csrf": session.csrf, "x-crv-operator": "c5-check" },
    body: JSON.stringify({ name: nombre, firstName: "Persona", lastName: "C5", accessCode: "ClavePruebaC5" }),
  });
  void csrf;
  return response.ok ? await response.json() : { error: response.status, me: me.status, csrf: Boolean(session.csrf) };
}, CUENTA);
report.datos.creada = creada;
if (!creada.id) {
  fallo("cuenta de prueba", JSON.stringify(creada));
  console.log("FALLO: cuenta de prueba", JSON.stringify(creada));
  await browser.close();
  process.exit(1);
}
ok("cuenta de prueba creada", `${creada.name} #${creada.id}`);

await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=personas`, { waitUntil: "networkidle" });
await page.waitForSelector(".rw-window");
await page.waitForTimeout(1200);
const fila = page.locator(".rw-row", { hasText: CUENTA }).first();
const acciones = await fila.getByRole("button").allTextContents();
report.datos.acciones = acciones.map((texto) => texto.trim());
for (const nombre of ["Perfil", "Usuario", "Código", "Activación", "Revocar", "Quitar"]) {
  if (report.datos.acciones.some((texto) => texto.startsWith(nombre))) ok(`acción presente: ${nombre}`);
  else fallo(`acción ${nombre}`, "no está en la fila");
}

// ---- editor de persona
await fila.getByRole("button", { name: /Perfil/ }).click();
await page.waitForTimeout(1200);
const camposPerfil = await page.locator(".rw-window input, .rw-window textarea").count();
report.datos.camposPerfil = camposPerfil;
if (camposPerfil >= 9) ok("editor de persona con sus 9 campos", String(camposPerfil));
else fallo("editor de persona", `${camposPerfil} campos`);
await page.locator(".rw-window").getByLabel("Disponibilidad").fill("Tardes de martes");
await page.locator(".rw-window").getByLabel("País").fill("Venezuela");
await page.getByRole("button", { name: "Guardar perfil" }).click();
await page.waitForTimeout(1500);
const guardado = await api(async (id) => {
  const response = await fetch(`/crv/api/community/admin/collaborators/${id}/person`, { credentials: "include" });
  return response.ok ? await response.json() : { error: response.status };
}, creada.id);
report.datos.perfil = { availability: guardado.availability, country: guardado.country };
if (guardado.availability === "Tardes de martes" && guardado.country === "Venezuela") {
  ok("el perfil global persiste (disponibilidad y país)");
} else fallo("guardado del perfil", JSON.stringify(report.datos.perfil));
await page.screenshot({ path: path.join(OUT, "c5-perfil-persona.png"), fullPage: false });
report.capturas.push(path.join(OUT, "c5-perfil-persona.png"));

await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// ---- cambiar usuario
const fila2 = page.locator(".rw-row", { hasText: CUENTA }).first();
await fila2.getByRole("button", { name: /Usuario/ }).click();
await page.waitForTimeout(800);
await page.locator("#pw-usuario").fill(`${CUENTA}-nuevo`);
await page.getByRole("button", { name: "Guardar usuario" }).click();
await page.waitForTimeout(1600);
const trasUsuario = await api(async (id) => {
  const response = await fetch(`/crv/api/community/admin/collaborators/${id}`, { credentials: "include" });
  return response.ok ? await response.json() : { error: response.status };
}, creada.id);
report.datos.usuario = trasUsuario.name;
if (trasUsuario.name === `${CUENTA}-nuevo`) ok("cambio de usuario aplicado", trasUsuario.name);
else fallo("cambio de usuario", String(trasUsuario.name));

// ---- borrar la cuenta
const fila3 = page.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).first();
await fila3.getByRole("button", { name: /Quitar/ }).click();
await page.waitForSelector("[role=alertdialog]");
await page.getByRole("button", { name: "Borrar cuenta" }).click();
const inicio = Date.now();
let sigue = 1;
let enApi = 200;
while (Date.now() - inicio < 10_000) {
  await page.waitForTimeout(500);
  sigue = await page.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).count();
  enApi = await api(async (id) => {
    const response = await fetch(`/crv/api/community/admin/collaborators/${id}`, { credentials: "include" });
    return response.status;
  }, creada.id);
  if (sigue === 0 && enApi === 404) break;
}
report.datos.trasBorrar = { filas: sigue, api: enApi };
if (sigue === 0 && enApi === 404) ok("borrado de cuenta: fuera de la lista y 404 en la API");
else fallo("borrado", JSON.stringify(report.datos.trasBorrar));

await page.screenshot({ path: path.join(OUT, "c5-personas-escritorio.png"), fullPage: true });
report.capturas.push(path.join(OUT, "c5-personas-escritorio.png"));

if (errors.length === 0) ok("consola sin errores");
else fallo("consola", errors.slice(0, 3).join(" | "));

await context.close();
await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
