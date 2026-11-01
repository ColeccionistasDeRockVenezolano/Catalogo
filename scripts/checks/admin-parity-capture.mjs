/* global document -- las funciones de page.evaluate corren en la página */
// CRV · Paridad del admin (B6) — capturas de staging.
//
// Captura /curaduria/roadmap a 1440 y 390 px, ES y EN, la página completa y
// las ventanas 3.1–3.3, y mide la geometría del menú lateral (el corte que
// reportó Brian). Deja PNG y un informe.json en la campaña del SSD.
//
// Uso: node scripts/checks/admin-parity-capture.mjs [--out <dir>] [--only <panel|ventanas>]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = "http://127.0.0.1:3130";
const OUT = value("--out", path.join(os.homedir(), "crv-staging/reports/admin-paridad-2026-11"));
const USER = "fase1-admin";
const PASS = "Fase1Admin2026";
const VIEWS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];
const LANGS = ["es", "en"];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { generado: new Date().toISOString(), base: BASE, capturas: [], menu: [], incidencias: [] };

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/crv/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"], input#username, input[type="text"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"], form button');
  await page.waitForTimeout(2500);
  return page;
}

for (const view of VIEWS) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, locale: "es-VE" });
    await context.addInitScript((l) => localStorage.setItem("crv-lang", l), lang);
    const page = await login(context);
    await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
    await page.waitForSelector(".roadmap-admin__stage", { timeout: 20000 });
    await page.waitForTimeout(700);

    const menu = await page.evaluate(() => {
      const side = document.querySelector(".cside");
      const links = [...document.querySelectorAll(".cside__link")];
      const clipped = links
        .map((el) => {
          const label = el.querySelector(".cside__label");
          const count = el.querySelector(".cside__count");
          const box = el.getBoundingClientRect();
          const countBox = count?.getBoundingClientRect();
          return {
            texto: label?.textContent?.trim() ?? "",
            recortado: Boolean(label && label.scrollWidth > label.clientWidth + 1),
            cuentaFuera: Boolean(countBox && countBox.right > box.right + 1),
            bordeDerechoCuenta: countBox ? Math.round(countBox.right) : null,
          };
        })
        .filter((item) => item.recortado || item.cuentaFuera);
      return {
        cside: side ? { clientWidth: side.clientWidth, scrollWidth: side.scrollWidth, right: Math.round(side.getBoundingClientRect().right) } : null,
        enlaces: links.length,
        recortados: clipped,
        scrollHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    report.menu.push({ vista: view.name, idioma: lang, ...menu });
    if (menu.scrollHorizontal) report.incidencias.push(`${view.name}/${lang}: scroll horizontal en la página`);

    const shot = path.join(OUT, `staging-panel-${view.name}-${lang}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    report.capturas.push({ archivo: shot, vista: view.name, idioma: lang, tipo: "panel" });

    if (lang === "es") {
      const windows = [
        { id: "3.1", selector: ".roadmap-admin__tool--primary", nombre: "nueva-actividad" },
        { id: "3.2", selector: '.roadmap-admin__tool:nth-child(2)', nombre: "nueva-etapa" },
        { id: "3.3", selector: '.roadmap-admin__stage .roadmap-admin__icon[aria-label^="Editar el título"]', nombre: "editar-etapa" },
      ];
      for (const item of windows) {
        await page.locator(item.selector).first().click();
        await page.waitForSelector(".modal-panel", { timeout: 8000 });
        await page.waitForTimeout(350);
        const file = path.join(OUT, `staging-ventana-${item.id}-${item.nombre}-${view.name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        report.capturas.push({ archivo: file, vista: view.name, idioma: lang, tipo: `ventana ${item.id}` });
        await page.keyboard.press("Escape");
        await page.waitForSelector(".modal-panel", { state: "detached", timeout: 8000 }).catch(() => null);
        await page.waitForTimeout(250);
      }
    }
    await context.close();
  }
}

await browser.close();
await writeFile(path.join(OUT, "informe-staging.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ capturas: report.capturas.length, menu: report.menu, incidencias: report.incidencias }, null, 2).slice(0, 4000));
