import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startPgContainer, type PgContainer } from '../support/pg-container.js';
import { closeDb, getPool } from '../../src/db/client.js';
import { resetEnvCache } from '../../src/config/env.js';
import { registerOperatorAuth } from '../../src/api/auth.js';
import { registerAdminPanelRoutes } from '../../src/api/routes/admin-panel.js';
import { registerTrafficRoutes } from '../../src/api/routes/traffic.js';
import { registerRoadmapRoutes } from '../../src/api/routes/roadmap.js';
import { registerCommunityRoutes } from '../../src/api/routes/community.js';
import { hashAccessCode } from '../../src/api/community/validation.js';
import { acquisitionReport, createCampaignLink, flushAcquisitions, recordAcquisition, type AcquisitionInput } from '../../src/traffic/acquisition.js';
import { localDay } from '../../src/api/roadmap/visits.js';

describe('procedencia: PostgreSQL real, permisos y deduplicación', () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let project: number;
  let admin: { cookie: string; csrf: string };
  let community: { cookie: string; csrf: string };
  const pool = () => getPool();
  const path = '/community/admin/panel/metrics/links';
  const browserHeaders = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    origin: 'http://crv.test',
    'accept-language': 'es-VE', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', accept: 'application/json' };
  const input = (overrides: Partial<AcquisitionInput> = {}): AcquisitionInput => ({ projectId: project,
    ip: '203.0.113.11', country: 've', page: 'roadmap', kind: 'navigation',
    attribution: { source: 'instagram', campaign: 'lanzamiento' }, classification: { category: 'human', agent: '', reason: 'test' }, ...overrides });
  const report = () => acquisitionReport(project, localDay(), localDay());
  const write = (method: 'POST' | 'PATCH', url: string, session: { cookie: string; csrf: string }, payload: unknown) => app.inject({ method, url,
    headers: { cookie: session.cookie, 'x-crv-csrf': session.csrf }, payload: payload as Record<string, unknown> });

  beforeAll(async () => {
    container = await startPgContainer();
    await closeDb();
    process.env['DATABASE_URL'] = container.databaseUrl;
    process.env['CRV_AUTH_BACKEND'] = 'postgres'; process.env['CRV_HERRA_PROJECT_SLUG'] = 'acquisition-test';
    process.env['CRV_TRAFFIC_ENABLED'] = 'true'; process.env['CRV_TRAFFIC_TOKEN'] = 'test-internal-acquisition-token';
    // El endurecimiento CSRF exige Origin en las escrituras: el navegador de prueba lo envía.
    process.env['CRV_ALLOWED_ORIGINS'] = 'http://crv.test';
    delete process.env['CRV_OPERATOR_TOKEN']; delete process.env['CRV_COLLABORATORS_JSON']; resetEnvCache();
    await pool().query(readFileSync('migrations/0112_unified_auth.up.sql', 'utf8'));
    await pool().query(readFileSync('migrations/pending/0124_community_roles.up.sql', 'utf8'));
    await pool().query(readFileSync('migrations/0125_audit_public_actor.up.sql', 'utf8'));
    await pool().query(readFileSync('migrations/0126_traffic_acquisition.up.sql', 'utf8'));
    project = (await pool().query<{ id: number }>(`INSERT INTO auth.projects(slug,name) VALUES('acquisition-test','Acquisition') RETURNING id`)).rows[0]!.id;
    const password = 'PruebaProcedencia2026';
    for (const [name, role] of [['admin-origen', 'admin'], ['community-origen', 'community']]) {
      await pool().query('INSERT INTO auth.admins(username,password_hash,role,project_id) VALUES($1,$2,$3,$4)', [name, hashAccessCode(password), role, project]);
    }
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await registerOperatorAuth(app); await registerTrafficRoutes(app); await registerAdminPanelRoutes(app); await registerRoadmapRoutes(app); await registerCommunityRoutes(app);
    async function login(username: string) {
      const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { username, password } });
      expect(response.statusCode).toBe(200);
      return { cookie: String(response.headers['set-cookie']).split(';')[0]!, csrf: (response.json() as { csrf: string }).csrf };
    }
    admin = await login('admin-origen'); community = await login('community-origen');
  });
  afterAll(async () => { if (app) await app.close(); await closeDb(); if (container) await container.stop(); resetEnvCache(); });

  it('deduplica reintentos y suma páginas, sin multiplicar visitantes ni acciones', async () => {
    recordAcquisition(input({ eventId: 'navigation-1' }));
    recordAcquisition(input({ kind: 'page', eventId: 'page-1' }));
    recordAcquisition(input({ kind: 'page', eventId: 'page-1' }));
    recordAcquisition(input({ kind: 'radio', eventId: 'radio-1' }));
    recordAcquisition(input({ kind: 'radio', eventId: 'radio-2' }));
    await flushAcquisitions();
    const rows = (await report()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visitors: 1, js_visitors: 1, pages: 1, requests: 1, radio: 1 });
    recordAcquisition(input({ kind: 'page', page: 'collaborate', eventId: 'page-2', attribution: { source: 'facebook' } }));
    recordAcquisition(input({ kind: 'application', eventId: 'application-1', attribution: {} }));
    await flushAcquisitions();
    expect((await report()).rows[0]).toMatchObject({ pages: 2, applications: 1, dimensions: { source: 'instagram', landing: 'roadmap' } });
  });
  it('corrige una navegación probable cuando JS indica automatización sin contarla dos veces', async () => {
    recordAcquisition(input({ ip: '203.0.113.12', eventId: 'navigation-2' }));
    recordAcquisition(input({ ip: '203.0.113.12', kind: 'page', eventId: 'page-3', classification: { category: 'suspicious', agent: '', reason: 'webdriver' } }));
    await flushAcquisitions();
    const rows = (await report()).rows;
    expect(rows.find(row => row.dimensions.category === 'suspicious')).toMatchObject({ visitors: 1, js_visitors: 1, pages: 1, requests: 1 });
    expect(rows.reduce((sum, row) => sum + row.visitors, 0)).toBe(2);
  });
  it('mantiene bots separados de personas que comparten conexión', async () => {
    recordAcquisition(input({ classification: { category: 'bot', agent: 'curl', reason: 'curl' }, eventId: 'curl-1' }));
    await flushAcquisitions();
    expect((await report()).rows.find(row => row.dimensions.category === 'bot')).toMatchObject({ visitors: 1, js_visitors: 0 });
  });
  it('fuentes automáticas, mapa archivado y enriquecimiento JS conservan solo dimensiones seguras', async () => {
    const link = await createCampaignLink(project, { code: 'whatsapp-rock', label: 'Grupo de rock', source: 'whatsapp', medium: 'grupo', campaign: 'presentacion', destination: '/' });
    await pool().query('UPDATE auth.traffic_links SET archived=true WHERE id=$1', [link.id]);
    recordAcquisition(input({ ip: '203.0.113.13', attribution: { ref: link.code, source: 'falso' } }));
    recordAcquisition(input({ ip: '203.0.113.14', attribution: {} }));
    recordAcquisition(input({ ip: '203.0.113.14', kind: 'page', attribution: { referrer: 'https://prensa.example/noticia?token=secreto' } }));
    await flushAcquisitions();
    const rows = (await report()).rows;
    expect(rows.find(row => row.dimensions.ref === link.code)?.dimensions.source).toBe('whatsapp');
    expect(rows.find(row => row.dimensions.referrer === 'prensa.example')?.dimensions.source).toBe('prensa.example');
    expect(JSON.stringify(rows)).not.toContain('secreto'); expect(JSON.stringify(rows)).not.toContain('203.0.113');
  });
  it('protege mapa, creación y archivo mediante sesión, rol y CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: path, headers: { cookie: community.cookie } })).statusCode).toBe(200);
    const payload = { code: 'instagram-bio', label: 'Bio', source: 'instagram', medium: 'social', destination: '/' };
    expect((await write('POST', path, community, payload)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: path, headers: { cookie: admin.cookie }, payload })).statusCode).toBe(403);
    const result = await write('POST', path, admin, payload); expect(result.statusCode).toBe(201);
    const id = (result.json() as { link: { id: number } }).link.id;
    expect((await write('POST', path, admin, payload)).statusCode).toBe(409);
    expect((await write('PATCH', path + '/' + id, admin, { archived: true })).statusCode).toBe(200);
    expect((await write('PATCH', path + '/' + id, admin, { source: 'rewrite' })).statusCode).toBe(400);
    expect((await write('POST', path, admin, { ...payload, code: 'evil', destination: 'https://evil.example' })).statusCode).toBe(400);
  });
  it('rechaza eventos malformados, orígenes ajenos y conversiones inventadas por el cliente', async () => {
    const payload = { page: 'roadmap', kind: 'page', eventId: 'public-event-1', webdriver: false, attribution: {} };
    expect((await app.inject({ method: 'POST', url: '/traffic/event', headers: browserHeaders, payload })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/traffic/event', headers: { ...browserHeaders, origin: 'https://evil.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/traffic/event', headers: browserHeaders, payload: { ...payload, kind: 'application' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/traffic/event', headers: browserHeaders, payload: { ...payload, page: 'admin' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/traffic/page', payload: { page: 'roadmap' } })).statusCode).toBe(403);
    await flushAcquisitions();
  });
  it('el contador público no acepta webdriver, GoogleOther ni navegadores incoherentes', async () => {
    const request = (headers: Record<string, string>, webdriver = false) => app.inject({ method: 'POST', url: '/roadmap/visit', headers, payload: { webdriver } });
    await request(browserHeaders, true);
    await request({ ...browserHeaders, 'user-agent': 'GoogleOther' });
    await request({ 'user-agent': browserHeaders['user-agent'] });
    expect((await pool().query('SELECT count(*)::int AS n FROM auth.project_visits')).rows[0].n).toBe(0);
    await request(browserHeaders);
    expect((await pool().query('SELECT count(*)::int AS n FROM auth.project_visits')).rows[0].n).toBe(1);
  });
  it('solo registra la conversión después de persistir una candidatura válida', async () => {
    await pool().query('UPDATE auth.projects SET accepts_applications=1 WHERE id=$1', [project]);
    const count = async () => (await report()).rows.reduce((sum, row) => sum + row.applications, 0);
    const before = await count();
    const invalid = await app.inject({ method: 'POST', url: '/community/applications', headers: browserHeaders, payload: { firstName: 'Prueba' } });
    expect(invalid.statusCode).toBe(400); await flushAcquisitions(); expect(await count()).toBe(before);
    const valid = await app.inject({ method: 'POST', url: '/community/applications', headers: browserHeaders,
      payload: { firstName: 'Prueba', lastName: 'QA', email: 'qa@example.test', contributionText: 'Prueba de candidatura confirmada en PostgreSQL desechable.' } });
    expect(valid.statusCode, valid.body).toBe(200); await flushAcquisitions(); expect(await count()).toBe(before + 1);
    expect((await pool().query('SELECT count(*)::int n FROM auth.applications')).rows[0].n).toBe(1);
  });
  it('los agregados sobreviven a la poda de huellas y el cambio de día usa Caracas', async () => {
    expect(localDay(new Date('2026-11-04T03:59:59Z'))).toBe('2026-11-03');
    expect(localDay(new Date('2026-11-04T04:00:00Z'))).toBe('2026-11-04');
    const before = (await report()).rows;
    await pool().query('DELETE FROM auth.traffic_acquisition_receipts');
    await pool().query('DELETE FROM auth.traffic_acquisition_visitors');
    expect((await report()).rows).toEqual(before);
  });
  it('conserva el día del evento aunque la cola se vacíe después de medianoche', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-04T03:59:59Z'));
      recordAcquisition(input({ ip: '203.0.113.99', attribution: { source: 'midnight-test' }, eventId: 'midnight-before' }));
      vi.setSystemTime(new Date('2026-11-04T04:00:01Z'));
      recordAcquisition(input({ ip: '203.0.113.99', attribution: { source: 'midnight-test' }, eventId: 'midnight-after' }));
      await flushAcquisitions();
      const rows = (await pool().query<{ day: string; n: number }>(`SELECT day,sum(visitors)::int AS n FROM auth.traffic_acquisition_daily
        WHERE dimensions->>'source'='midnight-test' GROUP BY day ORDER BY day`)).rows;
      expect(rows).toEqual([{ day: '2026-11-03', n: 1 }, { day: '2026-11-04', n: 1 }]);
    } finally { vi.useRealTimers(); }
  });
  it('aísla las campañas y estadísticas de otros proyectos y protege el rollback con datos', async () => {
    const other = (await pool().query<{ id: number }>("INSERT INTO auth.projects(slug,name) VALUES('other-project','Other') RETURNING id")).rows[0]!.id;
    await createCampaignLink(other, { code: 'other-link', label: 'Privado de otro proyecto', source: 'otro', destination: '/' });
    expect((await report()).links.some(link => link.code === 'other-link')).toBe(false);
    await expect(pool().query(readFileSync('migrations/0126_traffic_acquisition.down.sql', 'utf8'))).rejects.toThrow('Exportar campañas');
    await pool().query('ROLLBACK');
    expect((await report()).links.length).toBeGreaterThan(0);
  });
});
