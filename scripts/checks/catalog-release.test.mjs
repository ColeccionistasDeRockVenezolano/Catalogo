/* global document, window -- las funciones de evaluate corren en el navegador */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, devices } from 'playwright';
import { landingAssets } from '../../web/landing-assets.mjs';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);

test('dos builds reales de Vite: conserva hashes, módulos anteriores y una sola recarga segura', async t => {
  const root = mkdtempSync(join(tmpdir(), 'crv-vite-update-'));
  let browser, server;
  try {
    const staleBuild = fileURLToPath(new URL('../../web/src/lib/staleBuild.ts', import.meta.url));
    writeFileSync(join(root, 'index.html'), '<html><head><script type="module" src="/main.js"></script></head><body><main id="root"></main></body></html>');
    async function compile(edition) {
      writeFileSync(join(root, 'main.js'), `import { reloadForNewBuild } from ${JSON.stringify(staleBuild)};
        window.addEventListener('vite:preloadError', event => { ${edition === 'A' ? 'window.location.reload();' : 'if (reloadForNewBuild()) event.preventDefault();'} });
        document.getElementById('root').textContent = '${edition}';
        window.loadLazy = () => import('./lazy.js');`);
      writeFileSync(join(root, 'lazy.js'), `export const edition = '${edition}';`);
      const output = join(root, edition);
      await build({ root, configFile: false, logLevel: 'error', base: '/crv/', build: { outDir: output, copyPublicDir: false } });
      mkdirSync(join(output, 'landing'));
      cpSync(new URL('../../web/public/landing/release-update.js', import.meta.url), join(output, 'landing/release-update.js'));
      const html = readFileSync(join(output, 'index.html'), 'utf8');
      return { output, publication: landingAssets(join(output, 'landing')).prepareCatalogHtml(html, '/crv') };
    }
    const a = await compile('A');
    const b = await compile('B');
    cpSync(join(a.output, 'assets'), join(b.output, 'assets'), { recursive: true, force: false });
    assert.notEqual(a.publication.version, b.publication.version);
    let live = a;
    let headRequests = 0;
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = join(live.output, pathname.replace(/^\/crv\//, ''));
      if (pathname.includes('/assets/') || pathname.includes('/landing/')) {
        if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('content-type', 'application/javascript');
        res.end(readFileSync(file));
      } else {
        if (req.method === 'HEAD') headRequests += 1;
        res.setHeader('content-type', 'text/html');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('X-CRV-Page-Version', live.publication.version);
        res.end(req.method === 'HEAD' ? '' : live.publication.html);
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    for (const [name, options] of [['escritorio', {}], ['iPad', devices['iPad Pro 11']], ['Android', devices['Pixel 7']]]) {
      await t.test(name, async () => {
        live = a;
        const context = await browser.newContext(options);
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.clock.install();
          const url = `http://127.0.0.1:${server.address().port}/crv/artistas/123?tipo=ep&tipo=remix`;
          await page.goto(url);
          await page.waitForFunction(() => document.getElementById('root').textContent === 'A');
          const viteUrls = await page.locator('script[type="module"]').evaluateAll(scripts => scripts.map(script => script.src));
          assert.ok(viteUrls.every(url => /\/assets\/[^?]+\.js$/.test(url)));
          // Un iframe abierto impide interrumpir música del catálogo.
          await page.evaluate(() => { const player = document.createElement('div'); player.className = 'catalog-video-player'; player.innerHTML = '<iframe></iframe>'; document.body.append(player); });
          live = b;
          const before = headRequests;
          const checked = page.waitForResponse(response => response.request().method() === 'HEAD' && response.headers()['x-crv-page-version'] === b.publication.version);
          await page.clock.fastForward(60000);
          await checked;
          assert.ok(headRequests > before);
          assert.equal(await page.locator('#root').textContent(), 'A');
          // La pestaña antigua todavía puede importar su módulo A tras publicar B.
          assert.equal(await page.evaluate(async () => (await window.loadLazy()).edition), 'A');
          // El aviso de Vite utiliza el mismo coordinador y respeta el bloqueo.
          assert.equal(await page.evaluate(() => { const event = new Event('vite:preloadError', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
          assert.equal(await page.locator('#root').textContent(), 'A');
          const loaded = page.waitForEvent('load');
          await page.locator('.catalog-video-player').evaluate(player => player.remove());
          await page.clock.fastForward(5000);
          await loaded;
          await page.waitForFunction(() => document.getElementById('root').textContent === 'B');
          assert.equal(page.url(), url);
          assert.equal(await page.evaluate(async () => (await window.loadLazy()).edition), 'B');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
