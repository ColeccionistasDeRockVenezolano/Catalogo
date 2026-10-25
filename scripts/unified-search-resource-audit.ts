import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/config/project-root.js";
import { archiveResourceFieldReview } from "../src/search/resource-field-review.js";

const root = projectRoot(import.meta.url), { review, cut } = await archiveResourceFieldReview(root);
const directory = path.join(root, "reports/unified-search-stage2");
await mkdir(path.join(directory, "verification"), { recursive: true });
const result = { ...review, cut, verified: "annex_registry_source_pins_and_field_dispositions",
  limits: "La disposición por campo no prueba cobertura musical, integración de recursos diferidos, aprobación editorial o despliegue",
  operationalDatabaseWrites: 0, wholeStageComplete: false };
await writeFile(path.join(directory, "resource-field-review.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.join(directory, "verification/resource-field-audit.json"), `${JSON.stringify({
  version: review.version, revision: review.revision, cut, coverage: review.coverage, inputs: review.inputs,
  evidence: review.evidence, publicationAuthorized: false, operationalDatabaseWrites: 0,
}, null, 2)}\n`);
console.log(JSON.stringify(review.coverage));
