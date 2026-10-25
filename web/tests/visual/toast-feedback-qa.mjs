// Gestos reales de ratón y touch mediante Playwright/CDP; sin API de producción.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
const output = process.env.CRV_QA_OUT ?? `${process.env.HOME}/crv-staging/reports/image-curation-async-2026-10-24`;
await mkdir(output, { recursive: true });
const web = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)), server: { host: "127.0.0.1", port: 0 } });
await web.listen();
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390 });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/toast-qa", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/toast-feedback.tsx"></script></body></html>' }));
    await page.goto(`http://127.0.0.1:${web.httpServer.address().port}/toast-qa`);
    const visible = () => page.locator(".toast:not([data-limited]):not([data-ending-style])");
    const cdp = await context.newCDPSession(page);
    async function swipe(dx, dy, touch) {
      const toast = visible().first();
      await toast.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
      const box = await toast.locator(".toast__title").boundingBox();
      const x = box.x + box.width * .35, y = box.y + box.height / 2;
      if (touch) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let step = 1; step <= 10; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 10, y: y + dy * step / 10 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
      }
    }
    for (const [direction, dx, dy] of [["left", -110, 0], ["right", 110, 0], ["up", 0, -110], ["down", 0, 110]]) {
      await page.getByRole("button", { name: "Mostrar aviso", exact: true }).click();
      await expect(visible()).toHaveCount(1);
      await swipe(dx, dy, width === 390);
      await expect(page.locator(".toast")).toHaveCount(0);
      checks.push({ width, gesture: width === 390 ? "touch" : "mouse", direction, dismissed: true });
    }
    await page.getByRole("button", { name: "Mostrar aviso", exact: true }).click();
    await swipe(-12, 0, width === 390);
    await expect(visible()).toHaveCount(1);
    await visible().getByRole("button", { name: "Cerrar aviso" }).click();
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.getByRole("button", { name: "Aviso con acción", exact: true }).click();
    await visible().getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("Acciones realizadas: 1", { exact: true })).toBeVisible();
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.getByRole("button", { name: "Mostrar error", exact: true }).click();
    await visible().focus(); await page.keyboard.press("Escape");
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.getByRole("button", { name: "Mostrar cinco", exact: true }).click();
    await expect(visible()).toHaveCount(3);
    await expect(page.locator(".toast")).toHaveCount(3);
    await visible().evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/toasts-${width}.png` });
    for (let i = 0; i < 3; i++) {
      await visible().first().getByRole("button", { name: "Cerrar aviso" }).click();
      await expect(visible()).toHaveCount(2 - i);
    }
    await expect(page.locator(".toast")).toHaveCount(0);
    // Un aviso cerrado no absorbe el próximo éxito por la ventana de fusión de títulos.
    await page.getByRole("button", { name: "Aviso de cambio", exact: true }).click();
    await visible().getByRole("button", { name: "Cerrar aviso" }).click();
    await page.getByRole("button", { name: "Nuevo éxito", exact: true }).click();
    await expect(visible()).toContainText("Otra operación completada");
    await visible().getByRole("button", { name: "Cerrar aviso" }).click();
    await expect(page.locator(".toast")).toHaveCount(0);
    if (width === 1440) {
      await page.clock.install();
      await page.getByRole("button", { name: "Aviso temporal", exact: true }).click();
      await visible().hover(); await page.clock.fastForward(2000);
      await expect(visible()).toHaveCount(1);
      await page.mouse.move(5, 5); await page.clock.fastForward(2000);
      await expect(page.locator(".toast")).toHaveCount(0);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Mostrar aviso", exact: true }).click();
    assert.ok(await visible().evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) <= .001));
    await visible().getByRole("button", { name: "Cerrar aviso" }).click();
    assert.deepEqual(errors, []);
    checks.push({ width, shortDragRestores: true, close: true, action: true, escape: true, maxThree: true, closedMerge: true, reducedMotion: true });
    await context.close();
  }
  await writeFile(`${output}/toast-checks.json`, JSON.stringify(checks, null, 2));
  console.log(JSON.stringify(checks));
} finally { await browser.close(); await web.close(); }
