import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const out = process.env.CRV_QA_OUT ?? "docs/ui-qa/appearance-viewer-2026-10-15";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
let theme = "current";
let failSave = false;
let failImage = false;
const errors = [];
async function contextFor(role, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 761 });
  await context.route("**/site-appearance", async route => {
    if (route.request().method() === "PATCH") {
      if (failSave) return route.fulfill({ status: 503, json: { error: { message: "No se pudo guardar el tema de prueba." } } });
      assert.equal(role, "admin");
      assert.equal(route.request().headers()["x-crv-csrf"], "qa-csrf");
      theme = route.request().postDataJSON().catalogTheme;
    }
    return route.fulfill({ json: { catalogTheme: theme, updatedAt: null } });
  });
  await context.route("**/auth/me", route => route.fulfill({ json: { user: role ? { username: "qa", name: "QA", role } : null, csrf: role ? "qa-csrf" : "" } }));
  await context.route("**/entity-verification/**", route => route.fulfill({ json: null }));
  await context.route("**/credit-sources?**", route => route.fulfill({ json: [] }));
  await context.route(/\/(?:claims|audit)(?:\?|$)/u, route => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 15, offset: 0 } } }));
  await context.route("**/albums/*/text-rewrites", route => route.fulfill({ json: { pending: [] } }));
  await context.route("**/artists/*/text-rewrites", route => route.fulfill({ json: { pending: [] } }));
  await context.route(/\/changes(?:\?|$)/u, route => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 10, offset: 0 } } }));
  await context.route("**/crv/media/**", async route => {
    if (failImage && /\/album\/262\.jpg$/u.test(new URL(route.request().url()).pathname) && !new URL(route.request().url()).search) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ response: await route.fetch({ url: route.request().url().replace(new URL(base).host, "127.0.0.1:3120") }) });
  });
  await context.route("https://www.youtube.com/iframe_api", route => route.fulfill({ body: "" }));
  await context.route(/https:\/\/(?:www\.youtube-nocookie\.com\/embed|open\.spotify\.com\/embed|widget\.deezer\.com|embed\.tidal\.com)/u, route => route.fulfill({ body: "<!doctype html><style>html{background:#0b0b0d}</style><title>Reproductor de prueba</title>" }));
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  return context;
}
function transform(image) { return image.evaluate(node => { const m = new DOMMatrix(getComputedStyle(node).transform); return { x: m.m41, y: m.m42, zoom: m.a }; }); }
async function capture(page, filename, fullPage = false) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${out}/${filename}.png`, fullPage, animations: "disabled", style: ".toast-stack { visibility: hidden; }" });
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    theme = "current";
    const context = await contextFor("admin", viewport);
    const page = await context.newPage();
    await page.goto(`${base}/configuracion/temas`);
    await expect(page.getByRole("heading", { name: "Temas del catálogo" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Actual/u })).toBeChecked();
    await page.getByRole("button", { name: /^Cuenta de .*Administrar/u }).click();
    const accountMenu = page.getByRole("navigation", { name: "Administración" });
    await expect(accountMenu.getByRole("link", { name: /Curaduría/u })).toBeVisible();
    await expect(accountMenu.getByRole("link", { name: /Configuración/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountMenu).toHaveCount(0);
    await page.getByRole("radio", { name: /^Carbón/u }).check();
    assert.equal(await page.locator("html").getAttribute("data-catalog-theme"), "current", "seleccionar no publica antes de aplicar");
    failSave = true;
    await page.getByRole("button", { name: "Aplicar tema al catálogo" }).click();
    await expect(page.getByRole("alert")).toContainText("No se pudo guardar");
    assert.equal(theme, "current");
    failSave = false;
    await page.getByRole("button", { name: "Aplicar tema al catálogo" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-catalog-theme", "charcoal");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await capture(page, `temas-${viewport.width}`, true);

    const visitor = await contextFor(null, viewport);
    const publicPage = await visitor.newPage();
    await publicPage.goto(`${base}/discos/262`);
    await expect(publicPage.locator("html")).toHaveAttribute("data-catalog-theme", "charcoal");
    await expect(publicPage.getByRole("button", { name: /^Cuenta de .*Administrar/u })).toHaveCount(0);
    await publicPage.getByRole("button", { name: "Ampliar portada de Indeleble" }).waitFor();
    await publicPage.locator(".album-profile img").evaluate(image => image.decode());
    await capture(publicPage, `album-carbon-${viewport.width}`, true);
    await capture(publicPage, `album-carbon-viewport-${viewport.width}`);
    // Estudio se publica por el mismo camino y llega a un visitante sin sesión.
    await page.getByRole("radio", { name: /^Estudio/u }).check();
    assert.equal(theme, "charcoal", "el nuevo tema también requiere aplicar");
    await page.getByRole("button", { name: "Aplicar tema al catálogo" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-catalog-theme", "studio");
    assert.ok((await page.getByRole("button", { name: "Aplicar tema al catálogo" }).boundingBox()).height >= 44, "aplicar tema tiene área táctil de 44px");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await capture(page, `temas-estudio-${viewport.width}`, true);
    await publicPage.reload();
    await expect(publicPage.locator("html")).toHaveAttribute("data-catalog-theme", "studio");
    await publicPage.locator(".album-profile img").evaluate(image => image.decode());
    await capture(publicPage, `album-estudio-${viewport.width}`, true);
    await capture(publicPage, `album-estudio-viewport-${viewport.width}`);
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Estudio no desborda");
    const publicHomeLink = publicPage.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Home", exact: true });
    if (viewport.width < 761) {
      await expect(publicHomeLink.locator(".nav-icon")).toBeVisible();
      await expect(publicHomeLink.locator(".nav-label-mobile")).toBeHidden();
      await expect(publicHomeLink.locator(".nav-label")).toBeHidden();
    } else {
      await expect(publicHomeLink.locator(".nav-icon")).toBeHidden();
      await expect(publicHomeLink.locator(".nav-label")).toBeVisible();
    }
    await publicPage.goto(`${base}/configuracion/temas`);
    await expect(publicPage.getByText("Esta sección requiere una cuenta administradora.")).toBeVisible();
    await expect(publicPage.getByRole("radio")).toHaveCount(0);
    await visitor.close();

    await page.goto(`${base}/`);
    await expect(page.locator("html")).toHaveAttribute("data-catalog-theme", "current");
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--red").trim()), "#e50914");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundImage), "none");
    await expect(page.locator('.main-nav a').first()).toContainText("Home");
    // La vuelta a Home funciona con ambos temas globales y también por enlace SPA.
    await page.goto(`${base}/configuracion/temas`);
    await page.getByRole("radio", { name: /^Carbón/u }).check();
    await page.getByRole("button", { name: "Aplicar tema al catálogo" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-catalog-theme", "charcoal");
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-catalog-theme", "current");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundImage), "none");
    await page.goto(`${base}/discos/262`);
    const cover = page.getByRole("button", { name: "Ampliar portada de Indeleble" });
    await cover.click();
    const dialog = page.getByRole("dialog", { name: "Portada de Indeleble" });
    const image = dialog.locator(".image-viewer__stage img");
    await expect(image).toHaveClass("is-ready");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    const initial = await transform(image);
    assert.equal(initial.zoom, 1);
    for (let count = 0; count < 5; count++) await dialog.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    assert.ok((await transform(image)).zoom > 3);
    const box = await dialog.locator(".image-viewer__stage").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const moved = await transform(image);
    assert.ok(moved.x > 0 || moved.y > 0, "arrastre desplaza la imagen ampliada");
    await dialog.getByRole("button", { name: "Ajustar a la pantalla", exact: true }).click();
    assert.equal((await transform(image)).zoom, 1);
    await dialog.locator(".image-viewer__stage").dblclick();
    assert.ok((await transform(image)).zoom > 1);
    await dialog.locator(".image-viewer__stage").dblclick();
    assert.equal((await transform(image)).zoom, 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await transform(image)).zoom).toBeGreaterThan(1);
    await dialog.getByRole("button", { name: "Tamaño real (100%)", exact: true }).click();
    await expect(dialog.getByLabel("Nivel de zoom", { exact: true })).toHaveText("100%");
    await page.keyboard.press("0");
    assert.equal((await transform(image)).zoom, 1);
    if (viewport.width < 761) {
      const cdp = await context.newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 0 }, { x: x + 30, y, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 90, y, id: 0 }, { x: x + 90, y, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await transform(image)).zoom).toBeGreaterThan(1.5);
      await cdp.detach();
    }
    for (let count = 0; count < 10; count++) {
      await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), "foco contenido en el visor");
    }
    await page.screenshot({ path: `${out}/visor-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(cover).toBeFocused();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    // Contexto nuevo: una imagen ya decodificada puede reutilizarse sin otra petición.
    failImage = true;
    const recovery = await contextFor(null, viewport);
    const recoveryPage = await recovery.newPage();
    await recoveryPage.goto(`${base}/discos/262`);
    await recoveryPage.getByRole("button", { name: "Ampliar portada de Indeleble" }).click();
    await expect(recoveryPage.getByRole("alert")).toContainText("No se pudo cargar la imagen");
    failImage = false;
    await recoveryPage.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(recoveryPage.locator(".image-viewer__stage img")).toHaveClass("is-ready");
    await recoveryPage.getByRole("button", { name: "Cerrar visor de imagen" }).click();
    await expect(recoveryPage.getByRole("dialog")).toHaveCount(0);
    await recovery.close();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.goto(`${base}/artistas/4235`);
    await page.getByRole("button", { name: "Ampliar foto de Arca", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Foto de Arca", exact: true }).locator("img")).toHaveClass("is-ready");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Ampliar foto de Arca", exact: true })).toBeFocused();
    console.log(`✓ ${viewport.width}px: temas globales, acceso admin, Home aislada y visor (zoom, pan, rueda, teclado, foco, error/reintento${viewport.width < 761 ? ", pellizco" : ""})`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
