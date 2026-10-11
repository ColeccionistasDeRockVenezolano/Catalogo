import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { MODEL_TABLES, deleteModel, readModel, writeModel, type ModelInput } from "../../catalog/model.js";
import { withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { idParamSchema, writeErrorResponses } from "../schemas.js";
import { noteSchema } from "./catalog-writes.js";
import { dateValueText, parseDateValue } from "../../catalog/date-value.js";

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z.string().max(40).transform((input, ctx) => {
  try { return dateValueText(parseDateValue(input)); }
  catch(error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); return z.NEVER; }
});
const text = z.string().trim().min(1).max(250);
const notes = z.string().trim().max(20_000).nullable().optional();
const fields = {
  work: z.object({ title: text, artistId: positive, notes }),
  edition: z.object({ albumId: positive, workId: positive.nullable().optional(), releaseDate: date.nullable().optional(), editionName: text.nullable().optional(), notes }),
  identity: z.object({ personId: positive, artistId: positive, relationship: z.enum(["solo_identity","member","collaborator"]), period: date.nullable().optional(), notes }),
  support: z.object({ albumId: positive, albumFormatId: positive.nullable().optional(), format: text, discNumber: z.number().int().min(1).max(99), trackIds: z.array(positive).max(999).optional(), notes }),
  genre: z.object({ artistId: positive.optional(), personId: positive.optional(), albumId: positive.optional(), trackId: positive.optional(), genreId: positive.optional(), genreSlug: text.optional(), period: date.nullable().optional(), notes }),
};
export async function registerCatalogModelRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get("/catalog-model/:kind/:id", {
    schema: { tags: ["catalog-model"], security: OPERATOR_SECURITY,
      params: idParamSchema.extend({ kind: z.enum(["artist","person","album","track"]) }),
      response: { 200: z.unknown(), ...writeErrorResponses } },
  }, request => readModel(getPool(), request.params.kind, request.params.id));
  for (const kind of Object.keys(MODEL_TABLES) as Array<keyof typeof MODEL_TABLES>) {
    const shape: z.AnyZodObject = fields[kind];
    server.post(`/catalog-model/${kind}`, {
      schema: { tags: ["catalog-model"], security: OPERATOR_SECURITY, body: shape.extend({ note: noteSchema }).strict(),
        response: { 201: z.object({ id: positive, runId: positive }), ...writeErrorResponses } },
    }, async (request, reply) => {
      const { note, ...input } = request.body as ModelInput & {note:string};
      const result = await withOperatorRun({ name: `api:model:create:${kind}`, operator: request.operator, note }, ctx => writeModel(ctx,kind,input));
      return reply.status(201).send({ id: result.result, runId: result.runId });
    });
    server.patch(`/catalog-model/${kind}/:id`, {
      schema: { tags: ["catalog-model"], security: OPERATOR_SECURITY, params: idParamSchema,
        body: shape.partial().extend({ note: noteSchema }).strict(),
        response: { 200: z.object({ id: positive, runId: positive }), ...writeErrorResponses } },
    }, async request => {
      const { note, ...input } = request.body as ModelInput & {note:string};
      const result = await withOperatorRun({ name: `api:model:update:${kind}`, operator: request.operator, note }, ctx => writeModel(ctx,kind,input,request.params.id));
      return { id: result.result, runId: result.runId };
    });
    server.delete(`/catalog-model/${kind}/:id`, {
      schema: { tags: ["catalog-model"], security: OPERATOR_SECURITY, params: idParamSchema, querystring: z.object({ note: noteSchema }),
        response: { 200: z.object({ runId: positive }), ...writeErrorResponses } },
    }, async request => {
      const result = await withOperatorRun({ name: `api:model:delete:${kind}`, operator: request.operator, note: request.query.note }, ctx => deleteModel(ctx,kind,request.params.id));
      return { runId: result.runId };
    });
  }
}
