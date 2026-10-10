// CRV · Candidatos de duplicado de persona en la API (PHASES E11.5; plan P10).
//
// Lista de solo lectura de las revisiones vivas `person_duplicate`: el par,
// sus créditos, el score y las features con que el detector lo propuso. La
// decisión (fusionar o «son distintas») se toma en la ficha o en la cola.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { compareCatalog } from "../../review/person-comparison.js";
import { personComparisonSchema } from "../person-comparison-schema.js";
import { z } from "zod";
import { paginationQuerySchema, toPage } from "../pagination.js";
import { listPersonDuplicateCandidates } from "../repositories/persons.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { getPool } from "../../db/client.js";
import { loadPersonFacts, scorePersonPair } from "../../review/person-candidates.js";
import { declarePersonsDistinct, getActiveResearchJob, getPersonPairResearch, getResearchJob, isPairDeclaredDistinct, listPersonPairResearch, recoverResearchJobs, startPersonPairResearch, investigateAndSavePersonPair } from "../../ambiguity/person-pair-research.js";
import { notFound } from "../http-errors.js";

export const personDuplicateCandidateSchema = z.object({
  comparison: personComparisonSchema.nullable(),
  reviewId: z.number().int(),
  a: z.object({ id: z.number().int(), name: z.string(), creditCount: z.number().int() }),
  b: z.object({ id: z.number().int(), name: z.string(), creditCount: z.number().int() }),
  priority: z.number().int(),
  score: z.number().nullable(),
  effectiveScore: z.number().nullable(),
  scoreBlocked: z.string().nullable(),
  webVerdict: z.enum(["same", "different", "mixed", "unknown"]).nullable(),
  webRationale: z.string().nullable(),
  webEvidence: z.array(z.object({ supports: z.enum(["same", "different", "mixed"]) }).passthrough()),
  features: z.array(z.object({ key: z.string(), value: z.number(), evidence: z.string() })),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const listQuerySchema = paginationQuerySchema.extend({
  minScore: z.coerce.number().min(0).max(1).optional(),
});

export async function registerPersonCandidateRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  await recoverResearchJobs();

  const pairSchema = z.object({ aId: z.coerce.number().int().positive(), bId: z.coerce.number().int().positive() }).refine(
    ({ aId, bId }) => aId !== bId, "Selecciona dos personas distintas");
  const verificationSchema = z.object({
    id: z.number().int(), reviewId: z.number().int().nullable(), personId: z.number().int().nullable(),
    dossierHash: z.string(), status: z.string(),
    comparison: personComparisonSchema.nullable(),
    verdict: z.enum(["same", "different", "mixed", "unknown"]), rationale: z.string(),
    evidence: z.array(z.object({ url: z.string(), title: z.string(), quote: z.string(), supports: z.enum(["same", "different", "mixed"]) })),
    sources: z.array(z.object({ url: z.string(), title: z.string(), contentHash: z.string() })),
    createdAt: z.string(), reviewedBy: z.string().nullable(), reviewNote: z.string().nullable(),
    baseScore: z.number().nullable(), scoreBlocked: z.string().nullable(),
    declaredDistinct: z.boolean(),
    baseFeatures: z.array(z.object({ key: z.string(), value: z.number(), evidence: z.string() })),
  });
  const jobSchema = z.object({ id: z.number().int(), aId: z.number().int(), bId: z.number().int(),
    status: z.enum(["queued", "running", "done", "failed"]), error: z.string().nullable(),
    verificationId: z.number().int().nullable(), requestedAt: z.string(), finishedAt: z.string().nullable() });
  const withScore = async (aId: number, bId: number, verification: Awaited<ReturnType<typeof getPersonPairResearch>>) => {
    if (!verification) return null;
    const [allFacts, declaredDistinct] = await Promise.all([loadPersonFacts(getPool()), isPairDeclaredDistinct(aId, bId)]);
    const facts = new Map(allFacts.map((person) => [person.id, person]));
    const a = facts.get(aId);
    const b = facts.get(bId);
    const scored = a && b ? scorePersonPair(a, b) : null;
    const comparison = a && b ? compareCatalog(a, b, verification.comparison ?? null) : null;
    return { ...verification, comparison, baseScore: comparison ? comparison.rows.reduce((sum, row) => sum + row.points, 0) / 100 : null, scoreBlocked: scored?.blocked ?? null, declaredDistinct,
      baseFeatures: scored?.features ?? [] };
  };

  server.get("/persons/identity-research", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY, querystring: pairSchema, response: { 200: verificationSchema.nullable() } },
  }, async (request) => withScore(request.query.aId, request.query.bId,
    await getPersonPairResearch(request.query.aId, request.query.bId)));

  server.get("/persons/:id/identity-research", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY, params: z.object({ id: z.coerce.number().int().positive() }),
      response: { 200: z.array(z.object({ otherId: z.number().int(), otherName: z.string(), verificationId: z.number().int(),
        verdict: z.enum(["same", "different", "mixed", "unknown"]), rationale: z.string(), status: z.string(), createdAt: z.string(), declaredDistinct: z.boolean() })) } },
  }, async (request) => listPersonPairResearch(request.params.id));

  server.post("/persons/identity-research/jobs", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY,
      body: pairSchema, response: { 200: jobSchema } },
  }, async (request) => startPersonPairResearch(request.body.aId, request.body.bId));

  server.get("/persons/identity-research/active-job", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY, querystring: pairSchema, response: { 200: jobSchema.nullable() } },
  }, async (request) => getActiveResearchJob(request.query.aId, request.query.bId));

  server.get("/persons/identity-research/jobs/:id", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY, params: z.object({ id: z.coerce.number().int().positive() }), response: { 200: jobSchema } },
  }, async (request) => {
    const result = await getResearchJob(request.params.id);
    if (!result) throw notFound("investigación", request.params.id);
    return result;
  });

  server.post("/persons/identity-research/distinct", {
    schema: { tags: ["persons:merge"], security: OPERATOR_SECURITY,
      body: pairSchema.and(z.object({ note: z.string().trim().min(1).max(2000) })),
      response: { 200: z.object({ runId: z.number().int(), closedReviews: z.number().int() }) } },
  }, async (request) => declarePersonsDistinct(request.body.aId, request.body.bId, request.operator, request.body.note));

  // Los hallazgos «Fichas repetidas» pueden ser pares de personas sin una revisión
  // en review_queue. La investigación se muestra al operador y no cambia fichas.
  server.post("/persons/identity-research", {
    schema: {
      tags: ["persons:merge"], security: OPERATOR_SECURITY,
      body: z.object({ aId: z.number().int().positive(), bId: z.number().int().positive() }).strict().refine(
        ({ aId, bId }) => aId !== bId, "Selecciona dos personas distintas"),
      response: { 200: z.object({
        comparison: personComparisonSchema.nullable(),
    verdict: z.enum(["same", "different", "mixed", "unknown"]), rationale: z.string(),
        evidence: z.array(z.object({ url: z.string(), title: z.string(), quote: z.string(), supports: z.enum(["same", "different", "mixed"]) })),
        sources: z.array(z.object({ url: z.string(), title: z.string(), contentHash: z.string() })),
        baseScore: z.number().nullable(), scoreBlocked: z.string().nullable(),
        declaredDistinct: z.boolean(),
        baseFeatures: z.array(z.object({ key: z.string(), value: z.number(), evidence: z.string() })),
      }) },
    },
  }, async (request) => {
    const result = await investigateAndSavePersonPair(request.body.aId, request.body.bId);
    return (await withScore(request.body.aId, request.body.bId, result))!;
  });

  server.get("/persons/duplicate-candidates", {
    schema: {
      tags: ["persons:merge"],
      summary: "Pares de personas que el detector propone revisar, con score y features. Solo lectura.",
      querystring: listQuerySchema,
      response: { 200: z.object({
        data: z.array(personDuplicateCandidateSchema),
        pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
      }) },
    },
  }, async (request) => {
    const { rows, total } = await listPersonDuplicateCandidates(request.query);
    return toPage(rows, total, request.query);
  });
}
