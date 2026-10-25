import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { dailyCycleAt } from "../shared/daily-cycle.js";

export const dailyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(date => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}, "La fecha debe ser una fecha real en formato AAAA-MM-DD");
export const dailyCycleSchema = z.object({
  date: dailyDateSchema, day: z.number().int(), timeZone: z.string(), startsAt: z.string(), changesAt: z.string(),
});

export async function registerDailyCycleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/daily-cycle", {
    schema: { tags: ["search"], summary: "Reloj común para todas las selecciones diarias",
      response: { 200: dailyCycleSchema.extend({ serverNow: z.string() }) } },
  }, async (_request, reply) => {
    const now = new Date();
    reply.header("Cache-Control", "no-store");
    return { ...dailyCycleAt(now), serverNow: now.toISOString() };
  });
}
