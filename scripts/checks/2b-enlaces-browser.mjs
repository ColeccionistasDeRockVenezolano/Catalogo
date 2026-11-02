// CRV · Ensayo 2B · enlaces de cuenta y administración en modo portada.
/* global document */
//
// Con sesión abierta, /roadmap en la portada (:3150) no debe ofrecer /cuenta ni
// /curaduria (la lista blanca responde 404); el mismo render bajo /crv (:3151,
// catálogo) sí debe conservarlos. Se comprueba en ES/EN y 1440/390.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const OUT = path.join(os.homedir(), "crv-staging/reports/2b-rehearsal-2026-11");
await mkdir(OUT, { recursive: true });
const report = { cuando: new Date().toISOString(), casos: {}, errores: [] };

async function entrar(page, base, loginPath) {
  await page.goto(`${base}${loginPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#name", { timeout: 20_000 });
  const pendiente = page.waitForResponse(
    (response) => response.url().includes("/api/auth/login") && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.fill("#name", "fase1-admin");
  await page.fill("#accessCode", "Fase1Admin2026");
  await page.click('form.login-form button[type="submit"]');
  const respuesta = await pendiente;
  if (respuesta.status() !== 200) throw new Error(`login ${base}: ${respuesta.status()}`);
  await page.waitForTimeout(800);
}

async function enlaces(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  return page.evaluate(() => [...document.querySelectorAll("a")]
    .map((nodo) => nodo.getAttribute("href") ?? "")
    .filter((href) => /cuenta|curaduria/u.test(href)));
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
  const page = await context.newPage();
  await entrar(page, "http://127.0.0.1:3150", "/login");

  for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width: ancho, height: alto });
    for (const lang of ["es", "en"]) {
      const hrefs = await enlaces(page, `http://127.0.0.1:3150/roadmap?lang=${lang}`);
      const clave = `portada-${lang}-${ancho}`;
      report.casos[clave] = { hrefs, ok: hrefs.length === 0 };
      await page.screenshot({ path: path.join(OUT, `${clave}.png`), fullPage: ancho === 390 });
    }
  }

  // El catálogo conserva los enlaces (misma sesión, mismo host).
  await page.setViewportSize({ width: 1440, height: 900 });
  const hrefsCatalogo = await enlaces(page, "http://127.0.0.1:3151/crv/roadmap?lang=es");
  report.casos["catalogo-es-1440"] = {
    hrefs: hrefsCatalogo,
    ok: hrefsCatalogo.some((href) => href.includes("/crv/cuenta")) && hrefsCatalogo.some((href) => href.includes("/crv/curaduria")),
  };
  await context.close();
} catch (error) {
  report.errores.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  await writeFile(path.join(OUT, "enlaces.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = Object.values(report.casos).every((caso) => caso.ok) && report.errores.length === 0 ? 0 : 1;
}
