import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const DOMAIN = 'https://coleccionistasderockvenezolano.com';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const hits = { gtm: 0, gtag: 0, hotjar: 0, ga4collect: 0 };
  const cspErrors = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/gtm.js?id=GTM-KJ8VKCCX')) hits.gtm++;
    if (u.includes('/gtag/js?id=G-WNJ73ZPTXY')) hits.gtag++;
    if (u.includes('hotjar-6838865.js')) hits.hotjar++;
    if (u.includes('/g/collect') || u.includes('google-analytics.com')) hits.ga4collect++;
  });
  page.on('console', m => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
  });

  await page.goto(`${DOMAIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('crv-gtm'), null, { timeout: 15000 });
  await page.waitForTimeout(4000);

  assert.equal(await page.locator('#crv-hotjar-consent').count(), 0, 'quedó el banner de consentimiento');
  assert.equal(await page.locator('#crv-hotjar-settings').count(), 0, 'quedó el botón de privacidad');
  assert.equal(await page.evaluate(() => typeof window.hj), 'function', 'Hotjar no se inicializó');
  const hasGa = await page.evaluate(() => window.dataLayer.some(a => Array.isArray(a) || (a && a[0] === 'config')));
  assert.equal(hasGa, true, 'GA4 no encoló config');

  console.log('inicio', JSON.stringify(hits));
  assert.ok(hits.gtm >= 1, 'GTM no se cargó solo');
  assert.ok(hits.gtag >= 1, 'gtag.js no se cargó solo');
  assert.ok(hits.hotjar >= 1, 'Hotjar no se cargó solo');
  assert.deepEqual(cspErrors, [], `CSP bloqueó analítica: ${cspErrors.join(' | ')}`);

  await page.goto(`${DOMAIN}/colaborar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('crv-gtm'), null, { timeout: 15000 });
  assert.equal(await page.locator('#crv-hotjar-consent').count(), 0);

  await page.goto(`${DOMAIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#crv-gtm').count(), 0, 'login no debe cargar GTM');
  assert.equal(await page.evaluate(() => typeof window.hj), 'undefined', 'login no debe cargar Hotjar');

  console.log('PASS analítica automática: sin banner, GTM+GA4+Hotjar cargan solos en / y /colaborar, login excluido, CSP limpia');
} finally {
  await browser.close();
}
