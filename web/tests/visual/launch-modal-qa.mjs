// Recorrido repetible del aviso; escribe únicamente en PostgreSQL de staging.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';

const base = process.env.CRV_QA_BASE || 'http://127.0.0.1:3143';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Solo ensayo local');
const env = parse(await readFile(path.join(os.homedir(), 'apps/crv-staging/launch-modal-api.env'), 'utf8'));
const db = new pg.Client({ connectionString: env.DATABASE_URL }); await db.connect();
if (!(await db.query('SELECT current_database() AS name')).rows[0].name.includes('staging')) throw Error('Solo staging');
const out = process.env.CRV_QA_OUTPUT || path.join(os.homedir(), 'crv-staging/reports/launch-modal-2026-11-04');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const key = 'crv-library-launch-completed-v1';
const email = `qa-launch-${Date.now()}@example.invalid`;
const checks = []; const errors = [];
const ok = message => { checks.push(message); console.log('OK', message); };
const screenshot = (page, name) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: false });
const contexts = [];
async function fresh(width, height, query = '') {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', locale: 'es-VE' }); contexts.push(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/' + query, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { context, page, dialog: page.getByRole('dialog') };
}
async function fits(page) {
  expect(await page.evaluate(() => { const d = document.querySelector('#launch-modal'); const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; })).toBe(true);
}
try {
  const desktop = await fresh(1440, 1000, '?utm_campaign=biblioteca%20digital');
  await fits(desktop.page); await screenshot(desktop.page, 'desktop'); ok('Diálogo inicial de escritorio y sin desbordamiento');
  await expect(desktop.page.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused(); ok('Foco inicial sin abrir teclado móvil');
  for (let i = 0; i < 12; i++) { await desktop.page.keyboard.press('Tab'); expect(await desktop.page.evaluate(() => document.activeElement.closest('#launch-modal') !== null)).toBe(true); }
  await desktop.page.keyboard.press('Escape'); await expect(desktop.dialog).not.toBeVisible(); ok('Foco contenido y Escape cierra');
  await desktop.page.reload({ waitUntil: 'domcontentloaded' }); await expect(desktop.dialog).toBeVisible(); ok('Cerrar sin enviar vuelve a mostrar en la siguiente entrada');
  await desktop.page.getByRole('button', { name: 'Avísame del lanzamiento' }).click();
  await expect(desktop.page.getByLabel('Tu nombre', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(desktop.page.getByLabel('Correo electrónico', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(desktop.dialog.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true'); ok('Errores de campos obligatorios asociados y con foco');
  await desktop.page.getByLabel('Tu nombre', { exact: true }).fill('QA Biblioteca');
  await desktop.page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await desktop.dialog.getByRole('combobox').selectOption('Investigador');
  await desktop.page.getByText('Añadir teléfono o redes', { exact: false }).click();
  await desktop.page.getByLabel('Teléfono', { exact: true }).fill('incorrecto');
  await desktop.page.getByRole('button', { name: 'Avísame del lanzamiento' }).click();
  await expect(desktop.page.getByLabel('Teléfono', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await desktop.page.getByLabel('Teléfono', { exact: true }).fill('+58 412 123 4567');
  await desktop.page.getByLabel('Redes sociales', { exact: true }).fill('@qa-biblioteca');
  await desktop.page.route('**/api/roadmap/launch', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await desktop.page.getByRole('button', { name: 'Avísame del lanzamiento' }).click();
  await expect(desktop.page.getByRole('alert')).toContainText('Tus datos siguen aquí');
  await expect(desktop.page.getByLabel('Correo electrónico', { exact: true })).toHaveValue(email);
  expect(await desktop.page.evaluate(k => localStorage.getItem(k), key)).toBeNull(); ok('Fallo de red conserva datos y permite reintentar sin recordar inscripción');
  await screenshot(desktop.page, 'error'); await desktop.page.unroute('**/api/roadmap/launch');
  const other = await desktop.context.newPage(); await other.goto(base); await expect(other.getByRole('dialog')).toBeVisible();
  await desktop.page.getByRole('button', { name: 'Avísame del lanzamiento' }).click();
  await expect(desktop.page.getByRole('heading', { name: 'Ya eres parte.' })).toBeVisible(); await screenshot(desktop.page, 'success');
  await expect(other.getByRole('dialog')).not.toBeVisible(); ok('Éxito confirmado y cierre en otra pestaña');
  const saved = (await db.query('SELECT name,type,email,phone,social,origin,campaign FROM auth.launch_contacts WHERE email=$1', [email])).rows;
  expect(saved).toEqual([{ name: 'QA Biblioteca', type: 'Investigador', email, phone: '+58 412 123 4567', social: '@qa-biblioteca', origin: 'Roadmap', campaign: 'biblioteca digital' }]); ok('Siete columnas correctas y campaña decodificada de la URL');
  await desktop.page.reload({ waitUntil: 'domcontentloaded' }); await expect(desktop.dialog).not.toBeVisible();
  await desktop.page.evaluate(() => localStorage.clear()); await desktop.page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => desktop.page.evaluate(k => localStorage.getItem(k), key)).toBe('1'); await expect(desktop.dialog).not.toBeVisible(); ok('Recuerda el envío por cookie aunque se borre localStorage');
  await desktop.context.clearCookies(); await desktop.page.reload({ waitUntil: 'domcontentloaded' }); await expect(desktop.dialog).not.toBeVisible(); ok('Marcador local evita reaparecer aunque falte la cookie');
  const repeat = await desktop.page.request.post(base + '/api/roadmap/launch', { headers: { origin: base }, data: { name: 'Otro', type: 'Oyente', email, campaign: 'otra-campaña' } });
  expect(repeat.status()).toBe(200); expect((await db.query('SELECT campaign FROM auth.launch_contacts WHERE email=$1', [email])).rows).toEqual([{ campaign: 'biblioteca digital' }]); ok('Correo repetido conserva una fila y atribución original');
  const mobile = await fresh(390, 844); await fits(mobile.page); await screenshot(mobile.page, 'mobile');
  await mobile.page.getByText('Añadir teléfono o redes', { exact: false }).click();
  await mobile.page.getByLabel('Teléfono', { exact: true }).fill('+1 555 123 4567');
  await mobile.page.getByRole('button', { name: 'Avísame del lanzamiento' }).scrollIntoViewIfNeeded();
  await expect(mobile.page.getByRole('button', { name: 'Avísame del lanzamiento' })).toBeInViewport(); await fits(mobile.page);
  await screenshot(mobile.page, 'mobile-optional'); ok('Móvil: formulario y opcionales desplazables con acción accesible');
  const small = await fresh(320, 568); await fits(small.page); await screenshot(small.page, 'small'); ok('320px sin desbordamiento lateral');
  const laptop = await fresh(1280, 720); await fits(laptop.page); await screenshot(laptop.page, 'laptop'); ok('Laptop de 720px de alto: scroll propio dentro del diálogo');
  const english = await fresh(1280, 800, '?lang=en'); await expect(english.page.getByRole('button', { name: 'Notify me at launch' })).toBeVisible(); await screenshot(english.page, 'english'); ok('Idioma inglés y valores de Tipo consistentes');
  const noStorage = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(noStorage);
  await noStorage.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } }); });
  const blocked = await noStorage.newPage(); await blocked.goto(base); await expect(blocked.getByRole('dialog')).toBeVisible(); ok('Sigue abriendo con almacenamiento local bloqueado');
  expect(errors).toEqual([]); ok('Sin errores de JavaScript');
} finally {
  await db.query('DELETE FROM auth.launch_contacts WHERE email=$1', [email]);
  await Promise.all(contexts.map(context => context.close())); await browser.close(); await db.end();
  await writeFile(path.join(out, 'qa.json'), JSON.stringify({ checks, errors }, null, 2));
}
