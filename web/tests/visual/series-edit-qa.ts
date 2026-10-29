// CRV · QA end-to-end de la edición de series (2026-10-27) contra un
// contenedor de prueba — nunca contra la base de desarrollo.
//
// Por la interfaz real, comprobando la BASE DE DATOS después de cada paso:
// crear una serie desde /series, añadirle entregas desde su página, corregir
// un volumen y los datos de la serie, ver por qué queda oculta, añadir y
// retirar un disco desde su ficha y borrar la serie sin tocar los discos.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "@playwright/test";
import { startPgContainer } from "../../../test/support/pg-container.js";
import { applyCore } from "../../../test/support/apply-core.js";
import { migrateUp } from "../../../src/db/migrate.js";
import { getPool, closeDb } from "../../../src/db/client.js";
import { resetEnvCache } from "../../../src/config/env.js";
import { buildApp } from "../../../src/api/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outputDir = path.join(root, "docs/ui-qa/series-edit");
const QA_USER = "qa-admin";
const QA_PASSWORD = "qa-admin-2026-segura";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error("sin puerto libre"))));
    });
  });
}

function waitForUrl(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        if ((await fetch(url)).ok) return resolve();
      } catch { /* Aún arrancando. */ }
      if (Date.now() >= deadline) return reject(new Error(`Timeout esperando ${url}`));
      setTimeout(() => void attempt(), 200);
    };
    void attempt();
  });
}

