// CRV_WEB_URL=http://127.0.0.1:5186 node web/tests/visual/catalog-menu-qa.mjs
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5186";
const browser = await chromium.launch({ headless: true });
const overview = {
  totals: { "/artistas": 4542, "/discos": 20498, "/personas": 32162, "/organizaciones": 3225 },
  genres: [{ slug: "rock", name: "Rock" }, { slug: "fusion-latina", name: "Fusión latina" }],
  decades: [1960, 2000, 2020],
};
try {
  for (const scenario of ["success", "error", "timeout"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", error => console.error(error.message));
    let requests = 0;
    const legacy = [];
    await page.route("**/*/facets*", route => { legacy.push(route.request().url()); return route.abort(); });
    await page.route("**/catalog/overview", async route => {
      requests++;
      if (requests === 1 && scenario === "timeout") return;
      if (requests === 1 && scenario === "error") return route.fulfill({ status: 503, json: { error: { message: "Temporal" } } });
      return route.fulfill({ json: overview });
    });
    await page.route("**/__catalog-menu-qa", route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="es"><body><div id="root" style="padding:80px"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
          window.__vite_plugin_react_preamble_installed__=true;
        </script><script type="module" src="/tests/visual/catalog-menu-fixture.tsx"></script></body></html>`,
    }));
    await page.goto(`${base}/__catalog-menu-qa`);
    const trigger = page.getByRole("button", { name: "Catálogo", exact: true });
    const start = Date.now();
    await trigger.click();
    if (scenario !== "success") {
      await expect(page.getByRole("status")).toContainText("No se pudieron cargar", { timeout: 12_000 });
      if (scenario === "timeout") assert.ok(Date.now() - start < 12_000);
      await expect(page.locator(".mega__skeleton")).toHaveCount(0);
      await expect(page.locator(".mega__entities a")).toHaveCount(4);
      await page.getByRole("button", { name: "Reintentar" }).click();
    }
    await expect(page.locator(".mega__tags a")).toHaveCount(5);
    await expect(page.locator(".mega__skeleton")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Rock", exact: true })).toHaveAttribute("href", "/artistas?genero=rock");
    await expect(page.getByRole("link", { name: "Años 2000", exact: true })).toHaveAttribute("href", "/discos?decada=2000");
    await page.getByRole("link", { name: "Rock", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(page.locator(".mega__tags a").first()).toBeVisible();
    assert.equal(requests, scenario === "success" ? 1 : 2);
    assert.deepEqual(legacy, []);
    if (scenario === "success") await page.screenshot({ path: "/tmp/crv-catalog-menu.png" });
    console.log(`${scenario}: ok (${Date.now() - start} ms)`);
    await page.close();
  }
} finally { await browser.close(); }
