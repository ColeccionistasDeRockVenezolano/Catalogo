import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const errors = [];

async function checkStart(page, target) {
  await expect.poll(() => target.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
    // Short final pages may reach the bottom of the document before aligning.
    return top >= margin - 2 && top < innerHeight;
  })).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/artistas', '/discos', '/personas', '/organizaciones']) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
      const pagination = page.locator('.pagination');
      await expect(pagination).toBeVisible({ timeout: 20000 });
      const target = page.locator('.pagination-start').first();
      const next = pagination.getByRole('button', { name: 'Siguiente' });
      await next.click();
      await expect(page).toHaveURL(/offset=30/);
      await expect(page.locator('.is-refreshing')).toHaveCount(0);
      await checkStart(page, target);
      const previous = pagination.getByRole('button', { name: 'Anterior' });
      await previous.scrollIntoViewIfNeeded();
      await previous.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/offset=0/);
      await expect(page.locator('.is-refreshing')).toHaveCount(0);
      await checkStart(page, target);
      await expect(previous).toBeDisabled();
      console.log(`${viewport.width}px ${route}: siguiente, anterior y cabecera OK`);
    }

    // Render the production shared control and report browser in an isolated
    // fixture: independent segments, delayed results and a shorter final page.
    await page.route('**/pagination-scroll-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>
        :root { --header-h: 72px; } body { margin: 0; }
        header { position: fixed; top: 0; height: 72px; width: 100%; background: black; z-index: 40; }
        .pagination-start { scroll-margin-top: calc(var(--header-h) + 24px); }
        li { min-height: 100px; } .spacer { height: 1000px; }
      </style></head><body><header></header><div id="root"></div>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/tests/visual/pagination-scroll-fixture.tsx');
      </script></body></html>`,
    }));
    await page.goto(`${baseUrl}/pagination-scroll-fixture`);
    const second = page.locator('#second');
    await second.locator('.pagination').getByRole('button', { name: 'Siguiente' }).click();
    await expect(second.locator('[data-loaded-offset]')).toHaveAttribute('data-loaded-offset', '20');
    await checkStart(page, second.locator('.pagination-start'));
    await expect(page.locator('#first .pagination')).toContainText('Página 1');
    await second.locator('.pagination').getByRole('button', { name: 'Anterior' }).click();
    await expect(second.locator('[data-loaded-offset]')).toHaveAttribute('data-loaded-offset', '0');
    await checkStart(page, second.locator('.pagination-start'));

    const group = page.locator('.verification-browser__group').filter({ hasText: 'Cómo se calcula' });
    await group.locator('summary').click();
    await group.getByRole('button', { name: 'Siguiente' }).click();
    await expect(group.locator('.verification-browser__list > li')).toHaveCount(5);
    await checkStart(page, group.locator('.pagination-start'));
    await expect(group.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await group.getByRole('button', { name: 'Anterior' }).click();
    await expect(group.locator('.verification-browser__list > li')).toHaveCount(20);
    await checkStart(page, group.locator('.pagination-start'));
    console.log(`${viewport.width}px segmentos independientes, carga diferida e informes: OK`);
    await page.close();
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