function stopChild(child: ChildProcess | undefined): void {
  if (!child || child.killed || !child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, undefined, { timeout: 60_000 });
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)));
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await getPool().query<T>(sql, params)).rows;
}

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: se esperaba ${JSON.stringify(expected)} y la base dice ${JSON.stringify(actual)}`);
  }
}

const container = await startPgContainer();
let web: ChildProcess | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;

try {
  process.env["DATABASE_URL"] = container.databaseUrl;
  process.env["LOG_LEVEL"] = "silent";
  process.env["CRV_SESSION_COOKIE_PATH"] = "/";
  process.env["CRV_COLLABORATORS_JSON"] = JSON.stringify([
    { username: QA_USER, name: "QA Admin", passwordHash: await passwordHash(QA_PASSWORD) },
  ]);
  resetEnvCache();
  await applyCore(container.name);
  await migrateUp();

  const one = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number((await rows<{ id: string }>(sql, params))[0]!.id);
  const va = await one("INSERT INTO public.artists(name, artist_type) VALUES('Various Artists','band') RETURNING id");
  const band = await one("INSERT INTO public.artists(name, artist_type, origin_country) VALUES('Banda Serie QA','band','Venezuela') RETURNING id");
  const vol1 = await one("INSERT INTO public.albums(artist_id, title, album_type, release_year) VALUES($1,'Compilado Serie QA Uno','compilation',2001) RETURNING id", [va]);
  const vol2 = await one("INSERT INTO public.albums(artist_id, title, album_type, release_year) VALUES($1,'Compilado Serie QA Dos','compilation',2002) RETURNING id", [va]);
  const own = await one("INSERT INTO public.albums(artist_id, title, album_type) VALUES($1,'Disco Propio Serie QA','studio_album') RETURNING id", [band]);
  console.log(`QA: sembrados ${vol1}/${vol2} (Various Artists) y ${own} (banda)`);

  const port = await freePort();
  const webUrl = `http://127.0.0.1:${port}`;
  process.env["CRV_ALLOWED_ORIGINS"] = webUrl;
  resetEnvCache();
  app = await buildApp();
  const apiAddress = await app.listen({ host: "127.0.0.1", port: 0 });
  web = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(root, "web"), env: { ...process.env, VITE_API_BASE_URL: apiAddress }, stdio: "ignore", detached: true,
  });
  process.once("exit", () => stopChild(web));
  await waitForUrl(webUrl);
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) pageErrors.push(message.text());
    });
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "GET") console.log(`   ${request.method()} ${new URL(request.url()).pathname} -> ${response.status()}`);
    });
    const shot = (name: string) => page.screenshot({ path: path.join(outputDir, `desktop-${name}.png`), fullPage: true });
    const modal = () => page.locator('[aria-modal="true"]').last();
    const closed = (dialog: Locator) => dialog.waitFor({ state: "detached", timeout: 15_000 });
    const pick = async (dialog: Locator, label: string, query: string, option: RegExp) => {
      const input = dialog.getByLabel(label, { exact: true });
      await input.click();
      await input.fill(query);
      await dialog.getByRole("option", { name: option }).click({ timeout: 15_000 });
    };
    const seriesRow = async () => (await rows<{ id: string; title: string; description: string | null }>("SELECT id::text, title, description FROM ingest.series"));
    const entries = async (seriesId: number) =>
      (await rows<{ album_id: string; volume_number: string | null; volume_label: string | null }>(
        "SELECT album_id::text, volume_number::text, volume_label FROM ingest.series_albums WHERE series_id=$1 ORDER BY album_id", [seriesId]))
        .map((row) => [Number(row.album_id), row.volume_number === null ? null : Number(row.volume_number), row.volume_label]);

    // ---- Sesión de administración -------------------------------------------------
    await page.goto(`${webUrl}/series`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByRole("button", { name: "Iniciar sesión como colaborador" }).first().click();
    await page.getByLabel("Usuario").fill(QA_USER);
    await page.getByLabel("Contraseña").fill(QA_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.getByRole("button", { name: "+ Nueva serie" }).waitFor({ timeout: 15_000 });
    await page.getByText("Series ocultas (0)").waitFor();
    console.log("1. sesión iniciada; /series muestra «+ Nueva serie» y el panel de ocultas");

    // ---- 1. Crear la serie ----------------------------------------------------------
    await page.getByRole("button", { name: "+ Nueva serie" }).click();
    const create = modal();
    await create.getByLabel("Título de la serie *").fill("Serie QA del Oeste");
    await create.getByLabel("Descripción pública").fill("Compilados de prueba.");
    await create.getByLabel("Motivo *").fill("QA: serie documentada en la contraportada");
    await create.getByRole("button", { name: "Crear serie" }).click();
    await closed(create);
    await page.waitForURL(/\/series\/\d+$/u);
    const seriesId = Number(page.url().split("/").pop());
    assertEqual((await seriesRow()).map((row) => [Number(row.id), row.title, row.description]), [[seriesId, "Serie QA del Oeste", "Compilados de prueba."]], "serie creada");
    await page.getByText("Oculta: necesita al menos dos entregas visibles", { exact: false }).waitFor();
    await shot("serie-nueva-oculta");
    console.log(`2. serie ${seriesId} creada; la página explica por qué está oculta`);

    // ---- 2. Añadir entregas desde la página de la serie --------------------------------
    for (const [title, number, label] of [["Compilado Serie QA Dos", 2, "Vol. 2"], ["Compilado Serie QA Uno", 1, "Vol. 1"]] as const) {
      await page.getByRole("button", { name: "+ Añadir disco" }).click();
      const add = modal();
      await pick(add, "Disco", title, new RegExp(title, "u"));
      await add.getByLabel("Número para ordenar").fill(String(number));
      await add.getByLabel("Volumen como lo escribe la fuente").fill(label);
      await add.getByLabel("Motivo *").fill("QA: volumen impreso en la portada");
      await add.getByRole("button", { name: "Añadir", exact: true }).click();
      await closed(add);
    }
    assertEqual(await entries(seriesId), [[vol1, 1, "Vol. 1"], [vol2, 2, "Vol. 2"]], "entregas añadidas");
    await page.locator(".badge", { hasText: "Pública" }).waitFor();
    const order = await page.locator(".series-volume__title").allInnerTexts();
    assertEqual(order, ["Compilado Serie QA Uno", "Compilado Serie QA Dos"], "orden público por volumen");
    await shot("serie-publica");
    console.log("3. dos entregas añadidas; la serie pasa a pública y se ordena por volumen");

    // ---- 3. Corregir un volumen y los datos de la serie ---------------------------------
    await page.locator(".relation-editor__list li", { hasText: "Compilado Serie QA Dos" }).getByRole("button", { name: "Editar" }).click();
    const volume = modal();
    await volume.getByLabel("Volumen como lo escribe la fuente").fill("Vol. II");
    await volume.getByLabel("Motivo *").fill("QA: la portada usa números romanos");
    await volume.getByRole("button", { name: "Guardar" }).click();
    await closed(volume);
    assertEqual(await entries(seriesId), [[vol1, 1, "Vol. 1"], [vol2, 2, "Vol. II"]], "volumen corregido");

    await page.locator(".entity-admin-bar").getByRole("button", { name: "Editar" }).click();
    const edit = modal();
    await edit.getByLabel("Título de la serie *").fill("Serie QA del Oeste Caraqueño");
    await edit.getByLabel("Motivo *").fill("QA: título completo según el sello");
    await edit.getByRole("button", { name: "Guardar" }).click();
    await closed(edit);
    await page.getByRole("heading", { level: 1, name: "Serie QA del Oeste Caraqueño" }).waitFor();
    assertEqual((await seriesRow()).map((row) => row.title), ["Serie QA del Oeste Caraqueño"], "serie renombrada");
    // «Deshacer» desde el aviso devuelve el título y la página se actualiza sola.
    const toasts = page.locator("[data-crv-toasts]");
    await toasts.locator(".toast", { hasText: "Serie guardada." }).getByRole("button", { name: "Deshacer" }).click();
    await toasts.getByText("Cambio deshecho.").waitFor({ timeout: 15_000 });
    await page.getByRole("heading", { level: 1, name: "Serie QA del Oeste", exact: true }).waitFor({ timeout: 15_000 });
    assertEqual((await seriesRow()).map((row) => row.title), ["Serie QA del Oeste"], "renombre deshecho");
    await toasts.getByRole("button", { name: "Rehacer" }).first().click();
    await toasts.getByText("Cambio rehecho.").waitFor({ timeout: 15_000 });
    await page.getByRole("heading", { level: 1, name: "Serie QA del Oeste Caraqueño" }).waitFor({ timeout: 15_000 });
    assertEqual((await seriesRow()).map((row) => row.title), ["Serie QA del Oeste Caraqueño"], "renombre rehecho");
    console.log("4. volumen y título corregidos; deshacer y rehacer desde el aviso refrescan la página");

    // ---- 4. Pertenencia desde la ficha de un disco ---------------------------------------
    await page.goto(`${webUrl}/discos/${own}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByRole("button", { name: "+ Añadir a una serie" }).click();
    const join = modal();
    await pick(join, "Serie", "Oeste", /Serie QA del Oeste Caraqueño/u);
    await join.getByLabel("Motivo *").fill("QA: el disco aparece en el catálogo del sello");
    await join.getByRole("button", { name: "Añadir", exact: true }).click();
    await closed(join);
    assertEqual(await entries(seriesId), [[vol1, 1, "Vol. 1"], [vol2, 2, "Vol. II"], [own, null, null]], "disco añadido desde su ficha");
    await page.getByText("Oculta: tiene entregas que no son de Various Artists", { exact: false }).waitFor();
    await shot("disco-en-serie-oculta");
    await page.locator(".relation-editor__list li", { hasText: "Serie QA del Oeste Caraqueño" }).getByRole("button", { name: "Retirar" }).click();
    const leave = modal();
    await leave.getByLabel("Motivo *").fill("QA: no era una entrega de la serie");
    await leave.getByRole("button", { name: "Retirar de la serie" }).click();
    await closed(leave);
    assertEqual(await entries(seriesId), [[vol1, 1, "Vol. 1"], [vol2, 2, "Vol. II"]], "disco retirado desde su ficha");
    await page.getByText("Este disco no pertenece a ninguna serie.").waitFor();
    console.log("5. un disco de banda deja la serie oculta y se retira desde su ficha");

    // ---- 5. Móvil sin desbordes -------------------------------------------------------
    await page.setViewportSize({ width: 400, height: 900 });
    for (const [name, url] of [["serie", `/series/${seriesId}`], ["indice", "/series"]] as const) {
      await page.goto(`${webUrl}${url}`, { waitUntil: "domcontentloaded" });
      await waitForApp(page);
      await page.getByText(name === "serie" ? "Entregas" : "Series ocultas", { exact: false }).first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`móvil: overflow de ${overflow}px en ${url}`);
      await page.screenshot({ path: path.join(outputDir, `mobile-${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 1000 });

    // ---- 6. Borrar la serie ---------------------------------------------------------------
    await page.goto(`${webUrl}/series/${seriesId}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Retirar del catálogo" }).click();
    const remove = modal();
    await remove.getByLabel("Motivo *").fill("QA: serie creada por error");
    await remove.getByRole("button", { name: "Borrar serie" }).click();
    await closed(remove);
    await page.waitForURL(/\/series$/u);
    assertEqual(await seriesRow(), [], "serie borrada");
    assertEqual((await rows<{ n: number }>("SELECT count(*)::int AS n FROM public.albums WHERE id = ANY($1::bigint[])", [[vol1, vol2, own]]))[0]!.n, 3, "los discos se conservan");
    console.log("6. serie borrada; los tres discos siguen en el catálogo");

    if (pageErrors.length) throw new Error(`errores de consola: ${pageErrors.join("; ")}`);
    console.log(`QA de series: todo en verde. Capturas en ${path.relative(root, outputDir)}.`);
  } finally {
    await browser.close();
  }
} finally {
  stopChild(web);
  if (app) await app.close();
  await closeDb();
  await container.stop();
}
