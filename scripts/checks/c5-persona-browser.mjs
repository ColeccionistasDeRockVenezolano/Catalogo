/* global document, window */
// CRV · C5 · Editor de persona, cambio de usuario y borrado de cuenta en la
// ventana «Personas y colaboradores» (3.4), comprobado contra la API.
//
// Cubre escritorio (1440) en español, móvil (390, página completa), inglés y el
// rol community (que no puede leer ni tocar las cuentas ligadas a un admin).
//
// Uso: node scripts/checks/c5-persona-browser.mjs
//   CRV_C5_ADMIN_USER / CRV_C5_ADMIN_PASS          (por omisión fase1-admin)
//   CRV_C5_COMMUNITY_USER / CRV_C5_COMMUNITY_PASS  (por omisión fase1-community)
// El admin community se crea y se limpia con `scripts/fase1-fixtures.ts`.
// La cuenta de prueba se borra al final; la persona global se conserva (es el
// diseño del borrado) y queda anotada en `informe.json` para limpiarla.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/c5-persona-2026-11");
const USER = process.env["CRV_C5_ADMIN_USER"] ?? "fase1-admin";
const PASS = process.env["CRV_C5_ADMIN_PASS"] ?? "Fase1Admin2026";
const COMMUNITY_USER = process.env["CRV_C5_COMMUNITY_USER"] ?? "fase1-community";
const COMMUNITY_PASS = process.env["CRV_C5_COMMUNITY_PASS"] ?? "Fase1Community2026";
const CUENTA = `c5-persona-${Date.now().toString(36).slice(-4)}`;

