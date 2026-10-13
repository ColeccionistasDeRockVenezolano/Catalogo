import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const hit = (type, id, label, context = null, albumId = null) => ({ type, id, label, context, albumId });
const empty = { artist: [], track: [], album: [], person: [], organization: [] };
const results = {
  artist: [hit("artist", 266, "Zapato 3", "Caracas")],
  track: [hit("track", 1, "Una canción con un título largo para comprobar el espacio disponible", "Zapato 3 · Amor, Furia y Languidez", 410)],
  album: Array.from({ length: 8 }, (_, index) => hit("album", 410 + index, `Disco ${index + 1}`, "Zapato 3")),
  person: [hit("person", 1, "Carlos Segura", "Venezuela")],
  organization: [hit("organization", 1, "Sello de prueba")],
};
const browser = await chromium.launch();
const errors = [];
try {
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", error => errors.push(error.message));
    let fail = false;
    await page.route("**/search?**", async route => {
      const query = new URL(route.request().url()).searchParams.get("q");
      await route.fulfill({ status: fail ? 503 : 200, contentType: "application/json",
        body: JSON.stringify(fail ? { message: "Fallo de prueba" } : query === "sin-coincidencias" ? empty : results) });
    });
    const input = page.getByRole("combobox", { name: "Buscar en el catálogo", exact: true });
    const popup = page.locator(".catalog-suggestions");
    const all = popup.getByRole("button", { name: /Ver todos los resultados/ });
    const fullResults = page.locator(".search-groups");
    await page.goto(baseUrl);
    await input.fill("Za");
    await expect(popup).toHaveCount(0);
    await input.fill("Zapato");
    await expect(popup.getByRole("option")).toHaveCount(7);
    await expect(page.locator(".catalog-suggestions__group-label")).toHaveText(["Artistas", "Canciones", "Álbumes", "Personas", "Organizaciones"]);
    await expect(popup.locator(".catalog-suggestions__count")).toHaveText("7 resultados");
    await expect(popup.locator('[data-category="Pista"] .catalog-suggestions__category')).toHaveText("Canción");
    await expect(popup.locator('[data-category="Disco"] .catalog-suggestions__category')).toHaveText(["Álbum", "Álbum", "Álbum"]);
    await expect(popup.locator('[data-category="Artista"] .catalog-suggestions__name mark')).toHaveText("Zapato");
    await expect(page.locator(".home-search-recommendation")).toHaveCount(0);
    await expect(fullResults).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    const anchor = await input.boundingBox();
    const panel = await popup.boundingBox();
    expect(panel.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    expect(panel.width).toBeLessThanOrEqual(560);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
    await expect(all).toBeVisible();
    await page.screenshot({ path: `/tmp/crv-search-panel-${device}.png` });

    await input.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(fullResults).toHaveCount(0);
    await input.click();
    await expect(all).toBeVisible();
    await all.click();
    await expect(fullResults).toBeVisible();
    await expect(popup).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("q")).toBe("Zapato");
    await expect(fullResults.locator(".search-hit")).toHaveCount(12);

    // Volver a editar una búsqueda completa no muestra resultados duplicados.
    await input.click();
    await expect(popup).toBeVisible();
    await expect(fullResults).toHaveCount(0);
    await input.fill("Nueva búsqueda");
    await expect(popup.getByRole("option")).toHaveCount(7);
    await expect(popup.locator(".catalog-suggestions__status")).toHaveCount(0);
    await input.press("Enter");
    await expect(popup).toHaveCount(0);
    await expect(fullResults).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe("Nueva búsqueda");
    await page.goBack();
    await expect(input).toHaveValue("Zapato");
    await expect(fullResults).toBeVisible();
    await input.fill("");
    await expect(popup).toHaveCount(0);
    await expect(fullResults).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);

    await input.fill("sin-coincidencias");
    await expect(popup.getByText("Sin coincidencias. Prueba otro nombre, alias o género.", { exact: true })).toBeVisible();
    await input.press("Enter");
    await expect(page.getByText("Sin resultados para «sin-coincidencias»", { exact: true })).toBeVisible();
    await expect(popup).toHaveCount(0);

    fail = true;
    await input.fill("Error de búsqueda");
    await expect(popup.getByRole("button", { name: "Reintentar sugerencias" })).toBeVisible();
    await expect(fullResults).toHaveCount(0);
    fail = false;
    await popup.getByRole("button", { name: "Reintentar sugerencias" }).click();
    await expect(popup.getByRole("option")).toHaveCount(7);

    // Flechas + Enter conservan la navegación a una ficha; Enter sin selección busca.
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/artistas\/266$/);
    await page.goto(`${baseUrl}/?q=Zapato`);
    await expect(input).toHaveValue("Zapato");
    await expect(fullResults).toBeVisible();
    await expect(popup).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  }
  expect(errors).toEqual([]);
  console.log("Panel compacto agrupado, sin resultados duplicados; botón, Enter, teclado, URL compartida, historial, vacío y recuperación verificados en escritorio y móvil.");
} finally {
  await browser.close();
}
