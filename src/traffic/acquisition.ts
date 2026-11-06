import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db/client.js';
import { getEnv } from '../config/env.js';
import { localDay, normalizeCountry, visitorFingerprint } from '../api/roadmap/visits.js';
import { dailyCycleAt } from '../shared/daily-cycle.js';
import { moduleLogger } from '../logger/index.js';
import { ApiError } from '../api/http-errors.js';
import type { Classification, TrafficCategory } from './classify.js';
import { campaignTag, resolveAttribution, type Attribution, type AttributionInput, type CampaignLink, type AcquisitionPage } from './attribution.js';

const log = moduleLogger('acquisition');
const MAX_QUEUE = 5000;
export type AcquisitionKind = 'navigation' | 'page' | 'collaborate' | 'radio' | 'application';
export interface AcquisitionInput {
  projectId: number; ip: string | null; country: string | null; page: AcquisitionPage;
  classification: Classification; attribution: AttributionInput; kind: AcquisitionKind; eventId?: string;
}
interface Event extends Omit<AcquisitionInput, 'ip'> { day: string; visitor: string; at: string; eventId: string; attempts: number }
interface Dimensions extends Attribution { country: string; landing: AcquisitionPage; category: TrafficCategory }
interface Counters { visitors: number; js_visitors: number; requests: number; pages: number; collaborate: number; radio: number; applications: number }
interface Snapshot { dimensions: Dimensions; counts: Counters; browserSignal: boolean }
const COUNTERS = ['visitors', 'js_visitors', 'requests', 'pages', 'collaborate', 'radio', 'applications'] as const;
let queue: Event[] = [];
let flushing: Promise<void> | undefined;
let lastPrune = 0;

export function recordAcquisition(input: AcquisitionInput): void {
  if (!getEnv().CRV_TRAFFIC_ENABLED || !input.ip) return;
  if (queue.length >= MAX_QUEUE) { log.warn('cola de procedencia llena; se descarta evento'); return; }
  const day = localDay();
  const { ip, ...safe } = input;
  queue.push({ ...safe, day, visitor: visitorFingerprint(input.projectId, day, ip), at: new Date().toISOString(), eventId: input.eventId ?? randomUUID(), attempts: 0 });
}

export async function campaignLinks(project: number): Promise<CampaignLink[]> {
  return (await getPool().query<CampaignLink>(
    `SELECT id, code, label, source, medium, campaign, content, destination, archived
     FROM auth.traffic_links WHERE project_id=$1 ORDER BY archived, id DESC`, [project])).rows;
}

export async function createCampaignLink(project: number, raw: Record<string, unknown>): Promise<CampaignLink> {
  const code = typeof raw['code'] === 'string' ? raw['code'].trim().toLowerCase() : '';
  const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
  const source = campaignTag(raw['source']);
  const tags = ['medium', 'campaign', 'content'] as const;
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/u.test(code) || !label || label.length > 100 || !source
    || tags.some(key => raw[key] && !campaignTag(raw[key]))
    || (raw['destination'] !== '/' && raw['destination'] !== '/colaborar')) {
    throw new ApiError(400, 'invalid_campaign', 'Revisa el código, nombre, fuente y destino. Usa etiquetas sin URLs ni datos personales.');
  }
  // El límite y la unicidad se resuelven bajo el mismo bloqueo para altas concurrentes.
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, 126)', [project]);
    const total = await client.query<{ n: string }>('SELECT count(*) AS n FROM auth.traffic_links WHERE project_id=$1', [project]);
    if (Number(total.rows[0]!.n) >= 200) throw new ApiError(409, 'campaign_limit', 'Se alcanzó el límite de 200 enlaces de campaña.');
    const result = await client.query<CampaignLink>(
      `INSERT INTO auth.traffic_links(project_id,code,label,source,medium,campaign,content,destination)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,code,label,source,medium,campaign,content,destination,archived`,
      [project, code, label, source, campaignTag(raw['medium']), campaignTag(raw['campaign']), campaignTag(raw['content']), raw['destination']]);
    await client.query('COMMIT');
    return result.rows[0]!;
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'duplicate_campaign', 'Ese código ya existe. Elige otro para conservar su histórico.');
    throw error;
  } finally { client.release(); }
}

