// CRV · Veredictos de identidad de la IA del catálogo (etapa 3).
//
// Cada veredicto se guarda con modelo, prompt y política para que la página lo
// muestre, la fusión lo consulte y la caché evite repetir la llamada. La tabla
// es historial: se lee el último por par.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ARTIST_MERGE_INSTRUCTIONS, ARTIST_MERGE_SCHEMA_VERSION, type ArtistMergeVerdict,
} from "../review/artist-merge.js";
import { EDITORIAL_POLICY_VERSION } from "./editorial-policy.js";
import type { OperatorContext } from "../merge/operator.js";

export const AI_VERDICT_PROMPT_VERSION = `${ARTIST_MERGE_SCHEMA_VERSION}:${createHash("sha256")
  .update(ARTIST_MERGE_INSTRUCTIONS).digest("hex").slice(0, 12)}`;
export const AI_VERDICT_POLICY_VERSION = String(EDITORIAL_POLICY_VERSION);

export interface StoredVerdict {
  id: number;
  decision: ArtistMergeVerdict["decision"];
  confidence: number;
  evidence: ArtistMergeVerdict["evidence"];
  reasoning: string;
  dataGaps: string[];
  identityDoubts: string[];
  model: string;
  promptVersion: string;
  policyVersion: string | null;
  createdAt: string;
}

type VerdictRow = {
  id: string; decision: string; confidence: string; evidence: unknown; reasoning: string;
  data_gaps: unknown; identity_doubts: unknown; model: string; prompt_version: string;
  policy_version: string | null; created_at: Date;
};

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asEvidence = (value: unknown): ArtistMergeVerdict["evidence"] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return typeof record["fact_id"] === "string" && (record["supports"] === "match" || record["supports"] === "separate")
        ? [{ fact_id: record["fact_id"], supports: record["supports"] as "match" | "separate" }]
        : [];
    })
    : [];

function mapVerdict(row: VerdictRow): StoredVerdict {
  return {
    id: Number(row.id),
    decision: row.decision as ArtistMergeVerdict["decision"],
    confidence: Number(row.confidence),
    evidence: asEvidence(row.evidence),
    reasoning: row.reasoning,
    dataGaps: asStringList(row.data_gaps),
    identityDoubts: asStringList(row.identity_doubts),
    model: row.model,
    promptVersion: row.prompt_version,
    policyVersion: row.policy_version,
    createdAt: row.created_at.toISOString(),
  };
}

/** Último veredicto del par; con `promptVersion`, solo si es de ese prompt. */
export async function latestVerdict(
  queryable: Pick<PoolClient, "query">, kind: string, aId: number, bId: number,
  options: { promptVersion?: string; model?: string } = {},
): Promise<StoredVerdict | null> {
  const a = Math.min(aId, bId);
  const b = Math.max(aId, bId);
  const params: unknown[] = [kind, a, b];
  const filters: string[] = [];
  if (options.promptVersion) {
    params.push(options.promptVersion);
    filters.push(`prompt_version=$${params.length}`);
  }
  if (options.model) {
    params.push(options.model);
    filters.push(`model=$${params.length}`);
  }
  const filter = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const { rows } = await queryable.query<VerdictRow>(`
    SELECT id::text,decision,confidence::text,evidence,reasoning,data_gaps,identity_doubts,model,prompt_version,policy_version,created_at
      FROM ingest.curation_ai_verdicts
     WHERE kind=$1 AND a_id=$2 AND b_id=$3${filter}
     ORDER BY created_at DESC, id DESC LIMIT 1`, params);
  return rows[0] ? mapVerdict(rows[0]) : null;
}

/** Guarda el veredicto dentro del run de la acción y devuelve su id. */
export async function recordVerdict(
  context: OperatorContext, kind: string, aId: number, bId: number,
  verdict: ArtistMergeVerdict, model: string,
): Promise<number> {
  const a = Math.min(aId, bId);
  const b = Math.max(aId, bId);
  const { rows } = await context.client.query<{ id: string }>(`
    INSERT INTO ingest.curation_ai_verdicts
      (kind,a_id,b_id,decision,confidence,evidence,reasoning,data_gaps,identity_doubts,model,prompt_version,policy_version,run_id)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)
    RETURNING id::text`,
  [
    kind, a, b, verdict.decision, verdict.confidence, JSON.stringify(verdict.evidence), verdict.reasoning,
    JSON.stringify(verdict.data_gaps), JSON.stringify(verdict.identity_doubts), model,
    AI_VERDICT_PROMPT_VERSION, AI_VERDICT_POLICY_VERSION, context.runId,
  ]);
  return Number(rows[0]!.id);
}
