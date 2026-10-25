import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = (process.env.CRV_WEB_URL ?? "http://127.0.0.1:5176").replace(/\/$/, "");
const output = process.env.CRV_QA_OUT ?? "../docs/ui-qa/community-simplified-2026-10-20";
const routes = ["terminos", "privacidad", "ayuda"];
const errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  // Se consulta como visitante, sin credenciales ni escrituras al catálogo.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));

  for (const route of routes) {
    await page.goto(`${base}/${route}`, { waitUntil: "networkidle" });
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.locator('.community-nav [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.community-nav a')).toHaveCount(3);
    await expect(page.getByRole("navigation", { name: "Ayuda y condiciones" }).getByRole("link")).toHaveCount(3);
    assert.match(await page.title(), /· CRV$/u);
    for (const target of routes) {
      await expect(page.locator(`footer a[href$="/${target}"]`)).toHaveCount(1);
    }
    const brokenAnchors = await page.locator(".community-toc a").evaluateAll(links => links
      .filter(link => !document.getElementById(decodeURIComponent(new URL(link.href).hash.slice(1))))
      .map(link => link.href));
    assert.deepEqual(brokenAnchors, [], `Anclas rotas en ${route}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Desbordamiento en ${route}`);
  }

  await page.goto(`${base}/terminos#menores`, { waitUntil: "networkidle" });
  await expect.poll(() => page.locator("#menores").evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(150);
  assert.ok(await page.locator("#menores").evaluate(node => node.getBoundingClientRect().top >= 64));
  await page.screenshot({ path: `${output}/desktop-minors.png` });

  // Navegación entre páginas y anclas al llegar desde el pie global.
  await page.locator('footer a[href$="/privacidad"]').click();
  await expect(page.locator("main h1")).toHaveText("Política de privacidad");
  await page.getByRole("navigation", { name: "En esta página" }).getByRole("link", { name: "Tus solicitudes de privacidad" }).click();
  await expect(page).toHaveURL(/\/privacidad#derechos$/u);
  await expect.poll(() => page.locator("#derechos").evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(150);
  await page.goBack();
  await expect(page.locator("main h1")).toHaveText("Política de privacidad");

  await page.goto(`${base}/terminos`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${output}/desktop-terms.png`, fullPage: true });
  await page.goto(`${base}/ayuda`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${output}/desktop-help.png`, fullPage: true });
  const question = page.locator("#faq-cuenta");
  await question.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(question).toHaveAttribute("open", "");
  await expect(question.locator(".community-question__answer")).toBeVisible();

  // Los enlaces ya compartidos conservan tanto la sección como la pregunta.
  for (const [oldPath, currentPath] of [
    ["derechos-de-autor", "terminos#derechos-de-autor"],
    ["derechos-de-autor#reclamos", "terminos#reclamos"],
    ["derechos-de-autor#colaboraciones", "terminos#aportes"],
    ["reglas", "ayuda#reglas"],
    ["reglas#discografia", "ayuda#discografia"],
    ["reglas#audiovisuales", "ayuda#audiovisuales"],
    ["preguntas-frecuentes", "ayuda#preguntas-frecuentes"],
    ["preguntas-frecuentes#autor", "ayuda#faq-autor"],
    ["preguntas-frecuentes#diario", "ayuda#faq-diario"],
    ["apoyar", "ayuda#apoyar"],
  ]) {
    await page.goto(`${base}/${oldPath}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(`${base}/${currentPath}`);
    const target = page.locator(`#${currentPath.split("#")[1]}`);
    await expect(target).toBeVisible();
    if (await target.evaluate(node => node.tagName === "DETAILS")) await expect(target).toHaveAttribute("open", "");
  }

  // Todos los enlaces internos apuntan ya a las tres rutas canónicas.
  for (const route of routes) {
    await page.goto(`${base}/${route}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main h1")).toBeVisible();
    const nonCanonical = await page.locator(".community-copy a").evaluateAll(links => links
      .filter(link => link.origin === location.origin && /\/(?:derechos-de-autor|reglas|preguntas-frecuentes|apoyar)\/?$/u.test(link.pathname))
      .map(link => link.href));
    assert.deepEqual(nonCanonical, []);
  }

  // El pie también existe en Home y fuera de las páginas de comunidad.
  for (const route of ["", "efemerides", "radio"]) {
    await page.goto(`${base}/${route}`, { waitUntil: "networkidle" });
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.locator('footer a[href$="/terminos"]')).toHaveCount(1);
  }

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(`${base}/${route}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main h1")).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Desbordamiento ${width}px: ${route}`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/ayuda`, { waitUntil: "networkidle" });
  await expect(page.locator(".community-index")).not.toHaveAttribute("open", "");
  await expect(page.locator("#preguntas-frecuentes h2")).toBeInViewport();
  await page.screenshot({ path: `${output}/mobile-help.png`, fullPage: true });
  await page.locator(".community-index > summary").click();
  await page.getByRole("navigation", { name: "En esta página" }).getByRole("link", { name: "Reglas de la comunidad" }).click();
  await expect(page.locator(".community-index")).not.toHaveAttribute("open", "");
  await expect.poll(() => page.locator("#reglas").evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(150);
  await page.goto(`${base}/ayuda#faq-autor`, { waitUntil: "networkidle" });
  await expect(page.locator("#faq-autor")).toHaveAttribute("open", "");
  await page.screenshot({ path: `${output}/mobile-question.png` });
  await page.goto(`${base}/terminos#menores`, { waitUntil: "networkidle" });
  await expect.poll(() => page.locator("#menores").evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(150);
  await page.screenshot({ path: `${output}/mobile-minors.png` });
  await page.locator("footer").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/mobile-footer.png` });

  // Tokens existentes: las dos variantes de catálogo deben conservar legibilidad.
  for (const theme of ["charcoal", "studio"]) {
    await page.evaluate(value => { document.documentElement.dataset.catalogTheme = value; }, theme);
    assert.ok(await page.locator("footer").evaluate(node => getComputedStyle(node).color !== getComputedStyle(node).backgroundColor));
  }
  assert.deepEqual(errors, []);
  console.log("OK: 3 páginas; 10 redirecciones con anclas; pie único; desplegables por teclado; índice móvil plegable; navegación, 320/390/768/1280/1440 px y ausencia de errores JS.");
} finally {
  await browser.close();
}
