import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { getEnv } from "../../config/env.js";
import { getPool } from "../../db/client.js";
import { ENTITY_FIELDS } from "./catalog-writes.js";
import { RELATION_ROUTES } from "./relation-writes.js";
import {
  applyPlan,
  getPlan,
  listPlans,
  recoverPlans,
  savePlan,
  decidePlan,
  refreshPlan,
  startPlan,
  waitForPlans,
} from "../../curation/ai/store.js";
import { describeFields } from "../../curation/ai/fields.js";
import { draftSchema } from "../../curation/ai/schema.js";
import type {
  CatalogDraft,
  CatalogVocabulary,
} from "../../curation/ai/types.js";
import { latestPersonArtistJob, recoverPersonArtistJobs, startPersonArtistJob, waitForPersonArtistJobs } from "../../curation/ai/person-artist.js";

export async function registerAiCurationRoutes(
  app: FastifyInstance,
): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const kind = z.enum(["artist", "person", "organization", "album", "track"]);
  const params = z.object({ id: z.coerce.number().int().positive() });
  await recoverPlans();
  await recoverPersonArtistJobs();
  app.addHook("onClose", waitForPlans);
  app.addHook("onClose", waitForPersonArtistJobs);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/curation/ai/"))
      reply.header("cache-control", "no-store");
    return payload;
  });
  server.get("/curation/ai/persons/:id/resolve-artist", {
    schema: {security: OPERATOR_SECURITY, params, response: {200: z.unknown()}},
  }, request => latestPersonArtistJob(request.params.id));
  server.post("/curation/ai/persons/:id/resolve-artist", {
    schema: {security: OPERATOR_SECURITY, params, response: {200: z.unknown()}},
  }, request => startPersonArtistJob(request.params.id, request.operator));
  server.get(
    "/curation/ai/vocabulary",
    { schema: { security: OPERATOR_SECURITY, response: { 200: z.unknown() } } },
    async (): Promise<CatalogVocabulary> => {
      const env = getEnv();
      return {
        configured: Boolean(env.DEEPSEEK_API_KEY),
        model: env.CRV_AI_CURATION_MODEL,
        modelLabel: "DeepSeek V4.1 Flash",
        maxCalls: env.CRV_AI_CURATION_MAX_CALLS,
        maxTokens: env.CRV_AI_CURATION_MAX_TOKENS,
        entities: Object.fromEntries(
          Object.entries(ENTITY_FIELDS).map(([k, v]) => [k, describeFields(v)]),
        ) as CatalogVocabulary["entities"],
        relations: Object.fromEntries(
          RELATION_ROUTES.map((r) => [r.kind, describeFields(r.create)]),
        ) as CatalogVocabulary["relations"],
        genres: (
          await getPool().query<CatalogVocabulary["genres"][number]>(
            'SELECT slug,name,level,parent_genre_id::int AS "parentGenreId" FROM ingest.genres WHERE active ORDER BY name',
          )
        ).rows,
      };
    },
  );
  server.get(
    "/curation/ai/plans",
    {
      schema: {
        security: OPERATOR_SECURITY,
        querystring: z.object({
          kind: kind.optional(),
          entityId: z.coerce.number().int().positive().optional(),
        }),
        response: { 200: z.unknown() },
      },
    },
    (request) => listPlans(request.query.kind, request.query.entityId),
  );
  server.get(
    "/curation/ai/plans/:id",
    {
      schema: {
        security: OPERATOR_SECURITY,
        params,
        response: { 200: z.unknown() },
      },
    },
    (request) => getPlan(request.params.id),
  );
  server.post(
    "/curation/ai/plans",
    {
      schema: {
        security: OPERATOR_SECURITY,
        body: z
          .object({
            kind,
            entityId: z.number().int().positive(),
            instruction: z.string().trim().min(10).max(6000),
          })
          .strict(),
        response: { 200: z.unknown() },
      },
    },
    (request) =>
      startPlan(
        request.body.kind,
        request.body.entityId,
        request.body.instruction,
        request.operator,
      ),
  );
  server.patch(
    "/curation/ai/plans/:id",
    {
      schema: {
        security: OPERATOR_SECURITY,
        params,
        body: z
          .object({
            revision: z.number().int().positive(),
            draft: draftSchema,
            reviewedKeys: z.array(z.string()).max(100),
          })
          .strict(),
        response: { 200: z.unknown() },
      },
    },
    (request) =>
      savePlan(
        request.params.id,
        request.body.revision,
        request.body.draft as CatalogDraft,
        request.body.reviewedKeys,
        request.operator,
      ),
  );
  server.post(
    "/curation/ai/plans/:id/decisions",
    {
      schema: {
        security: OPERATOR_SECURITY,
        params,
        body: z.object({ revision: z.number().int().positive(), key: z.string().min(1).max(40), decision: z.enum(["accepted", "rejected"]) }).strict(),
        response: { 200: z.unknown() },
      },
    },
    (request) => decidePlan(request.params.id, request.body.revision, request.body.key, request.body.decision, request.operator),
  );
  server.post(
    "/curation/ai/plans/:id/refresh",
    { schema: { security: OPERATOR_SECURITY, params, body: z.object({ revision: z.number().int().positive() }).strict(), response: { 200: z.unknown() } } },
    (request) => refreshPlan(request.params.id, request.body.revision, request.operator),
  );
  server.post(
    "/curation/ai/plans/:id/implement",
    {
      schema: {
        security: OPERATOR_SECURITY,
        params,
        body: z
          .object({
            revision: z.number().int().positive(),
            previewHash: z.string().length(64),
            confirmSensitive: z.boolean().default(false),
          })
          .strict(),
        response: { 200: z.unknown() },
      },
    },
    (request) =>
      applyPlan(
        request.params.id,
        request.body.revision,
        request.body.previewHash,
        request.body.confirmSensitive,
        request.operator,
      ),
  );
}
