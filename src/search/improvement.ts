import { z } from "zod";
import { getPool } from "../db/client.js";
import { OperatorError } from "../merge/operator.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import { sanitizeSearchText } from "./privacy.js";

/**
 * Etapa 5 (reducida) · bandeja de mejora manual. Una persona diagnostica una consulta sin resultados y el
 * caso lleva el seguimiento. No agrupa consultas, no infiere equivalencias y no crea aprobaciones: solo abre
 * tareas (reutilizando `review_queue`) y registra cuántas veces volvió a salir vacía la misma consulta.
 */
export const DIAGNOSES = {
  identity_alias: "Nombre o alias ausente, o identidad ambigua",
  unrecognized_expression: "Expresión o sinónimo no reconocido",
  missing_knowledge: "Consulta entendida sin conocimiento musical suficiente",
  technical_incident: "Timeout, proveedor, base o sobrecarga",
  defective_extraction: "Captura duplicada, homónimo o extracción defectuosa",
  other: "Otro",
} as const;
export type Diagnosis = keyof typeof DIAGNOSES;
const diagnosisKeys = Object.keys(DIAGNOSES) as [Diagnosis, ...Diagnosis[]];

export const openCaseSchema = z.object({
  /** El texto tal como lo muestra «Sin resultados»; el servidor deriva la clave del registro (0072). */
  query: z.string().trim().min(1).max(200),
  diagnosis: z.enum(diagnosisKeys),
  note: z.string().trim().max(1000).default(""),
}).strict();
export const closeCaseSchema = z.object({
  status: z.enum(["resolved", "discarded"]),
  note: z.string().trim().max(1000).default(""),
}).strict();
export type OpenCaseInput = z.infer<typeof openCaseSchema>;
export type CloseCaseInput = z.infer<typeof closeCaseSchema>;

/** Solo «falta conocimiento» abre una tarea de curaduría; el resto se atiende con las acciones que ya existen (alias, etc.). */
export const opensReviewTask = (diagnosis: Diagnosis): boolean => diagnosis === "missing_knowledge";

/**
 * Seguimiento sin causalidad: cuántas veces salió vacía la consulta desde que se cerró el caso. La exposición
 * de la consulta cambia con el tiempo, así que esto es una lectura, no una medición de efecto.
 */
export function followUp(missesAtClose: number | null, missesNow: number): number | null {
  return missesAtClose === null ? null : Math.max(0, missesNow - missesAtClose);
}

/** Misma clave que usa el registro de consultas sin resultados (src/api/search-misses.ts). */
export const missKey = (query: string): string => normalizeEntityName(sanitizeSearchText(query)).secondaryKey;

/** Veces que salió vacía según el registro de consultas sin resultados; `known` es false si la consulta no está en él. */
async function missCount(queryKey: string): Promise<{ known: boolean; count: number }> {
  const row = (await getPool().query<{ misses: number }>("SELECT misses FROM ingest.search_misses WHERE normalized_query=$1", [queryKey])).rows[0];
  return { known: row !== undefined, count: row?.misses ?? 0 };
}