async function adjust(client: PoolClient, event: Event, snapshot: Snapshot, sign: number): Promise<void> {
  const dimensions = JSON.stringify(snapshot.dimensions, Object.keys(snapshot.dimensions).sort());
  const bucket = createHash('sha256').update(dimensions).digest('hex');
  const counts = COUNTERS.map(key => snapshot.counts[key] * sign);
  if (sign < 0) {
    await client.query(`UPDATE auth.traffic_acquisition_daily SET
      visitors=visitors+$4,js_visitors=js_visitors+$5,requests=requests+$6,pages=pages+$7,
      collaborate=collaborate+$8,radio=radio+$9,applications=applications+$10
      WHERE project_id=$1 AND day=$2 AND bucket=$3`, [event.projectId, event.day, bucket, ...counts]);
  } else {
    await client.query(`INSERT INTO auth.traffic_acquisition_daily
      (project_id,day,bucket,visitors,js_visitors,requests,pages,collaborate,radio,applications,dimensions)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT (project_id,day,bucket) DO UPDATE SET
        visitors=auth.traffic_acquisition_daily.visitors+EXCLUDED.visitors,
        js_visitors=auth.traffic_acquisition_daily.js_visitors+EXCLUDED.js_visitors,
        requests=auth.traffic_acquisition_daily.requests+EXCLUDED.requests,
        pages=auth.traffic_acquisition_daily.pages+EXCLUDED.pages,
        collaborate=auth.traffic_acquisition_daily.collaborate+EXCLUDED.collaborate,
        radio=auth.traffic_acquisition_daily.radio+EXCLUDED.radio,
        applications=auth.traffic_acquisition_daily.applications+EXCLUDED.applications`,
    [event.projectId, event.day, bucket, ...counts, dimensions]);
  }
}

