import { getPool } from "../db/client.js";

export const RAW_DAYS = 30;
export const DAILY_DAYS = 180;
export function closedUtcDay(now: Date): string {
  // Esperar el cierre de los 15 min de atribución de la última impresión.
  return new Date(now.getTime() - 900000).toISOString().slice(0, 10);
}
/** Lote independiente: reemplaza cuentas, nunca incrementa al reintentar.
 * Serializa ejecuciones y captura una fotografía consistente del colector. */
export async function aggregateMetrics(now = new Date()) {
  const client = await getPool().connect();
  let job: number | undefined;
  let attempts = 0;
  try {
    const acquired = (await client.query("SELECT pg_try_advisory_lock(7530053) AS locked")).rows[0]?.locked;
    if (!acquired) return { status: "busy" };
    await client.query("UPDATE ingest.discovery_metric_jobs SET status='failed',finished_at=clock_timestamp(),summary='{\"code\":\"interrupted\"}' WHERE status='running'");
    job = Number((await client.query("INSERT INTO ingest.discovery_metric_jobs(status) VALUES('running') RETURNING id")).rows[0].id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts = attempt;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query("SET LOCAL statement_timeout='60s'");
        await client.query("SET LOCAL lock_timeout='5s'");
        const end = closedUtcDay(now);
        const cutoff = new Date(Date.parse(`${now.toISOString().slice(0,10)}T00:00:00Z`) - RAW_DAYS * 86400000).toISOString().slice(0,10);
        await client.query("DELETE FROM ingest.discovery_metric_daily WHERE day >= $1::date AND day < $2::date", [cutoff,end]);
        const result = await client.query(`INSERT INTO ingest.discovery_metric_daily(day,subject_id,kind,count,exposure_configs,updated_at)
          SELECT (i.received_at AT TIME ZONE 'UTC')::date,e.subject_id,e.kind,count(*)::int,
            array_agg(DISTINCT i.exposure_config ORDER BY i.exposure_config),$3::timestamptz
          FROM ingest.discovery_metric_events e JOIN ingest.discovery_metric_events i ON i.id=e.impression_id AND i.kind='impression'
          WHERE i.received_at >= ($1::date::timestamp AT TIME ZONE 'UTC') AND i.received_at < ($2::date::timestamp AT TIME ZONE 'UTC')
          GROUP BY 1,2,3`, [cutoff,end,now.toISOString()]);
        const raw = await client.query(`DELETE FROM ingest.discovery_metric_events e WHERE e.client_key IN
          (SELECT client_key FROM ingest.discovery_metric_events WHERE kind='impression' AND received_at < ($1::date::timestamp AT TIME ZONE 'UTC'))`, [cutoff]);
        const daily = await client.query("DELETE FROM ingest.discovery_metric_daily WHERE day < $1::date - $2::int", [now.toISOString().slice(0,10),DAILY_DAYS]);
        await client.query("DELETE FROM ingest.discovery_metric_jobs WHERE id<>$1 AND started_at < $2::timestamptz - interval '180 days'", [job,now.toISOString()]);
        const summary = { status: "completed", job, attempts: attempt, closedBefore: end, recomputedFrom: cutoff,
          rows: result.rowCount, rawDeleted: raw.rowCount, dailyDeleted: daily.rowCount, updatedAt: now.toISOString() };
        await client.query("UPDATE ingest.discovery_metric_jobs SET status='completed',finished_at=$2,attempts=$3,summary=$4 WHERE id=$1", [job,now.toISOString(),attempt,summary]);
        await client.query("COMMIT");
        return summary;
      } catch (error) {
        await client.query("ROLLBACK");
        const code = (error as { code?: string }).code;
        if (attempt === 3 || !["40001", "40P01", "55P03"].includes(code ?? "")) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new Error("Lote sin resultado");
  } catch (error) {
    if (job) await client.query("UPDATE ingest.discovery_metric_jobs SET status='failed',finished_at=clock_timestamp(),summary=$2,attempts=$3 WHERE id=$1", [job, { code: (error as { code?: string }).code ?? "job_failed" },attempts]);
    throw error;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(7530053)"); } finally { client.release(); }
  }
}
