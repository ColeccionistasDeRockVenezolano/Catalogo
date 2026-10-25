import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { hashText } from "../../src/search/review-protocol.js";
import { archiveResourceFieldReview, projectResourceFieldReview, readResourceFieldReview, resourceFieldAdministration, resourceFieldReviewSchema, resourceFieldStatus } from "../../src/search/resource-field-review.js";

const reviewPath = "docs/unified-search/stage2/resource-field-review.json", roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const original = async () => resourceFieldReviewSchema.parse(JSON.parse(await readFile(reviewPath, "utf8")));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crv-resource-fields-")); roots.push(root);
  const review = await original();
  for (const input of review.inputs) {
    await mkdir(path.dirname(path.join(root, input.path)), { recursive: true });
    await writeFile(path.join(root, input.path), await readFile(input.path));
  }
  await mkdir(path.dirname(path.join(root, reviewPath)), { recursive: true });
  await writeFile(path.join(root, "proof.txt"), "fixture proof");
  review.evidence = [{ id: "fixture", path: "proof.txt", sha256: hashText("fixture proof") }];
  for (const resource of review.resources) for (const field of resource.fields)
    if (field.evidenceIds.length) field.evidenceIds = ["fixture"];
  const save = () => writeFile(path.join(root, reviewPath), JSON.stringify(review));
  await save(); return { root, review, save };
}

it("contrasta los 46 recursos y sus campos con el anexo real sin presentarlos como cobertura musical", async () => {
  const review = await readResourceFieldReview(process.cwd());
  expect(review.coverage.resources).toBe(46); expect(review.coverage.fields).toBe(107);
  expect(Object.values(review.coverage.dispositions).reduce((n, count) => n + count, 0)).toBe(107);
  expect(review.coverage.measures).toBe("field_dispositions_not_musical_coverage");
  const r03 = review.resources.find(r => r.id === "R03")!;
  expect(resourceFieldStatus(r03.fields)).toBe("partially_extracted");
  expect(r03.fields.find(f => f.key === "discography_reviews")!.disposition).toBe("deferred");
  const r04 = review.resources.find(r => r.id === "R04")!;
  expect(r04.fields.filter(f => ["review_title", "review_helpfulness"].includes(f.key)).every(f => f.disposition === "deferred")).toBe(true);
  expect(review.resources.find(r => r.id === "R16")!.fields.every(f => f.disposition === "excluded")).toBe(true);
  const projected = projectResourceFieldReview(review), serialized = JSON.stringify(projected);
  expect(projected.publicationAuthorized).toBe(false);
  for (const privateField of ["sha256", "sourceTerms", "sourceFieldText", "data/raw", "/mnt/1tb", "captureHash"])
    expect(serialized).not.toContain(privateField);
});

it("conserva el cotejo de evidencias cuando reports vive fuera del repositorio", async () => {
  const f = await fixture(), shared = await mkdtemp(path.join(os.tmpdir(), "crv-resource-shared-")); roots.push(shared);
  await rename(path.join(f.root, "reports"), path.join(shared, "reports"));
  await symlink(path.join(shared, "reports"), path.join(f.root, "reports"), "dir");
  expect((await readResourceFieldReview(f.root)).coverage.resources).toBe(46);
});

it("no acepta filas/campos duplicados, usos sin evidencia, reactivación R16 ni aprobación implícita", async () => {
  const review = await original();
  const duplicate = structuredClone(review); duplicate.resources[1] = duplicate.resources[0]!;
  expect(resourceFieldReviewSchema.safeParse(duplicate).success).toBe(false);
  const missing = structuredClone(review); missing.resources.pop();
  expect(resourceFieldReviewSchema.safeParse(missing).success).toBe(false);
  const unknown = structuredClone(review); unknown.resources[0]!.fields[0]!.evidenceIds = ["not-a-proof"];
  expect(resourceFieldReviewSchema.safeParse(unknown).success).toBe(false);
  unknown.resources[0]!.fields[0]!.evidenceIds = [];
  expect(resourceFieldReviewSchema.safeParse(unknown).success).toBe(false);
  const retired = structuredClone(review); retired.resources.find(r => r.id === "R16")!.fields[0]!.disposition = "preserved_development";
  expect(resourceFieldReviewSchema.safeParse(retired).success).toBe(false);
  expect(resourceFieldReviewSchema.safeParse({ ...review, publicationAuthorized: true }).success).toBe(false);
  expect(resourceFieldReviewSchema.safeParse({ ...review, automaticActivation: true }).success).toBe(false);
});

