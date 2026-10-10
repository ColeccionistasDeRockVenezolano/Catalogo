import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { searchSuggestions } from "./suggestions.js";

export const metricEventSchema = z.object({
  id: z.string().uuid(), client: z.string().uuid(), kind: z.enum(["impression", "acceptance", "search", "visit"]),
  token: z.string().max(2048), visibleMs: z.number().int().min(1000).max(60000).optional(),
}).strict();
export type MetricEvent = z.infer<typeof metricEventSchema>;
const ticketSchema = z.object({ artist: z.number().int().positive(), config: z.string(), issued: z.number(), expires: z.number() });
const receiptSchema = z.object({ impression: z.string().uuid(), session: z.string(), expires: z.number() });
const ATTRIBUTION_MS = 15 * 60_000;
function mac(value: string): string {
  return createHmac("sha256", getEnv().CRV_DISCOVERY_METRICS_SECRET!).update(value).digest("base64url");
}
function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}
function verify<T>(token: string, schema: z.ZodType<T>): T | undefined {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return;
    const expected = Buffer.from(mac(body)); const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return;
    return schema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
  } catch { return; }
}
export async function metricsReady(): Promise<boolean> {
  return getEnv().CRV_DISCOVERY_METRICS_ENABLED
    && Boolean((await getPool().query("SELECT to_regclass('ingest.discovery_metric_events') AS t")).rows[0]?.t);
}
export function suggestionTicket(artist: number, group: string, priority: number, selection: string): string {
  const env = getEnv(); const now = Date.now();
  const config = mac(JSON.stringify(["crv-exposure-v1", group, priority, env.CRV_DISCOVERY_INTERVAL_MS, env.CRV_DISCOVERY_GROUP_POLICY, selection]));
  return sign({ artist, config, issued: now, expires: now + 30_000 });
}
export async function collectMetric(event: MetricEvent): Promise<{ status: string; receipt?: string }> {
  if (!await metricsReady()) return { status: "disabled" };
  const now = Date.now(); const session = mac(`session:${event.client}`);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    if (event.kind === "impression") {
      const ticket = verify(event.token, ticketSchema);
      if (!ticket || ticket.expires <= now || ticket.issued > now - 1000 || !event.visibleMs) return { status: "ignored" };
      // Volver a comprobar vigencia: un ticket no mantiene elegibilidad retirada.
      const current = (await searchSuggestions(client)).suggestions.find(s => s.id === ticket.artist);
      if (!current) return { status: "ignored" };
      const key = mac(`dedupe:${event.client}:${ticket.artist}:${Math.floor(now / 1_800_000)}`);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      const existing = (await client.query("SELECT id,received_at FROM ingest.discovery_metric_events WHERE client_key=$1 AND kind='impression'", [key])).rows[0];
      if (existing && existing.id !== event.id) return { status: "deduplicated" };
      await client.query(`INSERT INTO ingest.discovery_metric_subjects(id,artist_id,name_at_collection) VALUES($1,$1,$2) ON CONFLICT DO NOTHING`, [current.id, current.name]);
      // Sujetos históricos fusionados nunca se reatribuyen silenciosamente.
      const subject = (await client.query("SELECT artist_id FROM ingest.discovery_metric_subjects WHERE id=$1 FOR SHARE", [current.id])).rows[0];
      if (Number(subject?.artist_id) !== current.id) return { status: "ignored" };
      const inserted = await client.query(`INSERT INTO ingest.discovery_metric_events(id,impression_id,subject_id,kind,client_key,exposure_config)
        VALUES($1,$1,$2,'impression',$3,$4) ON CONFLICT DO NOTHING RETURNING received_at`, [event.id, current.id, key, ticket.config]);
      // IDs reutilizados por otro evento/sesión no entregan un recibo.
      const received = inserted.rows[0]?.received_at ?? existing?.received_at;
      if (!received) return { status: "ignored" };
      await client.query("COMMIT");
      return { status: inserted.rowCount ? "recorded" : "deduplicated", receipt: sign({ impression: event.id, session, expires: new Date(received).getTime() + ATTRIBUTION_MS }) };
    }
    const receipt = verify(event.token, receiptSchema);
    if (!receipt || receipt.session !== session || receipt.expires <= now) return { status: "ignored" };
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [receipt.impression]);
    const rows = (await client.query(`SELECT e.*,s.artist_id FROM ingest.discovery_metric_events e
      JOIN ingest.discovery_metric_subjects s ON s.id=e.subject_id WHERE e.impression_id=$1`, [receipt.impression])).rows;
    const impression = rows.find(r => r.kind === "impression");
    if (!impression || Number(impression.artist_id) !== Number(impression.subject_id) || new Date(impression.received_at).getTime() + ATTRIBUTION_MS <= now) return { status: "ignored" };
    const prerequisite = event.kind === "acceptance" ? "impression" : event.kind === "search" ? "acceptance" : "search";
    if (!rows.some(r => r.kind === prerequisite)) return { status: "ignored" };
    // Día de cohorte de la impresión; no dividir una cadena a medianoche.
    const result = await client.query(`INSERT INTO ingest.discovery_metric_events(id,impression_id,subject_id,kind,client_key,exposure_config,received_at)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT DO NOTHING`,
    [event.id, receipt.impression, impression.subject_id, event.kind, impression.client_key, impression.exposure_config]);
    await client.query("COMMIT");
    return { status: result.rowCount ? "recorded" : "deduplicated" };
  } finally { try { await client.query("ROLLBACK"); } finally { client.release(); } }
}
