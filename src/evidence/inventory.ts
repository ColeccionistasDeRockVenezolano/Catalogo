import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WebPage } from "../ambiguity/web-search.js";
import { dateValueText, parseDateValue, type DateValue } from "../catalog/date-value.js";
import { sourceProvenance } from "./provenance.js";
import { OperatorError, updateEntity, type OperatorContext } from "../merge/operator.js";
import { canonicalFieldValue } from "../merge/engine.js";
import { ENTITY_SPECS, type ResolvableClaimKind } from "../merge/specs.js";

type Queryable = Pick<Pool | PoolClient, "query">;
export const FACT_STATES = ["pending", "verified", "contradicted", "unverifiable", "editorial"] as const;
export type FactState = typeof FACT_STATES[number];
export type EvidenceRole = "supports" | "contradicts" | "context";
export interface FactScope {
  /** Explicit source scope; an album ID identifies the existing catalog edition. */
  editionAlbumId?: number | undefined;
  artistId?: number | undefined;
  personId?: number | undefined;
}
export interface FactInput {
  kind: ResolvableClaimKind;
  entityId: number;
  field?: string | undefined;
  relation?: string | undefined;
  value: unknown;
  valueType: "scalar" | "date" | "relation";
  scope?: FactScope | undefined;
  period?: string | null | undefined;
  state: FactState;
  evidence: Array<{ fragmentId: number; role: EvidenceRole }>;
  claimId?: number | undefined;
}
export interface FactRecord {
  id: number;
  bindingId: number | null;
  kind: ResolvableClaimKind;
  originalEntityId: number;
  entityId: number | null;
  field: string | null;
  relation: string | null;
  value: unknown;
  valueType: FactInput["valueType"];
  scope: FactScope;
  period: DateValue | null;
  state: FactState;
  disposition: "pending" | "applied" | "rejected" | "superseded" | null;
  reason: string;
  operator: string;
  claimId: number | null;
  evidence: Array<Record<string, unknown>>;
}

/** Object order is not assertion identity; array order remains meaningful. */
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new OperatorError("invalid", "la estructura del hecho es demasiado profunda");
  if (Array.isArray(value)) {
    if (value.length > 500) throw new OperatorError("invalid", "la estructura del hecho contiene demasiados elementos");
    return value.map(item => canonical(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 100) throw new OperatorError("invalid", "la estructura del hecho contiene demasiados campos");
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, depth + 1)]));
  }
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const positiveId = (value: number) => Number.isSafeInteger(value) && value > 0;

/** A preserved extracted document, not an invented acquisition timestamp. */
export async function rememberEvidenceDocument(db: Queryable, page: WebPage): Promise<number> {
  const contentHash = createHash("sha256").update(page.content).digest("hex");
  if (contentHash !== page.contentHash) throw new OperatorError("invalid", "el contenido no coincide con el hash de la fuente");
  const provenance = sourceProvenance(page);
  const method = provenance.acquisitionMethod;
  const capturedAt = method === "unknown" ? null : provenance.capturedAt;
  if (!provenance.readAt) throw new OperatorError("invalid", "falta la fecha de lectura real de la fuente");
  // PostgreSQL normalizes the instant without discarding its microseconds.
  // The same timestamp written with a different UTC offset is the same key.
  const documentKey = (await db.query<{ key: string }>(`SELECT encode(sha256(convert_to(jsonb_build_object(
    'url',$1::text,'contentHash',$2::text,'capturedAt',to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'method',$4::text)::text,'UTF8')),'hex') AS key`,
  [page.url, contentHash, capturedAt, method])).rows[0]!.key;
  const inserted = await db.query<{ id: string }>(`
    INSERT INTO ingest.evidence_documents(document_key,url,title,content_text,content_hash,captured_at,acquisition_method,raw_capture_id,extraction_metadata)
    VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9::jsonb) ON CONFLICT(document_key) DO NOTHING RETURNING id::text`,
  [documentKey, page.url, page.title, page.content, contentHash, capturedAt, method,page.document?.captureId??null,page.document?JSON.stringify(page.document):null]);
  // A separate statement observes a competing insert after its commit.
  const id = Number(inserted.rows[0]?.id ?? (await db.query<{ id: string }>("SELECT id::text FROM ingest.evidence_documents WHERE document_key=$1", [documentKey])).rows[0]?.id);
  if (!positiveId(id)) throw new Error("no se pudo conservar el documento");
  await db.query("INSERT INTO ingest.evidence_reads(document_id,read_at) VALUES($1,$2::timestamptz) ON CONFLICT DO NOTHING", [id, provenance.readAt]);
  return id;
}

