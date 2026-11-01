/* global document -- las funciones de page.evaluate corren en la página */
// CRV · B7 · arrastre táctil del panel (Codex lo dejó sin verificar).
// Usa CDP Input.dispatchTouchEvent para generar toques reales (pointerType
// "touch"), arrastra la primera actividad de la fase 01 sobre la segunda y
// comprueba el cambio de orden y el aviso con «Deshacer».
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { entrar } from "./lib/sesion.mjs";

const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/b7-tactil");
const BASE = "http://127.0.0.1:3130";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: "es-VE" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

// La landing /login es el acceso de colaborador; los admins entran por /cuenta.
await entrar(page, { base: BASE, usuario: "fase1-admin", clave: "Fase1Admin2026" });
await page.goto(`${BASE}/crv/curaduria/roadmap`, { waitUntil: "networkidle" });
await page.waitForSelector(".roadmap-admin__row", { timeout: 20000 }).catch(async () => {
  console.log("URL:", page.url());
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 400));
  throw new Error("sin filas en el panel");
});
await page.waitForTimeout(800);

const firstStage = page.locator(".roadmap-admin__stage").first();
const titles = async () => firstStage.locator(".roadmap-admin__row-title").allTextContents();
const antes = (await titles()).slice(0, 3);

await firstStage.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
const handle = firstStage.locator(".roadmap-admin__row .roadmap-admin__drag").first();
await handle.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const target = firstStage.locator(".roadmap-admin__row").nth(1);
const boxH = await handle.boundingBox();
const boxT = await target.boundingBox();
if (!boxH || !boxT) throw new Error("sin cajas para el arrastre");

const cdp = await context.newCDPSession(page);
const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 6, radiusY: 6, force: 1, id: 1 }];
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(boxH.x + boxH.width / 2, boxH.y + boxH.height / 2) });
for (let step = 1; step <= 6; step += 1) {
  const y = boxH.y + ((boxT.y + boxT.height * 0.8) - boxH.y) * (step / 6);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(boxH.x + boxH.width / 2, y) });
  await page.waitForTimeout(80);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(2600);

await page.waitForSelector(".roadmap-admin__row", { timeout: 20000 });
await page.waitForTimeout(1500);
const despues = (await titles()).slice(0, 3);
const toast = await page.locator(".toast__action, .toast button").first().textContent().catch(() => null);
await page.screenshot({ path: path.join(OUT, "tactil-despues.png"), fullPage: false });

// Deshacer, si el aviso lo ofrece.
let deshecho = null;
const undo = page.locator(".toast__action").first();
if (await undo.count()) {
  await undo.click();
  await page.waitForTimeout(1200);
  await page.waitForSelector(".roadmap-admin__row", { timeout: 20000 });
  await page.waitForTimeout(2000);
  deshecho = (await titles()).slice(0, 3);
}

const report = { generado: new Date().toISOString(), antes, despues, cambio: JSON.stringify(antes) !== JSON.stringify(despues), toast, deshecho, restaurado: deshecho ? JSON.stringify(deshecho) === JSON.stringify(antes) : false, errors };
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exitCode = report.cambio && report.restaurado ? 0 : 1;
