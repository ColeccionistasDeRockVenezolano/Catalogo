import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve(process.env.CRV_CAPTURE_DIR ?? "docs/ui-qa/catalog-gallery-refined");
const apiUrl = process.env.CRV_API_URL ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ headless: true });
await mkdir(outputDir, { recursive: true });
const errors = [];

async function open(page, route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".entity-card").first()).toBeVisible({ timeout: 15000 });
}

async function checkGrid(page, width) {
  const layout = await page.evaluate(() => {
    const grid = document.querySelector(".grid-cards");
    const card = grid.querySelector(".entity-card");
    const art = card.querySelector(".entity-card__art");
    const body = card.querySelector(".entity-card__body");
    const container = document.querySelector("main > .container");
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      containerWidth: container.getBoundingClientRect().width,
      gutter: Number.parseFloat(getComputedStyle(container).paddingLeft),
      gridLeft: grid.getBoundingClientRect().left,
      gridRight: grid.getBoundingClientRect().right,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      artWidth: art.getBoundingClientRect().width,
      artHeight: art.getBoundingClientRect().height,
      bodyTop: body.getBoundingClientRect().top,
      artBottom: art.getBoundingClientRect().bottom,
      background: getComputedStyle(card).backgroundColor,
      shadow: getComputedStyle(art).boxShadow,
      textOverflow: [...grid.querySelectorAll(".entity-card__body > span")].some((el) => el.scrollWidth > el.clientWidth + 1),
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.containerWidth).toBe(width);
  const gutter = Math.min(320, Math.max(width <= 560 ? 16 : 24, width * 0.125 - 40));
  expect(layout.gutter).toBeCloseTo(gutter, 1);
  expect(layout.gridLeft).toBeCloseTo(gutter, 1);
  expect(width - layout.gridRight).toBeCloseTo(gutter, 1);
  expect(Math.abs(layout.artWidth - layout.artHeight)).toBeLessThan(1);
  expect(layout.bodyTop).toBeGreaterThan(layout.artBottom);
  expect(layout.background).toBe("rgba(0, 0, 0, 0)");
  expect(layout.shadow).not.toBe("none");
  expect(layout.textOverflow).toBe(false);
  const expectedColumns = { 320: 2, 390: 2, 600: 3, 768: 3, 1080: 4, 1440: 5, 1920: 6, 2048: 7 };
  expect(layout.columns).toBe(expectedColumns[width]);
}

try {
  for (const viewport of [{ width: 2048, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [name, route] of [
      ["artistas", "/artistas?q=Los"], ["personas", "/personas?q=José"],
      ["discos", "/discos"], ["organizaciones", "/organizaciones"],
      ["discografia", "/artistas/58"],
    ]) {
      await open(page, route);
      await checkGrid(page, viewport.width);
      await page.locator(".grid-cards").scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector(".grid-cards").scrollIntoView({ block: "start" }));
      await page.waitForFunction(() => [...document.querySelectorAll(".grid-cards img")]
        .filter((img) => { const box = img.getBoundingClientRect(); return box.top < innerHeight && box.bottom > 0; })
        .every((img) => img.complete), undefined, { timeout: 5000 }).catch(() => undefined);
      if (process.env.CRV_CAPTURE_SKIP !== "1") {
        await page.screenshot({ path: path.join(outputDir, `${viewport.width}-${name}.png`) });
      }
    }

    const cards = page.locator(".discography-grid .entity-card");
    await expect(cards).toHaveCount(24);
    const firstAlbum = await cards.first().getAttribute("href");
    await page.getByRole("button", { name: "Siguiente →", exact: true }).click();
    await expect(page).toHaveURL(/discographyPage=2/);
    await expect(cards).toHaveCount(9);
    expect(await cards.first().getAttribute("href")).not.toBe(firstAlbum);
    await expect(page.getByRole("button", { name: "Siguiente →", exact: true })).toBeDisabled();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cards).toHaveCount(9);
    await page.getByRole("button", { name: "← Anterior", exact: true }).click();
    await expect(cards).toHaveCount(24);
    expect(await cards.first().getAttribute("href")).toBe(firstAlbum);
    await page.getByRole("tab", { name: /Integrantes/ }).click();
    await page.getByRole("tab", { name: /Discografía/ }).click();
    await expect(cards).toHaveCount(24);
    await open(page, "/artistas/58?discographyPage=invalid");
    await expect(cards).toHaveCount(24);
    await open(page, "/artistas/58?discographyPage=999");
    await expect(cards).toHaveCount(9);
    await open(page, "/artistas?q=Caramelos");
    await expect(page.locator(".pagination")).toHaveCount(0);

    await open(page, "/discos");
    const firstDisc = await page.locator(".entity-card").first().getAttribute("href");
    await page.getByRole("button", { name: "Siguiente →", exact: true }).click();
    await expect(page).toHaveURL(/offset=30/);
    await expect.poll(() => page.locator(".entity-card").first().getAttribute("href")).not.toBe(firstDisc);
    await page.getByRole("button", { name: "← Anterior", exact: true }).click();
    await expect.poll(() => page.locator(".entity-card").first().getAttribute("href")).toBe(firstDisc);
    await page.close();
  }

  const page = await browser.newPage();
  for (const width of [320, 600, 768, 1080, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/artistas/58");
    await checkGrid(page, width);
  }
  // La API real confirma las fotos de organizaciones; esta respuesta aislada
  // verifica el renderizado de un logo y el fallback ante una imagen rota.
  const organizationFixture = await (await page.request.get(`${apiUrl}/organizations?limit=30`)).json();
  const artist = await (await page.request.get(`${apiUrl}/artists/58`)).json();
  organizationFixture.data[0].pictureUrl = artist.pictureUrl;
  organizationFixture.data[1].pictureUrl = "/missing-organization-photo.jpg";
  await page.route((url) => url.pathname.endsWith("/organizations")
    && url.searchParams.get("limit") === "30" && Number(url.searchParams.get("offset")) === 0,
  (route) => route.fulfill({ json: organizationFixture }));
  await open(page, "/organizaciones");
  await expect(page.locator(".entity-card").first().locator("img")).toBeVisible();
  await expect(page.locator(".entity-card").nth(1).locator(".placeholder")).toBeVisible();
  await expect(page.locator(".entity-card").nth(1).locator(".entity-card__missing")).toHaveText("Sin imagen");
  await page.locator(".entity-card").first().focus();
  expect(await page.locator(".entity-card").first().evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.close();
  expect(errors).toEqual([]);
  console.log("Galerías verificadas en 320, 390, 600, 768, 1080, 1440, 1920 y 2048 px; márgenes simétricos, texto, paginación, pestañas, URL, fotos y fallback correctos.");
} finally {
  await browser.close();
}