/** UTF-8 byte offsets are stable in UTF8 and the production SQL_ASCII database. */
export async function rememberEvidenceFragment(db: Queryable, documentId: number, quote: string, selector: string | null = null): Promise<number> {
  if (!positiveId(documentId) || !quote.trim()) throw new OperatorError("invalid", "documento y fragmento obligatorios");
  const row = (await db.query<{ content_text: string; extraction_metadata:import("../verification/documents/types.js").DocumentMetadata|null }>("SELECT content_text,extraction_metadata FROM ingest.evidence_documents WHERE id=$1", [documentId])).rows[0];
  if (!row) throw new OperatorError("not_found", "documento conservado inexistente", { documentId });
  const offset = row.content_text.indexOf(quote);
  if (offset < 0) throw new OperatorError("invalid", "el fragmento no aparece literalmente en el documento conservado");
  const legacy = (await db.query<{id:string}>(`SELECT f.id::text FROM ingest.evidence_fragments f
    JOIN ingest.evidence_documents d ON d.id=f.document_id WHERE f.document_id=$1 AND f.quote=$2
    AND f.offset_unit='database_character' AND f.start_offset=position($2 IN d.content_text)-1
    AND f.end_offset=f.start_offset+length($2) LIMIT 1`,[documentId,quote])).rows[0];
  if (legacy) return Number(legacy.id);
  const start = Buffer.byteLength(row.content_text.slice(0, offset), "utf8");
  const end = start + Buffer.byteLength(quote, "utf8");
  if(!selector&&row.extraction_metadata){
    const locations=row.extraction_metadata.locations.filter(location=>location.start<end&&location.end>start);
    selector=JSON.stringify({captureId:row.extraction_metadata.captureId,format:row.extraction_metadata.format,method:row.extraction_metadata.method,locations});
  }
  const inserted = await db.query<{ id: string }>(`
    INSERT INTO ingest.evidence_fragments(document_id,quote,start_offset,end_offset,selector,offset_unit)
    VALUES($1,$2,$3,$4,$5,'utf8_byte') ON CONFLICT(document_id,offset_unit,start_offset,end_offset) DO NOTHING RETURNING id::text`, [documentId, quote, start, end, selector]);
  return Number(inserted.rows[0]?.id ?? (await db.query<{ id: string }>("SELECT id::text FROM ingest.evidence_fragments WHERE document_id=$1 AND offset_unit='utf8_byte' AND start_offset=$2 AND end_offset=$3", [documentId, start, end])).rows[0]!.id);
}

function factValue(input: FactInput): unknown {
  if (input.valueType === "date") {
    if (typeof input.value !== "string") throw new OperatorError("invalid", "el valor de fecha debe expresar su precisión");
    try { return parseDateValue(input.value); }
    catch (error) { throw new OperatorError("invalid", (error as Error).message); }
  }
  if (input.valueType === "relation") {
    if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) throw new OperatorError("invalid", "una relación requiere extremos y contexto estructurados");
    return input.value;
  }
  if (input.value !== null && !["string", "number", "boolean"].includes(typeof input.value)) throw new OperatorError("invalid", "un campo escalar no admite objetos ni listas");
  if (typeof input.value === "number" && !Number.isFinite(input.value)) throw new OperatorError("invalid", "valor numérico inválido");
  return input.value;
}

