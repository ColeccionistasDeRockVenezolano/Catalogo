// Datos simulados: este recorrido no escribe en el catálogo.
// CRV_QA_OUT debe apuntar al staging SSD de la campaña de capturas.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const base = process.env.CRV_WEB_URL ?? "http://localhost:5173";
const out = process.env.CRV_QA_OUT;
if (!out) throw new Error("Define CRV_QA_OUT en el staging SSD antes de capturar.");
await mkdir(out, { recursive: true });
const seed = await (await fetch("http://127.0.0.1:8080/artists/1525")).json();
const png = await sharp({ create: { width: 640, height: 420, channels: 3, background: "#62574b" } }).png().toBuffer();
const browser = await chromium.launch({ headless: true });
async function capture(page, name, overlay = false) {
  await page.evaluate(async overlay => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    if (overlay) document.querySelectorAll(".modal-body").forEach(node => { node.scrollTop = 0; });
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  }, overlay);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !overlay, animations: "disabled", style: ".toast-stack { visibility: hidden; }" });
}
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    page.setDefaultTimeout(30000);
    const errors = [], writes = [];
    let gallery = [], uploads = 0, failSecond = true;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/crv/media/**", route => route.fulfill({ contentType: "image/png", body: png }));
    await page.route("**/auth/me", route => route.fulfill({ json: { user: { username: "gallery.qa", name: "QA galería", role: "admin" }, csrf: "gallery-qa-csrf" } }));
    await page.route("http://127.0.0.1:8080/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/auth/me") return route.fulfill({ json: { user: { username: "gallery.qa", name: "QA galería", role: "admin" }, csrf: "gallery-qa-csrf" } });
      if (path === "/curation/images/jobs") return route.fulfill({ json: [] });
      if (path.startsWith("/entity-verification/")) return route.fulfill({ json: null });
      if (path.endsWith("/text-rewrites")) return route.fulfill({ json: { pending: [] } });
      if (["/claims", "/audit", "/changes"].includes(path)) return route.fulfill({ json: { data: [], pagination: { total: 0, limit: 10, offset: 0 } } });
      if (path === "/artists/1525" && request.method() === "GET") return route.fulfill({ json: { ...seed, name: "Galería de prueba · QA", platforms: [], playbackAlbums: [], channelVideo: null, gallery } });
      if (path === "/media/gallery-uploads") {
        assert.equal(request.headers()["x-crv-csrf"], "gallery-qa-csrf"); uploads++;
        if (uploads === 2 && failSecond) { failSecond = false; return route.fulfill({ status: 422, json: { error: { message: "No se pudo procesar la segunda imagen. Reintenta." } } }); }
        return route.fulfill({ status: 201, json: { url: `/crv/media/gallery-qa/${uploads}.webp`, width: 640, height: 420, bytes: png.length } });
      }
      if (/^\/artists\/1525\/gallery/u.test(path) && request.method() !== "GET") {
        const body = request.method() === "DELETE" ? null : request.postDataJSON();
        writes.push({ path, body });
        if (request.method() === "POST") gallery = body.photos.map((photo, index) => ({ ...photo, id: index + 1 }));
        if (request.method() === "PATCH") gallery = gallery.map(photo => photo.id === Number(path.split("/").at(-1)) ? { ...photo, ...body } : photo);
        if (request.method() === "DELETE") gallery = gallery.filter(photo => photo.id !== Number(path.split("/").at(-1)));
        return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: { ids: gallery.map(photo => photo.id) } });
      }
      if (request.method() !== "GET" && request.method() !== "OPTIONS") return route.fulfill({ json: {} });
      return route.continue();
    });
    await page.goto(`${base}/artistas/1525?tab=galeria`);
    await expect(page.getByText("Aún no hay imágenes en esta galería.")).toBeVisible();
    await page.getByRole("button", { name: "Añadir fotos", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Añadir fotos a la galería|Editar foto/u });
    await dialog.getByLabel("Seleccionar fotos de la galería").setInputFiles([
      { name: "concierto-qa.png", mimeType: "image/png", buffer: png }, { name: "poster-qa.png", mimeType: "image/png", buffer: png },
    ]);
    await dialog.getByLabel("Título de la imagen", { exact: true }).fill("Concierto de prueba");
    await dialog.getByLabel("Descripción o comentario").fill("Descripción de prueba para verificar el visor y el pie de foto.");
    await dialog.getByLabel("Categoría", { exact: true }).selectOption("concert");
    await dialog.getByLabel("Fecha", { exact: true }).fill("2000-01-02");
    await dialog.getByLabel("Ubicación", { exact: true }).fill("Caracas · dato simulado");
    await dialog.getByRole("button", { name: "Foto 2: poster-qa.png" }).click();
    await dialog.getByLabel("Título de la imagen", { exact: true }).fill("Póster de prueba");
    await dialog.getByLabel("Categoría", { exact: true }).selectOption("poster");
    await capture(page, `editor-${width}`, true);
    await dialog.getByRole("button", { name: "Añadir 2 fotos", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("segunda imagen");
    assert.equal(uploads, 2);
    await dialog.getByRole("button", { name: "Añadir 2 fotos", exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15000 }).catch(async error => {
      console.log("Diálogos pendientes:", await page.getByRole("dialog").allTextContents());
      console.log("Errores del navegador:", errors);
      throw error;
    }); assert.equal(uploads, 3);
    assert.equal(writes[0].body.photos[0].date, "2000-01-02");
    assert.equal(writes[0].body.photos[1].date, null);
    await expect(page.getByRole("heading", { name: "Concierto de prueba", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Conciertos 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Póster de prueba", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Todas 2", exact: true }).click();
    await capture(page, `galeria-${width}`);
    await page.getByRole("button", { name: "Ampliar Concierto de prueba", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Concierto de prueba", exact: true });
    await expect(viewer.locator(".image-viewer__stage img")).toHaveClass("is-ready");
    await viewer.getByText("Información de la foto", { exact: true }).click();
    await expect(viewer.getByText("Caracas · dato simulado", { exact: true })).toBeVisible();
    await expect(viewer.getByText("02/01/2000", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    await capture(page, `visor-${width}`, true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Editar galería", exact: true }).click();
    await page.getByRole("button", { name: "Editar Concierto de prueba", exact: true }).click();
    await dialog.getByLabel("Título de la imagen", { exact: true }).fill("Concierto corregido");
    await dialog.getByLabel("Fecha", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Concierto corregido", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Eliminar Concierto corregido", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Eliminar foto de la galería" });
    await confirmation.getByRole("button", { name: "Imagen duplicada", exact: true }).click();
    await confirmation.getByRole("button", { name: "Eliminar foto", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Concierto corregido", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Póster de prueba", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Añadir fotos", exact: true }).click();
    await dialog.getByLabel("Seleccionar fotos de la galería").setInputFiles({ name: "incorrecta.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(dialog.getByRole("alert")).toContainText("Revisa estos archivos");
    await dialog.getByLabel("Seleccionar fotos de la galería").setInputFiles({ name: "una-foto.png", mimeType: "image/png", buffer: png });
    await dialog.getByRole("button", { name: "Añadir 1 foto", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(writes.at(-1).body.photos.length, 1);
    assert.equal(writes.at(-1).body.photos[0].title, null);
    assert.equal(writes.at(-1).body.photos[0].description, null);
    await page.route("**/auth/me", route => route.fulfill({ json: { user: { username: "gallery.reader", name: "Lector QA", role: "reader" }, csrf: "reader-csrf" } }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Añadir fotos", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar galería", exact: true })).toHaveCount(0);
    await expect(page.locator(".artist-gallery__photo")).toHaveCount(1);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`OK ${width}px: lote, datos opcionales, fallo parcial, reintento sin duplicar, visor, edición y borrado individual`);
  }
} finally { await browser.close(); }
