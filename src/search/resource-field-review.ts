import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashText } from "./review-protocol.js";
import { resolveProjectFile } from "../storage/project-files.js";

const text = z.string().trim().min(1), sha = z.string().regex(/^[a-f0-9]{64}$/);
// R01–R40 from the source report, R41–R44 from the plan, R45–R46 added after the report (Brian, 2026-10-25).
const resourceCount = 46;
const id = z.string().regex(/^R(?:0[1-9]|[1-3][0-9]|4[0-6])$/);
export const resourceFieldDisposition = z.enum(["reused_existing", "extracted_partial", "preserved_development", "proposed", "deferred", "excluded"]);
const pin = z.object({ path: text, sha256: sha }).strict();
export const resourceFieldReviewSchema = z.object({
  version: z.literal("crv-resource-field-review-v1"), revision: z.string().regex(/^\d+\.\d+\.\d+$/), analyst: text,
  policy: z.literal("analytical_dispositions_not_editorial_approvals_or_musical_coverage"),
  inputs: z.array(pin).length(3),
  evidence: z.array(pin.extend({ id: text }).strict()).min(1),
  resources: z.array(z.object({ id, sourceFieldText: text,
    fields: z.array(z.object({ key: text, label: text, sourceTerms: z.array(text).min(1), disposition: resourceFieldDisposition,
      scope: text, reason: text, nextTask: text, evidenceIds: z.array(text),
    }).strict()).min(1),
  }).strict()).length(resourceCount),
  publicationAuthorized: z.literal(false), automaticActivation: z.literal(false),
}).strict().superRefine((review, ctx) => {
  if (new Set(review.inputs.map(p => p.path)).size !== review.inputs.length
    || new Set(review.evidence.map(p => p.id)).size !== review.evidence.length
    || new Set(review.resources.map(r => r.id)).size !== review.resources.length)
    ctx.addIssue({ code: "custom", message: "Recurso, entrada o evidencia duplicados" });
  const evidence = new Set(review.evidence.map(e => e.id));
  for (const resource of review.resources) {
    if (new Set(resource.fields.map(f => f.key)).size !== resource.fields.length)
      ctx.addIssue({ code: "custom", message: `Campo duplicado: ${resource.id}` });
    for (const field of resource.fields) {
      if (new Set(field.evidenceIds).size !== field.evidenceIds.length || field.evidenceIds.some(ref => !evidence.has(ref)))
        ctx.addIssue({ code: "custom", message: `Evidencia desconocida: ${resource.id}/${field.key}` });
      if (!["deferred", "excluded"].includes(field.disposition) && !field.evidenceIds.length)
        ctx.addIssue({ code: "custom", message: `Uso sin evidencia: ${resource.id}/${field.key}` });
      if (resource.id === "R16" && field.disposition !== "excluded")
        ctx.addIssue({ code: "custom", message: "R16 permanece excluido, también como vocabulario o desarrollo" });
    }
    const terms = new Set(resource.fields.flatMap(f => f.sourceTerms));
    for (const match of resource.sourceFieldText.matchAll(/`([^`]+)`/gu))
      if (!terms.has(match[1]!)) ctx.addIssue({ code: "custom", message: `Campo de origen sin disposición: ${resource.id}/${match[1]}` });
  }
});
export type ResourceFieldReview = z.infer<typeof resourceFieldReviewSchema>;
const inputPaths = ["docs/unified-search/resources.json", "docs/unified-search/PLAN_1.1.0.md", "reports/alimentar-laya-contexto-2026-10-16.md"];

/** Verify the actual annex and all referenced bytes, not only the presence of
 * 46 rows. Counts describe analytical review; they never measure integration. */
export async function readResourceFieldReview(root: string) {
  const read = async (relative: string) => {
    const filename = await resolveProjectFile(root, relative);
    return readFile(filename);
  };
  const review = resourceFieldReviewSchema.parse(JSON.parse((await read("docs/unified-search/stage2/resource-field-review.json")).toString("utf8")));
  if (review.inputs.some(p => !inputPaths.includes(p.path)) || inputPaths.some(p => !review.inputs.some(i => i.path === p)))
    throw new Error("La revisión exige registro, plan y reporte originales");
  const sources = new Map<string, string>();
  for (const input of [...review.inputs, ...review.evidence]) {
    const bytes = await read(input.path);
    if (hashText(bytes) !== input.sha256) throw new Error(`Revisión de recursos obsoleta: ${input.path}`);
    if (inputPaths.includes(input.path)) sources.set(input.path, bytes.toString("utf8"));
  }
  const registry = z.object({ resources: z.array(z.object({ id, resource: text, fields: text, acceptance: text }).passthrough()).length(resourceCount) }).passthrough()
    .parse(JSON.parse(sources.get(inputPaths[0]!)!));
  const annex = new Map<string, { resource: string; fields: string; acceptance: string }>();
  for (const line of sources.get(inputPaths[1]!)!.split("\n")) {
    if (!/^\| R\d{2} · /u.test(line)) continue;
    const columns = line.split("|").map(column => column.trim());
    const resourceId = columns[1]!.match(/^R\d{2}/u)![0];
    if (annex.has(resourceId)) throw new Error("Recurso duplicado en el anexo");
    annex.set(resourceId, { resource: columns[1]!.replace(/^R\d{2} · /u, ""), fields: columns[2]!, acceptance: columns[6]! });
  }
  if (annex.size !== resourceCount || new Set(registry.resources.map(r => r.id)).size !== resourceCount) throw new Error("Anexo o registro incompletos");
  for (const resource of registry.resources) {
    const original = annex.get(resource.id), decision = review.resources.find(r => r.id === resource.id);
    if (!decision || decision.sourceFieldText !== resource.fields || original?.fields !== resource.fields
      || original.resource !== resource.resource || original.acceptance !== resource.acceptance)
      throw new Error(`Campos o criterio sin revisión vigente: ${resource.id}`);
  }
  const fields = review.resources.flatMap(r => r.fields);
  return { ...review, coverage: { resources: review.resources.length, fields: fields.length, evidenceFiles: review.evidence.length,
    dispositions: Object.fromEntries(resourceFieldDisposition.options.map(state => [state, fields.filter(f => f.disposition === state).length])),
    measures: "field_dispositions_not_musical_coverage" as const } };
}

/** No original source terms, capture paths, document pins or private file names
 * are included in the administrative projection. */
export function projectResourceFieldReview(review: Awaited<ReturnType<typeof readResourceFieldReview>>) {
  return { version: review.version, revision: review.revision, analyst: review.analyst, coverage: review.coverage, publicationAuthorized: false as const,
    resources: review.resources.map(resource => ({ id: resource.id, fields: resource.fields.map(field => ({
      key: field.key, label: field.label, disposition: field.disposition, scope: field.scope,
      reason: field.reason, nextTask: field.nextTask, evidenceCount: field.evidenceIds.length,
    })) })) };
}

export function resourceFieldStatus(fields: Array<{ disposition: z.infer<typeof resourceFieldDisposition> }>) {
  if (!fields.length) throw new Error("No hay campos revisados");
  if (fields.every(f => f.disposition === "excluded")) return "excluded";
  if (fields.every(f => f.disposition === "deferred")) return "deferred";
  if (fields.some(f => f.disposition === "extracted_partial")) return "partially_extracted";
  if (fields.some(f => f.disposition === "deferred")) return "mixed_dispositions";
  return "reviewed_reuse_or_proposal";
}

export async function resourceFieldAdministration(root: string) {
  try { await access(path.join(root, "docs/unified-search/stage2/resource-field-review.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  // An absent review is distinct from a present review with missing/stale proof.
  return projectResourceFieldReview(await readResourceFieldReview(root));
}

/** Immutable documentary cut, including the bytes used as proof. This is an
 * archive of inputs, not another catalog or editorial decision store. */
export async function archiveResourceFieldReview(root: string) {
  const review = await readResourceFieldReview(root);
  const sourcePath = "docs/unified-search/stage2/resource-field-review.json";
  const source = await readFile(path.join(root, sourcePath));
  const { coverage: _coverage, ...document } = review;
  if (JSON.stringify(resourceFieldReviewSchema.parse(JSON.parse(source.toString("utf8")))) !== JSON.stringify(document))
    throw new Error("La revisión cambió durante el corte");
  const directory = `reports/unified-search-stage2/resource-cuts/${review.revision}`;
  const put = async (relative: string, bytes: Buffer) => {
    const filename = path.join(root, directory, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    try { await writeFile(filename, bytes, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(filename)).equals(bytes)) throw new Error("El corte ya existe con otros bytes; incrementar revisión", { cause: error });
    }
  };
  await put("resource-field-review.json", source);
  const inputs: Array<{ role: string; path: string; sha256: string; archived: string }> = [];
  for (const [role, pins] of [["input", review.inputs], ["evidence", review.evidence]] as const) {
    for (const pin of pins) {
      const bytes = await readFile(path.join(root, pin.path));
      if (hashText(bytes) !== pin.sha256) throw new Error("La evidencia cambió durante el corte");
      const archived = `files/${pin.sha256}.bin`;
      await put(archived, bytes); inputs.push({ role, ...pin, archived });
    }
  }
  const cut = { version: "crv-resource-field-cut-v1", revision: review.revision,
    source: { path: sourcePath, sha256: hashText(source), archived: "resource-field-review.json" }, inputs };
  await put("inputs.json", Buffer.from(`${JSON.stringify(cut, null, 2)}\n`));
  return { review, cut: { directory, ...cut } };
}
