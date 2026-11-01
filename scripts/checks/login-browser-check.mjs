/* global document -- las funciones de page.evaluate corren en la página */
// Fase 2A.3 · Inicio de sesión real en el navegador contra staging:
// la cookie Secure sobre http://127.0.0.1 (origen de confianza para Chrome),
// SameSite=Strict y HttpOnly deben dejar una sesión utilizable.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3130";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

await page.goto(`${BASE}/crv/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"], input#username, input[type="text"]', "fase1-admin");
await page.fill('input[type="password"]', "Fase1Admin2026");
await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST", { timeout: 15000 }).catch(() => null),
  page.click('button[type="submit"], form button'),
]);
await page.waitForTimeout(2500);

const cookies = await context.cookies();
const session = cookies.find((c) => c.name === "crv_session");
const me = await page.evaluate(async () => {
  const r = await fetch("api/auth/me", { credentials: "include" });
  const body = await r.json().catch(() => null);
  return { status: r.status, user: body?.user?.name ?? body?.user?.username ?? null, role: body?.user?.role ?? null };
});
const visible = await page.evaluate(() => {
  return (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140);
});
const cookieEnJs = await page.evaluate(() => {
  return document.cookie;
});
console.log(JSON.stringify({
  urlFinal: page.url(),
  cookieSesion: session
    ? { httpOnly: session.httpOnly, secure: session.secure, sameSite: session.sameSite, path: session.path, domain: session.domain }
    : null,
  cookieVisibleEnJs: cookieEnJs.includes("crv_session="),
  me,
  consola: consoleErrors,
  texto: visible,
}, null, 2));
await browser.close();
