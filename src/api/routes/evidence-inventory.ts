import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { WebSearchBroker } from "../../ambiguity/web-search.js";
import { getPool } from "../../db/client.js";
import { FACT_STATES, applyFact, factRecord, recordFact, rememberEvidenceDocument, rememberEvidenceFragment } from "../../evidence/inventory.js";
import { OperatorError, withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { idParamSchema, writeErrorResponses } from "../schemas.js";
import { noteSchema } from "./catalog-writes.js";

const kind = z.enum(["artist", "person", "organization", "album", "track"]);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const factBody = z.object({
  kind, entityId: positive, field: z.string().trim().min(1).max(80).optional(), relation: z.string().trim().min(1).max(80).optional(),
  value: z.unknown(), valueType: z.enum(["scalar", "date", "relation"]),
  scope: z.object({ editionAlbumId: positive.optional(), artistId: positive.optional(), personId: positive.optional() }).strict().optional(),
  period: z.string().trim().min(1).max(40).nullable().optional(), state: z.enum(FACT_STATES),
  evidence: z.array(z.object({ fragmentId: positive, role: z.enum(["supports", "contradicts", "context"]) }).strict()).max(100),
  claimId: positive.optional(), note: noteSchema,
}).strict();

export async function registerEvidenceInventoryRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get("/evidence-inventory/documents/:id", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY, params: idParamSchema, response: { 200: z.unknown(), ...writeErrorResponses } },
  }, async request => {
    const result = await getPool().query<{ document: unknown }>(`SELECT jsonb_build_object(
      'id',d.id,'url',d.url,'title',d.title,'contentText',d.content_text,'contentHash',d.content_hash,
      'capturedAt',d.captured_at,'acquisitionMethod',d.acquisition_method,'recordedAt',d.recorded_at,
      'readCount',(SELECT count(*) FROM ingest.evidence_reads r WHERE r.document_id=d.id)) AS document
      FROM ingest.evidence_documents d WHERE d.id=$1`, [request.params.id]);
    if (!result.rows[0]) throw new OperatorError("not_found", "documento conservado inexistente");
    return result.rows[0].document;
  });
  server.get("/evidence-inventory/documents/:id/reads", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY, params: idParamSchema,
      querystring: z.object({ after: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      response: { 200: z.object({ reads: z.array(z.string()), next: z.string().nullable() }), ...writeErrorResponses } },
  }, async request => {
    const { after, limit } = request.query;
    if (!(await getPool().query("SELECT 1 FROM ingest.evidence_documents WHERE id=$1", [request.params.id])).rowCount) throw new OperatorError("not_found", "documento conservado inexistente");
    const rows = (await getPool().query<{ instant: string }>(`SELECT to_char(read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS instant
      FROM ingest.evidence_reads WHERE document_id=$1 AND ($2::timestamptz IS NULL OR read_at>$2::timestamptz) ORDER BY read_at LIMIT $3`, [request.params.id, after ?? null, limit + 1])).rows;
    return { reads: rows.slice(0, limit).map(row => row.instant), next: rows.length > limit ? rows[limit - 1]!.instant : null };
  });
  server.get("/evidence-inventory/facts/:id", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY, params: idParamSchema, response: { 200: z.unknown(), ...writeErrorResponses } },
  }, async request => {
    const fact = await factRecord(getPool(), request.params.id);
    if (!fact) throw new OperatorError("not_found", "hecho inexistente");
    return fact;
  });
  server.get("/evidence-inventory/facts", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY,
      querystring: z.object({ kind, entityId: z.coerce.number().int().positive(), after: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(50), history: z.enum(["true", "false"]).default("false") }),
      response: { 200: z.object({ items: z.array(z.unknown()), next: z.number().nullable() }), ...writeErrorResponses } },
  }, async request => {
    const { kind, entityId, after, limit, history } = request.query;
    const rows = (await getPool().query<{ id: string }>(`
      SELECT f.id::text FROM ingest.catalog_facts f LEFT JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id
      WHERE f.subject_kind=$1 AND f.id>$3 AND (b.${kind}_id=$2 OR ($4 AND f.original_subject_id=$2))
      ORDER BY f.id LIMIT $5`, [kind, entityId, after, history === "true", limit + 1])).rows;
    const selected = rows.slice(0, limit);
    return { items: await Promise.all(selected.map(row => factRecord(getPool(), Number(row.id)))), next: rows.length > limit ? Number(selected[selected.length - 1]!.id) : null };
  });
  server.post("/evidence-inventory/documents", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY,
      body: z.object({ url: z.string().url().max(2000), note: noteSchema }).strict(), response: { 201: z.object({ documentId: positive, runId: positive }), ...writeErrorResponses } },
  }, async (request, reply) => {
    const page = await new WebSearchBroker(getPool(), "").page(request.body.url);
    if (!page) throw new OperatorError("needs_review", "no se pudo obtener una fuente legible; su captura queda pendiente");
    const result = await withOperatorRun({ name: "api:evidence:document", operator: request.operator, note: request.body.note }, async context => ({ documentId: await rememberEvidenceDocument(context.client, page) }));
    return reply.status(201).send({ ...result.result, runId: result.runId });
  });
  server.post("/evidence-inventory/fragments", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY,
      body: z.object({ documentId: positive, quote: z.string().min(1).max(20_000), selector: z.string().max(2000).nullable().optional(), note: noteSchema }).strict(),
      response: { 201: z.object({ fragmentId: positive, runId: positive }), ...writeErrorResponses } },
  }, async (request, reply) => {
    const result = await withOperatorRun({ name: "api:evidence:fragment", operator: request.operator, note: request.body.note }, async context => ({ fragmentId: await rememberEvidenceFragment(context.client, request.body.documentId, request.body.quote, request.body.selector ?? null) }));
    return reply.status(201).send({ ...result.result, runId: result.runId });
  });
  server.post("/evidence-inventory/facts", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY, body: factBody,
      response: { 201: z.object({ factId: positive, bindingId: positive, runId: positive }), ...writeErrorResponses } },
  }, async (request, reply) => {
    const { note, ...input } = request.body;
    const result = await withOperatorRun({ name: "api:evidence:fact", operator: request.operator, note }, context => recordFact(context, { ...input, value: input.value }));
    return reply.status(201).send({ ...result.result, runId: result.runId });
  });
  server.post("/evidence-inventory/facts/:id/apply", {
    schema: { tags: ["evidence-inventory"], security: OPERATOR_SECURITY, params: idParamSchema,
      body: z.object({ editorial: z.boolean().default(false), note: noteSchema }).strict(), response: { 200: z.object({ factId: positive, runId: positive }), ...writeErrorResponses } },
  }, async request => {
    const result = await withOperatorRun({ name: "api:evidence:apply", operator: request.operator, note: request.body.note }, context => applyFact(context, request.params.id, { editorial: request.body.editorial }));
    return { factId: request.params.id, runId: result.runId };
  });
}
