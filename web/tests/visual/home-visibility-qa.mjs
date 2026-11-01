// CRV_WEB_URL=http://127.0.0.1:5173 node web/tests/visual/home-visibility-qa.mjs
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });

// Chromium headless no oculta una página con bringToFront: emitir el mismo
// evento y estado del documento permite comprobar la pausa de forma repetible.
async function visibility(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function frames(page, count) {
  await page.evaluate(count => new Promise(resolve => {
    const tick = () => --count <= 0 ? resolve() : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  }), count);
}

async function sample(page) {
  return page.evaluate(() => {
    const wall = document.querySelector(".home-wall");
    const hero = document.querySelector(".home-hero").getBoundingClientRect();
    return {
      time: wall.getAnimations()[0].currentTime,
      transform: getComputedStyle(wall).transform,
      scrollY,
      heroTop: hero.top,
      heroHeight: hero.height,
    };
  });
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: "no-preference" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    const wall = page.locator(".home-wall");
    const backdrop = page.locator(".home-hero__backdrop");
    await expect(wall).toBeAttached();
    await expect(page.locator(".home-wall__cover")).toHaveCount(28);
    await expect(page.locator(".home-stats__value--loading")).toHaveCount(0);
    await expect(page.locator(".home-search-recommendation > button").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Comprobar la mitad de la deriva: aquí su velocidad es máxima.
    await wall.evaluate(node => { node.getAnimations()[0].currentTime = 45_000; });
    await page.evaluate(() => document.querySelectorAll(".home-hero .search-shell > *")
      .forEach(node => node.getAnimations().forEach(animation => animation.finish())));
    await page.evaluate(() => scrollTo(0, 80));

    for (let cycle = 0; cycle < 2; cycle++) {
      await visibility(page, true);
      await expect(backdrop).toHaveAttribute("data-paused", "true");
      await frames(page, 2); // resolver la operación pendiente de pausa de CSS
      const frozen = await sample(page);
      await frames(page, 30);
      expect(await sample(page)).toEqual(frozen);
      expect(await wall.evaluate(node => node.getAnimations()[0].playState)).toBe("paused");
      expect(await page.locator(".home-wall img").evaluateAll(images => images.every(image => getComputedStyle(image).animationPlayState === "paused"))).toBe(true);

      // Mantener la revalidación pendiente para medir también el estado sin
      // recomendación, que antes encogía el hero y desplazaba toda la página.
      let release;
      let intercepted = false;
      const pending = new Promise(resolve => { release = resolve; });
      await page.route("**/discovery/search-suggestions?*", async route => {
        intercepted = true;
        await pending;
        await route.continue();
      }, { times: 1 });
      const resumeStarted = await page.evaluate(() => performance.now());
      await visibility(page, false);
      await expect(backdrop).not.toHaveAttribute("data-paused");
      await frames(page, 8);
      const resumed = await sample(page);
      const elapsed = await page.evaluate(start => performance.now() - start, resumeStarted);
      expect(resumed.time).toBeGreaterThan(frozen.time);
      expect(resumed.time - frozen.time).toBeLessThan(elapsed + 50);
      expect(resumed.scrollY).toBe(frozen.scrollY);
      expect(resumed.heroTop).toBe(frozen.heroTop);
      expect(resumed.heroHeight).toBe(frozen.heroHeight);
      await expect.poll(() => intercepted).toBe(true);
      await expect(page.locator(".home-search-recommendation > button")).toHaveCount(0);
      const loading = await sample(page);
      expect(loading.scrollY).toBe(frozen.scrollY);
      expect(loading.heroHeight).toBe(frozen.heroHeight);
      release();
      await expect(page.locator(".home-search-recommendation > button").first()).toBeVisible();
      const loaded = await sample(page);
      expect(loaded.scrollY).toBe(frozen.scrollY);
      expect(loaded.heroHeight).toBe(frozen.heroHeight);
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => wall.evaluate(node => node.getAnimations().length)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }

  const hiddenPage = await browser.newPage({ reducedMotion: "no-preference" });
  await hiddenPage.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await hiddenPage.goto(base);
  await expect(hiddenPage.locator(".home-hero__backdrop")).toHaveAttribute("data-paused", "true");
  expect(await hiddenPage.locator(".home-wall").evaluate(node => node.getAnimations()[0].playState)).toBe("paused");
  await visibility(hiddenPage, false);
  await expect.poll(() => hiddenPage.locator(".home-wall").evaluate(node => node.getAnimations()[0].playState)).toBe("running");
  await hiddenPage.close();
  console.log("Portadas: pausa y reanudación sin saltos en escritorio/móvil, pestaña inicialmente oculta y movimiento reducido verificados.");
} finally {
  await browser.close();
}
