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
    writeFileSync(join(dir, 'index.html'), '<html></html>');
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
function tab({ safe = true, status = 200, next = 'new', fail = false } = {}) {
  const events = {};
  const timers = [];
  let reloads = 0;
  const requests = [];
  const window = {
    location: { href: 'https://crv.test/', reload() { reloads += 1; } },
    CRVRadioCanReload: () => safe,
    setInterval(fn, ms) { timers.push({ fn, ms }); },
    setTimeout() {}, clearTimeout() {},
    addEventListener(key, fn) { events[key] = fn; },
    async fetch(url, options) {
      requests.push({ url, options });
      if (fail) throw new Error('offline');
      return { ok: status === 200, headers: { get: () => next } };
    },
  };
  const document = {
    hidden: false,
    documentElement: { contains: () => true },
    querySelector: () => ({ content: 'old' }),
    querySelectorAll: () => [],
    addEventListener(key, fn) { events[key] = fn; },
  };
  runInNewContext(updater, { window, document });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { window, document, events, timers, requests, reloads: () => reloads, flush };
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
  t.events.input({ target: { form } });
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

for (const options of [{ next: 'old' }, { fail: true }, { status: 503 }, { next: null }]) {
  test(`no recarga con versión igual, error o cabecera ausente: ${JSON.stringify(options)}`, async () => {
    const t = tab(options);
    t.events.pageshow();
    await t.flush();
    assert.equal(t.reloads(), 0);
  });
}
