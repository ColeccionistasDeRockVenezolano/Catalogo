// Registro de tráfico para las métricas de administración (ventana 3.7, C7).
//
// Portado de Herra 1.1.36 (`dist/services/traffic.service.js` +
// `dist/traffic/track.js`) a PostgreSQL. Cada petición pública deja un evento
// ya clasificado (`classify.ts`) y, si el agente dice ser un rastreador,
// verificado (`verify.ts`). Nada de esto ocurre durante la respuesta: los
// eventos se apuntan en memoria cuando la respuesta ya salió y se escriben en
// lote cada dos segundos, en una sola transacción.
//
// Frente a una avalancha, la cola tiene tope: lo que no cabe se descarta y se
// deja constancia en el registro. Las métricas pueden perder precisión; la base
// de datos y la memoria del proceso, nunca.
//
// No se guarda IP ni User-Agent de personas: solo la huella diaria (HMAC),
// la categoría, el agente declarado, el país y la pantalla.
import { getPool } from "../db/client.js";
import { localDay, normalizeCountry, visitorFingerprint } from "../api/roadmap/visits.js";
import { agentInfo } from "./agents.js";
import type { Classification } from "./classify.js";
import { verifyAgent, type Verification } from "./verify.js";
import { moduleLogger } from "../logger/index.js";

const log = moduleLogger("traffic");

// Pantallas públicas que se miden. 'js' no es una pantalla: es el aviso del
// JavaScript de la portada, la señal que confirma a una persona.
export const TRAFFIC_PAGES = ["roadmap", "collaborate", "login", "register", "activate", "llms", "sitemap", "robots"] as const;
export type TrafficPage = typeof TRAFFIC_PAGES[number] | "js";
// Fila resumen de todas las pantallas, para contar visitantes únicos del día
// sin sumar dos veces a quien abrió tres páginas.
export const ALL_PAGES = "*";

const FLUSH_EVERY_MS = 2_000;
const FLUSH_SOON_AT = 500;
const MAX_QUEUE = 5_000;
const MAX_PENDING_VERIFICATIONS = 1_000;
const VISITOR_RETENTION_DAYS = 3;
const DAILY_RETENTION_DAYS = 400;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

interface TrafficEvent {
  projectId: number;
  day: string;
  page: string;
  category: string;
  agent: string;
  verification: Verification;
  country: string;
  visitor: string | null;
}

let queue: TrafficEvent[] = [];
let dropped = 0;
let flushTimer: NodeJS.Timeout | null = null;
let flushSoon: NodeJS.Immediate | null = null;
let lastPrune = 0;
const pendingVerifications = new Set<Promise<void>>();

export interface RecordInput {
  projectId: number;
  page: TrafficPage;
  ip: string | null;
  country: string | null;
  classification: Classification;
}

function enqueue(event: TrafficEvent): void {
  if (queue.length >= MAX_QUEUE) {
    dropped += 1;
    return;
  }
  queue.push(event);
  if (queue.length >= FLUSH_SOON_AT && !flushSoon) {
    flushSoon = setImmediate(() => { flushSoon = null; void flushTrafficQueue(); });
  }
}

export function recordTraffic(input: RecordInput): void {
  const day = localDay();
  // Misma idea que el contador público: HMAC de la IP con la sal de la
  // instancia, el proyecto y el día. Sirve para contar únicos hoy y nada más.
  const visitor = input.ip ? visitorFingerprint(input.projectId, day, input.ip) : null;
  const { category, agent } = input.classification;
  const base: TrafficEvent = {
    projectId: input.projectId, day, page: input.page, category, agent,
    country: normalizeCountry(input.country), visitor, verification: "none",
  };
  // Personas, sospechosos y bots que no ofrecen forma de comprobarse no se
  // verifican: no hay nada que comprobar.
  if (!agent || !agentInfo(agent)?.verifiable) {
    enqueue(base);
    return;
  }
  const verdict = verifyAgent(agent, input.ip);
  if (typeof verdict === "string") {
    enqueue({ ...base, verification: verdict });
    return;
  }
  if (pendingVerifications.size >= MAX_PENDING_VERIFICATIONS) {
    enqueue({ ...base, verification: "unverified" });
    return;
  }
  const task = verdict
    .then((result) => enqueue({ ...base, verification: result }), () => enqueue({ ...base, verification: "unverified" }))
    .finally(() => { pendingVerifications.delete(task); });
  pendingVerifications.add(task);
}

async function pruneOldTraffic(): Promise<void> {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  const pool = getPool();
  await pool.query("DELETE FROM auth.traffic_visitors WHERE day < $1", [localDay(new Date(now - VISITOR_RETENTION_DAYS * 86_400_000))]);
  await pool.query("DELETE FROM auth.traffic_daily WHERE day < $1", [localDay(new Date(now - DAILY_RETENTION_DAYS * 86_400_000))]);
}

