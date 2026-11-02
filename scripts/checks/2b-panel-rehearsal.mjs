// CRV · Ensayo 2B · panel privado en :3151 (sin publicar, base crv_staging).
//
// Entra con una cuenta de fixtures, comprueba la cookie Secure en un origen
// http://127.0.0.1, acepta la candidatura «2B Ensayo» creada por el ensayo y
// genera una invitación. Guarda la ruta de activación y el enlace de registro
// para los pasos siguientes; no toca producción.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.CRV_PANEL_BASE ?? "http://127.0.0.1:3151";
const OUT = path.join(os.homedir(), "crv-staging/reports/2b-rehearsal-2026-11");
await mkdir(OUT, { recursive: true });

const report = { cuando: new Date().toISOString(), base: BASE, pasos: {}, errores: [] };
const ok = (paso, detalle) => { report.pasos[paso] = { ok: true, detalle }; };
const fallo = (paso, detalle) => { report.pasos[paso] = { ok: false, detalle }; };

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "es-VE",
    extraHTTPHeaders: { "cf-connecting-ip": "203.0.113.20" },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

  // Login del documento de la portada (form POST interceptado por login.js:
  // fetch JSON a /api/auth/login y navegación a /roadmap).
  await page.goto(`${BASE}/crv/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#name", { timeout: 20_000 });
  const pendienteLogin = page.waitForResponse(
    (response) => response.url().includes("/api/auth/login") && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.fill("#name", "fase1-admin");
  await page.fill("#accessCode", "Fase1Admin2026");
  await page.click('form.login-form button[type="submit"]');
  const respuestaLogin = await pendienteLogin;
  report.loginStatus = respuestaLogin.status();
  if (respuestaLogin.status() !== 200) throw new Error(`login: ${respuestaLogin.status()}`);
  await page.waitForURL(/\/crv\/(roadmap)?$/u, { timeout: 20_000 }).catch(() => null);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
  const me = await page.evaluate(async () => {
    const response = await fetch("/crv/api/auth/me", { credentials: "include" });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  if (me.status !== 200 || !me.body?.user) throw new Error(`/auth/me: ${me.status}`);
  const user = me.body.user;
  ok("login", { usuario: user.username, rol: user.role });

  const cookies = (await context.cookies()).filter((cookie) => cookie.name === "crv_session");
  const session = cookies[0];
  report.cookies = session ? [{ name: session.name, path: session.path, secure: session.secure, httpOnly: session.httpOnly, sameSite: session.sameSite }] : [];
  if (session?.secure && session.httpOnly && session.path === "/") ok("cookie", { secure: session.secure, httpOnly: session.httpOnly, path: session.path });
  else fallo("cookie", { session: session ?? null });

  await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=candidaturas`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rw-window", { timeout: 20_000 });
  const fila = page.locator(".rw-row", { hasText: "2B Ensayo" }).first();
  if (await fila.count()) {
    ok("candidatura visible", await fila.innerText());
    const aceptar = fila.getByRole("button", { name: /Aceptar/u });
    if (await aceptar.count()) {
      await aceptar.click();
      await page.waitForSelector(".rw-note code", { timeout: 20_000 });
      const activacion = (await page.locator(".rw-note code").first().textContent())?.trim() ?? "";
      report.activacionPath = new URL(activacion, `${BASE}/crv/`).href;
      if (activacion.includes("activar?token=")) ok("aceptar", report.activacionPath);
      else fallo("aceptar", activacion);
    } else {
      ok("aceptar", "ya estaba aceptada (sin botón Aceptar)");
    }
  } else {
    fallo("candidatura visible", "no está la fila 2B Ensayo");
  }
  await page.screenshot({ path: path.join(OUT, "panel-candidaturas-1440.png"), fullPage: false });

  await page.goto(`${BASE}/crv/curaduria/roadmap?herramienta=enlaces`, { waitUntil: "networkidle" });
  await page.waitForSelector(".rw-window", { timeout: 20_000 });
  await page.getByRole("button", { name: /Generar enlace/u }).click();
  await page.waitForSelector(".rw-copybox code", { timeout: 20_000 });
  const invitacion = (await page.locator(".rw-copybox code").first().textContent())?.trim() ?? "";
  report.invitacionUrl = invitacion;
  if (invitacion.includes("/registro?token=")) ok("invitación", invitacion);
  else fallo("invitación", invitacion);
  await page.screenshot({ path: path.join(OUT, "panel-enlaces-1440.png"), fullPage: false });

  report.errores = errors;
  await context.close();
} catch (error) {
  report.errores.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  await writeFile(path.join(OUT, "panel.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = Object.values(report.pasos).every((paso) => paso.ok) && report.errores.length === 0 ? 0 : 1;
}
