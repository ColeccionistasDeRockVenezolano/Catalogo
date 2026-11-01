// CRV · Paridad del admin (B6) — capturas de Herra, sin tocar nada.
//
// Usa el Chrome con el perfil copiado (CDP :9335) para capturar las páginas
// PÚBLICAS de Herra 1.1.34 a 1440 y 390 px, ES y EN. El panel /admin exige
// sesión de administrador: si no la hay, se anota y se captura el login.
//
// Uso: node scripts/checks/admin-parity-herra.mjs
/* global document -- las funciones de page.evaluate corren en la página */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const OUT = path.join(os.homedir(), "crv-staging/reports/admin-paridad-2026-11");
// Herra local (misma versión 1.1.34 que el dominio, sin Cloudflare delante).
// Se puede apuntar al dominio con BASE=https://coleccionistasderockvenezolano.com
const DOMAIN = process.env.BASE ?? "http://127.0.0.1:3020/coleccionistas-rock-venezolano";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "es-VE" });
const report = { generado: new Date().toISOString(), capturas: [], admin: null, textos: {} };

for (const view of [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }]) {
  for (const lang of ["es", "en"]) {
    const page = await context.newPage();
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto(`${DOMAIN}/?lang=${lang}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2500);
    const file = path.join(OUT, `herra-roadmap-${view.name}-${lang}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const text = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
    report.capturas.push({ archivo: file, vista: view.name, idioma: lang, tipo: "roadmap público" });
    report.textos[`roadmap-${lang}`] = text.slice(0, 2500);
    await page.close();
  }
}

// El panel: comprobar si el perfil copiado conserva la sesión de administrador.
const admin = await context.newPage();
await admin.setViewportSize({ width: 1440, height: 900 });
await admin.goto(`${DOMAIN}/admin`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
await admin.waitForTimeout(2000);
const adminUrl = admin.url();
const onLogin = adminUrl.includes("/admin/login");
report.admin = { url: adminUrl, sesion: !onLogin };
if (onLogin) {
  const file = path.join(OUT, "herra-admin-login-1440.png");
  await admin.screenshot({ path: file, fullPage: false });
  report.capturas.push({ archivo: file, vista: "1440", idioma: "es", tipo: "admin login (sin sesión)" });
} else {
  for (const view of [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }]) {
    await admin.setViewportSize({ width: view.width, height: view.height });
    await admin.waitForTimeout(900);
    const file = path.join(OUT, `herra-admin-${view.name}-es.png`);
    await admin.screenshot({ path: file, fullPage: true });
    report.capturas.push({ archivo: file, vista: view.name, idioma: "es", tipo: "admin" });
  }
}
await admin.close();
await browser.close();
await writeFile(path.join(OUT, "informe-herra.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ admin: report.admin, capturas: report.capturas.map((c) => `${c.tipo} ${c.vista} ${c.idioma}`) }, null, 2));
