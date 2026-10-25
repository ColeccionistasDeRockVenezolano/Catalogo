import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { annotationSchema, KNOWLEDGE_VERSION } from "./knowledge-contracts.js";
import { enqueueKnowledgeBatch, feedBatchSchema, feedKey } from "./knowledge-feed.js";
import { extractReviews, hashText, REVIEW_EXTRACTOR_VERSION } from "./review-protocol.js";
import { assertDevelopmentSelection, resolveStudyRelease, studyReleaseFileSchema, studyReserveSchema } from "./study-identity.js";
import { resolveProjectFile } from "../storage/project-files.js";

const text = z.string().min(1), hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({ manifest: z.array(z.object({
  release: text, page: z.number().int().positive(), html: text, htmlHash: hash,
  capturedAt: text.nullable(),
}).passthrough()).max(5000) }).passthrough();
const artifactSchema = z.object({ annotations: z.array(annotationSchema).min(1).max(5000) }).passthrough();
export const studyFeedCursorSchema = z.object({ planHash: hash, offset: z.number().int().nonnegative() }).strict();
type Batch = z.infer<typeof feedBatchSchema>;
async function resolveFeedIdentity(root: string, spec: Parameters<typeof resolveStudyRelease>[1]) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='2s'");
    await client.query("SET LOCAL lock_timeout='500ms'");
    const identity = await resolveStudyRelease(root, spec, client);
    await client.query("COMMIT");
    return identity;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export interface StudyFeedPlan {
  version: "crv-study-feed-plan-v1";
  planHash: string;
  inputs: Array<{ path: string; sha256: string }>;
  batches: Batch[];
}

/** Only local project captures are read; no fetch, timer, model or catalog write.
 * Bounds also apply to symlinks and to files whose name contains traversal. */
async function pinnedRead(root: string, relative: string, maxBytes: number, capture = false) {
  const filename = await resolveProjectFile(root, relative, {
    dataOnly: capture, outsideMessage: "Archivo fuera del corte de conocimiento",
  });
  const info = await stat(filename);
  if (!info.isFile() || info.size > maxBytes) throw new Error("Archivo de conocimiento excede el límite");
  const bytes = await readFile(filename);
  if (bytes.length > maxBytes) throw new Error("Archivo de conocimiento excede el límite");
  return { content: bytes.toString("utf8"), pin: { path: relative, sha256: hashText(bytes) } };
}

/** R04 adapter: discovers eligible annotation/capture changes in the current
 * study, then re-extracts each cited review and revalidates existing catalog IDs.
 * An unseen capture without authored annotations remains outside this adapter;
 * it never invents a musical assertion to fill the pipeline. */