await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), ok: [], fallos: [], capturas: [], datos: {} };
const ok = (nombre, extra) => { report.ok.push(extra === undefined ? nombre : `${nombre} (${extra})`); };
const fallo = (nombre, detalle) => report.fallos.push(`${nombre}: ${detalle}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
const page = await context.newPage();
const errors = [];
function vigilar(pagina, etiqueta, opciones = {}) {
  // En el contexto de community se piden a propósito rutas prohibidas: sus 403
  // son la comprobación, no un fallo de la página.
  const ignoradas = opciones.ignorar403
    ? /401 \(Unauthorized\)|403 \(Forbidden\)|404 \(Not Found\)/
    : /401 \(Unauthorized\)|404 \(Not Found\)/;
  pagina.on("pageerror", (error) => errors.push(`${etiqueta}: ${String(error).slice(0, 200)}`));
  pagina.on("console", (message) => {
    if (message.type() === "error" && !ignoradas.test(message.text())) {
      errors.push(`${etiqueta}: ${message.text().slice(0, 200)}`);
    }
  });
}
vigilar(page, "escritorio");

/** GET/PATCH/DELETE dentro de la página: usa la cookie y el CSRF de la sesión. */
async function api(pagina, ruta, { method = "GET", body } = {}) {
  return pagina.evaluate(async ({ ruta, method, body }) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") {
      const me = await fetch("/crv/api/auth/me", { credentials: "include" });
      const session = me.ok ? await me.json() : { csrf: "" };
      headers["x-crv-csrf"] = session.csrf;
    }
    const response = await fetch(`/crv/api${ruta}`, {
      method, credentials: "include", headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, ...(text ? { json: JSON.parse(text) } : {}) };
  }, { ruta, method, body });
}

async function entrar(pagina, usuario, clave) {
  await pagina.goto(`${BASE}/crv/cuenta`, { waitUntil: "networkidle" });
  if (await pagina.locator("#op-username").count()) {
    await pagina.fill("#op-username", usuario);
    await pagina.fill("#op-password", clave);
    await pagina.click("form button");
    await pagina.waitForTimeout(1500);
  }
  const me = await api(pagina, "/auth/me");
  return me.status === 200 ? me.json.user : null;
}

async function abrirPersonas(pagina) {
  await pagina.goto(`${BASE}/crv/curaduria/roadmap?herramienta=personas`, { waitUntil: "networkidle" });
  await pagina.waitForSelector(".rw-window");
  await pagina.waitForTimeout(1200);
}

// ---------------------------------------------------------------- escritorio
const sesion = await entrar(page, USER, PASS);
if (sesion?.role !== "admin") {
  console.log("FALLO: sesión de admin", JSON.stringify(sesion));
  await browser.close();
  process.exit(1);
}
ok("sesión de administración", USER);

// Cuenta de prueba por la API (misma que usa el alta de la ventana).
const creada = await api(page, "/community/admin/collaborators", {
  method: "POST",
  body: { name: CUENTA, firstName: "Persona", lastName: "C5", accessCode: "ClavePruebaC5" },
});
report.datos.creada = creada.json ?? creada;
if (!creada.json?.id) {
  fallo("cuenta de prueba", JSON.stringify(creada));
  console.log("FALLO: cuenta de prueba", JSON.stringify(creada));
  await browser.close();
  process.exit(1);
}
const cuentaId = creada.json.id;
ok("cuenta de prueba creada", `${creada.json.name} #${cuentaId}`);
// La persona global se conserva al borrar la cuenta (es el diseño): se anota
// para poder limpiar staging con el DELETE de auth.people de FASE2-C5.md.
report.datos.personaConservada = creada.json.person_id ?? null;

// Una actividad asignada: el diálogo de «Quitar» debe decir cuántas pierde.
const roadmap = await api(page, "/community/admin/roadmap");
const etapa = roadmap.json?.categories?.[0]?.id;
if (!etapa) {
  fallo("etapa para la actividad", "el roadmap de staging no tiene etapas");
} else {
  const tarea = await api(page, "/community/admin/roadmap/tasks", {
    method: "POST",
    body: { categoryId: etapa, title: `C5 · actividad de ${CUENTA}`, status: "pending", assignedUserIds: [cuentaId] },
  });
  const nueva = tarea.json?.roadmap?.categories?.flatMap((c) => c.tasks).find((t) => t.title?.includes(CUENTA));
  report.datos.tarea = { status: tarea.status, id: nueva?.id ?? null };
  if (nueva?.id) ok("actividad de prueba asignada", `#${nueva.id}`);
  else fallo("actividad de prueba", JSON.stringify(tarea).slice(0, 300));
}

await abrirPersonas(page);
const fila = page.locator(".rw-row", { hasText: CUENTA }).first();
const acciones = await fila.getByRole("button").allTextContents();
report.datos.acciones = acciones.map((texto) => texto.trim());
for (const nombre of ["Perfil", "Usuario", "Código", "Activación", "Revocar", "Quitar"]) {
  if (report.datos.acciones.some((texto) => texto.startsWith(nombre))) ok(`acción presente: ${nombre}`);
  else fallo(`acción ${nombre}`, "no está en la fila");
}

// ---- «Quitar» avisa de las tareas que se pierden
await fila.getByRole("button", { name: /Quitar/ }).click();
await page.waitForSelector("[role=alertdialog]");
const aviso = await page.locator(".confirm-dialog__description").textContent();
report.datos.avisoQuitar = aviso;
if (/Se quitará de 1 tarea del roadmap/.test(aviso ?? "")) ok("«Quitar» avisa de la tarea que pierde");
else fallo("aviso de tareas en «Quitar»", String(aviso));
await page.locator("[role=alertdialog]").getByRole("button", { name: "Cancelar" }).click();
await page.waitForTimeout(500);

// ---- editor de persona
await fila.getByRole("button", { name: /Perfil/ }).click();
await page.waitForTimeout(1200);
const camposPerfil = await page.locator(".rw-window input, .rw-window textarea").count();
report.datos.camposPerfil = camposPerfil;
if (camposPerfil >= 9) ok("editor de persona con sus 9 campos", String(camposPerfil));
else fallo("editor de persona", `${camposPerfil} campos`);
await page.locator(".rw-window").getByLabel("Disponibilidad").fill("Tardes de martes");
await page.locator(".rw-window").getByLabel("País").fill("Venezuela");
await page.locator(".rw-window").getByLabel("Correo").fill("persona.c5@ejemplo.test");
await page.getByRole("button", { name: "Guardar perfil" }).click();
await page.waitForTimeout(1500);
const guardado = await api(page, `/community/admin/collaborators/${cuentaId}/person`);
report.datos.perfil = {
  availability: guardado.json?.availability, country: guardado.json?.country, email: guardado.json?.email,
};
if (guardado.json?.availability === "Tardes de martes" && guardado.json?.country === "Venezuela") {
  ok("el perfil global persiste (disponibilidad y país)");
} else fallo("guardado del perfil", JSON.stringify(report.datos.perfil));
await page.screenshot({ path: path.join(OUT, "c5-perfil-persona.png"), fullPage: false });
report.capturas.push(path.join(OUT, "c5-perfil-persona.png"));

// Vaciar un campo debe limpiarlo (la ventana manda "", no lo omite).
await page.locator(".rw-window").getByLabel("País").fill("");
await page.getByRole("button", { name: "Guardar perfil" }).click();
await page.waitForTimeout(1500);
const limpiado = await api(page, `/community/admin/collaborators/${cuentaId}/person`);
report.datos.perfilLimpiado = { country: limpiado.json?.country, availability: limpiado.json?.availability };
if (limpiado.json?.country === null && limpiado.json?.availability === "Tardes de martes") {
  ok("vaciar un campo lo limpia y conserva los demás");
} else fallo("limpieza del perfil", JSON.stringify(report.datos.perfilLimpiado));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// ---- cambiar usuario
const fila2 = page.locator(".rw-row", { hasText: CUENTA }).first();
await fila2.getByRole("button", { name: /Usuario/ }).click();
await page.waitForTimeout(800);
await page.locator("#pw-usuario").fill(`${CUENTA}-nuevo`);
await page.getByRole("button", { name: "Guardar usuario" }).click();
await page.waitForTimeout(1600);
const trasUsuario = await api(page, `/community/admin/collaborators/${cuentaId}`);
report.datos.usuario = trasUsuario.json?.name;
if (trasUsuario.json?.name === `${CUENTA}-nuevo`) ok("cambio de usuario aplicado", trasUsuario.json.name);
else fallo("cambio de usuario", String(trasUsuario.json?.name));

await page.screenshot({ path: path.join(OUT, "c5-personas-escritorio.png"), fullPage: true });
report.capturas.push(path.join(OUT, "c5-personas-escritorio.png"));

// --------------------------------------------------------------------- móvil
const movil = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: "es-VE",
  storageState: await context.storageState(),
});
const paginaMovil = await movil.newPage();
vigilar(paginaMovil, "móvil");
await abrirPersonas(paginaMovil);
const filaMovil = paginaMovil.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).first();
const accionesMovil = await filaMovil.getByRole("button").allTextContents();
report.datos.accionesMovil = accionesMovil.map((texto) => texto.trim());
const faltanMovil = ["Perfil", "Usuario", "Quitar"].filter((nombre) => !report.datos.accionesMovil.some((texto) => texto.startsWith(nombre)));
if (faltanMovil.length === 0) ok("móvil: acciones de la fila presentes");
else fallo("móvil: acciones", `faltan ${faltanMovil.join(", ")}`);
await filaMovil.getByRole("button", { name: /Perfil/ }).click();
await paginaMovil.waitForTimeout(1200);
const camposMovil = await paginaMovil.locator(".rw-window input, .rw-window textarea").count();
const desborde = await paginaMovil.evaluate(() => {
  const panel = document.querySelector(".rw-window");
  return {
    pagina: document.documentElement.scrollWidth - window.innerWidth,
    panel: panel ? Math.round(panel.getBoundingClientRect().right - window.innerWidth) : null,
  };
});
report.datos.movil = { campos: camposMovil, desborde };
if (camposMovil >= 9) ok("móvil: el editor conserva sus 9 campos", String(camposMovil));
else fallo("móvil: editor", `${camposMovil} campos`);
if (desborde.pagina <= 1 && (desborde.panel ?? 0) <= 1) ok("móvil: sin desborde horizontal", JSON.stringify(desborde));
else fallo("móvil: desborde horizontal", JSON.stringify(desborde));
await paginaMovil.screenshot({ path: path.join(OUT, "c5-personas-movil.png"), fullPage: true });
report.capturas.push(path.join(OUT, "c5-personas-movil.png"));
await movil.close();

