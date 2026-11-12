import { getPool } from "../db/client.js";

/**
 * Etapa 5 (reducida): latido de los trabajos del buscador. Solo estado de operación; nunca texto de
 * consultas, excepciones ni datos del visitante. Escribir el latido nunca puede romper el trabajo medido.
 */
export const SEARCH_JOBS = {
  retention: { label: "Retención y agregación", cadenceSecs: 3600 },
  collector: { label: "Colector de búsquedas", cadenceSecs: 300 },
} as const;
export type SearchJob = keyof typeof SEARCH_JOBS;
/** Un trabajo sin latido correcto en más de este múltiplo de su cadencia se considera detenido. */
export const STALE_FACTOR = 2;

export type JobState = "al_dia" | "sin_datos" | "detenido" | "con_error";
export interface JobRow {
  job: string; cadence_secs: number; last_ok_at: Date | null; last_error_at: Date | null; last_error: string | null;
  runs: string | number; failures: string | number; detail: Record<string, unknown>;
}

/**
 * «Sin datos» (nunca corrió) no es «detenido» (corrió y dejó de hacerlo). Un fallo posterior al último
 * éxito es «con_error»; si no falló pero pasó demasiado tiempo desde el último éxito, «detenido».
 */
export function classifyJob(row: Pick<JobRow, "cadence_secs" | "last_ok_at" | "last_error_at"> | null, now = new Date()): JobState {
  if (!row || (!row.last_ok_at && !row.last_error_at)) return "sin_datos";
  const ok = row.last_ok_at?.getTime() ?? null, err = row.last_error_at?.getTime() ?? null;
  if (err !== null && (ok === null || err > ok)) return "con_error";
  if (ok === null || now.getTime() - ok > STALE_FACTOR * row.cadence_secs * 1000) return "detenido";
  return "al_dia";
}

export type JobOutcome = { ok: true; detail?: Record<string, number | string | boolean | null> } | { ok: false; code: string };

/** Código corto y sin datos (`[a-z0-9_:-]{1,60}`); cualquier otra cosa se descarta. */
const safeCode = (code: string) => (/^[a-z0-9_:-]{1,60}$/.test(code) ? code : "error");

export async function recordJob(job: SearchJob, outcome: JobOutcome): Promise<void> {
  try {
    const cadence = SEARCH_JOBS[job].cadenceSecs;
    if (outcome.ok) {
      await getPool().query(
        `INSERT INTO ingest.search_job_status(job,cadence_secs,last_ok_at,runs,detail)
         VALUES($1,$2,now(),1,$3::jsonb)
         ON CONFLICT(job) DO UPDATE SET cadence_secs=EXCLUDED.cadence_secs, last_ok_at=now(), runs=ingest.search_job_status.runs+1,
           detail=EXCLUDED.detail, updated_at=now()`, [job, cadence, JSON.stringify(outcome.detail ?? {})]);
    } else {
      await getPool().query(
        `INSERT INTO ingest.search_job_status(job,cadence_secs,last_error_at,last_error,runs,failures)
         VALUES($1,$2,now(),$3,1,1)
         ON CONFLICT(job) DO UPDATE SET cadence_secs=EXCLUDED.cadence_secs, last_error_at=now(), last_error=EXCLUDED.last_error,
           runs=ingest.search_job_status.runs+1, failures=ingest.search_job_status.failures+1, updated_at=now()`, [job, cadence, safeCode(outcome.code)]);
    }
  } catch { /* el latido es de mejor esfuerzo: no tumba el trabajo ni escribe la excepción */ }
}

export interface InterpreterHealth { configured: boolean; reachable: boolean | null; laya: string | null; student: string | null }

// Lee las mismas variables que gated-service.ts y structured.ts, sin importarlos: la web tipa
// `SearchAdministration` desde este módulo y no debe arrastrar el compilador de consultas.
const gatedOn = (env: NodeJS.ProcessEnv = process.env) => env["CRV_QUERY_GATED"] === "1";
const planModeOf = (env: NodeJS.ProcessEnv = process.env): "off" | "shadow" | "on" => env["CRV_QUERY_PLAN"] === "shadow" || env["CRV_QUERY_PLAN"] === "on" ? env["CRV_QUERY_PLAN"] : "off";
const interpreterUrl = (env: NodeJS.ProcessEnv = process.env) => env["CRV_QUERY_INTERPRETER_URL"] ?? "http://127.0.0.1:3191";

async function interpreterHealth(): Promise<InterpreterHealth> {
  if (!gatedOn()) return { configured: false, reachable: null, laya: null, student: null };
  try {
    const res = await fetch(`${interpreterUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { ok?: boolean; laya?: string; student?: string };
    return { configured: true, reachable: res.ok && body.ok === true, laya: body.laya ?? null, student: body.student ?? null };
  } catch { return { configured: true, reachable: false, laya: null, student: null }; }
}

export async function searchOperation(now = new Date()) {
  const rows = (await getPool().query<JobRow>("SELECT job,cadence_secs,last_ok_at,last_error_at,last_error,runs,failures,detail FROM ingest.search_job_status")).rows;
  const byJob = new Map(rows.map(row => [row.job, row]));
  const jobs = (Object.keys(SEARCH_JOBS) as SearchJob[]).map(job => {
    const row = byJob.get(job) ?? null;
    return { job, label: SEARCH_JOBS[job].label, cadenceSecs: SEARCH_JOBS[job].cadenceSecs, state: classifyJob(row ? { ...row, cadence_secs: SEARCH_JOBS[job].cadenceSecs } : null, now),
      lastOkAt: row?.last_ok_at?.toISOString() ?? null, lastErrorAt: row?.last_error_at?.toISOString() ?? null, lastError: row?.last_error ?? null,
      runs: Number(row?.runs ?? 0), failures: Number(row?.failures ?? 0), detail: row?.detail ?? {} };
  });
  return {
    jobs,
    flags: { gated: gatedOn(), plan: planModeOf() },
    interpreter: await interpreterHealth(),
    staleFactor: STALE_FACTOR,
  };
}
export type SearchOperation = Awaited<ReturnType<typeof searchOperation>>;