export async function prepareStudyFeed(root: string, resolveIdentity = resolveFeedIdentity): Promise<StudyFeedPlan> {
  const deadline = Date.now() + 20_000;
  let bytesRead = 0;
  const checkDeadline = () => { if (Date.now() > deadline) throw new Error("Preparación excede el presupuesto; conservar el corte y reintentar"); };
  const read = async (relative: string, capture = false) => {
    checkDeadline();
    const file = await pinnedRead(root, relative, 20 * 1024 * 1024, capture);
    bytesRead += Buffer.byteLength(file.content);
    if (bytesRead > 128 * 1024 * 1024) throw new Error("Corte excede 128 MiB de lecturas; dividir el estudio");
    checkDeadline();
    return file;
  };
  const filenames = ["reports/unified-search-stage2/development-annotations.json", "reports/unified-search-stage2/study.json",
    "docs/unified-search/stage2/study-releases.json", "docs/unified-search/stage2/study-reserve.json"];
  const files = await Promise.all(filenames.map(name => read(name)));
  const annotations = artifactSchema.parse(JSON.parse(files[0]!.content)).annotations;
  const manifest = manifestSchema.parse(JSON.parse(files[1]!.content)).manifest;
  const specs = studyReleaseFileSchema.parse(JSON.parse(files[2]!.content));
  const reserve = studyReserveSchema.parse(JSON.parse(files[3]!.content));
  const seen = new Set<string>();
  const located = annotations.map(annotation => {
    if (seen.has(annotation.id)) throw new Error("ID de afirmación duplicado en el estudio");
    seen.add(annotation.id);
    if (annotation.observation.resourceId !== "R04") throw new Error("Adaptador de estudio limitado a reseñas R04");
    const captures = manifest.filter(c => c.htmlHash === annotation.observation.captureHash && c.page === annotation.observation.page);
    if (captures.length !== 1) throw new Error("Afirmación sin captura única en el manifiesto");
    const capture = captures[0]!;
    const spec = specs.releases.find(s => s.release === capture.release);
    if (!spec) throw new Error("Falta vínculo documentado para la publicación de la afirmación");
    return { annotation, capture, spec };
  });
  // Check the reserve before opening any of its HTML or consulting its identity.
  assertDevelopmentSelection(located.map(c => c.capture.release), reserve.releases);
  const inputs = files.map(file => file.pin), groups = new Map<string, Batch>();
  const identities = new Map<string, Awaited<ReturnType<typeof resolveStudyRelease>>>();
  const captures = new Map<string, ReturnType<typeof extractReviews>>();
  for (const { annotation: a, capture, spec } of located) {
    checkDeadline();
    let identity = identities.get(spec.release);
    if (!identity) {
      for (const [filename, expected] of [[spec.html, spec.htmlHash], [spec.metadata, spec.metadataHash]] as const) {
        const file = await read(filename, true);
        if (file.pin.sha256 !== expected) throw new Error("Captura de identidad cambió; revisar el corte");
        if (!inputs.some(pin => pin.path === filename)) inputs.push(file.pin);
      }
      if (spec.importPlan && !inputs.some(pin => pin.path === spec.importPlan)) inputs.push((await read(spec.importPlan)).pin);
      identity = await resolveIdentity(root, spec); identities.set(spec.release, identity);
      checkDeadline();
    }
    let rows = captures.get(capture.html);
    if (!rows) {
      const file = await read(capture.html, true);
      if (file.pin.sha256 !== capture.htmlHash) throw new Error("Captura cambió; regenerar y revisar el estudio");
      rows = extractReviews({ html: file.content, source: capture.html, release: capture.release,
        capturedAt: capture.capturedAt ?? "unknown", page: capture.page });
      captures.set(capture.html, rows);
      if (!inputs.some(pin => pin.path === file.pin.path)) inputs.push(file.pin);
    }
    const matches = rows.filter(r => r.id === a.observation.reviewId);
    if (matches.length !== 1) throw new Error("Reseña ausente o repetida en su captura");
    const row = matches[0]!;
    if (row.flags.length || row.page !== a.observation.page || row.release !== capture.release
      || row.captureHash !== a.observation.captureHash || !row.text.includes(a.observation.quote) || row.account !== a.observation.account
      || row.url !== a.observation.source || row.locator !== a.observation.locator || row.visibleDate !== a.observation.visibleDate
      || row.capturedAt !== a.observation.capturedAtOriginal || a.observation.extractorVersion.split("+cross:")[0] !== REVIEW_EXTRACTOR_VERSION)
      throw new Error("Cita o atribución no coincide con la extracción reparada");
    const expectedRating = row.rating === null ? null : { value: row.rating, minimum: 0.5, maximum: 5, object: "album" };
    const expectedTrackRatings = row.trackRatings.map(r => ({ value: r.value, minimum: 0.5, maximum: 5, object: r.title }));
    if (JSON.stringify(a.layers.individualRating) !== JSON.stringify(expectedRating)
      || JSON.stringify(a.layers.trackRatings) !== JSON.stringify(expectedTrackRatings))
      throw new Error("Puntuación de la cuenta no coincide con su reseña");
    if (a.object.resolution !== "resolved" || (a.object.kind === "album"
      ? a.object.id !== identity.album.id || a.object.name !== identity.album.title
      : a.object.kind !== "track" || !identity.tracks.some(t => t.id === a.object.id && t.title === a.object.name)))
      throw new Error("Objeto de afirmación sin vínculo vigente con la publicación");
    if (JSON.stringify(a.object.identityEvidence.slice(0, identity.identityEvidence.length)) !== JSON.stringify(identity.identityEvidence))
      throw new Error("Evidencia de identidad cambió; regenerar y revisar el estudio");
    const sourceObject = `rym:reviews:${capture.release}:page:${capture.page}`;
    const candidate: Batch = { resourceId: "R04", sourceObject, captureHash: capture.htmlHash,
      extractorVersion: a.observation.extractorVersion, schemaVersion: KNOWLEDGE_VERSION, annotations: [a] };
    const key = feedKey(candidate);
    const group = groups.get(key);
    if (group) group.annotations.push(a); else groups.set(key, candidate);
  }
  const batches = [...groups.values()].map(batch => feedBatchSchema.parse({ ...batch,
    annotations: batch.annotations.sort((a, b) => a.id.localeCompare(b.id, "en")) })).sort((a, b) => feedKey(a).localeCompare(feedKey(b), "en"));
  inputs.sort((a, b) => a.path.localeCompare(b.path, "en"));
  // Detect edits during preparation too, before the first job can be written.
  for (const pin of inputs) {
    if ((await read(pin.path)).pin.sha256 !== pin.sha256)
      throw new Error("El corte cambió durante la preparación");
  }
  // Include content, not only feedKey: an altered analysis needs a version bump
  // and must invalidate a cursor even when source bytes stay identical.
  return { version: "crv-study-feed-plan-v1", planHash: hashText(JSON.stringify([inputs, batches])), inputs, batches };
}

/** Bounded, resumable discovery feeding the existing idempotent jobs. Concurrent
 * scans need no second lease: the job's existing unique key arbitrates enqueue.
 * A restart at zero is safe; a stale cursor must never skip a changed plan. */
export async function syncStudyFeed(plan: StudyFeedPlan, options: { dryRun?: boolean; limit?: number; cursor?: z.infer<typeof studyFeedCursorSchema> } = {}) {
  if (plan.version !== "crv-study-feed-plan-v1" || plan.planHash !== hashText(JSON.stringify([plan.inputs, plan.batches])))
    throw new Error("Plan de alimentación alterado");
  for (const batch of plan.batches) feedBatchSchema.parse(batch);
  const limit = options.limit ?? 10, cursor = options.cursor ? studyFeedCursorSchema.parse(options.cursor) : null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Sincronización entre 1 y 20 lotes");
  if (cursor && (cursor.planHash !== plan.planHash || cursor.offset > plan.batches.length)) throw new Error("El corte cambió; reiniciar sincronización desde cero");
  const offset = cursor?.offset ?? 0, portion = plan.batches.slice(offset, offset + limit);
  const jobs: Array<{ key: string; id: number | null; created: boolean | null }> = [];
  for (const batch of portion) {
    if (options.dryRun) jobs.push({ key: feedKey(batch), id: null, created: null });
    else { const result = await enqueueKnowledgeBatch(batch); jobs.push({ key: feedKey(batch), ...result }); }
  }
  const end = offset + portion.length;
  return { planHash: plan.planHash, dryRun: options.dryRun ?? false, total: plan.batches.length, processed: portion.length,
    created: jobs.filter(j => j.created === true).length, reused: jobs.filter(j => j.created === false).length, jobs,
    nextCursor: end < plan.batches.length ? { planHash: plan.planHash, offset: end } : null };
}