async function write(event: Event, links: CampaignLink[], ownOrigin: string): Promise<void> {
  const client = await getPool().connect();
  const category = event.classification.category;
  const actor = category === 'human' || category === 'suspicious' ? 'browser' : `${category}:${event.classification.agent}`;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acquisition:${event.projectId}:${event.day}:${event.visitor}:${actor}`]);
    const receipt = await client.query(`INSERT INTO auth.traffic_acquisition_receipts(project_id,day,visitor,actor,event_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [event.projectId,event.day,event.visitor,actor,event.eventId]);
    if (!receipt.rowCount) { await client.query('COMMIT'); return; }
    const previous = (await client.query<{ snapshot: Snapshot; first_at: Date }>(
      `SELECT snapshot,first_at FROM auth.traffic_acquisition_visitors WHERE project_id=$1 AND day=$2 AND visitor=$3 AND actor=$4 FOR UPDATE`,
      [event.projectId,event.day,event.visitor,actor])).rows[0];
    const attribution = resolveAttribution(event.attribution, ownOrigin, links.find(link => link.code === event.attribution.ref));
    const snapshot: Snapshot = previous ? structuredClone(previous.snapshot) : {
      dimensions: { ...attribution, country: normalizeCountry(event.country), landing: event.page, category },
      counts: { visitors: 1, js_visitors: 0, requests: 0, pages: 0, collaborate: 0, radio: 0, applications: 0 }, browserSignal: false,
    };
    // El aviso del navegador puede completar un referente oculto al gateway al cargar esa misma página.
    if (previous && event.kind === 'page' && snapshot.dimensions.method === 'direct'
      && snapshot.dimensions.landing === event.page && Date.parse(event.at) - previous.first_at.getTime() < 15000) {
      Object.assign(snapshot.dimensions, attribution);
    }
    if (event.kind === 'navigation') snapshot.counts.requests += 1;
    if (event.kind === 'page') { snapshot.counts.pages += 1; snapshot.counts.js_visitors = 1; snapshot.browserSignal = true; }
    // Una señal JS sospechosa prevalece sobre una navegación sin contradicciones.
    if (actor === 'browser' && (category === 'suspicious' || (category === 'human' && !snapshot.browserSignal))) snapshot.dimensions.category = category;
    if (event.kind === 'collaborate') snapshot.counts.collaborate = 1;
    if (event.kind === 'radio') snapshot.counts.radio = 1;
    if (event.kind === 'application') snapshot.counts.applications = 1;
    if (previous) await adjust(client, event, previous.snapshot, -1);
    await adjust(client, event, snapshot, 1);
    await client.query(`INSERT INTO auth.traffic_acquisition_visitors(project_id,day,visitor,actor,snapshot,first_at,last_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) ON CONFLICT(project_id,day,visitor,actor)
      DO UPDATE SET snapshot=EXCLUDED.snapshot,last_at=EXCLUDED.last_at`,
    [event.projectId,event.day,event.visitor,actor,JSON.stringify(snapshot),event.at]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function drain(): Promise<void> {
  const batch = queue; queue = [];
  const configs = new Map<number, { links: CampaignLink[]; origin: string }>();
  for (const event of batch) {
    try {
      let config = configs.get(event.projectId);
      if (!config) {
        const row = (await getPool().query<{ branding_json: string }>('SELECT branding_json FROM auth.projects WHERE id=$1', [event.projectId])).rows[0];
        const branding = JSON.parse(row?.branding_json || '{}') as { siteUrl?: string };
        config = { links: await campaignLinks(event.projectId), origin: branding.siteUrl || 'https://coleccionistasderockvenezolano.com' };
        configs.set(event.projectId, config);
      }
      await write(event, config.links, config.origin);
    } catch (error) {
      log.error({ err: error instanceof Error ? error.message : 'error' }, 'no se pudo guardar procedencia');
      // Reintentar sin duplicar contadores: los recibos se confirman en la misma transacción.
      if (queue.length < MAX_QUEUE && event.attempts < 3 && (error as { code?: string }).code !== '23503') queue.push({ ...event, attempts: event.attempts + 1 });
    }
  }
  if (Date.now() - lastPrune >= 3600000) {
    const threshold = (days: number) => localDay(new Date(Date.now() - days * 86400000));
    await getPool().query('DELETE FROM auth.traffic_acquisition_receipts WHERE day < $1', [threshold(3)]);
    await getPool().query('DELETE FROM auth.traffic_acquisition_visitors WHERE day < $1', [threshold(3)]);
    await getPool().query('DELETE FROM auth.traffic_acquisition_daily WHERE day < $1', [threshold(400)]);
    lastPrune = Date.now();
  }
}

export async function flushAcquisitions(): Promise<void> {
  if (flushing) await flushing;
  if (queue.length === 0) return;
  flushing = drain();
  try { await flushing; } finally { flushing = undefined; }
}

export async function acquisitionReport(project: number, from: string, to: string) {
  const rows = (await getPool().query<{
    dimensions: Dimensions; visitors: number; js_visitors: number; requests: number; pages: number;
    collaborate: number; radio: number; applications: number;
  }>(`SELECT dimensions,sum(visitors)::int AS visitors,sum(js_visitors)::int AS js_visitors,
       sum(requests)::int AS requests,sum(pages)::int AS pages,sum(collaborate)::int AS collaborate,
       sum(radio)::int AS radio,sum(applications)::int AS applications
      FROM auth.traffic_acquisition_daily WHERE project_id=$1 AND day BETWEEN $2 AND $3 AND visitors>0
      GROUP BY dimensions ORDER BY sum(visitors) DESC,dimensions::text`, [project,from,to])).rows;
  const since = (await getPool().query<{ since: string | null }>('SELECT min(day) AS since FROM auth.traffic_acquisition_daily WHERE project_id=$1', [project])).rows[0]?.since ?? null;
  return { from, to, since, dailyCycle: dailyCycleAt(), rows, links: await campaignLinks(project) };
}
