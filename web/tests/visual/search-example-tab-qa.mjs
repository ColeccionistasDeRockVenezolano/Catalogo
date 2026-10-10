import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch();
const errors = [];
const surfaces = [
  ["/", "Buscar en el catálogo"],
  ["/artistas", "Filtrar artistas por nombre"],
  ["/personas", "Buscar personas"],
  ["/discos", "Filtrar discos por título"],
  ["/organizaciones", "Filtrar organizaciones por nombre"],
];
const closeLabel = "Ocultar consejo de Tab durante 24 horas";
const exampleLabel = async field => (await field.locator(".catalog-search-example__text").last().textContent()).replace(/^[^:]+: /, "");

try {
  for (const [device, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, isMobile: device === "mobile", hasTouch: device === "mobile" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    for (const [path, label] of surfaces) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
      const input = page.getByRole("combobox", { name: label, exact: true });
      const field = input.locator("..").locator("..");
      await expect(field.locator(".catalog-search-example__text").last()).toBeVisible();
      await input.focus();
      await expect(field.getByRole("button", { name: closeLabel })).toBeVisible();
      await page.clock.runFor(3800);
      const labelNow = await exampleLabel(field);
      await page.screenshot({ path: `/tmp/crv-search-tab-${device}-${path.slice(1) || "main"}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await input.press("Shift+Tab");
      await expect(input).toHaveValue("");
      await input.focus();
      await input.press("Escape");
      await expect(field.locator(".catalog-search-example")).toHaveCount(0);
      await input.press("Tab");
      await expect(input).toHaveValue("");
      await expect(input).not.toBeFocused();
      await input.focus();
      await input.press("Tab");
      await expect(input).toHaveValue(labelNow);
      await expect(input).toBeFocused();
      await expect(field.locator(".catalog-search-example")).toHaveCount(0);
      await expect(field.locator(".search-example-hint")).toHaveCount(0);
      await input.press("Tab");
      await expect(input).not.toBeFocused();
      await input.fill("");
      await expect(field.locator(".catalog-search-example__accept")).toBeVisible();
      const pointerLabel = await exampleLabel(field);
      const accept = field.getByRole("button", { name: `Usar recomendación: ${pointerLabel}`, exact: true });
      await input.blur();
      if (device === "mobile") await accept.tap(); else await accept.click();
      await expect(input).toHaveValue(pointerLabel);
      await expect(input).toBeFocused();
      await input.fill("consulta manual");
      await input.press("Tab");
      await expect(input).toHaveValue("consulta manual");
      await expect(input).not.toBeFocused();
    }

    await page.goto(`${baseUrl}/artistas`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Género", exact: true }).click();
    const genre = page.locator(".gfinder");
    const genreInput = genre.getByRole("combobox");
    await expect(genre.locator(".catalog-search-example__text").last()).toBeVisible();
    await genreInput.focus();
    await expect(genre.getByRole("button", { name: closeLabel })).toBeVisible();
    await page.screenshot({ path: `/tmp/crv-search-tab-${device}-genre.png` });
    const genreLabel = await exampleLabel(genre);
    await genreInput.press("Tab");
    await expect(genreInput).toHaveValue(genreLabel);
    await expect(genreInput).toBeFocused();
    await expect(genre.getByRole("option").first()).toBeVisible();

    await genreInput.fill("");
    const pointerGenreLabel = await exampleLabel(genre);
    const acceptGenre = genre.getByRole("button", { name: `Usar recomendación: ${pointerGenreLabel}`, exact: true });
    if (device === "mobile") await acceptGenre.tap(); else await acceptGenre.click();
    await expect(genreInput).toHaveValue(pointerGenreLabel);
    await expect(genreInput).toBeFocused();

    // Un cierre se comparte con otras barras, otras pestañas y recargas.
    const catalogInput = page.getByRole("combobox", { name: "Filtrar artistas por nombre" });
    await catalogInput.focus();
    const dismissedAt = await page.evaluate(() => Date.now());
    await page.getByRole("button", { name: closeLabel }).first().click();
    const until = await page.evaluate(() => Number(localStorage.getItem("crv.searchExampleHint.hiddenUntil")));
    expect(until).toBeGreaterThanOrEqual(dismissedAt + 24 * 60 * 60 * 1000);
    expect(until).toBeLessThan(dismissedAt + 24 * 60 * 60 * 1000 + 2000);
    await expect(page.locator(".search-example-hint")).toHaveCount(0);
    await genreInput.fill("");
    await genreInput.focus();
    await expect(page.locator(".search-example-hint")).toHaveCount(0);

    const second = await context.newPage();
    await second.goto(baseUrl, { waitUntil: "networkidle" });
    await second.getByRole("combobox", { name: "Buscar en el catálogo" }).focus();
    await expect(second.locator(".search-example-hint")).toHaveCount(0);
    await second.close();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "networkidle" });
    await catalogInput.focus();
    await expect(page.locator(".search-example-hint")).toHaveCount(0);
    // Seguir aceptando ejemplos aunque el aviso esté oculto.
    const field = catalogInput.locator("..").locator("..");
    await expect(field.locator(".catalog-search-example__text").last()).toBeVisible();
    const hiddenLabel = await exampleLabel(field);
    await catalogInput.press("Tab");
    await expect(catalogInput).toHaveValue(hiddenLabel);
    await catalogInput.fill("");
    const dismissedPointerLabel = await exampleLabel(field);
    const hiddenAccept = field.getByRole("button", { name: `Usar recomendación: ${dismissedPointerLabel}`, exact: true });
    if (device === "mobile") await hiddenAccept.tap(); else await hiddenAccept.click();
    await expect(catalogInput).toHaveValue(dismissedPointerLabel);
    await catalogInput.fill("");
    const remaining = await page.evaluate(() => Number(localStorage.getItem("crv.searchExampleHint.hiddenUntil")) - Date.now());
    await page.clock.fastForward(remaining - 60000);
    await expect(page.locator(".search-example-hint")).toHaveCount(0);
    await page.clock.fastForward(60001);
    await expect(field.getByRole("button", { name: closeLabel })).toBeVisible();
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log("Clic, toque y Tab aceptan el ejemplo visible en los cinco buscadores y géneros; Esc seguido de Tab permite saltarlo; Shift+Tab y campos con texto conservan la navegación. Aviso y cierre de 24h verificados en escritorio/móvil, recargas y otras pestañas; el atajo continúa y el aviso reaparece al vencer.");
} finally {
  await browser.close();
}
