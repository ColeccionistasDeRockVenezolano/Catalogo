// Visor integrado: gestos reales, pantallas bajas y colecciones extensas, sin escrituras a la API.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const out = process.env.CRV_QA_OUT;
if (!out) throw new Error("Define CRV_QA_OUT en staging SSD.");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const onlyLarge = process.env.CRV_QA_ONLY_LARGE === "1";
try {
  for (const [width, height] of onlyLarge ? [] : [[1440, 900], [1280, 720], [390, 844], [320, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort());
    await page.goto(`${base}/artistas/58?tab=galeria`);
    const open = page.locator(".artist-gallery__open").first();
    await open.click();
    const viewer = page.locator("dialog.image-viewer");
    await expect(viewer).toBeVisible();
    const stage = viewer.locator(".image-viewer__stage"), photo = stage.locator("img"), status = viewer.locator('[role="status"]').first();
    await expect(photo).toHaveClass("is-ready");
    await page.evaluate(() => document.fonts.ready);
    const inBounds = await viewer.locator("button").evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && !n.closest(".image-viewer__contacts")).every(n => {
      const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
    }));
    assert.ok(inBounds, `Controles dentro de ${width}×${height}`);
    if (height >= 720) {
      assert.equal(await viewer.locator(".image-viewer__contacts").evaluate(n => n.scrollHeight <= n.clientHeight + 1), true, "Las ocho miniaturas caben");
    }
    const box = await stage.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    assert.ok(box.height > 100, "La foto conserva espacio incluso en horizontal");
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([tx, ty, id = 0]) => ({ x: tx, y: ty, id })) });
    const tap = async (tx, ty) => { await touch("touchStart", [[tx, ty]]); await touch("touchEnd", []); };
    await tap(box.x + box.width * .8, y);
    await expect(status).toContainText("Foto 2 de");
    await expect(photo).toHaveClass("is-ready");
    await tap(box.x + box.width * .2, y);
    await expect(status).toContainText("Foto 1 de");
    await expect(photo).toHaveClass("is-ready");
    await tap(x, y); await tap(x, y);
    await expect(stage).toHaveClass(/is-zoomed/);
    await page.waitForTimeout(350);
    await expect(status).toContainText("Foto 1 de");
    await touch("touchStart", [[x, y]]); await touch("touchMove", [[x + 60, y + 35]]); await touch("touchEnd", []);
    await expect(status).toContainText("Foto 1 de");
    await viewer.getByRole("button", { name: "Ajustar a la pantalla", exact: true }).click();
    await touch("touchStart", [[x - 30, y, 0], [x + 30, y, 1]]);
    await touch("touchMove", [[x - 70, y, 0], [x + 70, y, 1]]);
    await touch("touchEnd", []);
    await expect(stage).toHaveClass(/is-zoomed/);
    await expect(status).toContainText("Foto 1 de");
    await viewer.getByRole("button", { name: "Ajustar a la pantalla", exact: true }).click();
    await expect(stage).not.toHaveClass(/is-zoomed/);
    await expect(photo).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.screenshot({ path: `${out}/light-table-${width}x${height}.png`, animations: "disabled" });
    await viewer.getByRole("button", { name: "Sobre la foto", exact: true }).click();
    await expect(viewer.locator(".image-viewer__photo-info")).toBeVisible();
    await page.screenshot({ path: `${out}/light-table-info-${width}x${height}.png` });
    await viewer.getByRole("button", { name: "Plegar el panel del archivo", exact: true }).click();
    const panel = viewer.locator("aside.image-viewer__panel");
    await expect(panel).toHaveAttribute("data-collapsed", "");
    await expect(panel).toHaveAttribute("inert", "");
    await expect.poll(() => panel.evaluate(n => Math.round(n.getBoundingClientRect().width * n.getBoundingClientRect().height)), { message: "El panel plegado no ocupa espacio" }).toBe(0);
    const unfolded = viewer.getByRole("button", { name: "Desplegar el panel del archivo", exact: true });
    assert.equal(await unfolded.evaluate(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }), true, "El mando de desplegar queda dentro de la pantalla");
    await expect(unfolded).toBeFocused();
    await page.screenshot({ path: `${out}/light-table-folded-${width}x${height}.png`, animations: "disabled" });
    await unfolded.click();
    await expect(panel).not.toHaveAttribute("data-collapsed");
    await expect(panel).not.toHaveAttribute("inert");
    await expect(viewer.locator(".image-viewer__photo-info")).toBeVisible();
    await expect.poll(() => panel.evaluate(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), { message: "El mismo mando vuelve a desplegar el panel" }).toBe(true);
    await page.screenshot({ path: `${out}/light-table-unfolded-${width}x${height}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    assert.deepEqual(errors, []);
    results.push({ width, height, realApi: true, tapZones: true, doubleTap: true, pinch: true, pan: true, collapse: true, unfold: true });
    await cdp.detach(); await context.close();
  }
  // La prueba amplía únicamente la respuesta local del navegador; el catálogo no cambia.
  const seed = await (await fetch("http://127.0.0.1:8080/artists/58")).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route(/\/artists\/58(?:\?.*)?$/, route => route.fulfill({ json: { ...seed, platforms: [], playbackAlbums: [], channelVideo: null,
    gallery: Array.from({ length: 80 }, (_, i) => ({ ...seed.gallery[i % seed.gallery.length], id: i + 1 })) } }));
  await page.goto(`${base}/artistas/58?tab=galeria`);
  await page.locator(".artist-gallery__open").first().click();
  await page.keyboard.press("End");
  const last = page.locator('.image-viewer__contacts [aria-current="true"]');
  await expect(last).toHaveAttribute("aria-label", /^Ver foto 80:/);
  await expect.poll(() => last.evaluate(n => { const a = n.getBoundingClientRect(), b = n.parentElement.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom + 1; }), { message: "La miniatura seleccionada se revela en colecciones largas" }).toBe(true);
  await context.close();
  await writeFile(`${out}/${onlyLarge ? "light-table-large-production-results" : "light-table-results"}.json`, JSON.stringify({ results, largeCollection: true }, null, 2));
  console.log(JSON.stringify({ results, largeCollection: true }, null, 2));
} finally { await browser.close(); }
