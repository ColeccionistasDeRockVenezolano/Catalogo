import { mkdir } from "node:fs/promises";
import path from "node:path";
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
    DATABASE_URL: database.databaseUrl, CRV_AUTH_BACKEND: "legacy", CRV_OPERATOR_TOKEN: "", CRV_HERRA_DB_PATH: "",
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
    const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/auth/login"));
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    const loggedIn = await response;
    assert.equal(loggedIn.status(), 200, await loggedIn.text());
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
  try {
    await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Edición con sesión y CSRF desde la SPA", { timeout: 10_000 });
  } catch (error) {
    // Un fallo aquí solo se veía como «waiting for»: se deja el texto real del diálogo en el log.
    console.error("Diálogo de edición:\n" + await dialog.innerText().catch(() => "(sin diálogo)"));
    throw error;
  }
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Banda QA Editada", exact: true })).toBeVisible();
  assert.equal((await getPool().query("SELECT name FROM public.artists WHERE id=$1", [id])).rows[0].name, "Banda QA Editada");
  const person=await request("/persons","POST",{name:"Persona QA Precisión",birthDate:"1973",note:"Fecha parcial de prueba"},admin.csrf);
  assert.equal(person.status,201);
  await page.goto(`${base}/personas/${person.body.id}`);
  await page.locator(".page-actions").getByRole("button",{name:"Editar",exact:true}).click();
  await dialog.getByLabel("Fecha de nacimiento",{exact:true}).fill("1973-05");
  await dialog.getByLabel("Motivo",{exact:false}).filter({visible:true}).fill("Conservar mes y año sin inventar día");
  await dialog.getByRole("button",{name:"Guardar",exact:true}).filter({visible:true}).click();
  await expect(page.getByText("mayo de 1973",{exact:true})).toBeVisible();
  const dates=(await getPool().query("SELECT birth_date,birth_date_value FROM public.persons WHERE id=$1",[person.body.id])).rows[0];
  assert.equal(dates.birth_date,null);assert.equal(dates.birth_date_value,"1973-05");
  await page.locator(".page-actions").getByRole("button",{name:"Editar",exact:true}).click();
  await dialog.getByRole("button",{name:"Identidad y períodos",exact:true}).click();
  await dialog.getByLabel("Artista o proyecto",{exact:true}).fill("Banda QA Editada");
  await dialog.getByRole("option",{name:"Banda QA Editada",exact:false}).click();
  await dialog.getByLabel("Relación *",{exact:true}).selectOption("member");
  await dialog.getByLabel("Período documentado",{exact:true}).fill("~1990/2000");
  await dialog.getByLabel("Motivo",{exact:false}).filter({visible:true}).fill("Vincular fichas conservando período aproximado");
  await dialog.getByRole("button",{name:"Guardar",exact:true}).filter({visible:true}).click();
  await expect(dialog.getByText(/Cambio guardado/)).toBeVisible();
  const identity=(await getPool().query("SELECT relationship,period FROM ingest.musical_identities WHERE person_id=$1",[person.body.id])).rows[0];
  assert.equal(identity.relationship,"member");assert.equal(identity.period.from.approximate,true);
  const artifactDir=process.env["CRV_BROWSER_ARTIFACT_DIR"];
  if(artifactDir) {
    await mkdir(artifactDir,{recursive:true});
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      await page.screenshot({path:path.join(artifactDir,`identity-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});
  }
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  const album=await request("/albums","POST",{title:"Edición QA Navegador",artistId:id,mediaFormat:"CD",note:"Edición independiente"},admin.csrf);
  assert.equal(album.status,201);
  const work=await request("/catalog-model/work","POST",{title:"Obra QA Navegador",artistId:id,note:"Obra documentada de prueba"},admin.csrf);
  assert.equal(work.status,201);
  await page.goto(`${base}/discos/${album.body.id}`);
  await page.locator(".page-actions").getByRole("button",{name:"Editar",exact:true}).click();
  await dialog.getByRole("button",{name:"Obra y soportes",exact:true}).click();
  await dialog.getByLabel("Obra compartida",{exact:true}).selectOption(String(work.body.id));
  await dialog.getByLabel("Fecha de publicación",{exact:true}).filter({visible:true}).fill("2001-05");
  await dialog.getByLabel("Motivo",{exact:false}).filter({visible:true}).fill("Vincular obra y edición con precisión de mes");
  await dialog.getByRole("button",{name:"Guardar",exact:true}).filter({visible:true}).click();
  await expect(dialog.getByText(/Cambio guardado/)).toBeVisible();
  assert.equal((await request(`/albums/${album.body.id}`)).body.releaseDateValue,"2001-05");
  await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
  assert.equal((await request("/auth/logout", "POST", {}, admin.csrf)).status, 204);
  await page.reload();
  const reader = await login("qa.reader");
  assert.equal(reader.user.role, "reader");
  assert.equal((await request(`/artists/${id}`, "PATCH", { name: "Prohibido" }, reader.csrf)).status, 403);
  assert.equal((await request("/curation/findings")).status, 403);
  assert.equal((await request(`/catalog-model/artist/${id}`)).status,403);
  assert.equal((await request("/evidence-inventory/facts?kind=person&entityId=1")).status, 403);
  assert.equal((await request("/evidence-inventory/documents/1")).status, 403);
  await expect(page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
  // Buscador sin mínimo de letras (2026-10-13): una sola letra ya sugiere fichas.
  assert.equal((await request("/search/misses")).status, 403);
  await page.goto(base);
  await page.getByLabel("Buscar en el catálogo", { exact: true }).fill("b");
  await expect(page.getByRole("option", { name: /^Banda QA Editada/u })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("Smoke aprobado: SPA compilada, PostgreSQL aislado, login, roles, CSRF, fechas parciales, identidad, obra y edición persistidas, buscador desde una letra.");
} finally {
  await browser?.close();
  if (web) await new Promise((resolve, reject) => web.httpServer.close(error => error ? reject(error) : resolve()));
  await api?.close();
  await closeDb();
  await database?.stop();
}
