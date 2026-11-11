// Comprueba transporte real de mediciones con el cliente servido y YouTube.
// node scripts/checks/radio-medicion-dominio.mjs [--base=http://127.0.0.1:3140] [--salida=directorio]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
const option = (name, fallback = '') => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = option('base', 'http://127.0.0.1:3140');
const output = option('salida');
const browser = await chromium.launch();
const received = [], errors = [];
let timeout;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  let resolve;
  const twoBatches = new Promise(done => { resolve = done; });
  page.on('response', async response => {
    if (!response.url().endsWith('/api/radio/diagnostic')) return;
    let body;
    try { body = response.request().postDataJSON(); } catch { return; }
    if (body?.kind !== 'playback_quality') return;
    received.push({ status: response.status(), reportId: body.reportId, device: body.device, script: body.script,
      measurement: body.measurement, hidden: body.hidden });
    if (received.length >= 2) resolve();
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // Activación por teclado: esta prueba verifica el transporte del medidor.
  // Una superposición flotante no debe cambiar el objeto de la comprobación.
  const button = page.locator('[data-radio-sync]');
  await button.focus();
  await button.press('Enter');
  await Promise.race([twoBatches, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('No llegaron dos lotes en 80 s')), 80000);
  })]);
  for (const batch of received) {
    assert.equal(batch.status, 204);
    assert.ok(batch.script.includes('meter1'));
    assert.equal(batch.device.type, 'desktop');
    assert.ok(batch.measurement.pieces.length > 0);
    assert.ok(batch.measurement.pieces.some(piece => piece.sampleCount > 0));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, received }, null, 2));
} finally {
  clearTimeout(timeout);
  await browser.close();
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'dominio.json'), JSON.stringify({ base, received, errors }, null, 2) + '\n');
  }
}
