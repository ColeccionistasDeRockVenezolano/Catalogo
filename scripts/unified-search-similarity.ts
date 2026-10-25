import { writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/config/project-root.js";
import { buildSimilarityRelations, readAqusticoIdentities, readAqusticoSimilarCaptures, similarityFileSchema } from "../src/search/similarity-relations.js";

// R28 · relaciones de parecido de Aqustico como propuestas explicables (E2-09).
// Solo lee archivos; no escribe en la base ni asigna nada.
const root = projectRoot(import.meta.url), out = "reports/unified-search-stage2/similarity-relations.json";
const { relations, coverage } = buildSimilarityRelations(await readAqusticoSimilarCaptures(root), await readAqusticoIdentities(root));
const file = similarityFileSchema.parse({
  version: "crv-similarity-relations-0.1.0", resourceId: "R28", policy: "explainable_proposals_never_assignments",
  identityRule: "Origen y destino se resuelven a CRV solo con el cruce «probado» (nombre exacto + disco en común) o con el alta creada desde la propia ficha de Aqustico; el resto es referencia externa sin alta.",
  coverage, relations,
});
await writeFile(path.join(root, out), JSON.stringify(file, null, 2) + "\n");
console.log(JSON.stringify({ output: out, coverage }));
