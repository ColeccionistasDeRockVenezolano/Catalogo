// Plan 20/20, etapa 4 · búsqueda completa y pista → disco.
// Solo lecturas públicas de la API local (8080), reenviadas por la prueba, con Vite en 127.0.0.1:5175;
// las escrituras (métricas de búsqueda) se responden aquí y no llegan a la API.
//   npx tsx tests/visual/search-track-qa.ts
import { chromium, expect } from "@playwright/test";

const WEB = process.env.QA_WEB ?? "http://127.0.0.1:5175";
const OUT = process.env.QA_OUT ?? "/tmp/crv-search-track";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results: string[] = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Without a session: the public search, as visitors use it.
    // Public reads are relayed to the local API (its CORS list does not include this Vite port).
    await page.route("http://127.0.0.1:8080/**", async (route) => {
      const req = route.request();
      if (new URL(req.url()).pathname === "/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "unauthorized", message: "" } }) });
      if (req.method() !== "GET") return route.fulfill({ status: 204, body: "" });
      const response = await route.fetch({ headers: { ...req.headers(), cookie: "" } });
      return route.fulfill({ status: response.status(), headers: { "content-type": response.headers()["content-type"] ?? "application/json", ...(response.headers()["x-crv-search-receipt"] ? { "x-crv-search-receipt": response.headers()["x-crv-search-receipt"]! } : {}) }, body: await response.body() });
    });
    await page.goto(`${WEB}/?q=amor&tipo=pistas`);
    const group = page.locator(".search-group").filter({ has: page.getByRole("heading", { name: /^Pistas/u }) });
    await expect(group.locator(".search-hit")).toHaveCount(20, { timeout: 20000 });
    await expect(group.getByText("Se muestran los 20 más cercanos.")).toBeVisible();
    // Truncated results: the filtered type can show up to 50 without retyping the query.
    await group.getByRole("button", { name: "Ver hasta 50 pistas" }).click();
    await expect(group.locator(".search-hit")).toHaveCount(50);
    await expect(group.getByText("Se muestran los 50 más cercanos; afina la búsqueda para ver otros.")).toBeVisible();
    await expect(group.getByRole("heading", { name: /^Pistas/u })).toContainText("(50+)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    // A track opens its album at that track, highlighted and focused.
    const hit = group.locator(".search-hit").nth(30);
    const href = await hit.getAttribute("href");
    expect(href).toMatch(/^\/discos\/\d+#pista-\d+$/u);
    const trackId = href!.split("#pista-")[1]!;
    await hit.click();
    const row = page.locator(`#pista-${trackId}`);
    await expect(row).toHaveClass(/is-target/u, { timeout: 20000 });
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    await page.screenshot({ path: `${OUT}-${width}-pista.png` });
    // Back to the search: query and filter come back from the URL.
    await page.goBack();
    await expect(page).toHaveURL(/\?q=amor&tipo=pistas$/u);
    await expect(group.locator(".search-hit").first()).toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
    results.push(`${width} px: 20 → 50 pistas sin reescribir, pista ${trackId} señalada y enfocada en su disco, regreso con consulta y filtro.`);
    await page.close();
  }
  console.log(results.join("\n"));
} finally { await browser.close(); }
