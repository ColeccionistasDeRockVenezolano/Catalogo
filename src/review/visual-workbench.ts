// Bandeja por ficha; las escrituras siguen pasando por merge y el diario.
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/client.js";
import { mergeClaim, resolveFieldConflict } from "../merge/engine.js";
import { OperatorError, withOperatorRun } from "../merge/operator.js";
import { resolvableSpec } from "../merge/specs.js";
import { getReviewEntity } from "./visual-identity.js";
import { loadClaimForApproval } from "./approval.js";
import type { ClaimToPersist } from "../claims/persistence.js";
import type { ClaimReviewChange, ClaimReviewDetail, ClaimReviewEntity, ClaimReviewGroup, ClaimReviewResult } from "../shared/claim-review.js";

type Queryable = Pick<Pool | PoolClient, "query">;
const GROUP_TARGETS = ["artist_id","person_id","organization_id","album_id","track_id","artist_membership_id","person_organization_id","album_credit_id","track_credit_id","album_format_id","video_id","media_link_id"] as const;

// Un homónimo con otro destino nunca se agrupa por compartir el nombre.
const GROUP_KEY = `COALESCE('target:' || COALESCE(c.artist_id,c.person_id,c.organization_id,c.album_id,c.track_id,
  c.artist_membership_id,c.person_organization_id,c.album_credit_id,c.track_credit_id,c.album_format_id,c.video_id,c.media_link_id)::text,
  'identity:' || c.identity_key, 'claim:' || c.id::text)`;
const TARGET_JOINS = `
 LEFT JOIN public.artists ar ON ar.id=c.artist_id
 LEFT JOIN public.persons pe ON pe.id=c.person_id
 LEFT JOIN public.organizations org ON org.id=c.organization_id
 LEFT JOIN public.tracks tr ON tr.id=c.track_id
 LEFT JOIN public.album_credits ac ON ac.id=c.album_credit_id
 LEFT JOIN public.track_credits tc ON tc.id=c.track_credit_id
 LEFT JOIN public.tracks ct ON ct.id=tc.track_id
 LEFT JOIN public.artist_members am ON am.id=c.artist_membership_id
 LEFT JOIN public.person_organizations po ON po.id=c.person_organization_id
 LEFT JOIN public.album_formats af ON af.id=c.album_format_id
 LEFT JOIN public.albums al ON al.id=COALESCE(c.album_id,tr.album_id,ac.album_id,ct.album_id,af.album_id)
 LEFT JOIN public.artists parent ON parent.id=COALESCE(al.artist_id,am.artist_id)
 LEFT JOIN public.persons related_person ON related_person.id=COALESCE(ac.person_id,tc.person_id,am.person_id,po.person_id)
 LEFT JOIN public.organizations related_org ON related_org.id=COALESCE(ac.organization_id,tc.organization_id,po.organization_id)
 LEFT JOIN public.artists related_artist ON related_artist.id=COALESCE(ac.artist_id,tc.artist_id)`;
const SNAPSHOT = `CASE c.entity_kind::text
 WHEN 'artist' THEN to_jsonb(ar) WHEN 'person' THEN to_jsonb(pe) WHEN 'organization' THEN to_jsonb(org)
 WHEN 'album' THEN to_jsonb(al) WHEN 'track' THEN to_jsonb(tr)
 WHEN 'album_credit' THEN to_jsonb(ac) WHEN 'track_credit' THEN to_jsonb(tc)
 WHEN 'artist_membership' THEN to_jsonb(am) WHEN 'person_organization' THEN to_jsonb(po)
 WHEN 'album_format' THEN to_jsonb(af) END`;
