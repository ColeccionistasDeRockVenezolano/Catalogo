import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { preview } from "vite";
import { startPgContainer } from "../../../test/support/pg-container.ts";
import { applyCore } from "../../../test/support/apply-core.ts";
import { migrateUp } from "../../../src/db/migrate.ts";
import { closeDb, getPool } from "../../../src/db/client.ts";
import { resetEnvCache } from "../../../src/config/env.ts";
import { buildApp } from "../../../src/api/app.ts";

// Runs the built SPA against the actual API and a disposable database.
// No network fixtures, bearer token, catalog IDs or credentials from the host.
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16);
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
let database, api, web, browser;
try {
  database = await startPgContainer();
  Object.assign(process.env, {
    DATABASE_URL: database.databaseUrl, CRV_OPERATOR_TOKEN: "", CRV_HERRA_DB_PATH: "",
    CRV_SESSION_COOKIE_PATH: "/", CRV_CURATION_AUTOSCAN: "false", CRV_CURATION_AUTOFIX: "false", LOG_LEVEL: "error",
    CRV_COLLABORATORS_JSON: JSON.stringify([
      { username: "qa.admin", name: "QA Admin", passwordHash, role: "admin" },
      { username: "qa.reader", name: "QA Reader", passwordHash, role: "reader" },
    ]),
  });
  resetEnvCache();
  await applyCore(database.name);
  await migrateUp();
  api = await buildApp();
  const apiUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  web = await preview({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    preview: { host: "127.0.0.1", port: 0, proxy: {
      "/api": { target: apiUrl, rewrite: path => path.replace(/^\/api/u, "") },
    } },
  });
  const address = web.httpServer.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const request = async (path, method = "GET", body, csrf) => page.evaluate(async ({ path, method, body, csrf }) => {
    const res = await fetch(`/api${path}`, { method, headers: {
      "Content-Type": "application/json", ...(csrf ? { "X-CRV-CSRF": csrf } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }, { path, method, body, csrf });
  await page.goto(base);
  assert.equal((await request("/artists", "POST", { name: "Prohibido" })).status, 401);
  const login = async username => {
    await page.getByRole("button", { name: "Iniciar sesión como colaborador" }).click();
    await page.getByLabel("Usuario", { exact: true }).fill(username);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const me = await request("/auth/me");
    assert.equal(me.status, 200, JSON.stringify(me.body));
    return me.body;
  };
  const admin = await login("qa.admin");
  assert.equal(admin.user.role, "admin");
  assert.equal((await request("/artists", "POST", { name: "Sin CSRF" })).status, 403);
  const created = await request("/artists", "POST", { name: "Banda QA Navegador", note: "Alta de aceptación aislada" }, admin.csrf);
  assert.equal(created.status, 201);
  const id = created.body.id;
  await page.goto(`${base}/artistas/${id}`);
  await expect(page.getByRole("heading", { name: "Banda QA Navegador", exact: true })).toBeVisible();
  await page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: false }).first().fill("Banda QA Editada");
  await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Edición con sesión y CSRF desde la SPA");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Banda QA Editada", exact: true })).toBeVisible();
  assert.equal((await getPool().query("SELECT name FROM public.artists WHERE id=$1", [id])).rows[0].name, "Banda QA Editada");
  assert.equal((await request("/auth/logout", "POST", {}, admin.csrf)).status, 204);
  await page.reload();
  const reader = await login("qa.reader");
  assert.equal(reader.user.role, "reader");
  assert.equal((await request(`/artists/${id}`, "PATCH", { name: "Prohibido" }, reader.csrf)).status, 403);
  assert.equal((await request("/curation/findings")).status, 403);
  await expect(page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("Smoke aprobado: SPA compilada, PostgreSQL aislado, login, roles, CSRF y edición persistida.");
} finally {
  await browser?.close();
  if (web) await new Promise((resolve, reject) => web.httpServer.close(error => error ? reject(error) : resolve()));
  await api?.close();
  await closeDb();
  await database?.stop();
}
