import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OPERATOR_SECURITY } from "../auth.js";
import { idParamSchema, writeErrorResponses } from "../schemas.js";
import { notFound } from "../http-errors.js";
import { decideClaimReview, getClaimReviewGroup, listClaimReviewGroups } from "../../review/visual-workbench.js";

const paging = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25),offset: z.coerce.number().int().min(0).max(10_000_000).default(0),bucket: z.enum(["all","candidate","conflict"]).default("all") });
const entity = z.object({ kind: z.string(),id: z.number().int().nullable(),name: z.string(),context: z.string().nullable(),imageUrl: z.string().nullable(),albumId: z.number().int().nullable() });
const group = z.object({ id: z.number().int(),entity,pending: z.number().int(),conflicts: z.number().int(),sources: z.array(z.string()),fields: z.array(z.string()) });
const pagination = z.object({ limit: z.number().int(),offset: z.number().int(),total: z.number().int() });
const change = z.object({ id: z.number().int(),version: z.string(),field: z.string(),value: z.unknown(),currentValue: z.unknown(),hasCurrentField: z.boolean(),status: z.string(),confidence: z.string(),sourceName: z.string(),sourceUrl: z.string().nullable(),
  evidence: z.array(z.object({ url: z.string().nullable(),excerpt: z.string().nullable() })),reviewId: z.number().int().nullable(),requiresReview: z.boolean(),canAccept: z.boolean(),canReject: z.boolean() });
export async function registerClaimReviewRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get("/claims/review/groups", { schema: { tags: ["claims"],security: OPERATOR_SECURITY,
    querystring: paging.extend({ q: z.string().trim().max(200).optional(),kind: z.enum(["","artist","person","organization","album","track","artist_membership","person_organization","album_credit","track_credit","album_format","video","media_link"]).optional() }),
    response: { 200: z.object({ data: z.array(group),pagination,claims: z.number().int() }) } } }, async request => listClaimReviewGroups(request.query));
  server.get("/claims/review/groups/:id", { schema: { tags: ["claims"],security: OPERATOR_SECURITY,params: idParamSchema,querystring: paging,
    response: { 200: z.object({ group,changes: z.array(change),pagination }) } } }, async request => {
    const result = await getClaimReviewGroup(request.params.id,request.query);
    if (!result) throw notFound("claim",request.params.id);
    return result;
  });
  server.post("/claims/review/decide", { schema: { tags: ["claims"],security: OPERATOR_SECURITY,
    body: z.object({ groupId: z.number().int().positive(),claims: z.array(z.object({ id: z.number().int().positive(),version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(100),action: z.enum(["accept","reject"]),note: z.string().trim().min(1).max(2000) }).strict(),
    response: { 200: z.object({ runId: z.number().int(),results: z.array(z.object({ id: z.number().int(),action: z.string(),detail: z.string() })),accepted: z.number().int(),rejected: z.number().int(),pending: z.number().int() }),...writeErrorResponses } } },
  async request => decideClaimReview({ ...request.body,operator: request.operator }));
}
