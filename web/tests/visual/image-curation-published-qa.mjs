// Comprueba el bundle publicado. Todas las escrituras y la sesión se simulan en el navegador.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.CRV_WEB_URL ?? "https://mini-server.tail5815b0.ts.net/crv";
const output = process.env.CRV_QA_OUT ?? `${process.env.HOME}/crv-staging/reports/image-curation-persistent-2026-10-24`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const page = await context.newPage(), held = new Map(), closed = new Set(), errors = [], writes = [], jobs = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    const groups = Array.from({ length: 3 }, (_, i) => ({ kind: "album", entityId: i + 1, name: `Prueba publicada ${i + 1}`, subtitle: "Datos simulados · Sin cambios al catálogo", currentUrl: "/crv/media/qa-current.svg", stale: false,
      candidates: [{ id: 101 + i, url: "/crv/media/qa-candidate.svg", source: "discogs", pageUrl: null, width: 600, height: 600, score: .94, naturalWidth: 600, naturalHeight: 600, effectiveWidth: 600, quality: "high", use: "cover", reasons: [], context: null, variantOf: null }] }));
    await page.route("**/crv/media/qa-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#402a2b"/><circle cx="300" cy="300" r="220" fill="#111"/><circle cx="300" cy="300" r="60" fill="#d31826"/></svg>' }));
    await page.route("**/crv/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace("/crv/api", "");
      if (request.method() !== "GET") {
        assert.equal(path, "/curation/images/jobs", `Escritura no esperada: ${path}`);
        assert.equal(request.headers()["x-crv-csrf"], "published-qa-csrf");
        const accepted = request.postDataJSON().tasks.map(task => {
          const id = task.entityId; writes.push(path);
          const job = { id, requestId: task.requestId, type: task.type, groups: [{ kind: task.kind, entityId: id, name: `Prueba publicada ${id}` }], candidateId: task.candidateId,
            status: "running", error: null, conflict: false, result: null, runId: null, attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          jobs.push(job);
          held.set(id, () => {
            held.delete(id); job.updatedAt = new Date().toISOString();
            if (id === 2) { job.status = "error"; job.error = "La fuente no responde. Puedes revisar esta imagen."; }
            else { closed.add(id); job.status = "done"; job.result = "Imagen guardada."; job.runId = 900000001; }
          });
          return job;
        });
        return route.fulfill({ status: 202, json: accepted });
      }
      if (path === "/curation/images/jobs") return route.fulfill({ json: jobs });
      if (path === "/auth/me") return route.fulfill({ json: { user: { username: "qa", name: "Prueba de interfaz", role: "admin" }, csrf: "published-qa-csrf" } });
      if (path === "/curation/images/summary") return route.fulfill({ json: { album: 3 - closed.size, artist: 0 } });
      if (path === "/curation/images") return route.fulfill({ json: { data: groups.filter(group => !closed.has(group.entityId)), pagination: { limit: 20, offset: 0, total: 3 - closed.size } } });
      if (path === "/curation/summary") return route.fulfill({ json: { totals: { open: 0 }, categories: [], autofix: { today: { applied: 0 }, alerts: [] }, running: false } });
      if (path.startsWith("/changes/")) return route.fulfill({ json: { id: 900000001, entities: [], action: "image_choice", kind: "manual", undoOf: null, redoOf: null } });
      if (path.includes("duplicate-candidates")) return route.fulfill({ json: { data: [], pagination: { total: 0, offset: 0, limit: 1 } } });
      if (path.startsWith("/curation/")) return route.fulfill({ json: { data: [], pagination: { total: 0, offset: 0, limit: 1 } } });
      return route.continue(); // Sólo lecturas públicas reales (reloj, tema y versión de caché).
    });
    await page.goto(`${base}/curaduria/imagenes`, { waitUntil: "domcontentloaded" });
    const card = id => page.getByRole("article", { name: `Prueba publicada ${id}`, exact: true });
    await expect(card(1)).toBeVisible();
    await card(1).getByRole("button", { name: "Usar esta", exact: true }).click();
    await expect.poll(() => held.has(1)).toBe(true);
    await expect(card(1)).toHaveCount(0);
    await card(2).getByRole("button", { name: "Usar esta", exact: true }).click();
    await expect.poll(() => held.has(2)).toBe(true);
    await expect(card(3).getByRole("button", { name: "Usar esta", exact: true })).toBeEnabled();
    await expect(page.getByText("La cola está guardada en el servidor.", { exact: false })).toBeVisible();
    assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }))), false);
    held.get(2)();
    await expect(card(2)).toBeVisible();
    await expect(page.getByRole("region", { name: "Procesamiento de imágenes" })).toContainText("con error");
    held.get(1)();
    const toast = page.locator(".toast:not([data-ending-style])").first();
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: "Cerrar aviso", exact: true })).toHaveCount(1);
    await toast.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    await page.getByRole("region", { name: "Procesamiento de imágenes" }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/published-${width}.png` });
    const box = await toast.locator(".toast__title").boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (width === 390) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - i * 10, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 100, y, { steps: 10 }); await page.mouse.up(); }
    await expect(page.locator(".toast")).toHaveCount(0);
    assert.equal(writes.length, 2); assert.deepEqual(errors, []);
    checks.push({ width, url: base, writesIntercepted: writes.length, concurrentSelection: true, serverQueueConfirmed: true, errorRestored: true, toastDismissedLeft: true, overflow: false });
    await context.close();
  }
  await writeFile(`${output}/published-checks.json`, JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks));
} finally { await browser.close(); }