export async function openImprovementCase(input: OpenCaseInput, operator: string) {
  const queryKey = missKey(input.query);
  const misses = await missCount(queryKey);
  // Ningún texto nuevo: la consulta ya debe estar registrada como sin resultados (clave ≤ 100 caracteres, como el registro).
  if (!queryKey || !misses.known) throw new OperatorError("not_found", "la consulta no está registrada como sin resultados");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`search:improvement:${queryKey}`]);
    const open = await client.query("SELECT id FROM ingest.search_improvement_cases WHERE query_key=$1 AND status='open'", [queryKey]);
    if (open.rowCount) throw new OperatorError("already_exists", "ya hay un caso abierto para esta consulta", { id: Number(open.rows[0].id) });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ingest.search_improvement_cases(query_key,diagnosis,misses_at_open,note,opened_by) VALUES($1,$2,$3,$4,$5) RETURNING id::text`,
      [queryKey, input.diagnosis, misses.count, input.note, operator]);
    const id = Number(inserted.rows[0]!.id);
    let reviewId: number | null = null;
    if (opensReviewTask(input.diagnosis)) {
      const review = await client.query<{ id: string }>(
        `INSERT INTO ingest.review_queue(kind,priority,payload,notes) VALUES('manual_review',4,$1::jsonb,$2) RETURNING id::text`,
        [JSON.stringify({ caseKey: `search-improvement:${id}`, via: "buscador-mejora", type: "search_improvement_case", caseId: id, queryKey, diagnosis: input.diagnosis }),
          `Buscador: la consulta «${sanitizeSearchText(input.query)}» se entiende pero el catálogo no tiene conocimiento suficiente. ${input.note}`.trim()]);
      reviewId = Number(review.rows[0]!.id);
      await client.query("UPDATE ingest.search_improvement_cases SET review_id=$1 WHERE id=$2", [reviewId, id]);
    }
    await client.query("COMMIT");
    return { id, reviewId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function closeImprovementCase(id: number, input: CloseCaseInput, operator: string) {
  const row = (await getPool().query<{ query_key: string; status: string }>("SELECT query_key,status FROM ingest.search_improvement_cases WHERE id=$1", [id])).rows[0];
  if (!row) throw new OperatorError("not_found", "caso inexistente");
  if (row.status !== "open") throw new OperatorError("not_open", "el caso ya está cerrado");
  const misses = await missCount(row.query_key);
  const done = await getPool().query(
    `UPDATE ingest.search_improvement_cases SET status=$2, close_note=$3, closed_by=$4, closed_at=now(), misses_at_close=$5 WHERE id=$1 AND status='open'`,
    [id, input.status, input.note, operator, misses.count]);
  if (!done.rowCount) throw new OperatorError("not_open", "el caso ya está cerrado");
  return { id, status: input.status };
}

export async function improvementState() {
  const rows = (await getPool().query(`SELECT c.id::text, c.query_key, c.diagnosis, c.status, c.review_id::text, c.misses_at_open, c.misses_at_close,
      c.note, c.close_note, c.opened_by, c.opened_at, c.closed_by, c.closed_at, r.status::text AS review_status, m.sample_query
    FROM ingest.search_improvement_cases c LEFT JOIN ingest.review_queue r ON r.id=c.review_id
    LEFT JOIN ingest.search_misses m ON m.normalized_query=c.query_key
    ORDER BY (c.status='open') DESC, coalesce(c.closed_at,c.opened_at) DESC LIMIT 200`)).rows;
  const cases = await Promise.all(rows.map(async row => {
    const now = row.status === "resolved" ? (await missCount(row.query_key)).count : null;
    return { id: Number(row.id), queryKey: row.query_key as string, query: (row.sample_query as string | null) ?? (row.query_key as string), diagnosis: row.diagnosis as Diagnosis, status: row.status as "open" | "resolved" | "discarded",
      reviewId: row.review_id ? Number(row.review_id) : null, reviewStatus: (row.review_status as string | null) ?? null,
      missesAtOpen: row.misses_at_open as number, missesAtClose: row.misses_at_close as number | null,
      missesSinceClose: now === null ? null : followUp(row.misses_at_close, now),
      note: row.note as string, closeNote: (row.close_note as string | null) ?? null,
      openedBy: row.opened_by as string, openedAt: (row.opened_at as Date).toISOString(),
      closedBy: (row.closed_by as string | null) ?? null, closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null };
  }));
  return { diagnoses: Object.entries(DIAGNOSES).map(([key, label]) => ({ key: key as Diagnosis, label, opensTask: opensReviewTask(key as Diagnosis) })), cases };
}
export type ImprovementState = Awaited<ReturnType<typeof improvementState>>;
