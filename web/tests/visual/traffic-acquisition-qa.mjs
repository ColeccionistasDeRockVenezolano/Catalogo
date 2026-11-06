// Recorrido real de campañas; solo staging, con limpieza de datos sintéticos.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { parse } from 'dotenv';
import { prepararFixtures, limpiarFixtures } from '../../../scripts/checks/lib/fixtures.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const env = parse(await readFile(path.join(os.homedir(), 'apps/crv-staging/staging.env'), 'utf8'));
const db = new pg.Client({ connectionString: env.DATABASE_URL }); await db.connect();
if (!(await db.query('SELECT current_database() AS name')).rows[0].name.includes('staging')) throw Error('Solo staging');
const base = process.env.CRV_QA_BASE || 'http://127.0.0.1:3141';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Solo servidores locales de ensayo');
const out = process.env.CRV_QA_OUTPUT || path.join(os.homedir(), 'crv-staging/reports/traffic-attribution-2026-11-04'); await mkdir(out, { recursive: true });
const review = process.env.CRV_QA_REVIEW || path.join(root, '.impeccable/review'); await mkdir(review, { recursive: true });
const stamp = Date.now().toString(36);
const code = 'qa-rock-' + stamp;
const ips = ['203.0.113.240', '203.0.113.241', '203.0.113.242'];
const days = new Set();
const checks = [];
const errors = [];
const ok = (name) => { checks.push(name); console.log('OK', name); };
const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const oldTraffic = (await db.query("SELECT * FROM auth.traffic_daily WHERE project_id=1 AND country='aq'")).rows;
let browser;
let panel;
let linkId;
async function screenshot(page, name) {
  if (name === 'desktop' || name === 'mobile') await page.evaluate(() => {
    document.querySelectorAll('dialog[open], dialog[open] .modal__body, dialog[open] .modal__panel').forEach(element => { element.scrollTop = 0; });
  });
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: false }); await copyFile(path.join(out, name + '.png'), path.join(review, name + '.png'));
}
async function openMetrics(page) {
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-open="metrics-form"]').click();
  try { await expect(page.locator('[data-acquisition-panel]')).toBeVisible(); }
  catch (error) {
    console.log('diagnóstico panel', await page.locator('[data-metrics-root]').innerText(),
      await page.evaluate(() => ({ module: typeof window.CRVAcquisitionPanel, scripts: Array.from(document.scripts).map(script => script.src).filter(src => /acquisition|metrics/.test(src)) })));
    throw error;
  }
}
function contextOptions(ip, width = 1440) { return { viewport: { width, height: width < 500 ? 844 : 1000 }, userAgent: ua, locale: 'es-VE',
  extraHTTPHeaders: { 'cf-connecting-ip': ip, 'x-forwarded-for': ip, 'cf-ipcountry': 'AQ' } }; }
