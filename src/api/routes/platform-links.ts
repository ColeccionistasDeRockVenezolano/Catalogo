import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { withOperatorRun } from "../../merge/operator.js";
import { linkStorage, writePlatformLink, type EditablePlatformLink } from "../../merge/platform-links.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { writeErrorResponses } from "../schemas.js";
import { noteSchema } from "./catalog-writes.js";

const params = z.object({ kind: z.enum(["artist", "album"]), id: z.coerce.number().int().positive(), category: z.enum(["social", "streaming"]) });
const link = z.object({ platform: z.string(), url: z.string(), handle: z.string().nullable(), verified: z.boolean() });
const writeResult = z.object({ runId: z.number().int() });
export async function registerPlatformLinkRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const path = "/catalog-links/:kind/:id/:category";
  server.get(path, {
    schema: { tags: ["catalog-links"], security: OPERATOR_SECURITY, params, response: { 200: z.array(link), ...writeErrorResponses } },
  }, async (request) => {
    const { kind, id, category } = request.params;
    const { table, column } = linkStorage(kind, category);
    const { rows } = await getPool().query<EditablePlatformLink>(
      `SELECT platform,url,${category === "social" ? "handle" : "NULL::text AS handle"},verified FROM public.${table} WHERE ${column}=$1 ORDER BY platform`, [id]);
    return rows;
  });
  server.patch(`${path}/:platform`, {
    schema: { tags: ["catalog-links:write"], security: OPERATOR_SECURITY, params: params.extend({ platform: z.string().max(24) }),
      body: z.object({ url: z.string().trim().url().max(2000).refine((url) => /^https?:\/\//u.test(url), "Usa una URL http o https."),
        handle: z.string().trim().max(120).nullable().optional(), verified: z.boolean(), note: noteSchema }).strict(),
      response: { 200: writeResult, ...writeErrorResponses } },
  }, async (request) => {
    const { kind, id, category, platform } = request.params;
    const { runId } = await withOperatorRun({ name: "api:save:catalog-link", operator: request.operator, note: request.body.note,
      params: { kind, id, category, platform } }, (context) => writePlatformLink(context, kind, id, category, platform,
        { url: request.body.url, handle: request.body.handle?.replace(/^@/u, "") || null, verified: request.body.verified }));
    return { runId };
  });
  server.delete(`${path}/:platform`, {
    schema: { tags: ["catalog-links:write"], security: OPERATOR_SECURITY, params: params.extend({ platform: z.string().max(24) }),
      querystring: z.object({ note: noteSchema }), response: { 200: writeResult, ...writeErrorResponses } },
  }, async (request) => {
    const { kind, id, category, platform } = request.params;
    const { runId } = await withOperatorRun({ name: "api:remove:catalog-link", operator: request.operator, note: request.query.note,
      params: { kind, id, category, platform } }, (context) => writePlatformLink(context, kind, id, category, platform, null));
    return { runId };
  });
}
