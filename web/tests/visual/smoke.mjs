import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const searchRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/search")) searchRequests.push(request.url());
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  const searchInput = page.getByLabel("Buscar en el catálogo");
  await searchInput.fill("Ca");
  await page.waitForTimeout(350);
  expect(searchRequests).toHaveLength(0);
  await searchInput.fill("Car");
  await expect.poll(() => searchRequests.filter((url) => new URL(url).searchParams.get("q") === "Car").length).toBe(1);
  await expect(page.locator('a[href="/artistas/58"]')).toBeVisible();
  await page.locator('a[href="/artistas/58"]').click();
  await expect(page).toHaveURL(/\/artistas\/58$/);
  await page.getByRole("link", { name: /Las Paticas De La Abuela/ }).click();
  await expect(page).toHaveURL(/\/discos\/57$/);
  await expect(page.locator("tbody > tr")).toHaveCount(4);
  await expect(page.getByText("Nadando a Través De La Galaxia", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Asier Cazalis", exact: true }).click();
  await expect(page).toHaveURL(/\/personas\/2698$/);
  await expect(page.getByRole("heading", { name: "Asier Cazalis" })).toBeVisible();

  await page.goBack({ waitUntil: "networkidle" });
  const studio = page.locator('a[href^="/organizaciones/"]').first();
  const studioName = await studio.textContent();
  const studioPath = await studio.getAttribute("href");
  await studio.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(studioPath);
  await expect(page.getByRole("heading", { name: studioName.trim(), exact: true })).toBeVisible();

  if (errors.length) throw new Error(errors.join("; "));
} finally {
  await browser.close();
}
