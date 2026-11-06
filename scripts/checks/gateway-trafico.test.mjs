// Regresión HTTP del gateway con API simulada: no accede a PostgreSQL.
// node --test scripts/checks/gateway-trafico.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const gateway = process.env.CRV_GATEWAY_FILE || fileURLToPath(new URL('../../web/server.mjs', import.meta.url));
const pages = { colaborar: 'collaborate', login: 'login', registro: 'register', activar: 'activate' };

for (const prefix of ['', '/crv']) {
  test(`avisos de documentos públicos bajo ${prefix || '/'}`, { timeout: 15000 }, async (t) => {
    const reports = [];
    const api = http.createServer(async (req, res) => {
      if (req.url === '/traffic/page') {
        let body = '';
        for await (const chunk of req) body += chunk;
        reports.push(JSON.parse(body).page);
        res.writeHead(204).end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><head></head><body>Prueba</body></html>');
      }
    });
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => api.close(resolve)));
    const reservation = http.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const child = spawn(process.execPath, [gateway], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME,
        CRV_WEB_HOST: '127.0.0.1', CRV_WEB_PORT: String(port),
        CRV_API_PORT: String(api.address().port), CRV_PUBLIC_PATH: prefix || '/',
        CRV_WEB_MODE: prefix ? 'catalog' : 'landing', CRV_RADIO_SOURCE: 'crv',
        CRV_TRAFFIC_REPORT: '1', CRV_TRAFFIC_TOKEN: 'token-sintetico-de-prueba' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${base}${prefix}/api/health`); ready = true; break; }
      catch { await delay(25); }
    }
    assert.ok(ready, 'el gateway arranca');
    const expected = [];
    for (const [page, metric] of Object.entries(pages)) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${base}${prefix}/${page}?lang=es`, { method });
        assert.equal(response.status, 200);
        await response.text();
        expected.push(metric);
      }
      const redirect = await fetch(`${base}${prefix}/${page}/`, { redirect: 'manual' });
      assert.equal(redirect.status, 301);
      await redirect.text();
    }
    if (prefix) {
      const stripped = await fetch(`${base}/login`);
      assert.equal(stripped.status, 200);
      await stripped.text();
      expected.push('login');
    }
    const account = await fetch(`${base}${prefix}/account`);
    await account.text();
    for (let i = 0; i < 100 && reports.length < expected.length; i++) await delay(25);
    await delay(100);
    assert.deepEqual(reports, expected, 'cada documento público genera un aviso; los redirects y account no cuentan');
  });
}
