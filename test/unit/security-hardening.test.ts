import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOperatorAuth, resetAuthStateForTests } from '../../src/api/auth.js';
import { resetEnvCache } from '../../src/config/env.js';
import { toApiError } from '../../src/api/http-errors.js';

describe('fronteras HTTP de seguridad', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.stubEnv('CRV_AUTH_BACKEND', 'legacy');
    vi.stubEnv('CRV_DEPLOYMENT', 'production');
    vi.stubEnv('CRV_ALLOWED_ORIGINS', 'https://crv.example');
    vi.stubEnv('CRV_READ_RATE_LIMIT', '2');
    vi.stubEnv('CRV_TRUST_CF_HEADERS', 'true');
    vi.stubEnv('CRV_HERRA_DB_PATH', '');
    vi.stubEnv('CRV_COLLABORATORS_JSON', '');
    resetEnvCache();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerOperatorAuth(app);
    app.post('/roadmap/visit', async () => ({ ok: true }));
    app.get('/artists', async () => ({ public: true }));
    app.get('/account/profile', async () => ({ profile: true }));
    app.get('/community/activate/:token', async () => ({ valid: false }));
    app.get('/community/admin/panel/users', async () => ({ private: true }));
  });
  afterEach(async () => { await app.close(); vi.unstubAllEnvs(); resetEnvCache(); resetAuthStateForTests(); });

  it('Host y cabeceras de proxy no amplían los orígenes de producción', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://crv.example']) {
      expect((await app.inject({ method: 'POST', url: '/roadmap/visit', headers: {
        origin, host: 'evil.example', 'x-forwarded-host': 'evil.example',
      } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/roadmap/visit' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/roadmap/visit', headers: { origin: 'https://crv.example' } })).statusCode).toBe(200);
  });

  it('una conexión remota no cambia de cupo inventando XFF ni CF-Connecting-IP', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/artists', remoteAddress: '198.51.100.20', headers: {
        'x-forwarded-for': `203.0.113.${i + 1}`, 'cf-connecting-ip': `192.0.2.${i + 1}`,
      } });
      expect(response.statusCode).toBe(i < 2 ? 200 : 429);
    }
  });

  it('no permite almacenar en cachés compartidas respuestas de cuenta, cookies ni activaciones', async () => {
    for (const url of ['/account/profile', '/community/activate/fake-token', '/artists']) {
      const response = await app.inject({ url, headers: { cookie: 'crv_session=falsa' } });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.vary).toContain('Cookie');
    }
  });

  it('las rutas privadas siguen protegidas con codificación y HEAD', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      expect((await app.inject({ method, url: '/%63ommunity/admin/panel/users' })).statusCode).toBe(401);
      expect((await app.inject({ method, url: '/community/admin/panel/users' })).statusCode).toBe(401);
    }
  });
});

describe('errores públicos de PostgreSQL', () => {
  it('oculta valores de filas, credenciales, SQL y nombres de restricciones', () => {
    for (const code of ['23505', '23503', '23514', '23502', '22P02', '22007', '22008', '22003', '22001', 'PCE01', 'PCE02']) {
      const error = toApiError({ code, detail: 'fila: correo-privado@example.invalid scrypt$hash-secreto',
        message: 'SQL interno', constraint: 'auth_secret_constraint' });
      expect(error).toBeDefined();
      expect(JSON.stringify(error)).not.toMatch(/correo-privado|scrypt|hash-secreto|SQL interno|auth_secret_constraint/u);
      expect(error!.message).toBeTruthy();
    }
    expect(toApiError(null)).toBeUndefined();
  });
});
