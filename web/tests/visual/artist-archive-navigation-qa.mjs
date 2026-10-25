// Archivo real de Caramelos, servido de solo lectura. Ninguna mutación llega a la API.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://localhost:5173";
const out = process.env.CRV_QA_OUT;
if (!out) throw new Error("Define CRV_QA_OUT en el staging SSD.");
await mkdir(out, { recursive: true });
const seed = await (await fetch("http://127.0.0.1:8080/artists/58")).json();
assert.ok(seed.gallery.length > 3 && seed.documents.length > 1);
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/crv\/api/, "");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        writes.push(path); return route.abort();
      }
      if (path === "/artists/58") return route.fulfill({ json: { ...seed, platforms: [], playbackAlbums: [], channelVideo: null } });
      if (path === "/auth/me") return route.fulfill({ json: { user: null, csrf: null } });
      return route.continue();
    });
    await page.goto(`${base}/artistas/58?tab=galeria`);
    const gallery = page.getByRole("region", { name: `Galería de ${seed.name}` });
    await expect(gallery.locator(".artist-gallery__photo")).toHaveCount(seed.gallery.length);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Galería sin desbordamiento");
    const heights = await gallery.locator(".artist-gallery__description").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    assert.ok(heights.every(height => height < 48), "Los textos largos no estiran las filas");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/gallery-${width}-full.png`, fullPage: true, animations: "disabled" });
    await page.evaluate(() => window.scrollTo(0, document.querySelector(".etabs").getBoundingClientRect().top + scrollY - 80));
    await page.screenshot({ path: `${out}/gallery-${width}.png`, animations: "disabled" });

    const opener = gallery.getByRole("button", { name: `Ampliar ${seed.gallery[0].title}`, exact: true });
    await opener.click();
    const viewer = page.locator("dialog.image-viewer");
    const photo = viewer.locator(".image-viewer__stage img");
    const status = viewer.locator('[role="status"]').first();
    await expect(photo).toHaveClass("is-ready");
    await expect(status).toContainText(`Foto 1 de ${seed.gallery.length}`);
    await viewer.getByRole("button", { name: "Foto siguiente", exact: true }).click();
    await expect(status).toContainText("Foto 2 de");
    await page.keyboard.press("ArrowRight");
    await expect(status).toContainText("Foto 3 de");
    await page.keyboard.press("ArrowLeft");
    await expect(status).toContainText("Foto 2 de");
    await page.keyboard.press("Home");
    await viewer.getByRole("button", { name: "Foto anterior", exact: true }).click();
    await expect(status).toContainText(`Foto ${seed.gallery.length} de`);
    await viewer.getByRole("button", { name: "Ver foto 1:", exact: false }).click();
    await expect(photo).toHaveClass("is-ready");
    await viewer.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    await expect(viewer.locator(".image-viewer__stage")).toHaveClass(/is-zoomed/);
    await page.keyboard.press("ArrowRight");
    await expect(status).toContainText("Foto 2 de");
    await expect(viewer.locator(".image-viewer__stage")).not.toHaveClass(/is-zoomed/);
    await expect(photo).toHaveClass("is-ready");
    if (width < 600) {
      const box = await viewer.locator(".image-viewer__stage").boundingBox();
      const cdp = await context.newCDPSession(page);
      const y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width * .75, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: width * .25, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(status).toContainText("Foto 3 de");
      await cdp.detach();
    }
    await expect(photo).toHaveClass("is-ready");
    await page.screenshot({ path: `${out}/viewer-${width}.png`, animations: "disabled" });
    // Panel plegable, pestañas documentales y navegación por zonas de la imagen.
    const imageStage = viewer.locator(".image-viewer__stage");
    const panel = viewer.locator(".image-viewer__panel");
    const beforeFold = await imageStage.boundingBox();
    await viewer.getByRole("button", { name: "Plegar el panel del archivo", exact: true }).click();
    await expect(panel).toHaveAttribute("data-collapsed", "");
    await expect.poll(async () => { const box = await imageStage.boundingBox(); return Math.round(width <= 700 ? box.height - beforeFold.height : box.width - beforeFold.width); }, { message: "Plegar amplía el espacio de la foto" }).toBeGreaterThan(0);
    const afterFold = await imageStage.boundingBox();
    assert.ok(width <= 700 ? afterFold.height > beforeFold.height : afterFold.width > beforeFold.width);
    await viewer.getByRole("button", { name: "Desplegar el panel del archivo", exact: true }).click();
    await expect(panel).not.toHaveAttribute("data-collapsed");
    await expect.poll(async () => { const box = await imageStage.boundingBox(); return Math.round(width <= 700 ? afterFold.height - box.height : afterFold.width - box.width); }, { message: "El mismo mando devuelve el panel a su sitio" }).toBeGreaterThan(0);
    const afterUnfold = await imageStage.boundingBox();
    assert.ok(width <= 700 ? afterUnfold.height < afterFold.height : afterUnfold.width < afterFold.width, "El mismo mando devuelve el panel a su sitio");
    await viewer.getByRole("button", { name: "Sobre la foto", exact: true }).click();
    await expect(viewer.locator(".image-viewer__photo-info")).toBeVisible();
    await expect(viewer.getByRole("tab", { name: "Sobre la foto", exact: true })).toHaveAttribute("aria-selected", "true");
    await viewer.getByRole("tab", { name: "Sobre la foto", exact: true }).focus();
    const currentCount = await status.textContent();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByRole("tab", { name: "Colección", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(status).toHaveText(currentCount);
    await page.keyboard.press("Home"); // Home sobre las pestañas conserva la foto.
    await expect(status).toHaveText(currentCount);
    await viewer.getByRole("button", { name: /^Ver foto 1:/ }).click();
    await expect(photo).toHaveClass("is-ready");
    const zone = await imageStage.boundingBox();
    const press = async x => width < 600 ? page.touchscreen.tap(x, zone.y + zone.height / 2) : page.mouse.click(x, zone.y + zone.height / 2);
    await press(zone.x + zone.width * .8);
    await expect(status).toContainText("Foto 2 de");
    await expect(photo).toHaveClass("is-ready");
    await press(zone.x + zone.width * .2);
    await expect(status).toContainText("Foto 1 de");
    await expect(photo).toHaveClass("is-ready");
    // El doble toque amplía sin cambiar de foto y vuelve a ajustar.
    const centerX = zone.x + zone.width / 2, centerY = zone.y + zone.height / 2;
    await page.mouse.dblclick(centerX, centerY, { delay: 80 });
    await expect(imageStage).toHaveClass(/is-zoomed/);
    await expect(status).toContainText("Foto 1 de");
    await page.waitForTimeout(350);
    await page.mouse.dblclick(centerX, centerY, { delay: 80 });
    await expect(imageStage).not.toHaveClass(/is-zoomed/);
    await expect(status).toContainText("Foto 1 de");
    await viewer.getByRole("button", { name: "Sobre la foto", exact: true }).click();
    await expect(viewer.locator(".image-viewer__photo-info h3")).toHaveText(seed.gallery[0].title);
    await viewer.getByRole("button", { name: "Foto siguiente", exact: true }).click();
    await expect(viewer.locator(".image-viewer__photo-info h3")).toHaveText(seed.gallery[1].title);
    await expect(photo).toHaveClass("is-ready");
    await page.screenshot({ path: `${out}/viewer-info-${width}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();

    if (width === 1440) {
      // Un original roto no bloquea el cambio de foto ni obliga a cerrar el visor.
      const broken = `**${seed.gallery[1].imageUrl}`;
      let fail = true;
      await page.route(broken, route => fail ? route.abort() : route.continue());
      await page.reload();
      await opener.click();
      await expect(status).toContainText("Foto 1 de");
      await page.keyboard.press("ArrowRight");
      await expect(viewer.getByRole("alert")).toContainText("No se pudo cargar la imagen");
      fail = false;
      await viewer.getByRole("button", { name: "Reintentar", exact: true }).click();
      await expect(photo).toHaveClass("is-ready");
      await page.keyboard.press("ArrowRight");
      await expect(status).toContainText("Foto 3 de");
      await expect(photo).toHaveClass("is-ready");
      await page.keyboard.press("Escape");
      await page.unroute(broken);
      // Las fotografías sueltas de la ficha conservan su visor y su zoom.
      await page.getByRole("button", { name: `Ampliar foto de ${seed.name}`, exact: true }).click();
      await expect(photo).toHaveClass("is-ready");
      await expect(viewer.getByRole("button", { name: "Foto siguiente", exact: true })).toHaveCount(0);
      await viewer.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
      await expect(viewer.locator(".image-viewer__stage")).toHaveClass(/is-zoomed/);
      await page.keyboard.press("Escape");
    }

    await gallery.getByRole("button", { name: "Artista 1", exact: true }).click();
    await opener.click();
    await expect(page.getByRole("button", { name: "Foto siguiente", exact: true })).toHaveCount(0);
    await expect(page.locator(".image-viewer__toolbar")).toContainText("Foto 1 de 1");
    await page.keyboard.press("Escape");
    await gallery.getByRole("button", { name: /^Imágenes relacionadas/ }).click();
    await gallery.locator(".artist-gallery__open").first().click();
    await expect(page.locator(".image-viewer__toolbar")).toContainText(`Foto 1 de ${seed.gallery.length - 1}`);
    await page.keyboard.press("Escape");

    if (width <= 760) await page.getByLabel("Ir a una sección del perfil").selectOption("otros");
    else await page.getByRole("tab", { name: /^Otros/ }).click();
    await expect(page).toHaveURL(/tab=otros/);
    const documents = page.getByRole("region", { name: "Entrevistas y otros documentos" });
    await expect(documents.locator(".artist-documents__list > li")).toHaveCount(seed.documents.length);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Documentos sin desbordamiento");
    await page.evaluate(() => window.scrollTo(0, document.querySelector(".etabs").getBoundingClientRect().top + scrollY - 80));
    await page.screenshot({ path: `${out}/documents-${width}.png`, animations: "disabled" });
    const search = documents.getByRole("searchbox");
    await search.fill("zzzzsinresultados");
    await expect(documents.getByText("No hay documentos con estos filtros.")).toBeVisible();
    await documents.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(search).toHaveValue("");
    const read = documents.getByRole("button", { name: /^Leer documento:/ }).first();
    await read.click();
    const reader = page.getByRole("dialog", { name: "Archivo del artista", exact: true });
    await expect(reader.locator(".artist-documents__content")).toContainText(seed.documents[0].content.slice(0, 70));
    await page.screenshot({ path: `${out}/reader-${width}.png`, animations: "disabled" });
    await reader.getByRole("button", { name: "Siguiente", exact: true }).click();
    await expect(reader.locator(".document-reader > h2")).toHaveText(seed.documents[1].title);
    assert.equal(await reader.locator(".modal-body").evaluate(node => node.scrollTop), 0);
    await page.keyboard.press("Escape");
    await expect(read).toBeFocused();
    // El teclado recorre y revela también las pestañas que quedaban fuera de pantalla.
    const activeTab = page.getByRole("tab", { selected: true });
    await activeTab.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
    const tabVisible = await page.getByRole("tab").last().evaluate(node => {
      const tab = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
      return tab.left >= list.left - 1 && tab.right <= list.right + 1;
    });
    assert.ok(tabVisible, "La pestaña activa se mantiene a la vista");
    if (width === 1440) {
      await page.setViewportSize({ width: 390, height: 900 });
      await expect.poll(() => page.getByRole("tab").last().evaluate(node => {
        const tab = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
        return tab.left >= list.left - 1 && tab.right <= list.right + 1;
      })).toBe(true);
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    report.push({ width, keyboard: true, buttons: true, thumbnails: true, swipe: width < 600, zoomReset: true, filterScope: true, reader: true, focusRestored: true, overflow: false, writes: 0 });
    await context.close();
  }
  await writeFile(`${out}/navigation-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
