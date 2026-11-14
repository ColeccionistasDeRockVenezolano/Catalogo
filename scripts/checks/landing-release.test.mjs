import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { runInNewContext } from 'node:vm';
import { landingAssets } from '../../web/landing-assets.mjs';
import { minifyRadioClient } from '../build-radio-client.mjs';

test('v= depende del contenido; cambia también con igual tamaño y mtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crv-assets-'));
  try {
    mkdirSync(join(dir, 'vendor'));
    writeFileSync(join(dir, 'radio.js'), 'AAAA');
    writeFileSync(join(dir, 'vendor/style.css'), 'body{}');
    writeFileSync(join(dir, 'release-update.js'), '// updater');
    const before = landingAssets(dir);
    const document = '<head></head><body><script src="/crv/landing/radio.js?v=manual&amp;lang=es#x"></script><script data-radio-client="/crv/landing/radio.js?v=old"></script><link href="/crv/landing/vendor/style.css"><img src="/crv/media/cover.jpg"><script src="https://youtube.com/embed/x"></script></body>';
    const first = before.prepareHtml(document, '/crv');
    assert.match(first.html, /radio\.js\?v=[a-f0-9]{20}&amp;lang=es#x/);
    assert.match(first.html, /data-radio-client="\/crv\/landing\/radio\.js\?v=[a-f0-9]{20}"/);
    assert.match(first.html, /vendor\/style\.css\?v=[a-f0-9]{20}/);
    assert.match(first.html, /release-update\.js\?v=[a-f0-9]{20}/);
    assert.ok(first.html.includes('src="/crv/media/cover.jpg"'));
    assert.ok(first.html.includes('src="https://youtube.com/embed/x"'));
    assert.equal(landingAssets(dir).version, before.version);
    writeFileSync(join(dir, 'radio.js'), 'BBBB');
    utimesSync(join(dir, 'radio.js'), new Date(0), new Date(0));
    const after = landingAssets(dir);
    assert.notEqual(after.version, before.version);
    assert.notEqual(after.prepareHtml(document, '/crv').html, first.html);
    assert.notEqual(after.pageVersion('<meta name="crv-template-version" content="aaa">'), after.pageVersion('<meta name="crv-template-version" content="bbb">'));
    const vite = '<html><head><script type="module" src="/crv/assets/index-AbC123.js"></script><link rel="stylesheet" href="/crv/assets/index-XyZ456.css"><link rel="modulepreload" href="/crv/assets/lazy-RsT789.js"></head><body></body></html>';
    const catalog = after.prepareCatalogHtml(vite, '/crv');
    assert.ok(catalog.html.includes('src="/crv/assets/index-AbC123.js"'));
    assert.ok(catalog.html.includes('href="/crv/assets/index-XyZ456.css"'));
    assert.ok(catalog.html.includes('href="/crv/assets/lazy-RsT789.js"'));
    assert.ok(catalog.html.indexOf('release-update.js') < catalog.html.indexOf('type="module"'));
    assert.notEqual(catalog.version, after.prepareCatalogHtml(vite.replace('AbC123', 'DeF456'), '/crv').version);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gateway real: GET, HEAD y respaldo sirven hashes y la misma versión bajo raíz y prefijo', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crv-gateway-assets-'));
  let upstreamOk = true;
  const html = '<!doctype html><html><head><meta name="crv-template-version" content="aaa"></head><body><script data-radio-client="/static/radio.js?v=old"></script></body></html>';
  const api = http.createServer((_req, res) => {
    res.writeHead(upstreamOk ? 200 : 503, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  try {
    mkdirSync(join(dir, 'landing'));
    writeFileSync(join(dir, 'index.html'), '<html><head><script type="module" src="/crv/assets/index-AbC123.js"></script></head><body></body></html>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/index-AbC123.js'), '// Vite module');
    writeFileSync(join(dir, 'landing/radio.js'), '// radio');
    writeFileSync(join(dir, 'landing/release-update.js'), '// updater');
    writeFileSync(join(dir, 'landing/roadmap-es.html'), '<html><head></head><body><script src="landing/radio.js"></script></body></html>');
    for (const prefix of ['', '/crv']) {
      // Puerto efímero reservado solo hasta que arranque el proceso del gateway.
      const reservation = http.createServer();
      await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
      const port = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      const child = spawn(process.execPath, ['web/server.mjs'], { env: {
        ...process.env, CRV_WEB_MODE: prefix ? 'catalog' : 'landing', CRV_PUBLIC_PATH: prefix,
        CRV_DEPLOYMENT: 'legacy', CRV_WEB_DIST: relative(resolve('web'), dir),
        CRV_WEB_PORT: String(port), CRV_API_PORT: String(api.address().port),
        CRV_RADIO_SOURCE: 'crv', CRV_WEB_TRUST_CF_HEADERS: 'false',
      }, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('gateway no arrancó')), 10000);
          child.stdout.on('data', chunk => { if (String(chunk).includes('CRV público local:')) { clearTimeout(timeout); resolve(); } });
          child.once('exit', code => { clearTimeout(timeout); reject(new Error(`gateway salió: ${code}`)); });
        });
        const url = `http://127.0.0.1:${port}${prefix}/${prefix ? 'roadmap' : ''}`;
        const get = await fetch(url);
        const body = await get.text();
        assert.equal(get.status, 200);
        const version = get.headers.get('x-crv-page-version');
        assert.match(version, /^[a-f0-9]{20}$/);
        assert.ok(body.includes(`name="crv-page-version" content="${version}"`));
        assert.match(body, /data-radio-client="[^" ]+radio\.js\?v=[a-f0-9]{20}"/);
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        assert.equal(head.headers.get('x-crv-page-version'), version);
        assert.equal(await head.text(), '');
        const updaterUrl = body.match(/src="([^"]+release-update\.js\?v=[a-f0-9]+)"/)[1];
        assert.equal((await fetch(new URL(updaterUrl, url))).status, 200);
        if (prefix) {
          const spa = await fetch(`http://127.0.0.1:${port}/crv/artistas/123?tab=discografia`);
          const spaBody = await spa.text();
          assert.equal(spa.status, 200);
          assert.equal(spa.headers.get('cache-control'), 'no-cache');
          assert.ok(spaBody.includes('src="/crv/assets/index-AbC123.js"'));
          assert.ok(!spaBody.includes('index-AbC123.js?v='));
          const spaVersion = spa.headers.get('x-crv-page-version');
          assert.ok(spaBody.includes(`name="crv-page-version" content="${spaVersion}"`));
          const spaHead = await fetch(`http://127.0.0.1:${port}/crv/discos/456`, { method: 'HEAD' });
          assert.equal(spaHead.headers.get('x-crv-page-version'), spaVersion);
          const asset = await fetch(`http://127.0.0.1:${port}/crv/assets/index-AbC123.js`);
          assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        }
        // Un documento sin copia previa puede caer al respaldo HTML del build.
        upstreamOk = false;
        const fallback = await fetch(`${url}?lang=es`, { headers: { cookie: 'fixture=private' } });
        const fallbackBody = await fallback.text();
        assert.equal(fallback.status, 200);
        assert.match(fallbackBody, /src="[^" ]+radio\.js\?v=[a-f0-9]{20}"/);
        assert.match(fallback.headers.get('x-crv-page-version'), /^[a-f0-9]{20}$/);
        upstreamOk = true;
      } finally {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill();
        await exited;
      }
    }
  } finally {
    await new Promise(resolve => api.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('el bundle publicado está generado con el código actual', async () => {
  assert.equal(readFileSync(new URL('../../web/public/landing/radio.js', import.meta.url), 'utf8'), await minifyRadioClient());
});

const updater = readFileSync(new URL('../../web/public/landing/release-update.js', import.meta.url), 'utf8');
function tab({ safe = true, status = 200, next = 'new', fail = false, holdMutation = false } = {}) {
  const events = {};
  const timers = [];
  let reloads = 0;
  const requests = [];
  let finishMutation;
  const window = {
    location: { href: 'https://crv.test/', reload() { reloads += 1; } },
    Event,
    dispatchEvent: () => true,
    CRVRadioCanReload: () => safe,
    setInterval(fn, ms) { timers.push({ fn, ms }); },
    setTimeout() {}, clearTimeout() {},
    addEventListener(key, fn) { events[key] = fn; },
    async fetch(url, options) {
      requests.push({ url, options });
      if (holdMutation && options.method === 'POST') return new Promise(resolve => { finishMutation = resolve; });
      if (fail) throw new Error('offline');
      return { ok: status === 200, headers: { get: () => next } };
    },
  };
  const document = {
    hidden: false,
    documentElement: { contains: () => true },
    querySelector: selector => selector.includes('meta[') ? ({ content: 'old' }) : null,
    querySelectorAll: () => [],
    addEventListener(key, fn) { events[key] = fn; },
  };
  runInNewContext(updater, { window, document });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { window, document, events, timers, requests, reloads: () => reloads, flush, finishMutation: () => finishMutation({ ok: true }) };
}

test('recarga sola tras una publicación y consulta sin caché; no se repite', async () => {
  const t = tab();
  t.events.pageshow({ persisted: true });
  await t.flush();
  assert.equal(t.reloads(), 1);
  assert.equal(t.requests[0].options.cache, 'no-store');
  assert.equal(t.requests[0].options.method, 'HEAD');
  t.timers.forEach(timer => timer.fn());
  assert.equal(t.reloads(), 1);
});

test('espera mientras suena la radio y actualiza después de la pausa', async () => {
  const t = tab({ safe: false });
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.window.CRVRadioCanReload = () => true;
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 1);
});

test('no pierde formularios ni recarga una pestaña oculta', async () => {
  const t = tab();
  const form = {};
  t.events.input({ target: { form, value: 'draft', defaultValue: '' } });
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.events.reset({ target: form });
  t.document.hidden = true;
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 0);
  t.document.hidden = false;
  t.events.visibilitychange();
  assert.equal(t.reloads(), 1);
});

