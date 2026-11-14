/* global document, window -- page.evaluate se ejecuta en el navegador */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

// Prueba el bundle completo publicado, sin YouTube ni base de producción.
test('créditos y actualización automática en escritorio, iPad y Android', async t => {
  const radio = readFileSync(new URL('../../web/public/landing/radio.js', import.meta.url));
  const updater = readFileSync(new URL('../../web/public/landing/release-update.js', import.meta.url));
  let revision = 'old';
  let current = {};
  const server = http.createServer((req, res) => {
    if (req.url === '/radio.js' || req.url === '/release-update.js') {
      res.setHeader('content-type', 'application/javascript');
      res.end(req.url === '/radio.js' ? radio : updater);
    } else if (req.url === '/now') {
      const now = Date.now();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        phase: 'music', queueId: 'fixture', serverTime: new Date(now).toISOString(),
        startsAt: new Date(now - 10000).toISOString(), endsAt: new Date(now + 600000).toISOString(),
        current: { videoId: 'ABCDEFGHIJK', startSeconds: 0, durationSeconds: 610,
          artist: 'Various Artists', title: 'Los Mentas - Tu Pan', album: 'Borrachos y Bolingas Vol. 1', year: 2000, ...current },
        next: { videoId: 'LMNOPQRSTUV', startSeconds: 0, durationSeconds: 200,
          artist: 'Various Artists', title: 'Estuproi! - Revolución Francesa' }, upcoming: [],
      }));
    } else {
      res.setHeader('content-type', 'text/html');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('X-CRV-Page-Version', revision);
      res.end(req.method === 'HEAD' ? '' : `<!doctype html><html><head><meta name="crv-page-version" content="${revision}"></head><body>
        <div id="radio" data-radio-api="/now"><iframe id="radioPlayer"></iframe>
        <h2 data-radio-title></h2><p data-radio-artist></p><p data-radio-next></p></div>
        <form><input name="draft"></form><script src="/radio.js"></script><script src="/release-update.js"></script>
        </body></html>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, options] of [['escritorio', {}], ['iPad', devices['iPad Pro 11']], ['Android', devices['Pixel 7']]]) {
      await t.test(name, async () => {
        revision = 'old';
        current = {};
        const context = await browser.newContext(options);
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.clock.install();
          await page.goto(`http://127.0.0.1:${server.address().port}/`);
          await page.clock.fastForward(30000);
          await page.waitForFunction(() => document.querySelector('[data-radio-title]').textContent === 'Tu Pan');
          assert.equal(await page.locator('[data-radio-artist]').textContent(), 'Los Mentas - Borrachos y Bolingas Vol. 1 ∙ 2000');
          assert.equal(await page.locator('[data-radio-next]').textContent(), 'Estuproi! - Revolución Francesa');
          assert.equal(await page.evaluate(() => window.CRVRadioCanReload()), true);
          for (const [artist, title, shownTitle, shownArtist] of [
            ['Varios artistas', '7 Balazos - Paranoia', 'Paranoia', '7 Balazos'],
            ['V. A.', 'Zapato 3 - Pantaletas Negras', 'Pantaletas Negras', 'Zapato3'],
            ['VA', 'Rock-n-Roll', 'Rock-n-Roll', ''],
            ['Convoy', 'Convoy - Hoy Voy Por Ti', 'Hoy Voy Por Ti', 'Convoy'],
            ['Convoy', 'Un título - Con guion', 'Un título - Con guion', 'Convoy'],
          ]) {
            current = { artist, title };
            await page.clock.fastForward(30000);
            await page.waitForFunction(title => document.querySelector('[data-radio-title]').textContent === title, shownTitle);
            const expected = `${shownArtist ? shownArtist + ' - ' : ''}Borrachos y Bolingas Vol. 1 ∙ 2000`;
            assert.equal(await page.locator('[data-radio-artist]').textContent(), expected);
          }
          // Una publicación mientras suena no destruye el reproductor.
          await page.evaluate(() => { window.CRVRadioCanReload = () => false; });
          revision = 'new';
          await page.clock.fastForward(60000);
          await page.waitForFunction(() => document.querySelector('[data-radio-title]').textContent === 'Un título - Con guion');
          assert.equal(await page.locator('meta[name="crv-page-version"]').getAttribute('content'), 'old');
          await page.evaluate(() => { window.CRVRadioCanReload = () => true; });
          const navigation = page.waitForEvent('load');
          await page.clock.fastForward(5000);
          await navigation;
          assert.equal(await page.locator('meta[name="crv-page-version"]').getAttribute('content'), 'new');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
