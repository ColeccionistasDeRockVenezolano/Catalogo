// CRV · QA end-to-end de «Deshacer» (diario de cambios, migración 0028)
// contra un contenedor de prueba — nunca contra la base de desarrollo.
//
// Por la interfaz real, comprobando la base después de cada paso:
//   1. editar un disco deja la barra «Deshacer» a la vista;
//   2. deshacer desde la barra devuelve el campo y la barra pasa a «Rehacer»;
//   3. rehacer vuelve a aplicar la edición;
//   4. retirar una persona → «Deshacer» en la barra la devuelve;
//   5. la ficha retirada ofrece «Deshacer retiro» en su propio 404;
//   6. la ficha lista «Cambios de esta ficha» y el Historial lista todo;
//   7. en móvil la barra queda sobre la navegación inferior, sin desbordar.
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
const outputDir = path.join(root, "docs/ui-qa/undo");
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
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch { /* Aún arrancando. */ }
      if (Date.now() >= deadline) return reject(new Error(`Timeout esperando ${url}`));
      setTimeout(() => void attempt(), 200);
    };
    void attempt();
  });
}

function stopChild(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

async function waitForApp(page: Page, timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, undefined, { timeout: timeoutMs });
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
    throw new Error(`${what}: esperaba ${JSON.stringify(expected)}, hay ${JSON.stringify(actual)}`);
  }
  console.log(`   ✓ ${what}`);
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
  const artist = await one("INSERT INTO public.artists(name, artist_type, origin_country) VALUES('Los Reversibles QA','band','Venezuela') RETURNING id");
  const album = await one("INSERT INTO public.albums(artist_id, title) VALUES($1,'Disco Reversible QA') RETURNING id", [artist]);
  const retirable = await one("INSERT INTO public.persons(name) VALUES('Persona Retirable QA') RETURNING id");
  const retirable2 = await one("INSERT INTO public.persons(name) VALUES('Persona Retirada QA') RETURNING id");
  // Se edita el año, no el género: `albums.genre` es una proyección de los
  // géneros asignados y la API rechaza escribirlo a mano.
  const yearOf = async () => (await rows<{ release_year: number | null }>("SELECT release_year FROM public.albums WHERE id=$1", [album]))[0]!.release_year;
  const personExists = async (id: number) => (await rows("SELECT 1 FROM public.persons WHERE id=$1", [id])).length === 1;

  const port = await freePort();
  const webUrl = `http://127.0.0.1:${port}`;
  process.env["CRV_ALLOWED_ORIGINS"] = webUrl;
  resetEnvCache();
  app = await buildApp();
  const apiAddress = await app.listen({ host: "127.0.0.1", port: 0 });
  web = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(root, "web"),
    env: { ...process.env, VITE_API_BASE_URL: apiAddress },
    stdio: "ignore",
    detached: true,
  });
  process.once("exit", () => stopChild(web));
  await waitForUrl(webUrl);
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) pageErrors.push(message.text());
    });
    const shot = (name: string) => page.screenshot({ path: path.join(outputDir, `desktop-${name}.png`) });
    // Avisos (Base UI Toast) y diálogos modales: los avisos también llevan
    // role="dialog", así que los modales se buscan por aria-modal.
    const toasts = page.locator("[data-crv-toasts]");
    const modal = page.locator('[aria-modal="true"]').last();
    const confirmUndo = async (dialog: Locator, note: string, button: RegExp) => {
      await dialog.getByLabel("Motivo *").fill(note);
      await dialog.getByRole("button", { name: button }).click();
      await dialog.waitFor({ state: "detached", timeout: 15000 });
    };
    const saveEdit = async (field: string, value: string, note: string) => {
      await page.locator(".page-actions").getByRole("button", { name: "Editar" }).click();
      const edit = page.locator('[role="dialog"][aria-modal="true"]');
      await edit.getByLabel(field).fill(value);
      await edit.getByLabel("Motivo del cambio *").fill(note);
      await edit.locator(".eedit__tray-actions button[type=submit]").click();
      // Si no cierra, el motivo está escrito en el propio modal: decirlo aquí
      // ahorra abrir el navegador a mano.
      await edit.waitFor({ state: "detached", timeout: 15000 }).catch(async (error: Error) => {
        throw new Error(`el modal de edición no cerró: ${(await edit.innerText()).replace(/\s+/gu, " ").slice(0, 400)}`, { cause: error });
      });
    };
    const retireFromMenu = async (note: string) => {
      await page.getByRole("button", { name: "Más acciones" }).click();
      await page.getByRole("menuitem", { name: "Retirar del catálogo" }).click();
      const retire = page.getByRole("alertdialog");
      await retire.getByLabel("Motivo *").fill(note);
      await retire.getByRole("button", { name: "Retirar", exact: true }).click();
      await page.waitForURL(/\/personas$/u, { timeout: 15000 });
    };

    // ---- Sesión ----------------------------------------------------------------
    await page.goto(`${webUrl}/discos/${album}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.getByRole("button", { name: "Iniciar sesión como colaborador" }).click();
    await page.getByLabel("Usuario").fill(QA_USER);
    await page.getByLabel("Contraseña").fill(QA_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.locator(".page-actions").getByRole("button", { name: "Editar" }).waitFor({ timeout: 15000 });

    // ---- 1. Editar → el aviso ofrece deshacer y nombra la ficha ---------------
    await saveEdit("Año de publicación", "1998", "QA: año del disco");
    assertEqual(await yearOf(), 1998, "edición guardada");
    await toasts.getByRole("link", { name: "Disco Reversible QA" }).waitFor({ timeout: 15000 });
    await toasts.getByRole("button", { name: "Deshacer" }).waitFor();
    assertEqual(await toasts.locator(".toast", { hasText: "Disco Reversible QA" }).count(), 1, "un solo aviso por cambio");
    await shot("1-aviso-tras-editar");

    // ---- 2. Deshacer al momento desde el aviso (sin diálogo) --------------------
    await toasts.getByRole("button", { name: "Deshacer" }).click();
    await toasts.getByText("Cambio deshecho.").waitFor({ timeout: 15000 });
    assertEqual(await yearOf(), null, "deshacer al momento devuelve el año");
    assertEqual(await page.locator('[aria-modal="true"]').count(), 0, "deshacer al momento no abre diálogo");
    await toasts.getByRole("button", { name: "Rehacer" }).waitFor();
    await shot("2-aviso-rehacer");

    // ---- 3. Rehacer al momento ----------------------------------------------------
    await toasts.getByRole("button", { name: "Rehacer" }).click();
    await toasts.getByText("Cambio rehecho.").waitFor({ timeout: 15000 });
    assertEqual(await yearOf(), 1998, "rehacer vuelve a aplicar la edición");

    // ---- 3b. Cambios de esta sesión (menú de la cuenta) ---------------------------
    await page.getByRole("button", { name: /^Cuenta de .*cambios de esta sesión/u }).click();
    const recent = page.locator(".operator-menu");
    await recent.getByRole("heading", { name: "Cambios de esta sesión" }).waitFor();
    assertEqual(await recent.locator(".recent-changes__item").count(), 3, "la sesión lista edición, deshacer y rehacer");
    await recent.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    await shot("3-cambios-de-la-sesion");
    await page.keyboard.press("Escape");

    // ---- 6a. Cambios de esta ficha ----------------------------------------------
    await page.getByRole("heading", { name: "Cambios de esta ficha" }).scrollIntoViewIfNeeded();
    const fichaRows = page.locator(".section", { has: page.getByRole("heading", { name: "Cambios de esta ficha" }) }).locator(".change-row");
    await fichaRows.first().waitFor({ timeout: 15000 });
    assertEqual(await fichaRows.count(), 3, "la ficha lista edición, deshacer y rehacer");
    await page.getByRole("heading", { name: "Cambios de esta ficha" }).screenshot({ path: path.join(outputDir, "desktop-4-cambios-ficha-titulo.png") });
    await page.locator(".section", { has: page.getByRole("heading", { name: "Cambios de esta ficha" }) }).screenshot({ path: path.join(outputDir, "desktop-4-cambios-ficha.png") });

    // ---- 4. Retirar → deshacer con vista previa desde «Cambios de esta sesión» ----
    await page.goto(`${webUrl}/personas/${retirable}`, { waitUntil: "domcontentloaded" });
    await retireFromMenu("QA: retiro por error");
    assertEqual(await personExists(retirable), false, "persona retirada");
    await toasts.getByText("Persona Retirable QA").waitFor({ timeout: 15000 });
    await shot("5-aviso-tras-retirar");
    await page.getByRole("button", { name: /^Cuenta de .*cambios de esta sesión/u }).click();
    await recent.locator(".recent-changes__item").first().getByRole("button", { name: "Deshacer" }).click();
    await modal.getByText("Persona Retirable QA").first().waitFor({ timeout: 15000 });
    await recent.waitFor({ state: "detached", timeout: 5000 });
    console.log("   ✓ el panel de la sesión se cierra al abrir el deshacer");
    await shot("5b-dialogo-deshacer");
    await confirmUndo(modal, "QA: no había que retirarla", /^Deshacer este cambio$/u);
    assertEqual(await personExists(retirable), true, "deshacer el retiro la devuelve con su mismo id");

    // ---- 5. «Deshacer retiro» desde el 404 de la ficha ---------------------------
    await page.goto(`${webUrl}/personas/${retirable2}`, { waitUntil: "domcontentloaded" });
    await retireFromMenu("QA: retiro que luego se lamenta");
    await page.goto(`${webUrl}/personas/${retirable2}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Esta ficha fue retirada del catálogo").waitFor({ timeout: 15000 });
    await shot("6-ficha-retirada");
    await page.getByRole("button", { name: /Deshacer retiro/u }).click();
    await confirmUndo(modal, "QA: se retiró por error", /^Deshacer este cambio$/u);
    assertEqual(await personExists(retirable2), true, "«Deshacer retiro» desde la ficha la devuelve");
    await page.getByRole("heading", { name: "Persona Retirada QA" }).waitFor({ timeout: 15000 });

    // ---- 6b. Historial ----------------------------------------------------------
    await page.goto(`${webUrl}/historial`, { waitUntil: "domcontentloaded" });
    await page.locator(".change-row").first().waitFor({ timeout: 15000 });
    const listed = await page.locator(".change-row").count();
    if (listed < 7) throw new Error(`historial: esperaba al menos 7 cambios, hay ${listed}`);
    console.log(`   ✓ historial lista ${listed} cambios`);
    await page.screenshot({ path: path.join(outputDir, "desktop-7-historial.png"), fullPage: true });

    // ---- 7. Móvil: aviso sobre la navegación y Ctrl+Z -----------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webUrl}/discos/${album}`, { waitUntil: "domcontentloaded" });
    await saveEdit("Año de publicación", "1999", "QA: móvil");
    const toast = toasts.locator(".toast").last();
    await toast.getByRole("button", { name: "Deshacer" }).waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`móvil: overflow de ${overflow}px`);
    await toast.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    const [toastBox, navBox] = await Promise.all([toast.boundingBox(), page.locator(".main-nav").boundingBox()]);
    if (!toastBox || !navBox || toastBox.y + toastBox.height > navBox.y + 1) throw new Error("móvil: el aviso queda bajo la navegación inferior");
    console.log("   ✓ móvil: aviso visible sobre la navegación, sin desborde");
    await page.screenshot({ path: path.join(outputDir, "mobile-aviso.png") });
    await page.keyboard.press("Control+z");
    await toasts.getByText("Cambio deshecho.").last().waitFor({ timeout: 15000 });
    assertEqual(await yearOf(), 1998, "Ctrl+Z deshace el último cambio de la sesión");

    if (pageErrors.length) throw new Error(`errores de consola: ${pageErrors.join("; ")}`);
    console.log(`QA de deshacer: todo en verde. Capturas en ${path.relative(root, outputDir)}.`);
  } finally {
    await browser.close();
  }
} finally {
  stopChild(web);
  if (app) await app.close();
  await closeDb();
  await container.stop();
}