const ENTITY_SELECT = `c.entity_kind::text AS entity_kind,
 COALESCE(c.artist_id,c.person_id,c.organization_id,c.album_id,c.track_id,c.artist_membership_id,c.person_organization_id,c.album_credit_id,c.track_credit_id,c.album_format_id,c.video_id,c.media_link_id)::text AS target_id,
 COALESCE(ar.name,pe.name,org.name,tr.title,related_person.name,related_org.name,related_artist.name,al.title,c.identity_raw,c.identity_key,'Aporte sin identificar') AS name,
 concat_ws(' · ',parent.name,CASE WHEN c.entity_kind::text IN ('track','album_credit','track_credit','album_format') THEN al.title END,
   ar.origin_city,pe.nationality,org.country,ac.role,tc.role,am.role,po.role,al.release_year::text) AS context,
 COALESCE(ar.picture_url,pe.picture_url,org.picture_url,related_person.picture_url,related_org.picture_url,related_artist.picture_url,al.cover_url,parent.picture_url) AS image_url,
 al.id::text AS parent_album_id`;
interface EntityRow { entity_kind: string; target_id: string | null; name: string; context: string; image_url: string | null; parent_album_id: string | null; }
function entity(row: EntityRow): ClaimReviewEntity {
  return { kind: row.entity_kind, id: row.target_id === null ? null : Number(row.target_id), name: row.name,
    context: row.context || null, imageUrl: row.image_url, albumId: row.parent_album_id === null ? null : Number(row.parent_album_id) };
}
export interface WorkbenchQuery { limit: number; offset: number; q?: string | undefined; kind?: string | undefined; bucket?: string | undefined; }
function statuses(bucket?: string): string[] { return bucket === "conflict" ? ["conflict"] : bucket === "candidate" ? ["candidate"] : ["candidate", "conflict"]; }

export async function listClaimReviewGroups(query: WorkbenchQuery): Promise<{ data: ClaimReviewGroup[]; pagination: { total: number; limit: number; offset: number }; claims: number }> {
  const filter = `c.status=ANY($1::ingest.claim_status[]) AND ($2::text IS NULL OR c.entity_kind=$2::ingest.claim_entity_kind)
    AND ($3::text IS NULL OR c.identity_raw ILIKE '%' || $3 || '%' OR c.id::text=$3)`;
  const params = [statuses(query.bucket), query.kind || null, query.q?.trim() || null];
  const grouped = `SELECT min(c.id) AS id,count(*)::int AS pending,count(*) FILTER(WHERE c.status='conflict')::int AS conflicts,
    array_agg(DISTINCT s.name ORDER BY s.name) AS sources,array_agg(DISTINCT c.field ORDER BY c.field) AS fields
    FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id WHERE ${filter}
    GROUP BY c.entity_kind,${GROUP_KEY}`;
  type ListRow = { id: string; pending: number; conflicts: number; sources: string[]; fields: string[]; entity_kind: string; target_id: string | null; name: string };
  const result = await getPool().query<{ total: number; claims: number; items: ListRow[] }>(`
    WITH grouped AS MATERIALIZED (${grouped}),
    totals AS (SELECT count(*)::int AS total,COALESCE(sum(pending),0)::int AS claims FROM grouped),
    page AS (SELECT * FROM grouped ORDER BY conflicts ASC,id ASC LIMIT $4 OFFSET $5),
    items AS (SELECT g.*,c.entity_kind::text AS entity_kind,
      COALESCE(c.artist_id,c.person_id,c.organization_id,c.album_id,c.track_id,c.artist_membership_id,c.person_organization_id,c.album_credit_id,c.track_credit_id,c.album_format_id,c.video_id,c.media_link_id)::text AS target_id,
      COALESCE(c.identity_raw,c.identity_key,'Aporte sin identificar') AS name
      FROM page g JOIN ingest.claims c ON c.id=g.id)
    SELECT totals.*,COALESCE((SELECT jsonb_agg(to_jsonb(items) ORDER BY items.conflicts,items.id) FROM items),'[]'::jsonb) AS items
    FROM totals`, [...params, query.limit, query.offset]);
  const summary = result.rows[0]!;
  // Resolver las imágenes solo para esta página. Mezclar todos los puentes
  // con la agregación de decenas de miles de claims multiplica el trabajo.
  const data = await Promise.all(summary.items.map(async row => {
    let display: ClaimReviewEntity | null = null;
    if (row.target_id && resolvableSpec(row.entity_kind as ClaimToPersist["entityKind"])) display = await getReviewEntity(row.entity_kind,Number(row.target_id));
    else if (row.target_id) {
      const target = await getPool().query<EntityRow>(`SELECT ${ENTITY_SELECT} FROM ingest.claims c ${TARGET_JOINS} WHERE c.id=$1`,[row.id]);
      if (target.rows[0]) display = entity(target.rows[0]);
    }
    return { id: Number(row.id),entity: display ?? { kind: row.entity_kind,id: null,name: row.name,context: null,imageUrl: null,albumId: null },pending: row.pending,conflicts: row.conflicts,sources: row.sources,fields: row.fields };
  }));
  return { data,pagination: { total: summary.total,limit: query.limit,offset: query.offset },claims: summary.claims };

}

