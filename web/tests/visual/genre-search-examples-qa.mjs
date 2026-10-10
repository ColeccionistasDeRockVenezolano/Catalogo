import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const facetUrl = process.env.CRV_GENRE_FACETS_URL;
const browser = await chromium.launch();
const errors = [];
try {
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install();
    page.on("pageerror", error => errors.push(error.message));
    if (facetUrl) await page.route("**/genres/facets?**", async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${facetUrl}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    for (const path of ["/artistas", "/discos"]) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const finder = page.locator(".gfinder");
      const input = finder.getByRole("combobox", { name: "Buscar un género, subgénero o estilo", exact: true });
      const text = finder.locator(".catalog-search-example__text").last();
      const seen = new Set();
      for (let step = 0; step < 3; step++) {
        await expect(text).toBeVisible();
        seen.add((await text.textContent()).split(":")[0]);
        await page.clock.runFor(3800);
        await page.waitForTimeout(50);
      }
      expect([...seen]).toEqual(["Género", "Subgénero", "Estilo"]);
      await page.screenshot({ path: `/tmp/crv-genre-search-${device}-${path.slice(1)}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      for (const [query, family, sub, style] of [
        ["thrash", "metal", "thrash-metal", null],
        path === "/artistas" ? ["pasaje", "musica-venezolana", "joropo", "pasaje"]
          : ["neopsicodelia", "rock", "rock-psicodelico", "neo-psicodelia"],
      ]) {
        await input.fill(query);
        await expect(finder.locator(".catalog-search-example")).toHaveCount(0);
        const option = finder.getByRole("option").first();
        await expect(option).toBeVisible();
        await input.press("Enter");
        await expect.poll(() => new URL(page.url()).searchParams.get("genero")).toBe(family);
        expect(new URL(page.url()).searchParams.get("subgenero")).toBe(sub);
        expect(new URL(page.url()).searchParams.get("estilo")).toBe(style);
        await expect(input).toHaveValue("");
        await expect(text).toBeVisible();
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Dejar que el listener de matchMedia se aplique antes de adelantar el reloj.
    await page.waitForTimeout(50);
    const text = page.locator(".gfinder .catalog-search-example__text").last();
    const before = await text.textContent();
    await page.clock.runFor(12000);
    expect(await text.textContent()).toBe(before);
    await page.close();
  }
  expect(errors).toEqual([]);
  console.log("El filtro de géneros alterna género, subgénero y estilo; selecciona thrash, pasaje y neopsicodelia con su jerarquía, en escritorio y móvil, y respeta movimiento reducido.");
} finally { await browser.close(); }
