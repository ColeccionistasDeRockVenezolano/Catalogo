// Ejecutar contra Vite: CRV_WEB_URL=http://127.0.0.1:5185 node tests/visual/modal-focus-qa.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const out = process.env.CRV_QA_OUT ?? "/tmp/crv-modal-focus-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(4000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // No API, autenticación ni catálogo reales. Solo componentes y estilos de Vite.
    await page.route("**/__modal-focus-qa", route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/modal-focus.tsx"></script></body></html>',
    }));
    async function refresh() {
      const before = Number(await page.getByTestId("revision").textContent());
      await page.evaluate(() => window.dispatchEvent(new Event("qa:refresh")));
      await expect(page.getByTestId("revision")).toHaveText(String(before + 1));
    }
    try {
      await page.goto(`${base}/__modal-focus-qa`);
      const opener = page.getByRole("button", { name: "Editar ficha de prueba", exact: true });
      await opener.scrollIntoViewIfNeeded();
      await opener.click();
      // Solo el modal: los avisos (Base UI Toast) también llevan role="dialog".
      const dialog = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(dialog).toBeVisible();
      // Escape usa la función actual, incluso si su condición cambió con el modal abierto
      // (sin cambios pendientes, Escape llama directamente a onClose).
      await page.evaluate(() => window.dispatchEvent(new Event("qa:block")));
      await expect(page.getByTestId("blocked")).toHaveText("true");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("qa:block")));
      await expect(page.getByTestId("blocked")).toHaveText("false");
      // Un campo al final de un formulario largo: el contenido del editor scrollea, no la página.
      const content = dialog.locator(".eedit__main");
      const note = dialog.getByLabel("Biografía", { exact: true });
      await note.fill("Corrección de prueba sin guardar");
      await expect(note).toBeFocused();
      const before = await content.evaluate(node => node.scrollTop);
      assert.ok(before > 100, "la prueba llegó al final de un formulario largo");
      await note.selectText();
      await refresh();
      await expect(note).toBeFocused({ timeout: 700 });
      const after = await content.evaluate(node => node.scrollTop);
      assert.ok(Math.abs(after - before) <= 1, `scroll estable tras actualizar: ${before} → ${after}`);
      const selection = await note.evaluate(node => [node.selectionStart, node.selectionEnd]);
      assert.deepEqual(selection, [0, "Corrección de prueba sin guardar".length]);
      for (const char of "Texto completo") {
        await note.pressSequentially(char);
        await refresh();
        await expect(note).toBeFocused();
      }
      await expect(note).toHaveValue("Texto completo");
      const select = dialog.locator("select").first();
      await select.selectOption({ index: 1 });
      await select.focus();
      const value = await select.inputValue();
      await refresh();
      await expect(select).toBeFocused();
      await expect(select).toHaveValue(value);
      // El foco da la vuelta dentro del diálogo: de «Cerrar» (primero) a «Guardar» (último) y al revés.
      const close = dialog.locator(".modal-close");
      const save = dialog.locator(".eedit__tray-actions button[type=submit]");
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(save).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await note.focus();
      await page.screenshot({ path: `${out}/modal-${viewport.width}.png`, animations: "disabled" });
      const pageScroll = await page.evaluate(() => window.scrollY);
      // Con cambios pendientes, Escape pide confirmar el descarte.
      await page.keyboard.press("Escape");
      const discard = page.getByRole("alertdialog", { name: "Descartar cambios" });
      await discard.getByRole("button", { name: "Descartar", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      assert.equal(await page.evaluate(() => window.scrollY), pageScroll, "cerrar no mueve la página");
      assert.equal(await page.evaluate(() => document.body.classList.contains("has-modal")), false);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.deepEqual(errors, []);
      console.log(`✓ ${viewport.width}px: scroll, selección, escritura, selector, Tab, Escape y restauración`);
    } catch (error) {
      failures.push(`${viewport.width}px: ${error.message}`);
      await page.screenshot({ path: `${out}/failure-${viewport.width}.png`, animations: "disabled" });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