/** Vacía la cola. Público para el panel y para las pruebas. */
export async function flushTrafficQueue(): Promise<void> {
  if (dropped > 0) {
    log.warn({ dropped }, "eventos descartados por cola llena");
    dropped = 0;
  }
  const batch = queue;
  queue = [];
  if (batch.length > 0) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of batch) {
        const projectKey = event.projectId;
        const pages = event.page === "js" ? ["js"] : [event.page, ALL_PAGES];
        for (const page of pages) {
          const bucket = `${page}|${event.category}|${event.agent}|${event.verification}`;
          let fresh = 0;
          if (event.visitor) {
            const inserted = await client.query(
              `INSERT INTO auth.traffic_visitors (project_key, day, visitor, bucket) VALUES ($1,$2,$3,$4)
               ON CONFLICT DO NOTHING`, [projectKey, event.day, event.visitor, bucket]);
            fresh = inserted.rowCount ?? 0;
          }
          const updated = await client.query(
            `UPDATE auth.traffic_daily SET requests = requests + 1, visitors = visitors + $1,
                    last_at = to_char(timezone('UTC', statement_timestamp()), 'YYYY-MM-DD HH24:MI:SS')
              WHERE COALESCE(project_id, 0) = $2 AND day = $3 AND page = $4 AND category = $5
                AND agent = $6 AND verification = $7 AND country = $8`,
            [fresh, projectKey, event.day, page, event.category, event.agent, event.verification, event.country]);
          if ((updated.rowCount ?? 0) === 0) {
            await client.query(
              `INSERT INTO auth.traffic_daily (project_id, day, page, category, agent, verification, country, requests, visitors)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
              [projectKey, event.day, page, event.category, event.agent, event.verification, event.country, fresh]);
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Un proyecto borrado entre la visita y la escritura rompe la clave
      // foránea de todo el lote. Se reintenta evento a evento para salvar el resto.
      log.warn({ err: (error as Error).message }, "lote de tráfico falló: reintento uno a uno");
      for (const event of batch) {
        try {
          await writeOne(event);
        } catch { /* proyecto que ya no existe */ }
      }
    } finally {
      client.release();
    }
  }
  await pruneOldTraffic().catch(() => undefined);
}

async function writeOne(event: TrafficEvent): Promise<void> {
  const pool = getPool();
  const pages = event.page === "js" ? ["js"] : [event.page, ALL_PAGES];
  for (const page of pages) {
    const bucket = `${page}|${event.category}|${event.agent}|${event.verification}`;
    const inserted = event.visitor
      ? await pool.query(`INSERT INTO auth.traffic_visitors (project_key, day, visitor, bucket) VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING`, [event.projectId, event.day, event.visitor, bucket])
      : { rowCount: 0 };
    const updated = await pool.query(
      `UPDATE auth.traffic_daily SET requests = requests + 1, visitors = visitors + $1
        WHERE COALESCE(project_id, 0) = $2 AND day = $3 AND page = $4 AND category = $5
          AND agent = $6 AND verification = $7 AND country = $8`,
      [inserted.rowCount ?? 0, event.projectId, event.day, page, event.category, event.agent, event.verification, event.country]);
    if ((updated.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO auth.traffic_daily (project_id, day, page, category, agent, verification, country, requests, visitors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
        [event.projectId, event.day, page, event.category, event.agent, event.verification, event.country, inserted.rowCount ?? 0]);
    }
  }
}

/** Espera a las verificaciones por DNS en curso (con tope) y vacía la cola. */
export async function settleTraffic(maxWaitMs = 3_500): Promise<void> {
  if (pendingVerifications.size > 0) {
    await Promise.race([
      Promise.allSettled([...pendingVerifications]),
      new Promise((resolve) => setTimeout(resolve, maxWaitMs).unref()),
    ]);
  }
  await flushTrafficQueue();
}

export function startTrafficRecorder(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushTrafficQueue(); }, FLUSH_EVERY_MS);
  flushTimer.unref();
}

export async function stopTrafficRecorder(): Promise<void> {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  if (flushSoon) clearImmediate(flushSoon);
  flushSoon = null;
  try {
    await flushTrafficQueue();
  } catch (error) {
    log.warn({ err: (error as Error).message }, "no se pudo vaciar la cola de tráfico al apagar");
  }
}

/** Vacía el agregado (C7: «Poner el contador a cero»). No toca el contador público. */
export async function resetTraffic(projectId: number): Promise<{ daily: number; visitors: number }> {
  await settleTraffic();
  const pool = getPool();
  const visitors = await pool.query("DELETE FROM auth.traffic_visitors WHERE project_key = $1", [projectId]);
  const daily = await pool.query("DELETE FROM auth.traffic_daily WHERE project_id = $1", [projectId]);
  return { daily: daily.rowCount ?? 0, visitors: visitors.rowCount ?? 0 };
}
