import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const facetUrl = process.env.CRV_GENRE_FACETS_URL;
const browser = await chromium.launch({ headless: true });
const errors = [];
const surfaces = [
  ["/", "Buscar en el catálogo", ["Artista", "Persona", "Disco", "Organización", "Género", "Subgénero", "Estilo"]],
  ["/artistas", "Filtrar artistas por nombre", ["Artista"]],
  ["/personas", "Buscar personas", ["Persona"]],
  ["/discos", "Filtrar discos por título", ["Disco"]],
  ["/organizaciones", "Filtrar organizaciones por nombre", ["Organización"]],
];

try {
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install();
    if (facetUrl) await page.route("**/genres/facets?**", async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${facetUrl}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    page.on("pageerror", error => errors.push(error.message));
    for (const [path, label, categories] of surfaces) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      // Reloj controlado: probar un ciclo completo sin esperas entre cada ejemplo.
      const input = page.getByRole("combobox", { name: label });
      const example = page.locator(".catalog-search-field .catalog-search-example__text").last();
      await expect(example).toBeVisible();
      const first = await example.textContent();
      const seen = new Set();
      for (let step = 0; step < 56 && seen.size < categories.length; step++) {
        seen.add((await example.textContent()).split(":")[0]);
        await page.clock.runFor(3800);
        await page.waitForTimeout(50);
      }
      expect(await example.textContent()).not.toBe(first);
      for (const category of categories) expect(seen.has(category)).toBe(true);
      if (path !== "/") expect(seen.size).toBe(1);
      await page.screenshot({ path: `/tmp/crv-search-examples-${device}-${path.replaceAll("/", "") || "main"}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const query = path === "/personas" ? "jose" : path === "/organizaciones" ? "Mad Box" : "Caramelos";
      await input.fill(query);
      await expect(page.locator(".catalog-search-field .catalog-search-example")).toHaveCount(0);
      await page.clock.runFor(4000);
      await expect(input).toHaveValue(query);
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(query);
      await input.fill("");
      await expect(example).toBeVisible();
    }
    await page.close();
  }
  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.clock.install();
  await reduced.goto(baseUrl, { waitUntil: "networkidle" });
  const example = reduced.locator(".catalog-search-example__text");
  await expect(example).toBeVisible();
  const first = await example.textContent();
  await reduced.clock.runFor(12000);
  expect(await example.textContent()).toBe(first);

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const suggestionOptions = page.locator(".catalog-suggestions").getByRole("option");
  page.on("pageerror", error => errors.push(error.message));
  for (const [path, label, query, category, destination] of [
    ["/", "Buscar en el catálogo", "Caramelos", "Artista", /\/artistas\/\d+$/],
    ["/artistas", "Filtrar artistas por nombre", "Caramelos", "Artista", /\/artistas\/\d+$/],
    ["/personas", "Buscar personas", "Asier", "Persona", /\/personas\/\d+$/],
    ["/discos", "Filtrar discos por título", "Caramelos", "Disco", /\/discos\/\d+$/],
    ["/organizaciones", "Filtrar organizaciones por nombre", "Mad Box", "Organización", /\/organizaciones\/\d+$/],
  ]) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    const input = page.getByRole("combobox", { name: label });
    await input.fill(query);
    const option = suggestionOptions.filter({ has: page.locator(".catalog-suggestions__category", { hasText: category }) }).first();
    await expect(option).toBeVisible();
    await page.screenshot({ path: `/tmp/crv-search-suggestions-mobile-${path.replaceAll("/", "") || "main"}.png` });
    await input.press("Escape");
    await expect(suggestionOptions).toHaveCount(0);
    await input.click();
    await expect(option).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(destination);
  }
  for (const [path, label, destination] of [
    ["/", "Buscar en el catálogo", "/artistas"],
  ]) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: label }).fill("rock");
    const genre = suggestionOptions.filter({ has: page.locator(".catalog-suggestions__category", { hasText: "Género" }) }).first();
    await expect(genre).toBeVisible();
    await genre.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
    await expect.poll(() => new URL(page.url()).searchParams.get("genero")).toBe("rock");
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  }
  await page.goto(`${baseUrl}/personas`, { waitUntil: "networkidle" });
  const input = page.getByRole("combobox", { name: "Buscar personas" });
  await input.fill("zzzzzz-no-existe-crv");
  await expect(page.getByText("Sin coincidencias. Prueba otro nombre o alias.", { exact: true })).toBeVisible();
  await input.fill("Asier");
  await expect(suggestionOptions.first()).toBeVisible();
  await input.fill("zzzzzz-no-existe-crv");
  await expect(suggestionOptions).toHaveCount(0);
  await page.route("**/search?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fallo de prueba" }) }));
  await input.fill("jose");
  await expect(page.getByText("No se pudieron cargar las sugerencias. Prueba de nuevo.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log("Principal con siete categorías y secundarios con su tipo verificados en escritorio y móvil: transición, pausa, URL, movimiento reducido, teclado, fichas, géneros, vacío, error y descarte de resultados anteriores.");
} finally {
  await browser.close();
}