async function eventually(check) { await expect.poll(check, { timeout: 15000, intervals: [200, 500, 1000] }).toBe(true); }
try {
  const readyBy = Date.now() + 30000;
  while (true) {
    const response = await fetch(base + '/api/auth/me').catch(() => null);
    if (response && response.status === 401) break;
    if (Date.now() > readyBy) throw Error('La API de staging no está lista');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  prepararFixtures();
  browser = await chromium.launch({ headless: true });
  panel = await browser.newContext(contextOptions(ips[0]));
  panel.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const login = await panel.request.post(base + '/api/auth/login', { data: { username: 'fase1-admin', password: 'Fase1Admin2026' } });
  expect(login.status()).toBe(200); ok('Sesión de administración válida');
  const page = await panel.newPage(); await openMetrics(page); ok('Panel de procedencia accesible desde Métricas');
  const acquisition = page.locator('[data-acquisition-panel]');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click();
  await acquisition.getByLabel('Nombre del enlace', { exact: true }).fill('Prueba QA · WhatsApp rock');
  await acquisition.getByLabel('Código único', { exact: true }).fill(code);
  await acquisition.getByLabel('Fuente: whatsapp, instagram…', { exact: true }).fill('whatsapp');
  await acquisition.getByLabel('Medio: social, grupo, qr…', { exact: true }).fill('grupo');
  await acquisition.getByLabel('Campaña (opcional)', { exact: true }).fill('qa-' + stamp);
  await expect(acquisition.locator('output')).toContainText('?ref=' + code); ok('Vista previa del enlace actualizada');
  await acquisition.getByRole('button', { name: 'Crear enlace', exact: true }).click();
  await expect(acquisition.getByRole('status')).toContainText('Enlace creado');
  linkId = (await db.query('SELECT id FROM auth.traffic_links WHERE code=$1', [code])).rows[0].id; ok('Creación persistida en PostgreSQL');
  const link = acquisition.locator('.acquisition-link-list > li').filter({ hasText: 'Prueba QA · WhatsApp rock' });
  await link.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(acquisition.getByRole('status')).toContainText(/copiado|seleccionado/); ok('Copiar enlace con alternativa accesible');
  await link.getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(link).toHaveCount(0);
  await acquisition.getByLabel('Mostrar archivados').check();
  await expect(link).toContainText('Archivado');
  await link.getByRole('button', { name: 'Restaurar', exact: true }).click(); await expect(link).not.toContainText('Archivado'); ok('Archivo y restauración conservan el mismo código');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click();
  for (const [label, value] of [['Nombre del enlace', 'Duplicado QA'], ['Código único', code], ['Fuente: whatsapp, instagram…', 'facebook']]) await acquisition.getByLabel(label, { exact: true }).fill(value);
  await acquisition.getByRole('button', { name: 'Crear enlace', exact: true }).click();
  await expect(acquisition.getByRole('alert')).toContainText('ya existe'); ok('Error visible al intentar duplicar un código');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click();

  // Navegador sintético coherente para probar la rama probable; otro conserva webdriver=true.
  const visitor = await browser.newContext(contextOptions(ips[1]));
  await visitor.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const visit = await visitor.newPage(); visit.on('pageerror', error => errors.push(error.message));
  await visit.goto(base + '/?ref=' + code + '&utm_source=contradiccion', { waitUntil: 'domcontentloaded' });
  await eventually(async () => (await db.query("SELECT count(*)::int n FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1 AND dimensions->>'category'='human' AND js_visitors>0", [code])).rows[0].n > 0);
  ok('El enlace prevalece sobre UTM contradictorias y registra JS');
  const radio = visit.locator('[data-radio-sync]');
  if (await radio.count()) {
    await radio.evaluate(element => { element.disabled = false; }); await radio.click();
    await eventually(async () => (await db.query("SELECT coalesce(sum(radio),0)::int n FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1", [code])).rows[0].n === 1);
    ok('Clic de radio atribuido sin inventar tiempo de escucha');
  }
  await visit.locator('a[href="/colaborar"]').first().click(); await expect(visit).toHaveURL(/\/colaborar/);
  await eventually(async () => (await db.query("SELECT coalesce(sum(collaborate),0)::int n FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1", [code])).rows[0].n === 1); ok('Clic en colaborar conserva la primera campaña al navegar');
  await visit.reload({ waitUntil: 'domcontentloaded' });
  await eventually(async () => (await db.query("SELECT coalesce(sum(pages),0)::int n FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1 AND dimensions->>'category'='human'", [code])).rows[0].n >= 3);
  const measured = (await db.query("SELECT sum(visitors)::int visitors FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1 AND dimensions->>'category'='human'", [code])).rows[0];
  expect(measured.visitors).toBe(1); ok('Recargas y navegación aumentan páginas sin duplicar visitante/día');
  const bot = await browser.newContext(contextOptions(ips[2]));
  await bot.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => true }));
  const botPage = await bot.newPage();
  await botPage.goto(base + '/?utm_source=qa-automation&utm_campaign=qa-' + stamp, { waitUntil: 'domcontentloaded' });
  await eventually(async () => (await db.query("SELECT count(*)::int n FROM auth.traffic_acquisition_daily WHERE dimensions->>'source'='qa-automation' AND dimensions->>'category'='suspicious' AND js_visitors>0")).rows[0].n > 0); ok('Webdriver se clasifica como sospechoso');
  await bot.close(); await visitor.close();

  await acquisition.getByRole('button', { name: 'Descargar CSV' }).scrollIntoViewIfNeeded();
  await page.locator('[data-metrics-root] .metrics__filters button').filter({ hasText: 'Actualizar' }).click();
  await expect(acquisition.getByLabel('Buscar fuente o campaña')).toBeVisible();
  await acquisition.getByLabel('Buscar fuente o campaña').fill('qa-' + stamp);
  await expect(acquisition.locator('tbody')).toContainText('whatsapp'); ok('Búsqueda filtra fuentes y campañas');
  await acquisition.getByLabel('Agrupar por').selectOption('ref'); await expect(acquisition.locator('tbody')).toContainText('Prueba QA · WhatsApp rock'); ok('Agrupación por enlaces muestra su nombre y código');
  await acquisition.getByLabel('Agrupar por').selectOption('landing'); await expect(acquisition.locator('tbody')).toContainText('Portada'); ok('La página de entrada conserva la portada');
  await acquisition.getByLabel('Agrupar por').selectOption('country'); await expect(acquisition.locator('tbody')).toContainText(/Antártida/); ok('País independiente de la fuente');
  const downloadPromise = page.waitForEvent('download'); await acquisition.getByRole('button', { name: 'Descargar CSV' }).click();
  const download = await downloadPromise; await download.saveAs(path.join(out, 'procedencia-qa.csv')); ok('Exportación CSV del filtro actual');
  await acquisition.getByLabel('Agrupar por').selectOption('source');
  for (const days of ['7 días', '90 días']) {
    await page.locator('.metrics__filters').getByRole('radio', { name: days, exact: true }).click();
    await expect(page.locator('[data-metrics-root]')).not.toHaveAttribute('aria-busy');
    await expect(acquisition.locator('tbody')).toContainText('whatsapp');
  } ok('Periodos de 7 y 90 días conservan filtros y datos');
  await acquisition.scrollIntoViewIfNeeded(); await screenshot(page, 'desktop');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click();
  await acquisition.locator('.acquisition-create').scrollIntoViewIfNeeded(); await screenshot(page, 'desktop-links');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await acquisition.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await acquisition.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(391);
  await screenshot(page, 'mobile'); ok('Móvil de 390 px sin desbordamiento de página ni panel');
  await acquisition.getByText('Crear enlace de campaña', { exact: true }).click(); await acquisition.locator('.acquisition-create').scrollIntoViewIfNeeded();
  await screenshot(page, 'mobile-links'); ok('Formulario y enlaces operables en móvil');
  await acquisition.getByRole('button', { name: 'Crear enlace', exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, 'mobile-links-bottom');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/admin?lang=en', { waitUntil: 'domcontentloaded' }); await page.locator('[data-open="metrics-form"]').click();
  await expect(page.getByRole('heading', { name: 'Where visitors come from' })).toBeVisible();
  await expect(page.getByText('Create campaign link', { exact: true })).toBeVisible(); ok('Interfaz y controles en inglés');
  const anon = await browser.newContext(); expect((await anon.request.get(base + '/api/community/admin/panel/metrics/links')).status()).toBe(401); await anon.close(); ok('Campañas inaccesibles sin sesión');
  expect(errors).toEqual([]); ok('Navegación sin errores JavaScript');
} finally {
  if (browser) await browser.close();
  // Retirar solo el tráfico sintético identificado por IP o campaña de esta corrida.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); days.add(today);
  for (const day of days) {
    const visitors = ips.map(ip => createHmac('sha256', env.CRV_VISITS_SECRET || env.CRV_CHAT_SECRET).update(`visit:1:${day}:${ip}`).digest('hex').slice(0, 32));
    for (const tableName of ['traffic_acquisition_receipts', 'traffic_acquisition_visitors', 'project_visits']) {
      const removed = await db.query(`DELETE FROM auth.${tableName} WHERE project_id=1 AND day=$1 AND visitor=ANY($2) RETURNING *`, [day, visitors]);
      if (tableName === 'project_visits') for (const row of removed.rows) await db.query('UPDATE auth.project_visit_stats SET visits=greatest(0,visits-1) WHERE project_id=1 AND country=$1', [row.country]);
    }
    await db.query('DELETE FROM auth.traffic_visitors WHERE project_key=1 AND day=$1 AND visitor=ANY($2)', [day, visitors]);
  }
  await db.query("DELETE FROM auth.traffic_acquisition_daily WHERE dimensions->>'ref'=$1 OR dimensions->>'campaign'=$2", [code, 'qa-' + stamp]);
  if (linkId) await db.query('DELETE FROM auth.traffic_links WHERE id=$1', [linkId]);
  await db.query("DELETE FROM auth.traffic_daily WHERE project_id=1 AND country='aq'");
  for (const row of oldTraffic) {
    const keys = Object.keys(row); await db.query(`INSERT INTO auth.traffic_daily(${keys.join(',')}) VALUES(${keys.map((_, index) => '$' + (index + 1)).join(',')})`, Object.values(row));
  }
  await db.query("DELETE FROM auth.project_visit_stats WHERE project_id=1 AND country='aq' AND visits=0");
  limpiarFixtures(); await db.end();
  await writeFile(path.join(out, 'browser-report.json'), JSON.stringify({ at: new Date().toISOString(), base, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
}
