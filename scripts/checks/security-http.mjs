// Comprobaciones de bajo volumen para la portada. Ningún envío contiene datos válidos.
// node scripts/checks/security-http.mjs https://coleccionistasderockvenezolano.com
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3143');
const checks = [];
async function request(path, options = {}) {
  const transport = base.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({ hostname: base.hostname, port: base.port, path,
      method: options.method || 'GET', headers: { 'user-agent': 'CRV-authorized-security-review', ...options.headers } }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(20_000, () => req.destroy(new Error('Timeout')));
    req.on('error', reject); req.end(options.body);
  });
}
async function check(name, work) { await work(); checks.push(name); console.log('OK', name); }
await check('Cabeceras contra XSS, clickjacking, sniffing y downgrade HTTP', async () => {
  const r = await request('/'); assert.equal(r.status, 200);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.match(r.headers['content-security-policy'], /object-src 'none'/u);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/u);
  assert.doesNotMatch(r.headers['content-security-policy'], /script-src[^;]*'unsafe-(?:inline|eval)'/u);
  assert.match(r.headers['strict-transport-security'], /max-age=31536000/u);
});
for (const path of ['/.env', '/.git/config', '/package.json', '/server.mjs', '/landing/.env', '/landing/%2eenv', '/landing/%00.txt', '/landing/%2e%2e/.env', '/api/docs/json', '/api/artists']) {
  await check('Archivo o ruta no expuesto: ' + path, async () => {
    const r = await request(path); assert.ok([400, 403, 404].includes(r.status), String(r.status));
  });
}
for (const path of ['/api/community/admin/panel/users', '/api/%63ommunity/admin/panel/users']) {
  for (const method of ['GET', 'HEAD']) await check('Permiso anónimo ' + method + ' ' + path, async () => {
    const r = await request(path, { method }); assert.ok([401, 403, 404].includes(r.status), String(r.status));
  });
}
for (const origin of [undefined, 'null', 'https://evil.example']) {
  await check('Rechaza envío con Origin ' + String(origin), async () => {
    const r = await request('/api/roadmap/launch', { method: 'POST', headers: {
      'content-type': 'application/json', ...(origin ? { origin } : {}), 'x-forwarded-host': 'evil.example',
    }, body: '{}' }); assert.equal(r.status, 403);
  });
}
await check('CORS no permite leer desde un sitio ajeno', async () => {
  const r = await request('/api/roadmap/launch', { headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.match(r.headers['cache-control'], /no-store/u);
  assert.deepEqual(JSON.parse(r.body), { completed: false });
});
await check('Los redireccionamientos también entregan las cabeceras de seguridad', async () => {
  const r = await request('/admin'); assert.ok([302, 303].includes(r.status), String(r.status));
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['strict-transport-security'], /max-age=31536000/u);
});
if (['127.0.0.1', 'localhost'].includes(base.hostname)) await check('Un Host malformado no termina el gateway', async () => {
  const bad = await request('/', { headers: { host: '[invalid' } }); assert.equal(bad.status, 400);
  assert.equal((await request('/')).status, 200);
});
await check('Una cookie inventada no da permisos ni una inscripción', async () => {
  const r = await request('/api/roadmap/launch', { headers: { cookie: 'crv_launch=00000000-0000-0000-0000-000000000000; crv_session=inventada' } });
  assert.deepEqual(JSON.parse(r.body), { completed: false });
  assert.match(r.headers['cache-control'], /no-store/u);
});
await check('Rechaza un formulario incompleto', async () => {
  const r = await request('/api/roadmap/launch', { method: 'POST', headers: {
    origin: base.origin, 'content-type': 'application/json',
  }, body: '{}' }); assert.equal(r.status, 400);
  assert.doesNotMatch(r.body, /SELECT |INSERT |scrypt\$|DATABASE_URL|node_modules/u);
});
await check('Limita el tamaño del formulario antes de guardarlo', async () => {
  const r = await request('/api/roadmap/launch', { method: 'POST', headers: {
    origin: base.origin, 'content-type': 'application/json',
  }, body: JSON.stringify({ name: 'x'.repeat(5000) }) }); assert.equal(r.status, 413);
});
console.log(JSON.stringify({ base: base.origin, passed: checks.length, checks }, null, 2));
