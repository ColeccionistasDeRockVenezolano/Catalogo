import { z } from "zod";
const target = { requestId: z.string().uuid(), kind: z.enum(["album", "artist"]), entityId: z.number().int().positive(), note: z.string().trim().min(1).max(2000).optional() };
export const imageTaskSchema = z.discriminatedUnion("type", [
  z.object({ ...target, type: z.literal("decision"), candidateId: z.number().int().positive().nullable() }).strict(),
  z.object({ ...target, type: z.literal("inspection"), candidateIds: z.array(z.number().int().positive()).min(1).max(100) }).strict(),
]);
export type ImageTask = z.infer<typeof imageTaskSchema>;
export const imageJobSchema = z.object({
  id: z.number().int(), requestId: z.string(), type: z.enum(["decision", "inspection"]),
  groups: z.array(z.object({ kind: z.enum(["album", "artist"]), entityId: z.number().int(), name: z.string() })),
  candidateId: z.number().int().nullable(), status: z.enum(["queued", "running", "done", "error"]),
  error: z.string().nullable(), conflict: z.boolean(), result: z.string().nullable(), runId: z.number().int().nullable(),
  attempts: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
});
export type ImageJob = z.infer<typeof imageJobSchema>;
