import { readFile } from "node:fs/promises";
import { closeDb } from "../src/db/client.js";
import { importTrackContexts } from "../src/discovery/track-context-curation.js";
import { contextCoverage, contextReview, contextOntology } from "../src/discovery/track-contexts.js";
import { recordContextEvidence } from "../src/discovery/track-context-evidence.js";
const [command,arg] = process.argv.slice(2);
try {
  let result: unknown;
  if (command === "import" && arg) result = await importTrackContexts(JSON.parse(await readFile(arg,"utf8")),process.argv.includes("--apply"));
  else if (command === "evidence" && arg) result = await recordContextEvidence(JSON.parse(await readFile(arg,"utf8")),process.argv.includes("--apply"));
  else if (command === "coverage") {
    const offset = Number(arg ?? 0);
    if (!Number.isSafeInteger(offset) || offset<0) throw new Error("Offset inválido");
    result = await contextCoverage({ limit: 100, offset });
  } else if (command === "review" && arg && /^[1-9][0-9]*$/u.test(arg) && Number.isSafeInteger(Number(arg))) result = await contextReview(Number(arg));
  else if (command === "ontology") result = await contextOntology();
  else throw new Error("Uso: discovery:contexts -- import lote.json [--apply] | evidence evidencia.json [--apply] | coverage [offset] | review trackId | ontology");
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await closeDb(); }