// -------------------------------------------------------------------- inglés
const ingles = await browser.newContext({
  viewport: { width: 1440, height: 900 }, locale: "en-US",
  storageState: await context.storageState(),
});
await ingles.addInitScript(() => localStorage.setItem("crv-lang", "en"));
const paginaIngles = await ingles.newPage();
vigilar(paginaIngles, "inglés");
await abrirPersonas(paginaIngles);
const tituloIngles = await paginaIngles.locator(".modal-panel h2").first().textContent();
report.datos.tituloIngles = tituloIngles;
if (/People and collaborators/i.test(tituloIngles ?? "")) ok("inglés: la ventana se titula en inglés", tituloIngles.trim());
else fallo("inglés: título", String(tituloIngles));
const filaIngles = paginaIngles.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).first();
if (await filaIngles.count()) ok("inglés: la cuenta de prueba sigue en la lista");
else fallo("inglés: fila", "no aparece la cuenta de prueba");
await paginaIngles.screenshot({ path: path.join(OUT, "c5-personas-ingles.png"), fullPage: true });
report.capturas.push(path.join(OUT, "c5-personas-ingles.png"));
await ingles.close();

// ------------------------------------------------------------ rol community
const comoCommunity = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
const paginaCommunity = await comoCommunity.newPage();
vigilar(paginaCommunity, "community", { ignorar403: true });
const sesionCommunity = await entrar(paginaCommunity, COMMUNITY_USER, COMMUNITY_PASS);
report.datos.sesionCommunity = sesionCommunity;
if (sesionCommunity?.role === "community") {
  ok("sesión de comunidad", COMMUNITY_USER);
  await abrirPersonas(paginaCommunity);
  const listaAdmin = await api(page, "/community/admin/collaborators");
  const vinculadas = (listaAdmin.json?.data ?? []).filter((row) => row.linked_admin).map((row) => row.id);
  const listaCommunity = await api(paginaCommunity, "/community/admin/collaborators");
  const idsCommunity = (listaCommunity.json?.data ?? []).map((row) => row.id);
  report.datos.vinculadas = vinculadas;
  report.datos.communityVe = idsCommunity.length;
  if (vinculadas.length === 0) {
    fallo("community: cuentas vinculadas", "staging no tiene ninguna cuenta ligada a un admin");
  } else if (vinculadas.some((id) => idsCommunity.includes(id))) {
    fallo("community: lista", `ve cuentas vinculadas: ${vinculadas.filter((id) => idsCommunity.includes(id)).join(", ")}`);
  } else {
    ok("community: la lista no muestra las cuentas de administradores", `${vinculadas.length} ocultas`);
  }
  const primeraVinculada = vinculadas[0];
  if (primeraVinculada) {
    const ficha = await api(paginaCommunity, `/community/admin/collaborators/${primeraVinculada}/person`);
    const detalle = await api(paginaCommunity, `/community/admin/collaborators/${primeraVinculada}`);
    report.datos.community403 = { ficha: ficha.status, detalle: detalle.status, codigo: ficha.json?.error?.code };
    if (ficha.status === 403 && detalle.status === 403 && ficha.json?.error?.code === "linked_admin") {
      ok("community: la ficha y el detalle de una cuenta de admin dan 403", `#${primeraVinculada}`);
    } else fallo("community: 403 en cuenta vinculada", JSON.stringify(report.datos.community403));
    const normal = idsCommunity.find((id) => !vinculadas.includes(id));
    if (normal) {
      const fichaNormal = await api(paginaCommunity, `/community/admin/collaborators/${normal}/person`);
      if (fichaNormal.status === 200) ok("community: una cuenta normal sí se lee", `#${normal}`);
      else fallo("community: cuenta normal", `HTTP ${fichaNormal.status}`);
    }
  }
  await paginaCommunity.screenshot({ path: path.join(OUT, "c5-personas-community.png"), fullPage: true });
  report.capturas.push(path.join(OUT, "c5-personas-community.png"));
} else {
  fallo("sesión de comunidad", JSON.stringify(sesionCommunity));
}
await comoCommunity.close();

