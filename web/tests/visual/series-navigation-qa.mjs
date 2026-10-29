// Navegación de series con datos de lectura del catálogo; no escribe en la API.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const api = process.env.CRV_API_URL ?? 'http://127.0.0.1:8080';
const out = process.env.CRV_QA_OUT;
if (!out) throw new Error('Define CRV_QA_OUT en staging SSD.');
await mkdir(out, { recursive: true });
const collection = await fetch(`${api}/series/72`).then(r => r.json());
const results = [];
const browser = await chromium.launch();
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    let missingCover = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
    // Compatibilidad con la API anterior al despliegue: las portadas vienen de la serie real.
    await page.route(/\/albums\/\d+$/, async route => {
      const response = await route.fetch();
      const body = await response.json();
      for (const membership of body.series ?? []) {
        for (const direction of ['previous', 'next']) {
          const neighbor = membership[direction];
          if (neighbor) neighbor.coverUrl = missingCover ? '/missing-series-cover.jpg' : collection.volumes.find(v => v.albumId === neighbor.albumId)?.coverUrl ?? null;
        }
      }
      await route.fulfill({ response, json: body });
    });
    const nav = page.getByRole('navigation', { name: 'Volúmenes de VenezuelaDemo', exact: true });
    const check = async (index, expectedCount) => {
      await page.goto(`${base}/discos/${collection.volumes[index].albumId}`);
      await expect(nav).toBeVisible();
      await expect(nav.locator('.series-neighbor')).toHaveCount(expectedCount);
      await nav.scrollIntoViewIfNeeded();
      for (const img of await nav.locator('img').all()) await expect.poll(() => img.evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
      assert.equal(await nav.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    };
    await check(0, 1);
    await expect(nav.locator('.series-neighbor--previous')).toHaveCount(0);
    await nav.screenshot({ path: `${out}/first-${width}.png` });
    await nav.getByRole('link', { name: 'Siguiente Venezuelademo 2', exact: true }).click();
    await expect(nav.locator('.series-navigation__current')).toHaveText('Vol. 2 · Disco actual');
    await expect(nav.locator('.series-neighbor')).toHaveCount(2);
    await nav.scrollIntoViewIfNeeded();
    for (const img of await nav.locator('img').all()) await expect.poll(() => img.evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
    await nav.screenshot({ path: `${out}/middle-${width}.png` });
    const previous = nav.locator('.series-neighbor--previous');
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(nav.locator('.series-navigation__current')).toHaveText('Vol. 1 · Disco actual');
    await check(collection.volumes.length - 1, 1);
    await expect(nav.locator('.series-neighbor--next')).toHaveCount(0);
    await nav.getByRole('link', { name: 'Ver la serie', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'VenezuelaDemo', exact: true })).toBeVisible();
    missingCover = true;
    await page.goto(`${base}/discos/${collection.volumes[0].albumId}`);
    await nav.scrollIntoViewIfNeeded();
    await expect(nav.locator('.series-neighbor__art svg')).toBeVisible();
    await expect(nav.locator('.series-neighbor img')).toHaveCount(0);
    assert.deepEqual(errors, []);
    results.push({ width, first: true, middle: true, last: true, keyboard: true, collection: true, brokenCover: true, errors });
    await context.close();
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
