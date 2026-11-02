/* global document, window -- las funciones de page.evaluate corren en la página */
// CRV · Aceptación del panel con la plantilla de Herra, en la portada del dominio (:3141).
//
// Sustituye para el panel a los guiones b6-b10, c5 y p7, escritos para la versión
// React retirada. Solo contra staging: guarda el estado de `auth`, lo modifica con
// clics reales y lo deja igual al terminar, aunque falle.
//
//   node scripts/checks/panel-herra-browser.mjs
//
// Recorre: 12 herramientas con foco y Escape, etapa y actividad (crear, editar, borrar),
// arrastre con ratón, teclado y dedo, efecto en la portada, ajustes, formulario,
// marca, invitaciones, métricas, candidatura completa, rol `community`, inglés y 390 px.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { limpiarFixtures, prepararFixtures } from "./lib/fixtures.mjs";

const BASE = "http://127.0.0.1:3141";
const OUT = path.join(os.homedir(), "crv-staging/reports/panel-herra-2026-11");
const MARCA = `Prueba panel ${Date.now().toString(36)}`;
await mkdir(OUT, { recursive: true });

const resultados = [];
const ok = (nombre, detalle = "") => { resultados.push({ nombre, ok: true, detalle }); console.log(`ok    ${nombre}${detalle ? ` · ${detalle}` : ""}`); };
const fallo = (nombre, detalle = "") => { resultados.push({ nombre, ok: false, detalle: String(detalle).slice(0, 300) }); console.log(`FALLO ${nombre} · ${String(detalle).slice(0, 300)}`); };
const comprobar = (nombre, condicion, detalle = "") => (condicion ? ok(nombre) : fallo(nombre, detalle));
async function paso(nombre, funcion) {
  try { await funcion(); } catch (error) { fallo(`${nombre} (interrumpido)`, error instanceof Error ? error.message.split("\n")[0] : error); }
}

const sql = (consulta) => execFileSync("docker", ["exec", "-i", "crv-postgres-staging", "psql", "-U", "crv", "-d", "crv_staging", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: consulta, encoding: "utf8" }).trim();
const COPIA = "panel_prueba_copia";
const TABLAS_RESTAURADAS = ["projects", "categories", "tasks", "task_assignees", "catalog_terms"];
const huella = () => sql(["categories", "tasks", "users", "admins", "people", "applications", "registration_tokens", "activation_tokens"]
  .map((tabla) => `SELECT '${tabla}', count(*) FROM auth.${tabla};`).join("\n"));
const contenido = () => sql(`SELECT md5(string_agg(t::text,'' ORDER BY t::text)) FROM (SELECT * FROM auth.tasks) t;
  SELECT md5(string_agg(t::text,'' ORDER BY t::text)) FROM (SELECT * FROM auth.categories) t;
  SELECT md5(string_agg(t::text,'' ORDER BY t::text)) FROM (SELECT * FROM auth.projects) t;`);
const auditoria0 = sql("SELECT coalesce(max(id),0) FROM auth.audit_log;");
const tokens0 = sql("SELECT coalesce(max(id),0) FROM auth.registration_tokens;");
const huella0 = huella();
const contenido0 = contenido();
sql(`DROP SCHEMA IF EXISTS ${COPIA} CASCADE; CREATE SCHEMA ${COPIA};
  ${TABLAS_RESTAURADAS.map((tabla) => `CREATE TABLE ${COPIA}.${tabla} AS TABLE auth.${tabla};`).join("\n")}`);