interface ConflictRow { id: number; a: number; b: number; }
interface ChangeRow extends EntityRow {
  id: string; field: string; raw_value: unknown; normalized_value: unknown; raw_hash: string; updated_at: string;
  status: string; confidence: string; source_name: string; source_url: string | null; snapshot: Record<string, unknown> | null;
  evidence: Array<{ url: string | null; excerpt: string | null }>;
  conflicts: ConflictRow[]; review_id: string | null; review_kind: string | null; group_key: string;
}
const CHANGE_SELECT = `SELECT c.id::text,c.field,c.raw_value,c.normalized_value,c.raw_hash,c.updated_at::text,
 c.status::text,c.confidence::text,s.name AS source_name,s.url AS source_url,${ENTITY_SELECT},${SNAPSHOT} AS snapshot,${GROUP_KEY} AS group_key,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('url',e.url,'excerpt',e.excerpt) ORDER BY e.id) FROM ingest.claim_evidence e WHERE e.claim_id=c.id),'[]'::jsonb) AS evidence,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cf.id,'a',cf.claim_a_id,'b',cf.claim_b_id) ORDER BY cf.id) FROM ingest.conflicts cf
  WHERE cf.status='open' AND (cf.claim_a_id=c.id OR cf.claim_b_id=c.id)),'[]'::jsonb) AS conflicts,
 rev.id::text AS review_id,rev.kind::text AS review_kind
 FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id ${TARGET_JOINS}
 LEFT JOIN LATERAL (SELECT q.id,q.kind FROM ingest.review_queue q WHERE (q.claim_a_id=c.id OR q.claim_b_id=c.id)
  AND q.status IN ('open','in_progress') AND q.kind NOT IN ('low_confidence','manual_review')
  AND (q.kind<>'field_conflict' OR q.conflict_id IS NULL) ORDER BY q.id LIMIT 1) rev ON true`;
