// CRV · Comprobación en navegador real de las portadas de staging.
//
// Cubre el cierre de B1/B2 del plan independiente: portadas servidas por
// crv-web-staging (:3130, base /crv/) en escritorio y móvil, ES y EN.
// No sustituye a curl: abre Chromium de verdad, ejecuta el JS del documento,
// recoge errores de consola y respuestas fallidas, y captura pantalla.
//
// Uso:
//   node scripts/checks/landing-browser-check.mjs [--out <dir>] [--base <url>]
// Salida: informe JSON + PNG por página/vista/idioma en <dir> (por defecto
//         $HOME/crv-staging/reports/independencia/b2-navegador).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argValue("--base", "http://127.0.0.1:3130");
const OUT = argValue("--out", path.join(os.homedir(), "crv-staging/reports/independencia/b2-navegador"));
const PAGES = ["roadmap", "colaborar", "login"];
const LANGS = ["es", "en"];
const VIEWPORTS = [
  { name: "escritorio", viewport: { width: 1366, height: 900 }, isMobile: false },
  { name: "movil", viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, hasTouch: true },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
let failures = 0;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: Boolean(vp.isMobile),
    hasTouch: Boolean(vp.hasTouch),
    deviceScaleFactor: vp.deviceScaleFactor ?? 1,
    locale: "es-VE",
  });
  for (const page of PAGES) {
    for (const lang of LANGS) {
      const url = `${BASE}/crv/${page}?lang=${lang}`;
      const tab = await context.newPage();
      const consoleErrors = [];
      const failed = [];
      const apiResponses = [];
      tab.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
      });
      tab.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));
      tab.on("requestfailed", (req) => failed.push(`${req.method()} ${req.url()} (${req.failure()?.errorText ?? "?"})`));
      tab.on("response", (res) => {
        const u = res.url();
        if (u.includes("/api/")) apiResponses.push({ url: u.replace(BASE, ""), status: res.status() });
        // `/api/roadmap/me` responde 401 en anónimo: es la sonda de sesión de la
        // portada, no un fallo del recurso.
        const anonymousProbe = res.status() === 401 && u.includes("/api/roadmap/me");
        if (res.status() >= 400 && !anonymousProbe) failed.push(`${res.status()} ${u.replace(BASE, "")}`);
      });

      let status = null;
      try {
        const response = await tab.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        status = response?.status() ?? null;
      } catch (err) {
        (consoleErrors.length ? consoleErrors : failed).push(`goto: ${String(err).slice(0, 200)}`);
      }
      await tab.waitForTimeout(1200); // deja correr los fetch de las portadas

      const dom = await tab.evaluate(() => {
        /* global document -- la función se ejecuta en la página, no en Node */
        const meta = document.querySelector('meta[name="crv-api-base"]');
        const main = document.querySelector("main") ?? document.body;
        const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
        return {
          title: document.title,
          baseHref: document.querySelector("base")?.getAttribute("href") ?? null,
          baseURI: document.baseURI,
          apiBase: meta?.getAttribute("content") ?? null,
          lang: document.documentElement.lang,
          h1: document.querySelector("h1")?.textContent?.trim() ?? null,
          textLength: text.length,
          textHead: text.slice(0, 160),
          mainHeight: Math.round(main.getBoundingClientRect().height),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length,
          images: document.images.length,
          // F2-1: la portada resuelve sus llamadas contra document.baseURI, nunca
          // con rutas `../`. En login se comprueba el destino real del POST.
          loginTarget: new URL("api/auth/login", document.baseURI).pathname,
        };
      });

      const shot = path.join(OUT, `${vp.name}-${page}-${lang}.png`);
      await tab.screenshot({ path: shot, fullPage: false });

      const okApi = apiResponses.some((r) => r.status >= 200 && r.status < 300);
      const needsApi = page !== "login"; // login solo llama a la API al enviar el formulario
      // Chrome anota en consola cualquier respuesta 401 como «Failed to load
      // resource» aunque el JS la maneje. La sonda de sesión `/api/roadmap/me`
      // responde 401 a todo anónimo por diseño: se separa del resto.
      const benignConsole = consoleErrors.filter((e) => /Failed to load resource: the server responded with a status of 401/.test(e));
      const realConsoleErrors = consoleErrors.filter((e) => !benignConsole.includes(e));
      const checks = {
        http200: status === 200,
        baseEnabled: dom.baseHref === "/crv/",
        baseEffective: dom.baseURI === `${BASE}/crv/`,
        apiBaseOk: Boolean(dom.apiBase && dom.apiBase.includes("/crv/api")),
        titleOk: Boolean(dom.title && dom.title.length > 3),
        rendered: dom.textLength > 200 && dom.mainHeight > 300,
        noHorizontalOverflow: dom.scrollWidth <= dom.clientWidth + 1,
        noBrokenImages: dom.brokenImages === 0,
        noConsoleErrors: realConsoleErrors.length === 0,
        noFailedRequests: failed.length === 0,
        apiResponded: needsApi ? okApi : true,
        loginTargetOk: page === "login" ? dom.loginTarget === "/crv/api/auth/login" : true,
      };
      const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      if (failedChecks.length) failures += 1;

      results.push({ vista: vp.name, pagina: page, idioma: lang, url, status, checks, failedChecks, consoleErrors: realConsoleErrors, sondaSesion401: benignConsole.length, failedRequests: failed, apiResponses, dom, screenshot: shot });
      await tab.close();
      console.log(`${failedChecks.length ? "FALLA" : "ok   "} ${vp.name}/${page}/${lang}${failedChecks.length ? ` → ${failedChecks.join(",")}` : ""}`);
    }
  }
  await context.close();
}
await browser.close();

const summary = {
  generado: new Date().toISOString(),
  base: BASE,
  total: results.length,
  conFallas: failures,
  resultados: results,
};
const reportPath = path.join(OUT, "informe.json");
await writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");
console.log(`\n${results.length - failures}/${results.length} comprobaciones ok → ${reportPath}`);
process.exitCode = failures === 0 ? 0 : 1;