it("un literal técnico del anexo no puede quedar fuera de la disposición de campos", async () => {
  const review = await original();
  review.resources.find(r => r.id === "R03")!.fields.find(f => f.key === "discography_reviews")!.sourceTerms = ["otro campo"];
  expect(resourceFieldReviewSchema.safeParse(review).success).toBe(false);
});

it("un registro rehecho sin el campo del plan no supera el cotejo aunque se actualicen sus huellas", async () => {
  const f = await fixture();
  const filename = path.join(f.root, "docs/unified-search/resources.json");
  const registry = JSON.parse(await readFile(filename, "utf8"));
  registry.resources[0].fields += ", campo omitido del plan";
  const changed = JSON.stringify(registry); await writeFile(filename, changed);
  f.review.inputs.find(input => input.path === "docs/unified-search/resources.json")!.sha256 = hashText(changed);
  f.review.resources[0]!.sourceFieldText = registry.resources[0].fields; await f.save();
  await expect(readResourceFieldReview(f.root)).rejects.toThrow(/sin revisión vigente/);
});

it("una revisión ausente es distinta de evidencia faltante o cambiada", async () => {
  const f = await fixture(); expect((await resourceFieldAdministration(f.root))?.coverage.resources).toBe(46);
  await writeFile(path.join(f.root, "proof.txt"), "changed");
  await expect(resourceFieldAdministration(f.root)).rejects.toThrow(/obsoleta/);
  await rm(path.join(f.root, "proof.txt"));
  await expect(resourceFieldAdministration(f.root)).rejects.toThrow();
  await rm(path.join(f.root, reviewPath)); expect(await resourceFieldAdministration(f.root)).toBeNull();
});

it("rechaza rutas que escapan del proyecto y enlaces simbólicos ajenos", async () => {
  const f = await fixture(); f.review.evidence[0]!.path = "../proof.txt"; await f.save();
  await expect(readResourceFieldReview(f.root)).rejects.toThrow(/fuera del proyecto/);
  f.review.evidence[0]!.path = "proof.txt"; await f.save(); await rm(path.join(f.root, "proof.txt"));
  await symlink("/etc/hosts", path.join(f.root, "proof.txt"));
  await expect(readResourceFieldReview(f.root)).rejects.toThrow(/fuera del proyecto/);
});

it("el resumen conserva usos parciales y diferimientos sin declararlos una integración completa", () => {
  expect(resourceFieldStatus([{ disposition: "reused_existing" }, { disposition: "deferred" }])).toBe("mixed_dispositions");
  expect(resourceFieldStatus([{ disposition: "proposed" }])).toBe("reviewed_reuse_or_proposal");
  expect(resourceFieldStatus([{ disposition: "excluded" }])).toBe("excluded");
  expect(resourceFieldStatus([{ disposition: "deferred" }])).toBe("deferred");
  expect(() => resourceFieldStatus([])).toThrow();
});

it("conserva el corte y las pruebas por hash, es idempotente y exige otra revisión al cambiarlo", async () => {
  const f = await fixture(), first = await archiveResourceFieldReview(f.root);
  expect((await archiveResourceFieldReview(f.root)).cut).toEqual(first.cut);
  for (const pin of first.cut.inputs) expect(hashText(await readFile(path.join(f.root, first.cut.directory, pin.archived)))).toBe(pin.sha256);
  expect(hashText(await readFile(path.join(f.root, first.cut.directory, first.cut.source.archived)))).toBe(first.cut.source.sha256);
  f.review.resources[0]!.fields[0]!.reason = "Lectura corregida con criterio explícito"; await f.save();
  await expect(archiveResourceFieldReview(f.root)).rejects.toThrow(/incrementar revisión/);
  const [major,minor,patch]=f.review.revision.split(".").map(Number);
  f.review.revision = `${major}.${minor}.${patch!+1}`; await f.save();
  expect((await archiveResourceFieldReview(f.root)).cut.directory).toContain(f.review.revision);
  expect(hashText(await readFile(path.join(f.root, first.cut.directory, first.cut.source.archived)))).toBe(first.cut.source.sha256);
});
