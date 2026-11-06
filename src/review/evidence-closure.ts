import { createHash } from "node:crypto";
import { z } from "zod";
import type { OperatorContext } from "../merge/operator.js";

export const evidenceSchema = z.object({
  url: z.string().min(1), kind: z.enum(["primary", "secondary", "catalogue", "archive"]),
  quote: z.string().min(1), consultedAt: z.string().min(1),
});
export const closureSchema = z.object({
  reviewId: z.number().int().positive(), expectedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  verdict: z.enum(["confirmed", "already_resolved", "false_positive", "unverifiable"]),
  reason: z.string().min(20), evidence: z.array(evidenceSchema).min(1),
  research: z.array(z.object({ query: z.string().min(3), status: z.number().int(), receipt: z.string().min(1) })).default([]),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  identityClaim: z.boolean().default(false),
  target: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, context) => {
  if (value.verdict === "unverifiable") {
    const searches = new Set(value.research.filter(r => r.status === 200).map(r => r.query));
    if (searches.size < 2) context.addIssue({ code: "custom", message: "No verificable exige al menos dos búsquedas distintas completadas; un error de red no prueba ausencia" });
  }
  if (value.verdict === "confirmed" && value.identityClaim) {
    if (!value.evidence.some(e => e.kind === "primary") || new Set(value.evidence.map(e => e.url)).size < 2) {
      context.addIssue({ code: "custom", message: "Una identidad nueva exige evidencia primaria y dos fuentes" });
    }
  }
  if (value.verdict === "already_resolved" && !value.target) context.addIssue({ code: "custom", message: "Ya resuelto exige identificar la fila existente" });
});
export type EvidenceClosure = z.infer<typeof closureSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Remove Spanish sentence fragments accidentally captured before a person's name. */
export function cleanBiographyPersonName(raw: string): string {
  let value = raw.split(/\b(?:son|fueron|eran|unen|ingresan|incorporan|incluyen|incluye|fundadores)\s+/iu).at(-1) ?? raw;
  value = value.replace(/^.*?\b(?:formad[oa]s?|conformad[oa]s?|integrad[oa]s?|liderad[oa]s?|fundad[oa]s?|compañía|destacando|destacan|destaca|encontramos)\s+(?:por|con|de|a)\s+/iu, "");
  return value.replace(/^(?:a la banda|al grupo|a)\s+/iu, "").replace(/^[\s.,:;]+|[\s.,:;]+$/gu, "");
}

/** A guest list is not a lineup. Preserve an explicit historical membership elsewhere. */
export function biographyMembershipContext(name: string, paragraphs: readonly string[]): "member" | "guest" | "unspecified" {
  let guest = false;
  for (const paragraph of paragraphs) {
    const position = paragraph.indexOf(name);
    if (position < 0) continue;
    const before = paragraph.slice(Math.max(0, position - 700), position).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const guests = [...before.matchAll(/colaboracion|invitad[oa]s?|participacion especial|colaboran|colaborador/gu)];
    const members = [...before.matchAll(/integrantes|miembros|fundadores|se unen|se incorporan|ingresan|integrad[oa] por|formad[oa] por|formacion/gu)];
    const lastGuest = guests.at(-1)?.index ?? -1;
    const lastMember = members.at(-1)?.index ?? -1;
    if (lastMember > lastGuest) return "member";
    if (lastGuest >= 0) guest = true;
  }
  return guest ? "guest" : "unspecified";
}
export function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Only relevant source text; changing an HTML footer must not resurrect a case. */
export function sourceReviewFingerprint(payload: Record<string, unknown>, source: {
  bio?: string[]; bio_roles?: Record<string, string[]>; albums?: Array<{ title?: string }>;
}): string {
  const name = typeof payload["name"] === "string" ? cleanBiographyPersonName(payload["name"]) : null;
  const title = typeof payload["title"] === "string" ? payload["title"] : null;
  if (name) {
    const mentions = source.bio?.filter(p => p.includes(name)) ?? [];
    const roles = Object.entries(source.bio_roles ?? {}).filter(([key]) => cleanBiographyPersonName(key) === name).flatMap(([, value]) => value);
    return evidenceHash({ url: payload["url"] ?? payload["sourceUrl"], name, mentions: mentions.length ? mentions : source.bio ?? [], roles: [...new Set(roles)] });
  }
  return evidenceHash({ url: payload["url"] ?? payload["sourceUrl"], title, entries: source.albums?.filter(a => a.title === title) ?? [] });
}

export function shouldReopenEvidenceCase(payload: Record<string, unknown>, currentFingerprint: string): boolean {
  const closure = payload["rhvClosure"] as { sourceFingerprint?: string; verdict?: string } | undefined;
  return Boolean(closure?.sourceFingerprint && closure.sourceFingerprint !== currentFingerprint);
}

/** A terminal queue state is not a claim that an unverified assertion is false. */
export async function closeEvidenceReview(context: OperatorContext, input: EvidenceClosure): Promise<{ id: number; changed: boolean }> {
  const decision = closureSchema.parse(input);
  const { rows } = await context.client.query<{ id: number; status: string; payload: Record<string, unknown> }>(
    "SELECT id::int,status::text,payload FROM ingest.review_queue WHERE id=$1 FOR UPDATE", [decision.reviewId]);
  const row = rows[0];
  if (!row) throw new Error(`Revisión inexistente: ${decision.reviewId}`);
  if (row.status !== "open" && row.status !== "in_progress") return { id: row.id, changed: false };
  if (evidenceHash(row.payload) !== decision.expectedPayloadHash) throw new Error(`La revisión cambió desde el cotejo: ${row.id}`);
  const status = ["confirmed", "already_resolved"].includes(decision.verdict) ? "approved" : "dismissed";
  const labels = { confirmed: "Confirmado", already_resolved: "Ya resuelto", false_positive: "Falso positivo", unverifiable: "No verificable" };
  const closure = { ...decision, runId: context.runId, closedAt: new Date().toISOString(), reopenOnEvidenceChange: true };
  await context.client.query(`UPDATE ingest.review_queue SET status=$2::ingest.review_status,resolved_by='human',resolved_at=now(),updated_at=now(),
    resolution_note=$3,payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{rhvClosure}',$4::jsonb) WHERE id=$1`,
    [row.id, status, `[${labels[decision.verdict]}] ${decision.reason} · run ${context.runId}`, JSON.stringify(closure)]);
  return { id: row.id, changed: true };
}
