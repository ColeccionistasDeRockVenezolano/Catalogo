import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { imageJobSchema, imageTaskSchema } from "../../shared/image-curation-jobs.js";
import { dismissImageJob, enqueueImageTasks, ImageCurationWorker, listImageJobs, retryImageJob, type ImageWorkerOptions } from "../../merge/image-curation-jobs.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { writeErrorResponses } from "../schemas.js";

export async function registerImageJobRoutes(app: FastifyInstance, options: ImageWorkerOptions & { worker?: boolean } = {}): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const worker = new ImageCurationWorker(options);
  if (options.worker !== false) {
    app.addHook("onReady", async () => { worker.start(); });
    app.addHook("onClose", async () => { await worker.stop(); });
  }
  const wake = () => { if (options.worker !== false) void worker.tick(); };
  server.get("/curation/images/jobs", {
    schema: { tags: ["curation"], response: { 200: z.array(imageJobSchema) } },
  }, async (_request, reply) => { reply.header("cache-control", "no-store"); return listImageJobs(); });
  server.post("/curation/images/jobs", {
    schema: { tags: ["curation"], security: OPERATOR_SECURITY, body: z.object({ tasks: z.array(imageTaskSchema).min(1).max(100) }).strict(), response: { 202: z.array(imageJobSchema), ...writeErrorResponses } },
  }, async (request, reply) => {
    const jobs = await enqueueImageTasks(request.body.tasks, request.operator);
    wake();
    return reply.code(202).send(jobs);
  });
  server.post("/curation/images/jobs/:id/retry", {
    schema: { tags: ["curation"], security: OPERATOR_SECURITY, params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({}).strict(), response: { 202: imageJobSchema, ...writeErrorResponses } },
  }, async (request, reply) => {
    const job = await retryImageJob(request.params.id); wake(); return reply.code(202).send(job);
  });
  server.post("/curation/images/jobs/:id/dismiss", {
    schema: { tags: ["curation"], security: OPERATOR_SECURITY, params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({}).strict(), response: { 200: z.object({ dismissed: z.literal(true) }), ...writeErrorResponses } },
  }, async request => { await dismissImageJob(request.params.id); return { dismissed: true as const }; });
}
