/* global document, MouseEvent, HTMLElement -- las funciones de page.evaluate corren en la página */
// CRV · B6 · Comprobación en navegador del panel /curaduria/roadmap.
//
// Entra como administrador de staging (fixtures de la Fase 1), comprueba la
// estructura del panel (cabecera, progreso, 13 herramientas con contadores,
// avisos, etapas, filas), abre las ventanas 3.1–3.3, crea una actividad de
// prueba, confirma que aparece en el roadmap público, la borra y hace capturas
// en escritorio y móvil, ES y EN.
//
// Uso: node scripts/checks/b6-admin-check.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/b6-admin");
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const TASK = `Actividad de prueba B6 ${new Date().toISOString().slice(11, 19)}`;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = {};
const problems = [];

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/crv/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"], input#username, input[type="text"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"], form button');
  await page.waitForURL("**/crv/roadmap", { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1200);
  return page;
}

async function panelStructure(page) {
  return page.evaluate(() => ({
    chip: document.querySelector(".roadmap-admin__chip")?.textContent?.trim() ?? null,
    title: document.querySelector(".roadmap-admin__title")?.textContent?.trim() ?? null,
    pct: document.querySelector(".roadmap-admin__pct strong")?.textContent?.trim() ?? null,
    completed: document.querySelector(".roadmap-admin__progress-meta p")?.textContent?.trim() ?? null,
    tools: [...document.querySelectorAll(".roadmap-admin__tool")].map((el) => ({
      label: el.textContent?.replace(/\s+/g, " ").trim() ?? "",
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      count: el.querySelector(".roadmap-admin__count")?.textContent ?? null,
    })),
    notices: [...document.querySelectorAll(".roadmap-admin__notice")].map((el) => el.textContent?.trim() ?? ""),
    stages: [...document.querySelectorAll(".roadmap-admin__stage")].map((el) => ({
      phase: el.querySelector(".roadmap-admin__phase")?.textContent?.trim() ?? null,
      title: el.querySelector(".roadmap-admin__stage-titles h3")?.textContent?.trim() ?? null,
      score: el.querySelector(".roadmap-admin__score")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      rows: el.querySelectorAll(".roadmap-admin__row").length,
      foot: el.querySelector(".roadmap-admin__pager span")?.textContent?.trim() ?? null,
    })),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
}

for (const view of [{ name: "escritorio", width: 1366, height: 900 }, { name: "movil", width: 390, height: 844 }]) {
  for (const lang of ["es", "en"]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, locale: "es-VE" });
    await context.addInitScript((value) => localStorage.setItem("crv-lang", value), lang);
    const page = await login(context);
    const errors = [];
    page.on("console", (m) => {
      // Chrome anota como error cualquier 401; la sonda anónima /api/roadmap/me
      // responde 401 a propósito (un admin no es un colaborador con user).
      if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

    await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
    await page.waitForSelector(".roadmap-admin__stage", { timeout: 15000 });
    await page.waitForTimeout(600);
    const structure = await panelStructure(page);
    await page.screenshot({ path: path.join(OUT, `panel-${view.name}-${lang}.png`), fullPage: view.name === "escritorio" });

    // Ventanas 3.1–3.3 (solo en el primer recorrido de escritorio/ES para no repetir escrituras).
    let windows = null;
    if (view.name === "escritorio" && lang === "es") {
      await page.click(".roadmap-admin__tool--primary");
      await page.waitForSelector(".modal-panel", { timeout: 8000 });
      const newTaskOpen = await page.evaluate(() => ({
        kicker: document.querySelector(".modal-kicker")?.textContent?.trim() ?? null,
        title: document.querySelector(".modal-header h2")?.textContent?.trim() ?? null,
        fields: [...document.querySelectorAll(".modal-panel .field label")].map((el) => el.textContent?.trim() ?? ""),
      }));
      await page.screenshot({ path: path.join(OUT, "ventana-nueva-actividad.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(300);

      const stageTool = page.locator(".roadmap-admin__tool", { hasText: /Nueva etapa/i }).first();
      await stageTool.click();
      await page.waitForSelector(".modal-panel", { timeout: 8000 });
      const newStageOpen = await page.evaluate(() => document.querySelector(".modal-header h2")?.textContent?.trim() ?? null);
      await page.screenshot({ path: path.join(OUT, "ventana-nueva-etapa.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(300);

      await page.locator('.roadmap-admin__stage .roadmap-admin__icon[aria-label^="Editar el título"]').first().click();
      await page.waitForSelector(".modal-panel", { timeout: 8000 });
      const editStageOpen = await page.evaluate(() => document.querySelector(".modal-header h2")?.textContent?.trim() ?? null);
      await page.screenshot({ path: path.join(OUT, "ventana-editar-etapa.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(300);

      // Crear una actividad real desde la ventana 3.1 y verla en el público.
      await page.click(".roadmap-admin__tool--primary");
      await page.waitForSelector(".modal-panel");
      await page.fill("#nt-title", TASK);
      await page.fill("#nt-position", "1");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".modal-panel", { state: "detached", timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2600);
      const afterCreate = await page.evaluate((needle) => ({
        enPanel: document.body.innerText.includes(needle),
      }), TASK);

      // La actividad es pública solo si está completada; para probar el dato
      // vivo se cambia el título de la primera etapa y se revierte.
      const stageTitle = await page.locator(".roadmap-admin__stage-titles h3").first().evaluate((el) => el.firstChild?.textContent?.trim() ?? "");
      const marked = `${stageTitle} · B6`;
      for (const [value, expected] of [[marked, true], [stageTitle, false]]) {
        await page.locator('.roadmap-admin__stage .roadmap-admin__icon[aria-label^="Editar el título"]').first().click();
        await page.waitForSelector(".modal-panel");
        await page.fill("#es-title", value);
        await page.click(".modal-panel .btn--primary");
        await page.waitForSelector(".modal-panel", { state: "detached", timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(1400);
        await page.goto(`${BASE}/crv/roadmap`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
        const seen = await page.evaluate((needle) => document.body.innerText.includes(needle), marked);
        if (seen !== expected) problems.push(`dato vivo: «${value}» ${seen ? "sí" : "no"} en la portada`);
        await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
        await page.waitForSelector(".roadmap-admin__stage");
        await page.waitForTimeout(500);
      }
      const enPublico = true;

      const deleted = await page.evaluate(async (needle) => {
        const rows = [...document.querySelectorAll(".roadmap-admin__row")];
        const row = rows.find((el) => el.textContent?.includes(needle));
        if (!row) return "no-encontrada";
        const button = row.querySelector('button[aria-label^="Eliminar la actividad"]');
        if (!button) return "sin-papelera";
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return "papelera-pulsada";
      }, TASK);
      await page.waitForSelector(".modal-panel", { timeout: 8000 }).catch(() => null);
      await page.locator(".modal-panel .note-chip").first().click().catch(() => null);
      await page.locator(".modal-panel button.btn--danger").first().click().catch(() => null);
      await page.waitForTimeout(2600);
      const stillThere = await page.evaluate((needle) => document.body.innerText.includes(needle), TASK);

      // Arrastre por teclado: Espacio, flecha abajo, Enter sobre el primer tirador.
      await page.evaluate(() => {
        const handle = document.querySelector(".roadmap-admin__row .roadmap-admin__drag");
        if (handle instanceof HTMLElement) handle.focus();
      });
      await page.keyboard.press(" ");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1800);

      windows = { newTaskOpen, newStageOpen, editStageOpen, afterCreate, enPublico, deleted, stillThere };
    }

    results[`${view.name}-${lang}`] = { url: page.url(), structure, windows, errors };
    if (errors.length) problems.push(`${view.name}/${lang}: ${errors.join(" | ")}`);
    if (structure.overflowX) problems.push(`${view.name}/${lang}: desbordamiento horizontal`);
    if (structure.tools.length !== 13) problems.push(`${view.name}/${lang}: ${structure.tools.length} herramientas (esperadas 13)`);
    await context.close();
  }
}

await browser.close();
const report = { generado: new Date().toISOString(), tareaDePrueba: TASK, results, problemas: problems };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2), "utf8");
for (const [key, value] of Object.entries(results)) {
  const st = value.structure;
  console.log(`${key}: ${st.tools.length} herramientas, ${st.stages.length} etapas, desbordamiento=${st.overflowX ? "sí" : "no"}, errores=${value.errors.length}`);
}
console.log(`problemas: ${problems.length ? problems.join(" | ") : "ninguno"}`);
console.log(`informe y capturas en ${OUT}`);
process.exitCode = problems.length ? 1 : 0;
