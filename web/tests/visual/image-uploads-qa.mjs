// CRV_WEB_URL=http://127.0.0.1:5188 node web/tests/visual/image-uploads-qa.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5188";
const out = process.env.CRV_QA_OUT ?? "/tmp/crv-image-uploads-qa";
await mkdir(out, { recursive: true });
const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 160, g: 12, b: 16, alpha: .8 } } }).png().toBuffer();
const url = `/crv/media/uploads/${"a".repeat(64)}.webp`;
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30_000);
    const errors = [], writes = [], uploads = [];
    let release;
    let rejectUpload = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/__image-uploads-qa", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/image-uploads.tsx"></script></body></html>' }));
    await page.route("**/crv/media/**", route => route.fulfill({ contentType: "image/png", body: png }));
    await page.route("http://127.0.0.1:8080/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const send = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/media/uploads") {
        assert.equal(request.headers()["x-crv-csrf"], "image-upload-qa-csrf");
        assert.equal(request.headers()["content-type"], "image/png");
        assert.deepEqual(request.postDataBuffer(), png);
        uploads.push(path);
        await new Promise(resolve => { release = resolve; });
        if (rejectUpload) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "invalid_image", message: "La imagen está dañada. Prueba con otro archivo." } }) });
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ url, width: 120, height: 80, bytes: 100 }) });
      }
      if (["PATCH", "POST"].includes(request.method())) {
        writes.push({ path, body: request.postDataJSON() });
        return send({ id: 1, runId: 20, fields: [] });
      }
      if (path === "/catalog/cache-version") return send({ revision: "image-upload-qa" });
      if (path === "/catalog-editor/vocabulary") return send({ albumTypes: ["album"], classifications: [] });
      if (path === "/catalog-editor/entity/album/1") return send({ values: {}, vocabulary: { albumTypes: ["album"], classifications: [] } });
      if (path === "/catalog-editor/album/1/version") return send([{ id: 1, position: 1, title: "Primera edición", coverUrl: "/crv/media/upload-before.webp", editionTypes: [] }]);
      if (path.startsWith("/catalog-editor/")) return send([]);
      if (path === "/curation/images/summary") return send({ album: 1, artist: 0 });
      if (path === "/curation/images") return send({ data: [{ kind: "album", entityId: 1, name: "Disco de prueba", subtitle: "Artista", currentUrl: "/crv/media/upload-before.webp", stale: false, candidates: [] }], pagination: { total: 1, limit: 20, offset: 0 } });
      throw new Error(`Petición sin cubrir: ${request.method()} ${path}`);
    });
    await page.goto(`${base}/__image-uploads-qa`);
    const cases = [
      ["artist", "Logo", "logoUrl", "/artists/1"], ["artist", "Foto", "pictureUrl", "/artists/1"],
      ["person", "Foto", "pictureUrl", "/persons/1"], ["organization", "Imagen", "pictureUrl", "/organizations/1"],
      ["album", "Portada", "coverUrl", "/albums/1"], ["version", "Portada de esta versión", "coverUrl", "/catalog-editor/album/1/version/1"],
      ["proposal", "Foto", "pictureUrl", "/artists/1"], ["curation", "Portada", "coverUrl", "/albums/1"],
    ];
    for (const [surface, label, key, path] of cases) {
      await page.getByRole("button", { name: surface, exact: true }).click();
      if (surface === "version") await page.getByRole("button", { name: "Editar", exact: true }).click();
      if (surface === "proposal") await page.getByText("Editar propuesta", { exact: true }).click();
      if (surface === "curation") await page.getByRole("button", { name: "Subir otra imagen" }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Cerrar", exact: true }) });
      const field = dialog.locator(".image-upload").filter({ has: page.locator(`input[aria-label="Archivo: ${label}"]`) });
      await expect(field).toHaveCount(1);
      const before = uploads.length;
      release = undefined;
      // Alterna selector nativo y drag-and-drop para ejercitar ambas entradas.
      if (surface === "artist" || surface === "proposal") {
        await field.locator('input[type="file"]').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: png });
      } else {
        await field.locator(".image-upload__drop").evaluate((node, bytes) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(new File([new Uint8Array(bytes)], "foto.png", { type: "image/png" }));
          node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
        }, [...png]);
      }
      await expect.poll(() => uploads.length).toBe(before + 1);
      const save = surface === "proposal" ? dialog.getByRole("button", { name: "Sí, aceptar", exact: true }) : dialog.getByRole("button", { name: /^(Guardar(?: cambio| \d+ cambios)?|Guardando…|Subiendo imagen…)$/ });
      await expect(save).toBeDisabled();
      release();
      await expect(field.locator('input[inputmode="url"]')).toHaveValue(url);
      if (surface !== "proposal") await dialog.getByLabel(surface === "version" ? "Motivo y evidencia *" : "Motivo del cambio *", { exact: true }).fill("Fotografía confirmada en prueba");
      await expect(save).toBeEnabled();
      const overflow = await dialog.evaluate(node => node.scrollWidth > node.clientWidth);
      assert.equal(overflow, false, `sin desbordamiento en ${surface} a ${viewport.width}px`);
      if (surface === "artist" && key === "pictureUrl") await page.screenshot({ path: `${out}/form-${viewport.width}.png`, animations: "disabled" });
      const count = writes.length;
      await save.click();
      await expect.poll(() => writes.length).toBe(count + 1);
      assert.equal(writes.at(-1).path, path);
      assert.equal(writes.at(-1).body[key], url);
      assert.ok(writes.at(-1).body.note);
      await expect(dialog).toHaveCount(0);
    }
    // Un archivo inválido no llega a la API ni reemplaza el valor anterior.
    await page.getByRole("button", { name: "person", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Cerrar", exact: true }) });
    const count = uploads.length;
    await dialog.locator('input[type="file"]').setInputFiles({ name: "falsa.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(dialog.getByRole("alert")).toContainText("JPG, PNG");
    assert.equal(uploads.length, count);
    await expect(dialog.locator('input[inputmode="url"]')).toHaveValue("/crv/media/upload-before.webp");
    rejectUpload = true;
    await dialog.locator('input[type="file"]').setInputFiles({ name: "rota.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => uploads.length).toBe(count + 1); release();
    await expect(dialog.getByRole("alert")).toContainText("está dañada");
    await expect(dialog.locator('input[inputmode="url"]')).toHaveValue("/crv/media/upload-before.webp");
    rejectUpload = false;
    await dialog.locator('input[type="file"]').setInputFiles({ name: "reintento.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => uploads.length).toBe(count + 2); release();
    await expect(dialog.locator('input[inputmode="url"]')).toHaveValue(url);
    // Cancelar desbloquea el formulario y una respuesta tardía no pisa la URL nueva.
    await dialog.locator('input[type="file"]').setInputFiles({ name: "cancelar.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => uploads.length).toBe(count + 3);
    await dialog.getByRole("button", { name: "Cancelar subida", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /^Guardar(?: cambio| \d+ cambios)?$/ })).toBeEnabled();
    await expect(dialog.locator('input[inputmode="url"]')).toHaveValue(url);
    await dialog.locator('input[inputmode="url"]').fill("https://example.org/nueva-foto.jpg");
    release();
    await dialog.getByLabel("Motivo del cambio *", { exact: true }).fill("Imagen por URL");
    await dialog.getByRole("button", { name: /^Guardar(?: cambio| \d+ cambios)?$/ }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(writes.at(-1).body.pictureUrl, "https://example.org/nueva-foto.jpg");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`OK ${viewport.width}px: 8 superficies, drag/drop, selector, CSRF, bloqueo, guardado, errores y reintento`);
  }
} finally { await browser.close(); }