function restaurar() {
  const columnas = (tabla) => sql(`SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='auth' AND table_name='${tabla}' AND is_generated='NEVER' AND identity_generation IS DISTINCT FROM 'ALWAYS';`);
  sql(`BEGIN;
    DELETE FROM auth.application_links WHERE application_id IN (SELECT id FROM auth.applications WHERE first_name LIKE '${MARCA}%');
    DELETE FROM auth.application_catalog_terms WHERE application_id IN (SELECT id FROM auth.applications WHERE first_name LIKE '${MARCA}%');
    DELETE FROM auth.applications WHERE first_name LIKE '${MARCA}%';
    DELETE FROM auth.task_assignees;
    DELETE FROM auth.tasks;
    DELETE FROM auth.categories;
    INSERT INTO auth.categories (${columnas("categories")}) SELECT ${columnas("categories")} FROM ${COPIA}.categories;
    INSERT INTO auth.tasks (${columnas("tasks")}) SELECT ${columnas("tasks")} FROM ${COPIA}.tasks;
    INSERT INTO auth.task_assignees (${columnas("task_assignees")}) SELECT ${columnas("task_assignees")} FROM ${COPIA}.task_assignees;
    UPDATE auth.projects p SET (${columnas("projects")}) = (SELECT ${columnas("projects")} FROM ${COPIA}.projects c WHERE c.id = p.id);
    DELETE FROM auth.registration_tokens WHERE created_by LIKE 'fase1-%' AND id > ${tokens0};
    DELETE FROM auth.sessions WHERE payload->>'username' LIKE 'panelprueba%' OR payload->>'username' LIKE 'fase1-%';
    DELETE FROM auth.activation_tokens WHERE user_id IN (SELECT id FROM auth.users WHERE name::text LIKE 'panelprueba%' OR first_name LIKE '${MARCA}%');
    WITH u AS (DELETE FROM auth.users WHERE name::text LIKE 'panelprueba%' OR first_name LIKE '${MARCA}%' RETURNING person_id)
    DELETE FROM auth.people WHERE id IN (SELECT person_id FROM u);
    DELETE FROM auth.audit_log WHERE id > ${auditoria0};
    COMMIT;`);
}

prepararFixtures();
const navegador = await chromium.launch();

async function abrirContexto(opciones = {}) {
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE", ...opciones });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (error) => errores.push(String(error).slice(0, 200)));
  pagina.on("console", (mensaje) => {
    if (mensaje.type() === "error" && !/youtube|ytimg|Failed to load resource/iu.test(mensaje.text())) errores.push(mensaje.text().slice(0, 200));
  });
  pagina.on("dialog", (dialogo) => dialogo.accept());
  return { contexto, pagina, errores };
}
async function entrar(pagina, usuario, clave, consulta = "") {
  await pagina.goto(`${BASE}/login${consulta}`, { waitUntil: "domcontentloaded" });
  await pagina.fill("#name", usuario);
  await pagina.fill("#accessCode", clave);
  await Promise.all([pagina.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }), pagina.click('form button[type="submit"]')]);
}
const abrirPanel = async (pagina, consulta = "") => {
  await pagina.goto(`${BASE}/admin${consulta}`, { waitUntil: "domcontentloaded" });
  await pagina.waitForSelector(".admin-toolbar", { timeout: 30_000 });
};
const abrirHerramienta = async (pagina, id) => {
  await pagina.click(`.admin-toolbar [data-open="${id}"]`);
  await pagina.waitForSelector(`dialog#${id}[open]`, { timeout: 10_000 });
};
/** Espera el guardado real del orden: recargar antes lo cancelaría. */
const guardadoDeOrden = (pagina) => pagina.waitForResponse((r) => r.request().method() === "PATCH" && /\/panel\/tasks\/\d+$/u.test(r.url()), { timeout: 15_000 });
const titulos = (lista) => lista.locator("> .task[data-task-id] .task-text").allTextContents();
// Solo por el título visible: las ventanas de edición de cada actividad listan todas las etapas.
const bloque = (pagina, titulo) => pagina.locator(".cat-block").filter({ has: pagina.locator("[data-cat-title-view]", { hasText: titulo }) }).first();
const portadaAnonima = async (funcion) => {
  const { contexto, pagina } = await abrirContexto();
  try { return await funcion(pagina); } finally { await contexto.close(); }
};