function current(row: ChangeRow): { hasCurrentField: boolean; currentValue: unknown } {
  const spec = resolvableSpec(row.entity_kind as ClaimToPersist["entityKind"]);
  const column = spec?.fields[row.field];
  return { hasCurrentField: Boolean(column && row.snapshot && Object.hasOwn(row.snapshot, column)), currentValue: column ? row.snapshot?.[column] ?? null : null };
}
function version(row: ChangeRow): string {
  return createHash("sha256").update(JSON.stringify([row.id,row.updated_at,row.status,row.raw_hash,row.raw_value,row.normalized_value,row.snapshot,row.conflicts,row.review_id,row.evidence,row.confidence,row.source_name,row.source_url])).digest("hex");
}
function change(row: ChangeRow): ClaimReviewChange {
  const requiresReview = row.review_id !== null;
  return { id: Number(row.id), version: version(row), field: row.field, value: row.normalized_value ?? row.raw_value,
    ...current(row), status: row.status, confidence: row.confidence, sourceName: row.source_name, sourceUrl: row.source_url,
    evidence: row.evidence, reviewId: row.review_id === null ? null : Number(row.review_id), requiresReview,
    canAccept: !requiresReview && (row.status === "candidate" || (row.status === "conflict" && row.conflicts.length > 0)),
    canReject: !requiresReview && row.status === "candidate" };
}
export async function getClaimReviewGroup(id: number, query: Pick<WorkbenchQuery, "limit" | "offset" | "bucket">, db: Queryable = getPool()): Promise<ClaimReviewDetail | null> {
  const anchor = await db.query<Record<string,string | null>>(`SELECT c.* FROM ingest.claims c WHERE c.id=$1`, [id]);
  const key = anchor.rows[0];
  if (!key) return null;
  const target = GROUP_TARGETS.find(column => key[column] !== null);
  // Predicados sobre las FK/identidad indexadas; evitar calcular GROUP_KEY
  // sobre millones de claims cada vez que se abre una ficha.
  const identity = target ? `c.${target}=$2` : key["identity_key"] !== null
    ? `c.identity_key=$2 AND ${GROUP_TARGETS.map(column => `c.${column} IS NULL`).join(" AND ")}` : `c.id=$2`;
  const params = [key["entity_kind"],target ? key[target] : key["identity_key"] ?? id,statuses(query.bucket)];
  const where = `c.entity_kind=$1::ingest.claim_entity_kind AND ${identity} AND c.status=ANY($3::ingest.claim_status[])`;
  const rows = await db.query<ChangeRow>(`${CHANGE_SELECT} WHERE ${where} ORDER BY (c.field IN ('name','title')) DESC,c.field,c.id LIMIT $4 OFFSET $5`, [...params,query.limit,query.offset]);
  const totals = await db.query<{ total: number; conflicts: number; sources: string[]; fields: string[] }>(`SELECT count(*)::int AS total,count(*) FILTER(WHERE c.status='conflict')::int AS conflicts,
    array_agg(DISTINCT s.name ORDER BY s.name) AS sources,array_agg(DISTINCT c.field ORDER BY c.field) AS fields
    FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id WHERE ${where}`, params);
  const summary = totals.rows[0]!;
  // El ancla sigue permitiendo terminar la ficha tras resolver su último aporte.
  const first = rows.rows[0] ?? (await db.query<ChangeRow>(`${CHANGE_SELECT} WHERE c.id=$1`, [id])).rows[0]!;
  return { group: { id,entity: entity(first),pending: summary.total,conflicts: summary.conflicts,sources: summary.sources ?? [],fields: summary.fields ?? [] },
    changes: rows.rows.map(change),pagination: { total: summary.total,limit: query.limit,offset: query.offset } };
}

