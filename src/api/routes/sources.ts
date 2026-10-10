import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { idParamSchema } from "../schemas.js";
import { getSourceDetail, listSourcesRead } from "../repositories/sources.js";
import { listClaimsForEntity, listCreditSources, type ClaimEntityFilter } from "../repositories/claims.js";
import { paginationQuerySchema, toPage } from "../pagination.js";
import { notFound, badRequest } from "../http-errors.js";
import { OPERATOR_SECURITY } from "../auth.js";

const sourceSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  siteType: z.string(),
  accessStrategy: z.string().nullable(),
  requiresJs: z.boolean(),
  trustLevel: z.string(),
  enabled: z.boolean(),
  publicDisplay: z.boolean(),
  notes: z.string().nullable(),
});

const sourceDetailSchema = sourceSchema.extend({
  lastRun: z.object({
    id: z.number().int(), kind: z.string(), status: z.string(),
    startedAt: z.string(), finishedAt: z.string().nullable(),
  }).nullable(),
});

const claimSchema = z.object({
  id: z.number().int(),
  entityKind: z.string(),
  field: z.string(),
  rawValue: z.unknown(),
  normalizedValue: z.unknown(),
  confidence: z.string(),
  status: z.string(),
  sourceId: z.number().int(),
  sourceName: z.string(),
  sourceUrl: z.string().nullable(),
  pageUrl: z.string().nullable(),
  evidence: z.array(z.object({ url: z.string().nullable(), excerpt: z.string().nullable() })),
  seedRowNumber: z.number().int().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});

const CLAIM_ENTITIES = ["artist", "person", "organization", "album", "track", "album_credit", "track_credit"] as const;

const claimsQuerySchema = paginationQuerySchema.extend({
  entity: z.enum(CLAIM_ENTITIES),
  id: z.coerce.number().int().positive(),
});

export async function registerSourceRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/credit-sources", {
    schema: {
      tags: ["sources"], security: OPERATOR_SECURITY,
      summary: "Fuentes de cada crédito de un disco o pista. Solo administradores.",
      querystring: z.object({ entity: z.enum(["album", "track"]), id: z.coerce.number().int().positive() }),
      response: { 200: z.array(z.object({ entityKind: z.enum(["album_credit", "track_credit"]), entityId: z.number().int(), claims: z.array(claimSchema) })) },
    },
  }, async (request) => listCreditSources(request.query.entity, request.query.id));

  server.get("/sources", {
    schema: { tags: ["sources"], security: OPERATOR_SECURITY, summary: "Fuentes del catálogo. Solo administradores.", response: { 200: z.array(sourceSchema) } },
  }, async () => listSourcesRead());

  server.get("/sources/:id", {
    schema: { tags: ["sources"], security: OPERATOR_SECURITY, summary: "Detalle de una fuente. Solo administradores.", params: idParamSchema, response: { 200: sourceDetailSchema } },
  }, async (request) => {
    const detail = await getSourceDetail(request.params.id);
    if (!detail) throw notFound("source", request.params.id);
    return detail;
  });

  server.get("/claims", {
    schema: {
      tags: ["claims"],
      security: OPERATOR_SECURITY,
      summary: "Origen y evidencia de los datos de una entidad. Solo administradores; entity+id obligatorios.",
      querystring: claimsQuerySchema,
      response: { 200: z.object({
        data: z.array(claimSchema),
        pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
      }) },
    },
  }, async (request) => {
    const { entity, id, ...pagination } = request.query;
    if (!CLAIM_ENTITIES.includes(entity)) throw badRequest(`entidad de claim desconocida: ${entity}`);
    const { rows, total } = await listClaimsForEntity(entity as ClaimEntityFilter, id, pagination);
    return toPage(rows, total, pagination);
  });
}