const admin = await abrirContexto();
try {
  await paso("acceso", async () => {
    await entrar(admin.pagina, "fase1-admin", "Fase1Admin2026");
    ok("administrador entra por /login y vuelve a la portada", new URL(admin.pagina.url()).pathname);
    await admin.pagina.click('a.nav-admin-link[href$="/admin"]');
    await admin.pagina.waitForSelector(".admin-toolbar", { timeout: 30_000 });
    ok("«Administrar proyecto» abre el panel");
    const tareas = await admin.pagina.locator(".task[data-task-id]").count();
    comprobar("el panel pinta las 61 actividades", tareas === 61, tareas);
    const enlaces = await admin.pagina.locator('a[href*="curaduria"], a[href*="/crv/"], a[href*="/cuenta"]').count();
    comprobar("sin enlaces al catálogo", enlaces === 0, enlaces);
    await admin.pagina.screenshot({ path: path.join(OUT, "panel-1440-es.png") });
  });

  await paso("herramientas", async () => {
    const ids = await admin.pagina.locator(".admin-toolbar [data-open]").evaluateAll((botones) => botones.map((boton) => boton.dataset.open));
    comprobar("barra con 12 herramientas", ids.length === 12, ids.join());
    for (const id of ids) {
      await abrirHerramienta(admin.pagina, id);
      const dentro = await admin.pagina.evaluate((dialogo) => document.getElementById(dialogo).contains(document.activeElement), id);
      await admin.pagina.keyboard.press("Escape");
      await admin.pagina.waitForSelector(`dialog#${id}:not([open])`, { state: "attached", timeout: 5_000 });
      comprobar(`${id}: abre, recibe el foco y cierra con Escape`, dentro);
    }
  });

  await paso("etapa y actividad", async () => {
    const etapa = `${MARCA} etapa`;
    await abrirHerramienta(admin.pagina, "new-category-form");
    await admin.pagina.fill("#new-category-title-input", etapa);
    await admin.pagina.click('#categoryForm button[type="submit"]');
    await bloque(admin.pagina, etapa).waitFor({ timeout: 15_000 });
    ok("crear etapa");
    for (const sufijo of ["uno", "dos", "tres"]) {
      await abrirHerramienta(admin.pagina, "new-task-form");
      await admin.pagina.fill("#nt-title", `${MARCA} ${sufijo}`);
      await admin.pagina.selectOption("#nt-category", { label: etapa });
      await admin.pagina.fill("#nt-position", "99");
      await admin.pagina.click('#createForm button[type="submit"]');
      await admin.pagina.locator(".task", { hasText: `${MARCA} ${sufijo}` }).first().waitFor({ timeout: 15_000 });
      await admin.pagina.waitForTimeout(400);
    }
    ok("crear tres actividades en la etapa");

    await abrirPanel(admin.pagina);
    const lista = bloque(admin.pagina, etapa).locator("[data-task-dropzone]");
    const orden = await titulos(lista);
    comprobar("persisten al recargar y en orden", orden.join() === ["uno", "dos", "tres"].map((s) => `${MARCA} ${s}`).join(), orden.join());

    // Edición.
    const fila = lista.locator(".task", { hasText: `${MARCA} tres` });
    const id = await fila.getAttribute("data-task-id");
    await fila.locator('[data-action="toggle-edit"]').click();
    await admin.pagina.waitForSelector(`dialog#edit-${id}[open]`);
    await admin.pagina.fill(`#title-${id}`, `${MARCA} tres editada`);
    await admin.pagina.selectOption(`#status-${id}`, "in_progress");
    await admin.pagina.click(`dialog#edit-${id} [data-action="save-task"]`);
    await admin.pagina.locator(`.task[data-task-id="${id}"].task--in_progress`).waitFor({ timeout: 15_000 });
    ok("editar título y estado");

    // Arrastre con ratón: «tres» pasa antes de «uno».
    await abrirPanel(admin.pagina);
    const arrastreRaton = bloque(admin.pagina, etapa).locator("[data-task-dropzone]");
    // Al centro: junto al borde de la pantalla el arrastre desplaza la página y cae en otra etapa.
    await arrastreRaton.evaluate((lista) => lista.scrollIntoView({ block: "center", behavior: "instant" }));
    await admin.pagina.waitForTimeout(300);
    // En escritorio el tirador aparece y se coloca al pasar el ratón por la fila, como lo usa una persona.
    await arrastreRaton.locator(`.task[data-task-id="${id}"]`).hover();
    await admin.pagina.waitForTimeout(350);
    const asa = await arrastreRaton.locator(`.task[data-task-id="${id}"] [data-task-drag-handle]`).boundingBox();
    await admin.pagina.mouse.move(asa.x + asa.width / 2, asa.y + asa.height / 2);
    await admin.pagina.mouse.down();
    // Al empezar, el panel despliega las listas plegadas y la página se mueve: el destino se mide ahora.
    await admin.pagina.waitForTimeout(150);
    await arrastreRaton.evaluate((lista) => lista.scrollIntoView({ block: "center", behavior: "instant" }));
    const destino = await arrastreRaton.locator(":scope > .task[data-task-id]").first().boundingBox();
    await admin.pagina.mouse.move(asa.x + asa.width / 2, destino.y + 4, { steps: 12 });
    await admin.pagina.waitForTimeout(200);
    const respuestaRaton = guardadoDeOrden(admin.pagina);
    await admin.pagina.mouse.up();
    await respuestaRaton;
    await abrirPanel(admin.pagina);
    const trasRaton = await titulos(bloque(admin.pagina, etapa).locator("[data-task-dropzone]"));
    comprobar("arrastre con ratón persiste", trasRaton[0] === `${MARCA} tres editada`, trasRaton.join());

    // Teclado: la primera baja una posición.
    const asaTeclado = bloque(admin.pagina, etapa).locator("[data-task-dropzone] .task[data-task-id] [data-task-drag-handle]").first();
    await asaTeclado.focus();
    await admin.pagina.keyboard.press("Enter");
    await admin.pagina.keyboard.press("ArrowDown");
    const respuestaTeclado = guardadoDeOrden(admin.pagina);
    await admin.pagina.keyboard.press("Enter");
    await respuestaTeclado;
    await abrirPanel(admin.pagina);
    const trasTeclado = await titulos(bloque(admin.pagina, etapa).locator("[data-task-dropzone]"));
    comprobar("arrastre con teclado persiste", trasTeclado[1] === `${MARCA} tres editada`, trasTeclado.join());

    // Dedo a 390 px, con toques reales del protocolo del navegador.
    const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "es-VE", storageState: await admin.contexto.storageState() });
    const paginaMovil = await movil.newPage();
    paginaMovil.on("dialog", (dialogo) => dialogo.accept());
    await abrirPanel(paginaMovil);
    const listaMovil = bloque(paginaMovil, etapa).locator("[data-task-dropzone]");
    await listaMovil.evaluate((lista) => lista.scrollIntoView({ block: "center", behavior: "instant" }));
    await paginaMovil.waitForTimeout(400);
    const antesDedo = await titulos(listaMovil);
    const filasMovil = listaMovil.locator(".task[data-task-id]");
    const asaMovil = await filasMovil.nth(2).locator("[data-task-drag-handle]").boundingBox();
    const objetivoMovil = await filasMovil.nth(0).boundingBox();
    const cdp = await movil.newCDPSession(paginaMovil);
    const x = asaMovil.x + asaMovil.width / 2;
    const yInicial = asaMovil.y + asaMovil.height / 2;
    const toque = (y) => [{ x: Math.round(x), y: Math.round(y) }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: toque(yInicial) });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: toque(yInicial + (objetivoMovil.y + 2 - yInicial) * (i / 10)) });
      await paginaMovil.waitForTimeout(60);
    }
    const respuestaDedo = guardadoDeOrden(paginaMovil);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await respuestaDedo;
    await abrirPanel(paginaMovil);
    const trasDedo = await titulos(bloque(paginaMovil, etapa).locator("[data-task-dropzone]"));
    comprobar("arrastre con dedo a 390 px persiste", trasDedo[0] === antesDedo[2], `${antesDedo.join()} -> ${trasDedo.join()}`);

    // 390 px: página y ventanas dentro de la pantalla.
    const desborda = await paginaMovil.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    comprobar("390 px: el panel no desborda", desborda <= 0, `${desborda}px`);
    await paginaMovil.screenshot({ path: path.join(OUT, "panel-390-es.png") });
    const idsMovil = await paginaMovil.locator(".admin-toolbar [data-open]").evaluateAll((botones) => botones.map((boton) => boton.dataset.open));
    const anchas = [];
    for (const dialogo of idsMovil) {
      await paginaMovil.locator(`.admin-toolbar [data-open="${dialogo}"]`).scrollIntoViewIfNeeded();
      await paginaMovil.click(`.admin-toolbar [data-open="${dialogo}"]`);
      await paginaMovil.waitForSelector(`dialog#${dialogo}[open]`);
      const medida = await paginaMovil.evaluate((nombre) => {
        const caja = document.getElementById(nombre);
        const desbordado = [...caja.querySelectorAll("*")].filter((el) => {
          if (!el.getClientRects().length) return false;
          const rect = el.getBoundingClientRect();
          let ancestro = el.parentElement;
          while (ancestro && ancestro !== caja) { if (/auto|scroll|hidden/u.test(getComputedStyle(ancestro).overflowX)) return false; ancestro = ancestro.parentElement; }
          return rect.right > window.innerWidth + 1 || rect.left < -1;
        });
        return { ancho: caja.getBoundingClientRect().width, desbordados: desbordado.length, ejemplo: desbordado[0]?.className || desbordado[0]?.tagName };
      }, dialogo);
      if (medida.ancho > 390 || medida.desbordados) anchas.push(`${dialogo}:${Math.round(medida.ancho)}px/${medida.desbordados}/${medida.ejemplo}`);
      await paginaMovil.keyboard.press("Escape");
      await paginaMovil.waitForTimeout(100);
    }
    comprobar("390 px: las 12 ventanas caben", anchas.length === 0, anchas.join(" · "));
    await movil.close();

    // Efecto en la portada: staging publica solo lo completado, como la portada viva.
    await abrirPanel(admin.pagina);
    const filaDos = bloque(admin.pagina, etapa).locator(".task", { hasText: `${MARCA} dos` });
    const idDos = await filaDos.getAttribute("data-task-id");
    await filaDos.locator('[data-action="toggle-edit"]').click();
    await admin.pagina.waitForSelector(`dialog#edit-${idDos}[open]`);
    await admin.pagina.selectOption(`#status-${idDos}`, "completed");
    await admin.pagina.click(`dialog#edit-${idDos} [data-action="save-task"]`);
    await admin.pagina.locator(`.task[data-task-id="${idDos}"].task--completed`).waitFor({ timeout: 15_000 });
    // El gateway guarda 30 s la copia anónima.
    const publica = await portadaAnonima(async (pagina) => {
      let texto = "";
      for (let intento = 0; intento < 9 && !texto.includes(`${MARCA} dos`); intento += 1) {
        if (intento) await pagina.waitForTimeout(5_000);
        await pagina.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        texto = await pagina.locator("body").textContent();
      }
      return { texto, oculta: `${MARCA} uno` };
    });
    comprobar("la portada pública muestra la actividad completada", publica.texto.includes(`${MARCA} dos`));
    comprobar("la portada pública no muestra las pendientes", !publica.texto.includes(publica.oculta));

    // Borrar por clics.
    await abrirPanel(admin.pagina);
    for (const sufijo of ["uno", "dos", "tres editada"]) {
      await bloque(admin.pagina, etapa).locator(".task", { hasText: `${MARCA} ${sufijo}` }).locator('[data-action="delete"]').click();
      await admin.pagina.locator(".task", { hasText: `${MARCA} ${sufijo}` }).first().waitFor({ state: "detached", timeout: 15_000 });
    }
    ok("borrar actividades");
    await bloque(admin.pagina, etapa).locator('[data-action="category-delete"]').first().click();
    await bloque(admin.pagina, etapa).waitFor({ state: "detached", timeout: 15_000 });
    ok("borrar etapa");
  });

  await paso("ajustes", async () => {
    await abrirPanel(admin.pagina);
    await abrirHerramienta(admin.pagina, "project-settings-form");
    const antes = await admin.pagina.isChecked("#project-show-login");
    await admin.pagina.setChecked("#project-show-login", !antes);
    await admin.pagina.click('#projectSettingsForm button[type="submit"]');
    await admin.pagina.waitForTimeout(1500);
    const guardado = sql("SELECT show_login FROM auth.projects ORDER BY id LIMIT 1;");
    comprobar("Configuración: el interruptor de «Entrar» se guarda", guardado === (antes ? "0" : "1"), guardado);
  });

  await paso("invitaciones", async () => {
    await abrirPanel(admin.pagina);
    await abrirHerramienta(admin.pagina, "invites-form");
    await admin.pagina.click("#createInviteBtn");
    await admin.pagina.waitForSelector("dialog#inviteReveal[open]", { timeout: 15_000 });
    const direccion = await admin.pagina.inputValue("#inviteUrl");
    comprobar("el enlace de registro usa la dirección de la portada", direccion.startsWith(`${BASE}/registro?token=`), direccion.replace(/token=.*/u, "token=…"));
    const registro = await portadaAnonima(async (pagina) => {
      await pagina.goto(direccion, { waitUntil: "domcontentloaded" });
      return { url: pagina.url(), formulario: await pagina.locator("form").count() };
    });
    comprobar("el enlace abre el formulario de registro", registro.formulario >= 1, JSON.stringify(registro.url).slice(0, 60));
  });

  await paso("métricas", async () => {
    await abrirPanel(admin.pagina);
    await abrirHerramienta(admin.pagina, "metrics-form");
    await admin.pagina.waitForTimeout(1500);
    const texto = await admin.pagina.locator("dialog#metrics-form").innerText();
    comprobar("Métricas carga datos en la ventana", texto.length > 100, texto.slice(0, 80));
    await admin.pagina.screenshot({ path: path.join(OUT, "metricas-1440.png") });
  });

  await paso("candidatura completa", async () => {
    const candidato = await abrirContexto();
    try {
      await candidato.pagina.goto(`${BASE}/colaborar`, { waitUntil: "domcontentloaded" });
      const f = candidato.pagina;
      const valores = {
        "#firstName": `${MARCA} Candidata`, "#lastName": "Prueba", "#birthDate": "1990-01-15", "#whatsappPhone": "+584120000000",
        "#email": "candidata@example.com", "#city": "Caracas", "#country": "Venezuela", "#experience": "Prueba automatizada.",
        "#contributionText": "Prueba automatizada.", "#availability": "Fines de semana", "#idea": "Prueba", "#ideaReason": "Prueba",
      };
      // El formulario va por pasos: se rellena lo visible de cada uno y se avanza.
      for (let vuelta = 0; vuelta < 8; vuelta += 1) {
        for (const [campo, valor] of Object.entries(valores)) if (await f.locator(campo).isVisible().catch(() => false)) await f.fill(campo, valor);
        for (const nombre of ["skillIds", "areaIds"]) {
          const opcion = f.locator(`input[name="${nombre}"]:visible`).first();
          if (await opcion.count()) await opcion.check({ force: true });
        }
        const enlace = f.locator('input[name="linkUrl"]:visible').first();
        if (await enlace.count()) await enlace.fill("https://example.com/prueba");
        if (await f.locator('#collaborateForm button[type="submit"]').isVisible()) break;
        await f.click("[data-collab-next]");
        await f.waitForTimeout(150);
      }
      await f.click('#collaborateForm button[type="submit"]');
      await f.waitForFunction(() => /gracias|recibid/iu.test(document.body.innerText), undefined, { timeout: 15_000 });
      ok("/colaborar: formulario enviado desde el navegador");
    } finally { await candidato.contexto.close(); }

    await abrirPanel(admin.pagina);
    await abrirHerramienta(admin.pagina, "applications-form");
    const fila = admin.pagina.locator("#applicationList [data-application-id]", { hasText: MARCA }).first();
    await fila.waitFor({ timeout: 15_000 });
    await fila.locator('[data-application-action="accept"]').click();
    await admin.pagina.waitForSelector("dialog#applicationActivationReveal[open]", { timeout: 15_000 });
    const activacion = await admin.pagina.inputValue("#applicationActivationUrl");
    comprobar("aceptar con clic revela el enlace de activación", activacion.startsWith(`${BASE}/activar?token=`), activacion.replace(/token=.*/u, "token=…"));

    const nueva = await abrirContexto();
    try {
      await nueva.pagina.goto(activacion, { waitUntil: "domcontentloaded" });
      const usuario = `panelprueba${Date.now().toString(36)}`;
      const clave = "ClavePanelPrueba1234";
      await nueva.pagina.fill("#name", usuario);
      await nueva.pagina.fill("#accessCode", clave);
      await nueva.pagina.fill("#accessCodeConfirm", clave);
      await nueva.pagina.click('form button[type="submit"]');
      await nueva.pagina.waitForTimeout(1500);
      await entrar(nueva.pagina, usuario, clave);
      ok("activar y entrar con la cuenta nueva");
      comprobar("sin «Administrar proyecto» para un colaborador", await nueva.pagina.locator('a.nav-admin-link').count() === 0);
      await nueva.pagina.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
      comprobar("/admin no se abre para un colaborador", await nueva.pagina.locator(".admin-toolbar").count() === 0, nueva.pagina.url());
      await nueva.pagina.goto(`${BASE}/account`, { waitUntil: "domcontentloaded" });
      comprobar("«Mi perfil» abre para el colaborador", await nueva.pagina.locator("form").count() >= 1);
      comprobar("flujo sin errores de consola", nueva.errores.length === 0, nueva.errores.join(" · "));
    } finally { await nueva.contexto.close(); }
  });

  await paso("rol community", async () => {
    const comunidad = await abrirContexto();
    try {
      await entrar(comunidad.pagina, "fase1-community", "Fase1Community2026");
      await abrirPanel(comunidad.pagina);
      ok("community abre el panel");
      const herramientas = await comunidad.pagina.locator(".admin-toolbar [data-open]").evaluateAll((botones) => botones.map((boton) => boton.dataset.open));
      const soloAdmin = ["branding-form", "project-settings-form"].filter((id) => herramientas.includes(id));
      comprobar("community no ve las herramientas que el servidor le rechaza", soloAdmin.length === 0, soloAdmin.join());
      comprobar("community conserva las otras 10 herramientas", herramientas.length === 10, herramientas.join());
      await abrirHerramienta(comunidad.pagina, "languages-form");
      comprobar("community en Idiomas solo ve el contenido del roadmap", await comunidad.pagina.locator("#lang-content").isVisible() && !(await comunidad.pagina.locator("#lang-project").isVisible()));
      await comunidad.pagina.keyboard.press("Escape");
      const respuesta = await comunidad.pagina.evaluate(async () => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
        const r = await fetch("/api/community/admin/panel/settings", { method: "PUT", headers: { "content-type": "application/json", "x-crv-csrf": csrf }, body: "{}" });
        return r.status;
      });
      comprobar("community recibe 403 en Configuración", respuesta === 403, respuesta);
    } finally { await comunidad.contexto.close(); }
  });

  await paso("inglés", async () => {
    await abrirPanel(admin.pagina, "?lang=en");
    const texto = await admin.pagina.locator(".admin-toolbar").innerText();
    comprobar("panel en inglés", /New activity|New task|People|Metrics/iu.test(texto) && !/Nueva actividad/u.test(texto), texto.slice(0, 80));
    await admin.pagina.screenshot({ path: path.join(OUT, "panel-1440-en.png") });
  });

  comprobar("administrador sin errores de consola en todo el recorrido", admin.errores.length === 0, [...new Set(admin.errores)].join(" · "));
} finally {
  await new Promise((resolver) => { setTimeout(resolver, 1500); });
  await navegador.close();
  restaurar();
  limpiarFixtures();
  sql(`DROP SCHEMA IF EXISTS ${COPIA} CASCADE; DELETE FROM auth.audit_log WHERE id > ${auditoria0};`);
}

const huellaFinal = huella();
const contenidoFinal = contenido();
comprobar("staging: mismas filas que al empezar", huellaFinal === huella0, `${huella0} -> ${huellaFinal}`);
comprobar("staging: actividades, etapas y proyecto idénticos", contenidoFinal === contenido0, `${contenido0} -> ${contenidoFinal}`);
const mal = resultados.filter((r) => !r.ok);
await writeFile(path.join(OUT, "resultado.json"), JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2));
console.log(`\n${resultados.length - mal.length} bien, ${mal.length} mal · informe en ${OUT}`);
process.exit(mal.length ? 1 : 0);
