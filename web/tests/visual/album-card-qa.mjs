import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const output = '/tmp/crv-album-card-qa';
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [name, route] of [['discos', '/discos'], ['discografia', '/artistas/58?tab=discografia']]) {
      await page.goto(`${base}${route}`);
      const cards = page.locator('.entity-card--album');
      await expect(cards.first()).toBeVisible({ timeout: 20000 });
      await page.evaluate(() => document.querySelector('.grid-cards').scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${output}/${width}-${name}.png` });
      await expect(cards.first().locator('.entity-card__artist')).toBeVisible();
      await expect(cards.first().locator('.entity-card__edition')).toBeVisible();
      const layout = await cards.first().evaluate(card => {
        const title = card.querySelector('.entity-card__title');
        const artist = card.querySelector('.entity-card__artist');
        const edition = card.querySelector('.entity-card__edition');
        return {
          titleBottom: title.getBoundingClientRect().bottom,
          artistTop: artist.getBoundingClientRect().top,
          artistBottom: artist.getBoundingClientRect().bottom,
          editionTop: edition.getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(layout.artistTop).toBeGreaterThanOrEqual(layout.titleBottom);
      expect(layout.editionTop).toBeGreaterThanOrEqual(layout.artistBottom);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(['auto', '0px']).toContain(await cards.first().locator('.entity-card__title').evaluate(title => getComputedStyle(title).minHeight));
      const before = await cards.first().boundingBox();
      await cards.first().hover();
      await expect.poll(() => cards.first().locator('.entity-card__title').evaluate(title => getComputedStyle(title).color)).toBe('rgb(255, 139, 144)');
      expect(await cards.first().locator('.entity-card__title').evaluate(title => getComputedStyle(title).textDecorationLine)).toBe('none');
      expect(await cards.first().boundingBox()).toEqual(before);
      await cards.first().focus();
      await expect(cards.first()).toBeFocused();
      console.log(`${width}px ${name}: jerarquía, hover estable, foco y ancho OK`);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
} finally { await browser.close(); }