export async function decideClaimReview(input: {
  groupId: number; claims: Array<{ id: number; version: string }>; action: "accept" | "reject"; note: string; operator: string;
}): Promise<ClaimReviewResult> {
  const ids = input.claims.map(item => item.id);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new OperatorError("invalid", "Selecciona entre 1 y 100 aportes distintos.");
  const { runId, result } = await withOperatorRun({ name: `claims:visual-${input.action}`, operator: input.operator, note: input.note,
    params: { groupId: input.groupId,claimIds: ids,action: input.action } }, async context => {
    const db = context.client;
    // El aislamiento serializable rechaza una decisión si la ficha cambia
    // mientras se aplica, sin invertir los bloqueos internos del merge.
    await db.query("SELECT id FROM ingest.claims WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE", [ids]);
    const loaded = await db.query<ChangeRow>(`${CHANGE_SELECT} WHERE c.id=ANY($1::bigint[]) ORDER BY (c.field IN ('name','title')) DESC,c.id`, [ids]);
    const anchor = await db.query<{ entity_kind: string; group_key: string }>(`SELECT c.entity_kind::text,${GROUP_KEY} AS group_key FROM ingest.claims c WHERE c.id=$1`, [input.groupId]);
    const key = anchor.rows[0];
    if (!key || loaded.rows.length !== ids.length) throw new OperatorError("stale_preview", "Estos aportes cambiaron. Actualiza la ficha antes de decidir.");
    const selectedFields = new Map<string, string>();
    for (const row of loaded.rows) {
      const shown = input.claims.find(item => item.id === Number(row.id));
      if (row.entity_kind !== key.entity_kind || row.group_key !== key.group_key || shown?.version !== version(row)) {
        throw new OperatorError("stale_preview", "La ficha o sus aportes cambiaron. Actualiza para revisar los valores actuales.");
      }
      const item = change(row);
      if (!(input.action === "accept" ? item.canAccept : item.canReject)) throw new OperatorError("needs_review", "Este aporte necesita su comparación de identidad o conflicto.");
      const value = JSON.stringify(item.value);
      if (input.action === "accept" && selectedFields.has(row.field) && selectedFields.get(row.field) !== value) {
        throw new OperatorError("invalid", "Hay valores distintos para el mismo campo. Elige uno antes de aceptar.");
      }
      selectedFields.set(row.field,value);
    }
    const results: ClaimReviewResult["results"] = [];
    const signedNote = `[${input.operator}] ${input.note.trim()}`;
    for (const row of loaded.rows) {
      const id = Number(row.id);
      if (input.action === "reject") {
        await db.query("UPDATE ingest.claims SET status='rejected',notes=concat_ws(' · ',notes,$2::text),updated_at=now() WHERE id=$1", [id,signedNote]);
        results.push({ id,action: "rejected",detail: "Aporte descartado; su evidencia se conserva." });
      } else if (row.status === "conflict") {
        for (const conflict of row.conflicts) {
          await resolveFieldConflict(conflict.id, conflict.a === id ? "resolved_a" : "resolved_b", { actor: "human",note: signedNote,runId: context.runId,client: db });
        }
        results.push({ id,action: "accepted",detail: "Valor elegido y contradicción resuelta." });
      } else {
        const claim = await loadClaimForApproval(id, db);
        if (!claim) throw new OperatorError("stale_preview", "El aporte ya no está disponible.");
        const outcome = await mergeClaim({ ...claim,runId: context.runId,createdBy: "human" }, { id,inserted: false }, { client: db });
        const accepted = outcome.action === "applied" || outcome.action === "unchanged";
        const detail = accepted ? "Dato aceptado." : outcome.action === "conflict"
          ? "La propuesta contradice un dato existente. Compara los valores antes de elegir."
          : outcome.action === "unsupported" ? "Este tipo de dato necesita una revisión específica."
            : "Falta confirmar la ficha o su relación antes de aplicar este dato.";
        results.push({ id,action: accepted ? "accepted" : "pending",detail });
      }
    }
    const progressed = results.filter(item => item.action !== "pending").map(item => item.id);
    if (progressed.length) await db.query(`UPDATE ingest.review_queue SET status=$2,resolved_by='human',resolution_note=$3,resolved_at=now(),updated_at=now()
      WHERE claim_a_id=ANY($1::bigint[]) AND status IN ('open','in_progress') AND kind IN ('low_confidence','manual_review')`,
      [progressed,input.action === "reject" ? "dismissed" : "approved",signedNote]);
    return { results,accepted: results.filter(item => item.action === "accepted").length,rejected: results.filter(item => item.action === "rejected").length,pending: results.filter(item => item.action === "pending").length };
  }, { serializable: true }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "40001" || (error as { code?: string }).code === "40P01") {
      throw new OperatorError("stale_preview", "La ficha cambió mientras decidías. Actualiza y revisa de nuevo.");
    }
    throw error;
  });
  return { runId,...result };
}