/** Recording evidence never mutates the catalog or upgrades an AI assertion. */
export async function recordFact(context: OperatorContext, input: FactInput, actor: "human" | "system" | "ai" = "human"): Promise<{ factId: number; bindingId: number }> {
  const db = context.client;
  const spec = ENTITY_SPECS[input.kind];
  if (!spec || !positiveId(input.entityId) || !context.note.trim()) throw new OperatorError("invalid", "destino y motivo obligatorios");
  if (!!input.field === !!input.relation || (input.valueType === "relation") !== !!input.relation) throw new OperatorError("invalid", "el hecho debe tener un campo o una relación compatible con su valor");
  if ((input.field ?? input.relation ?? "").length > 80 || !(input.field ?? input.relation ?? "").trim()) throw new OperatorError("invalid", "destino de hecho inválido");
  if (!FACT_STATES.includes(input.state) || (actor !== "human" && ["verified", "editorial"].includes(input.state))) throw new OperatorError("invalid", "una afirmación automática no puede declararse verificada ni editorial");
  const value = factValue(input);
  let period: DateValue | null;
  try { period = input.period ? parseDateValue(input.period) : null; }
  catch (error) { throw new OperatorError("invalid", (error as Error).message); }
  const scope = input.scope ?? {};
  for (const [key, id] of Object.entries(scope)) {
    const scopeKinds: Record<string, ResolvableClaimKind> = { editionAlbumId: "album", artistId: "artist", personId: "person" };
    const kind = scopeKinds[key];
    if (!kind || typeof id !== "number" || !positiveId(id)) throw new OperatorError("invalid", "ámbito de hecho inválido");
    if (!(await db.query(`SELECT 1 FROM ${ENTITY_SPECS[kind].table} WHERE id=$1 FOR KEY SHARE`, [id])).rowCount) throw new OperatorError("not_found", "el destino del ámbito no existe", { key, id });
  }
  if (!(await db.query(`SELECT 1 FROM ${spec.table} WHERE id=$1 FOR KEY SHARE`, [input.entityId])).rowCount) throw new OperatorError("not_found", "la entidad del hecho no existe");
  if (input.claimId !== undefined && (!positiveId(input.claimId) || !(await db.query("SELECT 1 FROM ingest.claims WHERE id=$1", [input.claimId])).rowCount)) throw new OperatorError("not_found", "el claim del hecho no existe");
  const evidence = [...new Map(input.evidence.map(item => [`${item.fragmentId}:${item.role}`, item])).values()].sort((a, b) => a.fragmentId - b.fragmentId || a.role.localeCompare(b.role));
  for (const item of evidence) {
    if (!positiveId(item.fragmentId) || !["supports", "contradicts", "context"].includes(item.role)) throw new OperatorError("invalid", "referencia de evidencia inválida");
    if (!(await db.query("SELECT 1 FROM ingest.evidence_fragments WHERE id=$1", [item.fragmentId])).rowCount) throw new OperatorError("not_found", "fragmento de evidencia inexistente");
  }
  if (input.state === "verified") {
    const supporting = evidence.filter(item => item.role === "supports").map(item => item.fragmentId);
    const known = await db.query(`SELECT 1 FROM ingest.evidence_fragments f JOIN ingest.evidence_documents d ON d.id=f.document_id
      WHERE f.id=ANY($1::bigint[]) AND d.captured_at IS NOT NULL AND d.acquisition_method IN ('http','raw_archive') LIMIT 1`, [supporting]);
    if (!known.rowCount) throw new OperatorError("invalid", "un hecho verificado requiere una cita conservada con captura conocida");
  }
  const key = hash({ kind: input.kind, entityId: input.entityId, field: input.field ?? null, relation: input.relation ?? null, value, valueType: input.valueType, scope, period, state: input.state, actor, operator: context.operator, reason: context.note, claimId: input.claimId ?? null, evidence });
  const inserted = await db.query<{ id: string }>(`
    INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,field,relation,value,value_type,scope,period,documentary_state,created_by,operator,reason,claim_id,run_id)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15)
    ON CONFLICT(fact_key) DO NOTHING RETURNING id::text`,
  [key, input.kind, input.entityId, input.field ?? null, input.relation ?? null, JSON.stringify(value), input.valueType, JSON.stringify(scope), period === null ? null : JSON.stringify(period), input.state, actor, context.operator, context.note, input.claimId ?? null, context.runId]);
  const factId = Number(inserted.rows[0]?.id ?? (await db.query<{ id: string }>("SELECT id::text FROM ingest.catalog_facts WHERE fact_key=$1", [key])).rows[0]!.id);
  for (const item of evidence) await db.query("INSERT INTO ingest.catalog_fact_evidence(fact_id,fragment_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [factId, item.fragmentId, item.role]);
  const binding = await db.query<{ id: string }>(`
    INSERT INTO ingest.catalog_fact_bindings(fact_id,${spec.targetColumn}) VALUES($1,$2)
    ON CONFLICT(fact_id) DO NOTHING RETURNING id::text`, [factId, input.entityId]);
  const bindingId = Number(binding.rows[0]?.id ?? (await db.query<{ id: string }>("SELECT id::text FROM ingest.catalog_fact_bindings WHERE fact_id=$1", [factId])).rows[0]!.id);
  return { factId, bindingId };
}

export async function factRecord(db: Queryable, factId: number): Promise<FactRecord | null> {
  const result = await db.query<Record<string, unknown>>(`
    SELECT f.*, b.id AS binding_id, coalesce(b.artist_id,b.person_id,b.organization_id,b.album_id,b.track_id) AS entity_id,b.disposition,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('fragmentId',e.fragment_id,'role',e.role,'quote',fr.quote,'startOffset',fr.start_offset,'endOffset',fr.end_offset,'offsetUnit',fr.offset_unit,
        'documentId',d.id,'url',d.url,'title',d.title,'contentHash',d.content_hash,'capturedAt',d.captured_at,'acquisitionMethod',d.acquisition_method,
        'readAt',(SELECT max(r.read_at) FROM ingest.evidence_reads r WHERE r.document_id=d.id)) ORDER BY e.fragment_id,e.role)
        FROM ingest.catalog_fact_evidence e JOIN ingest.evidence_fragments fr ON fr.id=e.fragment_id JOIN ingest.evidence_documents d ON d.id=fr.document_id WHERE e.fact_id=f.id),'[]'::jsonb) AS evidence
    FROM ingest.catalog_facts f LEFT JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.id=$1`, [factId]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: Number(row["id"]), bindingId: row["binding_id"] === null ? null : Number(row["binding_id"]), kind: row["subject_kind"] as ResolvableClaimKind,
    originalEntityId: Number(row["original_subject_id"]), entityId: row["entity_id"] === null ? null : Number(row["entity_id"]), field: row["field"] as string | null,
    relation: row["relation"] as string | null, value: row["value"], valueType: row["value_type"] as FactInput["valueType"], scope: row["scope"] as FactScope,
    period: row["period"] as DateValue | null, state: row["documentary_state"] as FactState, disposition: row["disposition"] as FactRecord["disposition"],
    reason: row["reason"] as string, operator: row["operator"] as string, claimId: row["claim_id"] === null ? null : Number(row["claim_id"]), evidence: row["evidence"] as FactRecord["evidence"] };
}

/** Only an explicit editorial decision can apply an unverified assertion. */
export async function applyFact(context: OperatorContext, factId: number, options: { editorial: boolean }): Promise<void> {
  const fact = await factRecord(context.client, factId);
  if (!fact || fact.entityId === null || fact.bindingId === null) throw new OperatorError("not_found", "el hecho no tiene un destino vigente");
  if (!context.note.trim()) throw new OperatorError("invalid", "motivo editorial obligatorio");
  if (fact.state !== "verified" && !options.editorial) throw new OperatorError("needs_review", "el hecho no está comprobado; requiere una decisión editorial explícita");
  if (!fact.field || !ENTITY_SPECS[fact.kind].fields[fact.field] || fact.valueType === "relation") throw new OperatorError("invalid", "este hecho necesita un escritor específico de relación o ámbito");
  if (fact.period || Object.keys(fact.scope).length) throw new OperatorError("invalid", "un hecho acotado a edición o período no se aplica como campo global");
  const spec = ENTITY_SPECS[fact.kind];
  if (!(await context.client.query(`SELECT id FROM ${spec.table} WHERE id=$1 FOR UPDATE`, [fact.entityId])).rowCount) {
    throw new OperatorError("stale_preview", "el destino del hecho cambió; vuelve a revisarlo");
  }
  await context.client.query("SELECT id FROM ingest.catalog_fact_bindings WHERE id=$1 FOR UPDATE", [fact.bindingId]);
  // A merge or undo may have changed the binding while the parent lock waited.
  // Recheck under both locks before making any catalog or decision writes.
  const current = await factRecord(context.client, factId);
  if (!current || current.bindingId !== fact.bindingId || current.entityId !== fact.entityId) {
    throw new OperatorError("stale_preview", "el destino del hecho cambió; vuelve a revisarlo");
  }
  const value = fact.valueType === "date" ? dateValueText(fact.value as DateValue) : fact.value;
  if (current.disposition === "applied") {
    const stored = (await context.client.query<{ value: unknown }>(`SELECT to_jsonb(t)->$2::text AS value FROM ${spec.table} t WHERE id=$1`, [fact.entityId, spec.fields[fact.field]])).rows[0]!.value;
    const wanted = canonicalFieldValue(value, fact.field, "human");
    if (stored === wanted) return;
    throw new OperatorError("not_open", "el hecho ya fue aplicado y el campo cambió después; registra una nueva decisión");
  }
  if (current.disposition !== "pending") throw new OperatorError("not_open", "el hecho ya tiene una decisión; registra una nueva afirmación");
  await updateEntity(context, fact.kind, fact.entityId, { [fact.field]: value });
  await context.client.query("UPDATE ingest.catalog_fact_bindings SET disposition='applied',decided_by=$2,decision_reason=$3 WHERE id=$1", [fact.bindingId, context.operator, context.note]);
}
