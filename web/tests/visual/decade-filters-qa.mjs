import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const output = '/tmp/crv-decade-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/discos', '/artistas']) {
      await page.goto(`${baseUrl}${route}?offset=30&tipo=${route === '/discos' ? 'studio_album' : 'band'}`);
      await expect(page.locator('.entity-card').first()).toBeVisible({ timeout: 20000 });
      const toggle = page.locator('.catalog-filter-toggle').filter({ hasText: /^Década/ });
      await toggle.click();
      const decade = page.getByRole('group', { name: 'Décadas', exact: true });
      const seventies = decade.getByRole('button', { name: /^1970–1979:/ });
      await expect(seventies).toBeVisible();
      await seventies.click();
      await expect(page).toHaveURL(/decada=1970/);
      expect(new URL(page.url()).searchParams.has('offset')).toBe(false);
      expect(new URL(page.url()).searchParams.has('tipo')).toBe(true);
      await expect(page.locator('.is-refreshing')).toHaveCount(0);
      await expect(seventies).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Quitar filtro 1970–1979' })).toBeVisible();
      const cardsBeforeClosing = await page.locator('.entity-card').count();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(new URL(page.url()).searchParams.get('decada')).toBe('1970');
      expect(await page.locator('.entity-card').count()).toBe(cardsBeforeClosing);
      await toggle.click();
      await page.screenshot({ path: `${output}/${viewport.width}-${route.slice(1)}.png`, fullPage: false });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Quitar filtro 1970–1979' })).toBeVisible();
      await toggle.click();
      await page.getByRole('group', { name: 'Décadas', exact: true }).getByRole('button', { name: /^Sin año:/ }).click();
      await expect(page).toHaveURL(/decada=sin-anio/);
      await expect(page.locator('.is-refreshing')).toHaveCount(0);
      await page.getByRole('button', { name: 'Quitar filtro Sin año', exact: true }).click();
      expect(new URL(page.url()).searchParams.has('decada')).toBe(false);
      console.log(`${viewport.width}px ${route}: décadas, sin año, URL, tipo y quitar filtro OK`);
    }
    await page.goto(`${baseUrl}/artistas/58?tab=discografia&discographyPage=2`);
    const decades = page.getByRole('group', { name: 'Décadas', exact: true });
    await expect(decades).toBeVisible({ timeout: 20000 });
    const button = decades.getByRole('button', { name: /^\d{4}–\d{4}:/ }).first();
    await button.click();
    const selected = new URL(page.url()).searchParams.get('discographyDecade');
    expect(selected).toMatch(/^\d{4}$/);
    expect(new URL(page.url()).searchParams.has('discographyPage')).toBe(false);
    expect(new URL(page.url()).searchParams.get('tab')).toBe('discografia');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('.discography-grid .entity-card').count()).toBeGreaterThan(0);
    await page.screenshot({ path: `${output}/${viewport.width}-discografia.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    console.log(`${viewport.width}px discografía: filtro local y reinicio de página OK`);
    await page.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
