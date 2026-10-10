import { z } from "zod";

const citation = z.object({ url: z.string(), title: z.string(), quote: z.string(), origin: z.enum(["page", "search_snippet"]) });
const project = z.object({ name: z.string(), album: z.string().nullable(), year: z.number().nullable(), role: z.string(), evidence: z.array(citation),
  coverage: z.number().optional(), checks: z.object({ project: z.boolean(), album: z.boolean(), year: z.boolean(), role: z.boolean() }).optional() });
const person = z.object({ id: z.number(), name: z.string(), aliases: z.array(z.string()), birthDate: z.string().nullable(), deathDate: z.string().nullable(),
  chronology: z.object({ birthYear: z.number().nullable(), activeYears: z.array(z.number()), aliveOnlyYears: z.array(z.number()) }).optional(),
  projects: z.array(project), evidence: z.array(citation), missing: z.array(z.string()) });
export const personComparisonSchema = z.object({ rationale: z.string(), conclusion: z.enum(["same", "different", "mixed", "unknown"]), version: z.literal(3), catalogSignature: z.string(), stale: z.boolean(), a: person, b: person,
  rows: z.array(z.object({ key: z.string(), label: z.string(), a: z.array(z.string()), b: z.array(z.string()),
    status: z.enum(["match", "partial", "different", "missing", "unverified"]), points: z.number(), maximum: z.number(), explanation: z.string(), evidence: z.array(citation) })),
  bridge: z.array(citation), contradictions: z.array(z.string()), documentary: z.object({ a: z.number(), b: z.number(), bridge: z.number() }) });