// ------------------------------------------------------- borrar la cuenta
await abrirPersonas(page);
const fila3 = page.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).first();
await fila3.getByRole("button", { name: /Quitar/ }).click();
await page.waitForSelector("[role=alertdialog]");
const avisoBorrado = await page.locator(".confirm-dialog__description").textContent();
if (/Se quitará de 1 tarea del roadmap/.test(avisoBorrado ?? "")) ok("«Quitar» confirma el aviso de la tarea");
else fallo("aviso de tareas al borrar", String(avisoBorrado));
await page.getByRole("button", { name: "Borrar cuenta" }).click();
const inicio = Date.now();
let sigue = 1;
let enApi = 200;
while (Date.now() - inicio < 10_000) {
  await page.waitForTimeout(500);
  sigue = await page.locator(".rw-row", { hasText: `${CUENTA}-nuevo` }).count();
  enApi = (await api(page, `/community/admin/collaborators/${cuentaId}`)).status;
  if (sigue === 0 && enApi === 404) break;
}
report.datos.trasBorrar = { filas: sigue, api: enApi };
if (sigue === 0 && enApi === 404) ok("borrado de cuenta: fuera de la lista y 404 en la API");
else fallo("borrado", JSON.stringify(report.datos.trasBorrar));

// La actividad queda sin responsable y se retira (limpieza de staging).
const tareaId = report.datos.tarea?.id;
if (tareaId) {
  const trasBorrar = await api(page, "/community/admin/roadmap");
  const tarea = trasBorrar.json?.categories?.flatMap((c) => c.tasks).find((t) => t.id === tareaId);
  report.datos.tareaSinResponsable = tarea ? tarea.assignedUsers?.length ?? null : "desapareció";
  if (tarea && (tarea.assignedUsers?.length ?? 0) === 0) ok("la actividad quedó sin responsable");
  else fallo("actividad tras el borrado", JSON.stringify(report.datos.tareaSinResponsable));
  const limpieza = await api(page, `/community/admin/roadmap/tasks/${tareaId}`, { method: "DELETE" });
  report.datos.limpiezaTarea = limpieza.status;
  if (limpieza.status === 204) ok("actividad de prueba retirada");
  else fallo("limpieza de la actividad", `HTTP ${limpieza.status}`);
}

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
