import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRedirectServer } from '../../ops/www-redirect/server.mjs';

test('redirección fija preserva ruta y query sin confiar en Host ni URLs externas', async () => {
  const server = createRedirectServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [path, suffix] of [['/', '/'], ['/registro?token=abc&lang=en', '/registro?token=abc&lang=en'], ['//evil.example/a', '/'], ['https://evil.example/', '/']]) {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res); });
        req.on('error', reject); req.end();
      });
      assert.equal(result.statusCode, 308);
      assert.equal(result.headers.location, `https://coleccionistasderockvenezolano.com${suffix}`);
      assert.equal(result.headers['set-cookie'], undefined);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
