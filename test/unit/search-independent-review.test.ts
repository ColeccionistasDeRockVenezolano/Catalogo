import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readIndependentReview } from "../../src/search/independent-review.js";
import { hashText } from "../../src/search/review-protocol.js";

const reviewPath = "docs/unified-search/stage2/independent-review-claude.json";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada caso altera el JSON de la revisión a su manera
async function fixture(mutate: (review: any, annotations: any) => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), "crv-independent-review-")); roots.push(root);
  const review = JSON.parse(await readFile(reviewPath, "utf8")), annotationsPath: string = review.input.path;
  const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
  mutate(review, annotations);
  const annotationText = JSON.stringify(annotations);
  review.input.sha256 = hashText(annotationText);
  for (const [file, body] of [[reviewPath, JSON.stringify(review)], [annotationsPath, annotationText]] as const) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), body);
  }
  return root;
}

it("cubre las 35 anotaciones con una segunda lectura ciega de IA, sin presentarla como evaluación humana; umbrales aprobados por Brian", async () => {
  const { review, meetsProposedThresholds, humanEvaluation, thresholdsApproved } = await readIndependentReview(process.cwd());
  expect(review.items).toHaveLength(35);
  expect(review.reviewer.kind).toBe("ai_model_distinct_from_first_analyst");
  expect(review.metrics.scopeErrors).toBe(0);
  expect(meetsProposedThresholds).toBe(true);
  expect(humanEvaluation).toBe(false); expect(thresholdsApproved).toBe(true);
  expect(review.rectificationStatus).toBe("applied_after_brian_approval");
});

it("rechaza acuerdos inflados, citas cambiadas y anotaciones sin revisar", async () => {
  await expect(readIndependentReview(await fixture(review => { review.metrics.blindAgreement.coverage = 0.9; })))
    .rejects.toThrow("Acuerdo declarado");
  await expect(readIndependentReview(await fixture((_r, a) => { a.annotations[0].observation.quote += "!"; })))
    .rejects.toThrow("Cita distinta");
  await expect(readIndependentReview(await fixture((review, a) => { a.annotations.push({ ...a.annotations[0], id: "E2-X99" }); review.input.annotations = 36; })))
    .rejects.toThrow("cada anotación");
  await expect(readIndependentReview(await fixture(review => { review.rectifications.pop(); })))
    .rejects.toThrow("Rectificaciones");
  await expect(readIndependentReview(await fixture(review => { delete review.thresholds.approvedAt; })))
    .rejects.toThrow("solo la da Brian");
});
