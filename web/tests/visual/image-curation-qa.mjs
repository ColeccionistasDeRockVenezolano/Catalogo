// scripts/with-node22.sh npx tsx web/tests/visual/image-curation-qa.mjs
// API y PostgreSQL reales y desechables. Las únicas descargas simuladas son los originales.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { startPgContainer } from "../../../test/support/pg-container.ts";
import { applyCore } from "../../../test/support/apply-core.ts";
import { migrateUp } from "../../../src/db/migrate.ts";
import { closeDb, getPool } from "../../../src/db/client.ts";
import { resetEnvCache } from "../../../src/config/env.ts";
import { registerOperatorAuth } from "../../../src/api/auth.ts";
import { toApiError } from "../../../src/api/http-errors.ts";
import { registerImageCandidateRoutes } from "../../../src/api/routes/image-candidates.ts";
import { registerChangeRoutes } from "../../../src/api/routes/changes.ts";

const output = process.env.CRV_QA_OUT ?? `${process.env.HOME}/crv-staging/reports/image-curation-persistent-2026-10-24`;
const password = randomBytes(20).toString("base64url"), salt = randomBytes(16);
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
let database, mediaRoot, api, web, browser;
let blocking = true, failingEntity = null;
const gates = [], checks = [], errors = [];
try {
  await mkdir(output, { recursive: true });
  database = await startPgContainer(); mediaRoot = await mkdtemp(path.join(tmpdir(), "crv-image-queue-browser-"));
  Object.assign(process.env, { DATABASE_URL: database.databaseUrl, DATA_DIR: mediaRoot, CRV_OPERATOR_TOKEN: "", CRV_HERRA_DB_PATH: "", CRV_SESSION_COOKIE_PATH: "/", LOG_LEVEL: "error",
    CRV_COLLABORATORS_JSON: JSON.stringify([{ username: "qa.admin", name: "QA Imágenes", passwordHash, role: "admin" }]) });
  resetEnvCache(); await applyCore(database.name); await migrateUp();
  const bytes = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#991f33" } }).jpeg().toBuffer();
  api = Fastify(); api.setValidatorCompiler(validatorCompiler); api.setSerializerCompiler(serializerCompiler);
  api.setErrorHandler((error, _request, reply) => { const mapped = toApiError(error); return mapped ? reply.status(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message } }) : reply.send(error); });
  await registerOperatorAuth(api);
  api.get("/catalog/cache-version", async () => ({ revision: "queue-qa" }));
  await registerImageCandidateRoutes(api, { mediaRoot, download: async url => {
    const entityId = Number(url.match(/(\d+)\.jpg$/u)?.[1]);
    if (blocking) await new Promise(resolve => gates.push(resolve));
    return entityId === failingEntity ? { error: "HTTP 503", transient: true } : { bytes };
  } });
  await registerChangeRoutes(api);
  const apiUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  web = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api") }, server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: apiUrl, rewrite: value => value.replace(/^\/api/u, "") } } } });
  await web.listen(); const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  async function open(width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const login = await context.request.post(`${base}/api/auth/login`, { data: { username: "qa.admin", password } }); assert.equal(login.status(), 200);
    await context.route("**/curaduria/imagenes?real=1", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/image-curation.tsx"></script></body></html>' }));
    await context.route("**/crv/media/**", route => route.fulfill({ contentType: "image/jpeg", body: bytes }));
    await context.route("https://img.example/**", route => route.fulfill({ contentType: "image/jpeg", body: bytes }));
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/curaduria/imagenes?real=1`, { waitUntil: "domcontentloaded" });
    return { context, page };
  }
  for (const width of [1440, 390]) {
    await getPool().query("UPDATE ingest.image_candidates SET status='rejected' WHERE status='open'");
    const artist = Number((await getPool().query("INSERT INTO public.artists(name) VALUES($1) RETURNING id", [`Banda ${width}`])).rows[0].id);
    const ids = [];
    for (let i = 1; i <= 6; i++) {
      const id = Number((await getPool().query("INSERT INTO public.albums(artist_id,title,cover_url) VALUES($1,$2,'/crv/media/qa-before.jpg') RETURNING id", [artist, `Disco ${width} ${i}`])).rows[0].id); ids.push(id);
      await getPool().query("INSERT INTO ingest.image_candidates(entity_kind,album_id,current_url,candidate_url,source,origin) VALUES('album',$1,'/crv/media/qa-before.jpg',$2,'discogs','qa')", [id, `https://img.example/${id}.jpg`]);
    }
    blocking = true;
    let { context, page } = await open(width);
    let card = index => page.getByRole("article", { name: `Disco ${width} ${index}`, exact: true });
    await expect(card(1)).toBeVisible();
    const started = Date.now();
    await card(1).getByRole("button", { name: "Usar esta", exact: true }).evaluate(node => { node.click(); node.click(); });
    await expect(card(1)).toHaveCount(0); const nextDecisionMs = Date.now() - started;
    for (let i = 2; i <= 4; i++) await card(i).getByRole("button", { name: "Usar esta", exact: true }).click();
    await expect(page.getByText("La cola está guardada en el servidor.", { exact: false })).toBeVisible();
    await expect(card(5).getByRole("button", { name: "Usar esta", exact: true })).toBeEnabled();
    await expect.poll(() => gates.length).toBe(3);
    const saved = (await getPool().query("SELECT id,status FROM ingest.image_curation_jobs WHERE entity_id=ANY($1::bigint[]) ORDER BY id", [ids.slice(0, 4)])).rows;
    assert.equal(saved.length, 4); assert.equal(saved.filter(job => job.status === "running").length, 3); assert.equal(saved.filter(job => job.status === "queued").length, 1);
    assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }))), false);
    await page.getByText("Ver actividad", { exact: false }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/server-queue-${width}.png` });
    await context.close(); // Se cierra toda la sesión del navegador con cuatro trabajos pendientes.
    blocking = false; for (const release of gates.splice(0)) release();
    await expect.poll(async () => Number((await getPool().query("SELECT count(*) FROM ingest.image_curation_jobs WHERE id=ANY($1::bigint[]) AND status='done'", [saved.map(job => job.id)])).rows[0].count), { timeout: 15000 }).toBe(4);
    ({ context, page } = await open(width)); card = index => page.getByRole("article", { name: `Disco ${width} ${index}`, exact: true });
    await expect(card(5)).toBeVisible(); await expect(card(1)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Procesamiento de imágenes" })).toContainText("Procesamiento terminado");
    await page.getByText("Ver actividad", { exact: false }).click();
    await expect(page.getByRole("button", { name: "Deshacer", exact: true }).first()).toBeVisible();
    const completed = page.locator(".img-work__list li").filter({ hasText: `Disco ${width} 4` });
    await completed.getByRole("button", { name: "Deshacer", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /Deshacer/ }) });
    await dialog.getByRole("textbox").fill("Deshacer una imagen después de volver al navegador");
    await dialog.getByRole("button", { name: "Deshacer este cambio", exact: true }).click();
    await expect(card(4)).toBeVisible();
    failingEntity = ids[4];
    await card(5).getByRole("button", { name: "Usar esta", exact: true }).click();
    await expect(card(5)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
    await context.close();
    ({ context, page } = await open(width)); card = index => page.getByRole("article", { name: `Disco ${width} ${index}`, exact: true });
    await expect(page.getByRole("region", { name: "Procesamiento de imágenes" })).toContainText("con error");
    await page.getByText("Ver actividad", { exact: false }).click();
    failingEntity = null;
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(card(5)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Procesamiento de imágenes" })).toContainText("Procesamiento terminado");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(card(5)).toHaveCount(0); await expect(card(6)).toBeVisible();
    // Respuesta del envío perdida y lectura antigua: el mismo requestId recupera la aceptación.
    blocking = true;
    let lost = false, holdRead = true, releaseStale, settleStale;
    const staleDone = new Promise(resolve => { settleStale = resolve; });
    const requestIds = [];
    await page.route("**/api/curation/images/jobs", async route => {
      if (route.request().method() === "GET" && holdRead) {
        await new Promise(resolve => { releaseStale = resolve; });
        await route.fulfill({ json: [] }); settleStale(); return;
      }
      if (route.request().method() === "POST") {
        requestIds.push(route.request().postDataJSON().tasks[0].requestId);
        const response = await route.fetch(); assert.equal(response.status(), 202);
        if (!lost) { lost = true; return route.abort("failed"); }
        return route.fulfill({ response });
      }
      return route.fallback();
    });
    await card(6).getByRole("button", { name: "Usar esta", exact: true }).click();
    await page.getByText("Ver actividad", { exact: false }).click();
    await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
    await expect.poll(() => Boolean(releaseStale)).toBe(true);
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByText("La cola está guardada en el servidor.", { exact: false })).toBeVisible();
    holdRead = false; releaseStale(); await staleDone;
    await page.unroute("**/api/curation/images/jobs");
    await expect.poll(async () => Number((await getPool().query("SELECT count(*) FROM ingest.image_curation_jobs WHERE entity_id=$1", [ids[5]])).rows[0].count)).toBe(1);
    assert.equal(requestIds.length, 2); assert.equal(requestIds[0], requestIds[1]);
    await expect(card(6)).toHaveCount(0);
    blocking = false; for (const release of gates.splice(0)) release();
    await expect(page.getByRole("region", { name: "Procesamiento de imágenes" })).toContainText("Procesamiento terminado");
    await page.screenshot({ path: `${output}/returned-${width}.png` });
    checks.push({ width, nextDecisionMs, browserClosedWhilePending: true, completedWithoutBrowser: 4, restoredHistory: true, undoAfterReturn: true, persistentError: true, retryAfterReturn: true, noPendingUnloadWarning: true, lostAcknowledgmentRetriedOnce: true, staleReadIgnored: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors, database: "PostgreSQL desechable", auth: "Sesión real con CSRF" }, null, 2));
  console.log(JSON.stringify(checks));
} finally {
  blocking = false; for (const release of gates.splice(0)) release();
  await browser?.close(); await web?.close(); await api?.close(); await closeDb(); await database?.stop();
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
}
