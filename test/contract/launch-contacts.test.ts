import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPgContainer, type PgContainer } from '../support/pg-container.js';
import { getPool, closeDb } from '../../src/db/client.js';
import { resetEnvCache } from '../../src/config/env.js';
import { registerOperatorAuth } from '../../src/api/auth.js';
import { registerLaunchRoutes } from '../../src/api/routes/launch.js';
import { launchContactBody, saveLaunchContact, syncPendingLaunchContacts } from '../../src/landing/launch-contacts.js';

describe('aviso de lanzamiento: datos durables, permisos y envío a Sheets', () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let directory: string;
  let credentials: string;
  const payload = { name: 'Prueba Coleccionista', type: 'Coleccionista' as const, email: 'QA@example.invalid', phone: '+58 412 123 4567', social: '@prueba', campaign: 'biblioteca-2026' };
  const post = (data: unknown = payload, origin: string | undefined = 'http://localhost:5173', ip = '203.0.113.12') => app.inject({ method: 'POST', url: '/roadmap/launch',
    headers: { ...(origin ? { origin } : {}), 'x-forwarded-for': ip }, payload: data as Record<string, unknown> });
  beforeAll(async () => {
    container = await startPgContainer(); await closeDb();
    process.env['DATABASE_URL'] = container.databaseUrl;
    process.env['CRV_AUTH_BACKEND'] = 'postgres';
    delete process.env['CRV_LAUNCH_SHEET_CREDENTIALS']; resetEnvCache();
    await getPool().query(readFileSync('migrations/0112_unified_auth.up.sql', 'utf8'));
    await getPool().query(readFileSync('migrations/0127_launch_contacts.up.sql', 'utf8'));
    directory = await mkdtemp(join(tmpdir(), 'crv-launch-test-')); credentials = join(directory, 'account.json');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeFile(credentials, JSON.stringify({ client_email: 'test@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  });
  afterAll(async () => { vi.restoreAllMocks(); if (app) await app.close(); await closeDb(); if (container) await container.stop(); if (directory) await rm(directory, { recursive: true }); delete process.env['CRV_LAUNCH_SHEET_CREDENTIALS']; resetEnvCache(); });
  beforeEach(async () => {
    vi.restoreAllMocks(); delete process.env['CRV_LAUNCH_SHEET_CREDENTIALS']; resetEnvCache();
    if (app) await app.close();
    await getPool().query('TRUNCATE auth.launch_contacts');
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await registerOperatorAuth(app); await registerLaunchRoutes(app); await app.ready();
  });

  it('rechaza peticiones ajenas o sin Origin y no exige cuenta para el envío válido', async () => {
    expect((await post(payload, 'https://evil.example')).statusCode).toBe(403);
    expect((await post(payload, '')).statusCode).toBe(403);
    const response = await post(); expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ completed: true });
    expect(response.headers['cache-control']).toBe('no-store');
    const cookie = String(response.headers['set-cookie']); expect(cookie).toMatch(/HttpOnly; SameSite=Lax/);
    expect((await app.inject({ method: 'GET', url: '/roadmap/launch', headers: { cookie } })).json()).toEqual({ completed: true });
    expect((await app.inject({ method: 'GET', url: '/roadmap/launch' })).json()).toEqual({ completed: false });
    expect((await app.inject({ method: 'GET', url: '/roadmap/launch', headers: { cookie: 'crv_launch=------------------------------------' } })).json()).toEqual({ completed: false });
    expect((await getPool().query('SELECT name,type,email,phone,social,origin,campaign,synced_at FROM auth.launch_contacts')).rows[0]).toMatchObject({
      name: payload.name, type: payload.type, email: 'qa@example.invalid', phone: payload.phone, social: payload.social, origin: 'Roadmap', campaign: payload.campaign, synced_at: null,
    });
  });
  it('deduplica el correo sin sustituir su campaña original ni datos ya guardados', async () => {
    const first = await saveLaunchContact(launchContactBody.parse(payload));
    expect(await saveLaunchContact(launchContactBody.parse({ ...payload, email: 'qa@example.invalid', campaign: 'otra' }))).toBe(first);
    expect((await getPool().query('SELECT campaign FROM auth.launch_contacts')).rows).toEqual([{ campaign: payload.campaign }]);
  });
  it('valida tipo, correo y teléfono; impide que el cliente cambie Origen', async () => {
    for (const input of [{ ...payload, origin: 'Otro' }, { ...payload, type: 'CRV' }, { ...payload, email: 'incorrecto' }, { ...payload, phone: 'abc' }, { ...payload, name: 'x' }, { ...payload, campaign: 'x'.repeat(201) }]) expect((await post(input)).statusCode).toBe(400);
    expect((await post({ ...payload, website: 'bot.example' }, undefined, '203.0.113.13')).statusCode).toBe(400);
    expect(launchContactBody.safeParse({ ...payload, phone: '......' }).success).toBe(false);
    expect((await getPool().query('SELECT 1 FROM auth.launch_contacts')).rowCount).toBe(0);
  });
  it('cuenta los intentos inválidos antes de validar y rechaza cuerpos grandes sin guardarlos', async () => {
    for (let i = 0; i < 6; i += 1) expect((await post({ ...payload, email: 'invalido' })).statusCode).toBe(400);
    const limited = await post();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('900');
    expect((await post({ ...payload, social: 'x'.repeat(5000) }, undefined, '203.0.113.14')).statusCode).toBe(413);
    expect((await getPool().query('SELECT 1 FROM auth.launch_contacts')).rowCount).toBe(0);
  });
  function google(options: { failAppend?: boolean; known?: boolean; drift?: boolean; cells?: Array<Record<string, unknown>>; failUpdate?: boolean } = {}) {
    process.env['CRV_LAUNCH_SHEET_CREDENTIALS'] = credentials; resetEnvCache();
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const parsed = new URL(url);
      if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'synthetic-test-token', expires_in: 3600 });
      if (parsed.searchParams.has('ranges')) {
        expect(parsed.searchParams.get('ranges')).toBe("'Contactos reales'!A2:G2");
        const values = options.cells ?? [payload.name,payload.type,'QA@example.invalid',payload.phone,payload.social,'Roadmap',payload.campaign]
          .map(value => ({ userEnteredValue: { stringValue: value }, formattedValue: value }));
        return Response.json({ sheets: [{ data: [{ rowData: [{ values }] }] }] });
      }
      if (parsed.searchParams.get('fields')) return Response.json({ sheets: [{ properties: { sheetId: 0, title: 'Contactos reales', gridProperties: { rowCount: 1000 } } }] });
      if (decodeURIComponent(parsed.pathname).includes('!A1:G1')) return Response.json({ values: [options.drift ? ['Nombre'] : ['Nombre','Tipo','Correo','Numero','Redes','Origen','UTM Campaign']] });
      if (decodeURIComponent(parsed.pathname).includes('!C2:C1000')) return Response.json({ values: options.known ? [['QA@example.invalid']] : [] });
      if (url.includes('/values:batchUpdate')) {
        expect(JSON.parse(String(init?.body)).valueInputOption).toBe('RAW');
        if (options.failUpdate) return Response.json({ error: 'unavailable' }, { status: 503 });
        return Response.json({ totalUpdatedCells: JSON.parse(String(init?.body)).data.length });
      }
      if (url.includes(':append')) {
        expect(parsed.searchParams.get('valueInputOption')).toBe('RAW');
        expect(JSON.parse(String(init?.body)).values).toEqual([['Prueba Coleccionista','Coleccionista','qa@example.invalid','+58 412 123 4567','@prueba','Roadmap','biblioteca-2026']]);
        if (options.failAppend) throw new Error('Timeout after Google may have saved');
        return Response.json({ updates: { updatedRows: 1 } });
      }
      throw new Error('Unexpected Google request');
    });
  }
  it('escribe las siete columnas como texto RAW y marca la entrega', async () => {
    await saveLaunchContact(launchContactBody.parse(payload)); const mock = google();
    await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes(':append'))).toBe(true);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).not.toBeNull();
  });
  it('conserva la inscripción ante un fallo y recupera un append ambiguo sin duplicar', async () => {
    await saveLaunchContact(launchContactBody.parse(payload)); google({ failAppend: true });
    await syncPendingLaunchContacts();
    expect((await getPool().query('SELECT synced_at,attempts,next_attempt_at>now() AS waiting FROM auth.launch_contacts')).rows[0]).toEqual({ synced_at: null, attempts: 1, waiting: true });
    vi.restoreAllMocks(); await getPool().query('UPDATE auth.launch_contacts SET next_attempt_at=now()');
    const mock = google({ known: true }); await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).not.toBeNull();
  });
  it('completa los datos adicionales de un correo existente sin sustituir campos ni duplicarlo', async () => {
    await saveLaunchContact(launchContactBody.parse(payload));
    const cell = (value: string) => ({ userEnteredValue: { stringValue: value }, formattedValue: value });
    const mock = google({ known: true, cells: [cell('Nombre previo'),cell(''),cell('QA@example.invalid'),{},{},cell('Otro formulario'),cell('primera-campaña')] });
    await syncPendingLaunchContacts();
    const update = mock.mock.calls.find(([url]) => String(url).includes('/values:batchUpdate'));
    expect(update).toBeDefined();
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({ valueInputOption: 'RAW', data: [
      { range: "'Contactos reales'!B2", values: [[payload.type]] },
      { range: "'Contactos reales'!D2", values: [[payload.phone]] },
      { range: "'Contactos reales'!E2", values: [[payload.social]] },
    ] });
    expect(mock.mock.calls.some(([url]) => String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).not.toBeNull();
  });
  it('conserva fórmulas visualmente vacías, ceros y booleanos en las celdas existentes', async () => {
    await saveLaunchContact(launchContactBody.parse(payload));
    const cell = (value: string) => ({ userEnteredValue: { stringValue: value }, formattedValue: value });
    const mock = google({ known: true, cells: [cell(payload.name),cell(payload.type),cell('QA@example.invalid'),
      { userEnteredValue: { numberValue: 0 }, formattedValue: '0' },
      { userEnteredValue: { formulaValue: '=""' }, formattedValue: '' },
      { userEnteredValue: { boolValue: false }, formattedValue: 'FALSE' },cell(payload.campaign)] });
    await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/values:batchUpdate') || String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).not.toBeNull();
  });
  it('mantiene la entrega pendiente si falla completar datos y permite reintentar sin duplicar', async () => {
    await saveLaunchContact(launchContactBody.parse(payload));
    google({ known: true, cells: [{},{},{ userEnteredValue: { stringValue: 'qa@example.invalid' }, formattedValue: 'qa@example.invalid' }], failUpdate: true });
    await syncPendingLaunchContacts();
    expect((await getPool().query('SELECT synced_at,attempts FROM auth.launch_contacts')).rows[0]).toEqual({ synced_at: null, attempts: 1 });
    vi.restoreAllMocks(); await getPool().query('UPDATE auth.launch_contacts SET next_attempt_at=now()');
    const mock = google({ known: true }); await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/values:batchUpdate') || String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at,attempts FROM auth.launch_contacts')).rows[0]).toMatchObject({ synced_at: expect.any(Date), attempts: 2 });
  });
  it('no modifica una fila cuyo correo cambió desde que se leyó el índice', async () => {
    await saveLaunchContact(launchContactBody.parse(payload));
    const mock = google({ known: true, cells: [{},{},{ userEnteredValue: { stringValue: 'otro@example.invalid' }, formattedValue: 'otro@example.invalid' }] });
    await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes('/values:batchUpdate') || String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).toBeNull();
  });
  it('no escribe sobre columnas distintas de las verificadas', async () => {
    await saveLaunchContact(launchContactBody.parse(payload)); const mock = google({ drift: true });
    await syncPendingLaunchContacts();
    expect(mock.mock.calls.some(([url]) => String(url).includes(':append'))).toBe(false);
    expect((await getPool().query('SELECT synced_at FROM auth.launch_contacts')).rows[0].synced_at).toBeNull();
  });
});
