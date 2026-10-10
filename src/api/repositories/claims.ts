// CRV · Lectura de claims (PHASES §E7A: "lectura de fuentes, claims...").
// La tabla es grande (cientos de miles de filas, ver PHASES "Cierre F2–F5"):
// exigimos siempre un filtro por entidad, nunca un listado sin acotar.
import { getPool } from "../../db/client.js";
import { badRequest } from "../http-errors.js";
import type { PaginationQuery } from "../pagination.js";

const ENTITY_COLUMNS = {
  artist: "artist_id", person: "person_id", organization: "organization_id",
  album: "album_id", track: "track_id",
  album_credit: "album_credit_id", track_credit: "track_credit_id",
} as const;

export type ClaimEntityFilter = keyof typeof ENTITY_COLUMNS;

export interface ClaimRow {
  id: number;
  entityKind: string;
  field: string;
  rawValue: unknown;
  normalizedValue: unknown;
  confidence: string;
  status: string;
  sourceId: number;
  sourceName: string;
  sourceUrl: string | null;
  evidence: Array<{ url: string | null; excerpt: string | null }>;
  pageUrl: string | null;
  seedRowNumber: number | null;
  createdBy: string;
  createdAt: string;
}

type DbClaim = {
  id: string; entity_kind: string; field: string; raw_value: unknown; normalized_value: unknown;
  confidence: string; status: string; source_id: string; source_name: string; created_at: string;
  source_url: string | null; page_url: string | null; seed_row_number: number | null;
  created_by: string; evidence: ClaimRow["evidence"];
};

const CLAIM_SELECT = `SELECT c.id, c.entity_kind, c.field, c.raw_value, c.normalized_value,
  c.confidence, c.status, c.source_id, s.name AS source_name, s.url AS source_url,
  c.created_at::text AS created_at, COALESCE(NULLIF(rp.canonical_url, ''), rp.url) AS page_url,
  su.row_number AS seed_row_number, c.created_by,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'url', COALESCE(NULLIF(ce.url, ''), NULLIF(ep.canonical_url, ''), ep.url),
    'excerpt', ce.excerpt
  ) ORDER BY ce.captured_at, ce.id)
    FROM ingest.claim_evidence ce
    LEFT JOIN ingest.raw_pages ep ON ep.id = ce.raw_page_id
    WHERE ce.claim_id = c.id), '[]'::jsonb) AS evidence
  FROM ingest.claims c
  JOIN ingest.sources s ON s.id = c.source_id
  LEFT JOIN ingest.raw_pages rp ON rp.id = c.raw_page_id
  LEFT JOIN ingest.seed_uploads su ON su.id = c.seed_upload_id`;

function toClaim(row: DbClaim): ClaimRow {
  return {
    id: Number(row.id), entityKind: row.entity_kind, field: row.field,
    rawValue: row.raw_value, normalizedValue: row.normalized_value,
    confidence: row.confidence, status: row.status,
    sourceId: Number(row.source_id), sourceName: row.source_name, createdAt: row.created_at,
    sourceUrl: row.source_url, pageUrl: row.page_url, evidence: row.evidence,
    seedRowNumber: row.seed_row_number, createdBy: row.created_by,
  };
}

export async function listClaimsForEntity(
  entity: ClaimEntityFilter, entityId: number, query: PaginationQuery,
): Promise<{ rows: ClaimRow[]; total: number }> {
  const column = ENTITY_COLUMNS[entity];
  if (!column) throw badRequest(`entidad de claim desconocida: ${entity}`);
  const [rows, count] = await Promise.all([
    getPool().query<DbClaim>(
      `${CLAIM_SELECT} WHERE c.${column} = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT $2 OFFSET $3`,
      [entityId, query.limit, query.offset],
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ingest.claims WHERE ${column} = $1`, [entityId],
    ),
  ]);
  return { rows: rows.rows.map(toClaim), total: Number(count.rows[0]?.count ?? 0) };
}

export interface CreditSourceRow {
  entityKind: "album_credit" | "track_credit";
  entityId: number;
  claims: ClaimRow[];
}

/** Una consulta por ficha: créditos del disco y sus pistas, con evidencia directa y auditada.
 * La auditoría conserva créditos de varias pistas aunque el claim tenga solo la FK de la primera.
 */
export async function listCreditSources(entity: "album" | "track", id: number): Promise<CreditSourceRow[]> {
  const targets = await getPool().query<{ kind: CreditSourceRow["entityKind"]; id: string; claim_ids: string[] }>(`
    WITH credits AS (
      SELECT ac.id, 'album_credit' AS kind FROM public.album_credits ac WHERE $2 = 'album' AND ac.album_id = $1
      UNION ALL
      SELECT tc.id, 'track_credit' AS kind FROM public.track_credits tc JOIN public.tracks t ON t.id = tc.track_id
       WHERE ($2 = 'album' AND t.album_id = $1) OR ($2 = 'track' AND t.id = $1)
    )
    SELECT cr.kind, cr.id::text, ARRAY(
      SELECT c.id::text FROM ingest.claims c WHERE cr.kind = 'album_credit' AND c.album_credit_id = cr.id
      UNION
      SELECT c.id::text FROM ingest.claims c WHERE cr.kind = 'track_credit' AND c.track_credit_id = cr.id
      UNION
      SELECT mac.claim_id::text FROM ingest.merge_audit ma
        JOIN ingest.merge_audit_claims mac ON mac.merge_audit_id = ma.id
       WHERE cr.kind = 'album_credit' AND ma.album_credit_id = cr.id
      UNION
      SELECT mac.claim_id::text FROM ingest.merge_audit ma
        JOIN ingest.merge_audit_claims mac ON mac.merge_audit_id = ma.id
       WHERE cr.kind = 'track_credit' AND ma.track_credit_id = cr.id
    ) AS claim_ids FROM credits cr ORDER BY cr.kind, cr.id`, [id, entity]);
  const ids = [...new Set(targets.rows.flatMap((row) => row.claim_ids))];
  const claims = ids.length ? await getPool().query<DbClaim>(
    `${CLAIM_SELECT} WHERE c.id = ANY($1::bigint[]) ORDER BY c.created_at DESC, c.id DESC`, [ids],
  ) : { rows: [] };
  const ordered = claims.rows.map(toClaim);
  return targets.rows.map((target) => {
    const selected = new Set(target.claim_ids.map(Number));
    return { entityKind: target.kind, entityId: Number(target.id), claims: ordered.filter((claim) => selected.has(claim.id)) };
  });
}