test('Vite y la detección periódica comparten una sola recarga pendiente', async () => {
  const t = tab({ safe: false });
  assert.equal(t.window.CRVRequestBuildReload(), true);
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.window.CRVRadioCanReload = () => true;
  t.timers.find(timer => timer.ms === 5000).fn();
  t.window.CRVRequestBuildReload();
  assert.equal(t.reloads(), 1);
});

test('espera a los guardados por fetch y a los trabajos que cancelan la recarga', async () => {
  const t = tab({ holdMutation: true });
  const saving = t.window.fetch('/save', { method: 'POST' });
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.window.dispatchEvent = () => false;
  t.finishMutation();
  await saving;
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 0);
  t.window.dispatchEvent = () => true;
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 1);
});

test('protege campos fuera de form y players de YouTube o servicios externos', async () => {
  const t = tab();
  const field = { value: 'edición pendiente' };
  t.events.input({ target: field });
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.document.documentElement.contains = () => false;
  const original = t.document.querySelector;
  t.document.querySelector = selector => selector.includes('iframe') ? {} : original(selector);
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 0);
  t.document.querySelector = original;
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 1);
});

test('un mensaje enviado o una edición revertida dejan de bloquear la actualización', async () => {
  const t = tab();
  const field = { value: '', defaultValue: '' };
  t.events.focusin({ type: 'focusin', target: field });
  field.value = 'mensaje pendiente';
  t.events.input({ target: field });
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  field.value = '';
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 1);
});

test('respeta la ventana de recuperación de Vite para evitar bucles', async () => {
  const t = tab();
  t.window.sessionStorage = { getItem: () => String(Date.now()), setItem() {} };
  assert.equal(t.window.CRVRequestBuildReload(), false);
  t.events.pageshow();
  await t.flush();
  assert.equal(t.reloads(), 0);
  t.window.sessionStorage.getItem = () => '0';
  t.timers.find(timer => timer.ms === 5000).fn();
  assert.equal(t.reloads(), 1);
});

for (const options of [{ next: 'old' }, { fail: true }, { status: 503 }, { next: null }]) {
  test(`no recarga con versión igual, error o cabecera ausente: ${JSON.stringify(options)}`, async () => {
    const t = tab(options);
    t.events.pageshow();
    await t.flush();
    assert.equal(t.reloads(), 0);
  });
}
