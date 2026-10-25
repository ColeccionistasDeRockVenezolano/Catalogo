import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5187";
const out = process.env.CRV_QA_OUT ?? "reports/unified-search-stage1/browser";
await mkdir(out, { recursive: true });
const resources = JSON.parse(await readFile("docs/unified-search/resources.json", "utf8"));
const now = new Date().toISOString();
const fixture = { periodDays: 30, generatedAt: now, dailyCycle: { date: "2026-10-17", timeZone: "America/Caracas" }, summary: { total: 3, direct: 1, empty: 1, incidents: 1 },
  sampling: { maximumExamplesPerEditorialDay: 500 }, combinations: [], latencies: [], quality: { pending: 0, lost: 0, failed: 0 }, limitations: ["Lógica heredada; evaluación musical pendiente"], queries: [],
  legacy: { rows: [] }, suggestions: { decisions: [{ status: "approved", count: 15 }], funnel: [], jobs: [] },
  flags: { suggestions: true, suggestionMetrics: false, recommendations: false }, resources: { checkedAt: now, fieldReview: null, rows: resources.resources.map(({id,resource,availability,status,nextTask,stagePriority})=>({id,resource,availability,status,nextTask,stagePriority,fields:null})) } };
const browser = await chromium.launch({ headless: true });
const report = { fixture: "synthetic UI data; backend independently tested in PostgreSQL", errors: [], sizes: [], confirmations: [] };
try {
 for (const [name, width, height] of [["desktop",1440,1000],["mobile",390,844]]) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  let admin = true;
  await page.route("**/auth/me", route => route.fulfill({ status: admin ? 200 : 401, json: admin ? { user: { username: "qa", name: "QA", role: "admin" }, csrf: "qa" } : { error: { message: "Sin sesión" } } }));
  await page.route("**/search/administration", route => route.fulfill({ json: fixture }));
  await page.route("**/search/confirmations", async route => { report.confirmations.push(route.request().postDataJSON()); await route.fulfill({ json: { status: "queued" } }); });
  await page.route("**/search?*", route => {
    const q = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({ status: q === "falla" ? 503 : 200, headers: { "x-crv-search-receipt": randomUUID(), "access-control-expose-headers": "x-crv-search-receipt" },
      json: q === "falla" ? { error: { code: "search_busy", message: "El buscador está ocupado" } } : { artist: q === "Desorden" ? [{ type: "artist", id: 1, label: "Desorden Público", context: null, albumId: null }] : [], person: [], album: [], track: [], organization: [], emotion: null } });
  });
  await page.goto(`${base}/administrar/buscador`);
  await page.getByRole("heading", { name: "Resumen", exact: true }).waitFor();
  if (!process.env.CRV_QA_SKIP_SCREENSHOTS) await page.screenshot({ path: `${out}/${name}-summary.png`, fullPage: true });
  for (const section of ["Consultas y patrones","Conocimiento","Sugerencias","Alimentación","Laya y evaluación","Reglas e historial"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await page.getByRole("heading", { name: section, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Alimentación", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 44);
  if (!process.env.CRV_QA_SKIP_SCREENSHOTS) await page.screenshot({ path: `${out}/${name}-resources.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `${name}: page overflow`);
  report.sizes.push({ name, width, overflow });
  admin = false; await page.reload();
  await page.getByText("Esta sección requiere una cuenta administradora.").waitFor();
  await page.goto(base);
  const field = page.getByRole("combobox", { name: "Buscar en el catálogo" });
  await field.fill("sin gritos");
  await page.waitForTimeout(500);
  const previous = report.confirmations.length;
  assert.equal(previous, name === "desktop" ? 0 : 3, "Typing must not confirm");
  await field.press("Enter");
  await page.getByText("Sin resultados para «sin gritos»").waitFor();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(150);
  assert.equal(report.confirmations.length, previous + 1, "Enter must confirm once after rendering");
  await page.reload(); await page.waitForTimeout(500);
  assert.equal(report.confirmations.length, previous + 1, "Refresh must not confirm");
  await field.fill("Desorden");
  await page.getByRole("option").filter({ hasText: "Desorden Público" }).first().waitFor();
  await page.getByRole("option").filter({ hasText: "Desorden Público" }).first().click();
  await page.waitForTimeout(200);
  assert.equal(report.confirmations.length, previous + 2, "Entity selection must confirm a direct navigation");
  assert.equal(report.confirmations.at(-1).confirmation, "entity");
  assert.deepEqual(report.confirmations.at(-1).selected, { type: "artist", id: 1 });
  await page.goto(base);
  const again = page.getByRole("combobox", { name: "Buscar en el catálogo" });
  await again.fill("falla"); await again.press("Enter");
  await page.getByText("El buscador está ocupado", { exact: true }).first().waitFor();
  await page.waitForTimeout(200);
  assert.equal(report.confirmations.length, previous + 3, "Technical failure must also confirm once");
  await context.close();
 }
 assert.deepEqual(report.errors, []);
 await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ sizes: report.sizes, confirmed: report.confirmations.length, errors: report.errors }));
} finally { await browser.close(); }
