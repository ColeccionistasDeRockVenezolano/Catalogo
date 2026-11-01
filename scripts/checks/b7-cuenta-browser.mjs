/* global document -- las funciones de page.evaluate corren en la página */
// CRV · B7 · «Mi perfil» (/cuenta) en un navegador real.
//
// Entra como administrador de staging (fixtures de la Fase 1, vinculado a una
// persona de prueba), comprueba la cabecera y las cinco secciones, guarda un
// cambio real y lo restaura, cambia la clave a una temporal y la devuelve, y
// deja capturas de página completa a 1440×900 y 390×844 en ES y EN.
//
// El idioma se fija con `addInitScript` antes de cada documento (el proveedor
// de i18n lo lee de localStorage al montar), así que cada idioma usa su propio
// contexto y su propio inicio de sesión.
//
// Uso: node scripts/checks/b7-cuenta-browser.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/b7-cuenta-2026-11");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const TEMP = "CuentaTemp2026";

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
    // El 401 de /auth/me es la comprobación normal antes de iniciar sesión.
    if (message.type() === "error" && !/401 \(Unauthorized\)/.test(message.text())) errors.push(message.text().slice(0, 200));
  });
  await page.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
  if (await page.locator("#op-username").count()) {
    await page.fill("#op-username", USER);
    await page.fill("#op-password", PASS);
    await page.click("form button");
  }
  await page.waitForSelector(".account-profile__head", { timeout: 20000 });
  await page.waitForTimeout(600);
  return { context, page, errors };
}

async function shoot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.capturas.push(file);
}

const ESPERADAS = {
  es: ["Datos personales", "Perfil de colaboración", "Mis enlaces", "Visibilidad", "Contraseña"],
  en: ["Personal details", "Collaboration profile", "My links", "Visibility", "Password"],
};

async function estructura(page, lang, prefijo) {
  const session = (await page.locator(".account-profile__session").innerText()).replace(/\s+/gu, " ");
  report.datos[`sesion-${prefijo}`] = session;
  const cabecera = lang === "en"
    ? /Signed in:\s*fase1-admin at Coleccionistas De Rock Venezolano/
    : /Sesión:\s*fase1-admin en Coleccionistas De Rock Venezolano/;
  if (cabecera.test(session) && /(Persona|Person) #\d+/.test(session) && /(Collaborator|Colaborador) #\d+/.test(session)) {
    ok(`${prefijo}: cabecera con sesión, Persona #N y Colaborador #N`);
  } else fallo(`${prefijo}: cabecera`, session);

  const avatar = (await page.locator(".account-profile__avatar").innerText()).trim();
  if (avatar.length >= 1) ok(`${prefijo}: avatar con iniciales`, avatar);

  const secciones = await page.locator(".account-profile__section h2").allTextContents();
  report.datos[`secciones-${prefijo}`] = secciones;
  if (ESPERADAS[lang].every((titulo) => secciones.includes(titulo))) ok(`${prefijo}: cinco secciones`);
  else fallo(`${prefijo}: secciones`, secciones.join(" · "));

  const campos = await page.evaluate(() => ["acc-first", "acc-last", "acc-birth", "acc-phone", "acc-email", "acc-prefer", "acc-city", "acc-country"]
    .map((id) => document.getElementById(id)?.tagName ?? null));
  if (campos.every((tag) => tag !== null)) ok(`${prefijo}: 8 campos personales`);
  else fallo(`${prefijo}: campos`, JSON.stringify(campos));

  const ayudaNacimiento = await page.locator("#acc-birth ~ .account-profile__help").innerText();
  if (/nunca se muestra en público|never shown publicly/.test(ayudaNacimiento)) ok(`${prefijo}: nota de dato interno en la fecha`);
  else fallo(`${prefijo}: nota de fecha`, ayudaNacimiento);

  const chips = await page.locator(".account-chip").count();
  const chipsOn = await page.locator(".account-chip.is-on").count();
  if (chips > 10 && chipsOn > 0) ok(`${prefijo}: chips de habilidades y áreas`, `${chips} chips, ${chipsOn} marcados`);
  else fallo(`${prefijo}: chips`, `${chips} chips, ${chipsOn} marcados`);

  const filas = await page.locator(".account-link").count();
  const publicos = await page.locator(".account-link__public").count();
  if (filas >= 3 && publicos === filas) ok(`${prefijo}: enlaces con visibilidad por fila`, `${filas} filas`);
  else fallo(`${prefijo}: enlaces`, `${filas} filas, ${publicos} casillas`);

  const pie = page.locator(".account-profile__foot");
  const volver = (await pie.locator("a").innerText()).trim();
  const guardar = (await pie.locator("button").innerText()).trim();
  const volverOk = lang === "en" ? /Back to the roadmap/.test(volver) : /Volver al roadmap/.test(volver);
  const guardarOk = lang === "en" ? /Save changes/.test(guardar) : /Guardar cambios/.test(guardar);
  if (volverOk && guardarOk) ok(`${prefijo}: pie`, `${volver} · ${guardar}`);
  else fallo(`${prefijo}: pie`, `${volver} · ${guardar}`);
  const posicion = await pie.evaluate((node) => getComputedStyle(node).position);
  report.datos[`pie-posicion-${prefijo}`] = posicion;
  if (posicion === "sticky") ok(`${prefijo}: pie fijo`);
  else fallo(`${prefijo}: pie fijo`, posicion);

  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.datos[`desborde-${prefijo}`] = desborde;
  if (desborde <= 1) ok(`${prefijo}: sin desborde horizontal`);
  else fallo(`${prefijo}: desborde`, `${desborde}px`);
}

