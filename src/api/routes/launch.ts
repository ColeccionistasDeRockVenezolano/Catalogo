import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/client.js';
import { launchContactBody, saveLaunchContact, syncPendingLaunchContacts } from '../../landing/launch-contacts.js';
import { assertChatOrigin, clientIp } from '../auth.js';
import { ApiError } from '../http-errors.js';
import { createWindowLimiter } from '../rate-limit.js';

export async function registerLaunchRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const limiter = createWindowLimiter({ max: 6, windowMs: 15 * 60_000, maxKeys: 5000 });
  api.get('/roadmap/launch', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const token = /(?:^|;\s*)crv_launch=([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?:;|$)/u.exec(request.headers.cookie ?? '')?.[1];
    const completed = token ? Boolean((await getPool().query('SELECT 1 FROM auth.launch_contacts WHERE id=$1', [token])).rowCount) : false;
    return { completed };
  });
  api.post('/roadmap/launch', { bodyLimit: 4096, schema: { body: launchContactBody }, onRequest: async (request, reply) => {
    assertChatOrigin(request);
    reply.header('cache-control', 'no-store');
    if (!limiter.take(clientIp(request))) {
      reply.header('retry-after', '900');
      throw new ApiError(429, 'launch_rate_limit', 'Has enviado varios intentos. Espera 15 minutos y vuelve a intentarlo.');
    }
  } }, async (request, reply) => {
    if (request.body.website) throw new ApiError(400, 'invalid_submission', 'No se pudo enviar el formulario.');
    const id = await saveLaunchContact(request.body);
    reply.header('set-cookie', `crv_launch=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${getEnv().CRV_DEPLOYMENT === 'production' ? '; Secure' : ''}`);
    sync();
    return { completed: true };
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let working: Promise<void> | undefined;
  const sync = () => {
    if (working) return;
    working = syncPendingLaunchContacts().catch(() => app.log.warn('La cola de lanzamiento sigue pendiente.')).finally(() => { working = undefined; });
  };
  app.addHook('onReady', async () => {
    if (getEnv().CRV_LAUNCH_SHEET_CREDENTIALS) { sync(); timer = setInterval(sync, 60_000); timer.unref(); }
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); await working; });
}