// ------------------------------------------------- escritorio ES (interactivo)
{
  const { context, page, errors } = await open({ width: 1440, height: 900 }, "es");
  report.datos.url = page.url();
  await estructura(page, "es", "escritorio-es");

  // Guardado real: la ciudad cambia, se recarga y vuelve.
  const original = await page.inputValue("#acc-city");
  const prueba = original === "Valencia" ? "Maracay" : "Valencia";
  await page.fill("#acc-city", prueba);
  await page.click(".account-profile__foot button");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".account-profile__head");
  const guardada = await page.inputValue("#acc-city");
  report.datos.ciudad = { original, prueba, guardada };
  if (guardada === prueba) ok("guardado persistente de un campo", prueba);
  else fallo("guardado", `esperaba ${prueba}, leí ${guardada}`);
  await page.fill("#acc-city", original);
  await page.click(".account-profile__foot button");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".account-profile__head");
  if (await page.inputValue("#acc-city") === original) ok("restauración del valor original", original);
  else fallo("restauración", await page.inputValue("#acc-city"));

  // Aviso de perfil incompleto: sin fecha de nacimiento.
  await page.fill("#acc-birth", "");
  await page.click(".account-profile__foot button");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".account-profile__head");
  const aviso = await page.locator(".account-profile__gaps").count()
    ? (await page.locator(".account-profile__gaps").innerText()).replace(/\s+/gu, " ")
    : null;
  report.datos.avisoIncompleto = aviso;
  if (aviso && /Perfil incompleto/.test(aviso)) ok("aviso de perfil incompleto", aviso);
  else fallo("aviso de perfil incompleto", String(aviso));
  await page.fill("#acc-birth", "1990-05-17");
  await page.click(".account-profile__foot button");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".account-profile__head");
  if (await page.locator(".account-profile__gaps").count() === 0) ok("perfil completo tras restaurar la fecha");
  else fallo("perfil completo", "sigue el aviso de incompleto");

  // Clave: temporal y vuelta a la original (dos escrituras reales).
  const cambiar = async (actual, nueva) => {
    await page.fill("#acc-current", actual);
    await page.fill("#acc-new", nueva);
    await page.fill("#acc-repeat", nueva);
    await page.click(".account-profile__foot button");
    await page.waitForTimeout(1800);
  };
  await cambiar(PASS, TEMP);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".account-profile__head");
  if (page.url().endsWith("/crv/cuenta")) ok("la sesión sigue viva tras cambiar la clave");
  else fallo("sesión tras clave", page.url());
  await cambiar(TEMP, PASS);
  await page.waitForTimeout(800);

  await shoot(page, "cuenta-escritorio-es");
  if (errors.length === 0) ok("escritorio ES: consola sin errores");
  else fallo("consola escritorio ES", errors.slice(0, 3).join(" | "));
  await context.close();
}

// ------------------------------------------------------- escritorio y móvil EN/ES
for (const vista of [
  { nombre: "escritorio-en", viewport: { width: 1440, height: 900 }, lang: "en", touch: false },
  { nombre: "movil-es", viewport: { width: 390, height: 844 }, lang: "es", touch: true },
  { nombre: "movil-en", viewport: { width: 390, height: 844 }, lang: "en", touch: true },
]) {
  const { context, page, errors } = await open(vista.viewport, vista.lang, vista.touch);
  await estructura(page, vista.lang, vista.nombre);

  if (vista.touch) {
    const cajas = await page.evaluate(() => {
      const pie = document.querySelector(".account-profile__foot")?.getBoundingClientRect();
      const nav = document.querySelector(".main-nav")?.getBoundingClientRect();
      return { pie: pie ? { top: Math.round(pie.top), bottom: Math.round(pie.bottom) } : null,
        nav: nav ? { top: Math.round(nav.top), bottom: Math.round(nav.bottom) } : null };
    });
    report.datos[`pie-barra-${vista.nombre}`] = cajas;
    if (cajas.pie && (!cajas.nav || cajas.pie.bottom <= cajas.nav.top + 1)) ok(`${vista.nombre}: el pie no queda bajo la barra inferior`);
    else fallo(`${vista.nombre}: pie y barra`, JSON.stringify(cajas));
  }

  await shoot(page, `cuenta-${vista.nombre}`);
  if (errors.length === 0) ok(`${vista.nombre}: consola sin errores`);
  else fallo(`consola ${vista.nombre}`, errors.slice(0, 3).join(" | "));
  await context.close();
}

await browser.close();
report.resumen = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.resumen));
for (const linea of report.fallos) console.log("FALLO:", linea);
for (const linea of report.ok) console.log("OK:", linea);
process.exit(report.fallos.length === 0 ? 0 : 1);
