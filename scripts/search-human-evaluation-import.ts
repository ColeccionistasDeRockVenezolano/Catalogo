// Carga a ingest.search_human_evaluations las lecturas que Brian hizo en el
// artefacto «Lecturas del buscador CRV» (exportadas con ArtifactData out_dir).
// Uso: tsx scripts/search-human-evaluation-import.ts <dir-con-json> [--evaluator "Administrador CRV"] [--apply]
// Sin --apply solo informa. Reusa saveBlindReading/saveVerdict: cita o versión
// distinta se rechaza y una lectura ciega ya guardada nunca se reescribe.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getPool, closeDb } from "../src/db/client.js";
import { projectRoot } from "../src/config/project-root.js";
import { blindSchema, saveBlindReading, saveVerdict, verdictSchema } from "../src/search/human-review.js";
import { annotationSchema } from "../src/search/knowledge-contracts.js";
import { hashText } from "../src/search/review-protocol.js";

const root = projectRoot(import.meta.url);
const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--evaluator");
const evaluator = args.includes("--evaluator") ? args[args.indexOf("--evaluator") + 1] : "Administrador CRV";
const apply = args.includes("--apply");
if (!dir || !evaluator) throw new Error("Uso: <dir-con-json> [--evaluator nombre] [--apply]");

const record = z.object({
  id: z.string(), study: z.string(), quote: z.string(), blind: blindSchema, blindAt: z.string().datetime(),
  verdict: verdictSchema.nullable(), note: z.string().max(1000).default(""), verdictAt: z.string().datetime().nullable(),
}).passthrough();

// Same sources as human-review.ts: development readings plus the R45/R46 extension stratum.
const studies = await Promise.all(["development-annotations.json", "extension-annotations.json"]
  .map(async f => JSON.parse(await readFile(path.join(root, "reports/unified-search-stage2", f), "utf8")) as { annotations: unknown[] }));
const annotations = new Map(studies.flatMap(s => s.annotations).map(a => annotationSchema.parse(a)).map(a => [a.id, a]));

async function jsonFiles(d: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...await jsonFiles(p)); else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const raw = await Promise.all((await jsonFiles(dir)).map(async f => JSON.parse(await readFile(f, "utf8"))));
const records = raw.map(r => record.parse(r.data ?? r));
const problems: string[] = [];
for (const r of records) {
  const a = annotations.get(r.id);
  if (!a) problems.push(`${r.id}: no está en el estudio vigente`);
  else if (a.study !== r.study || a.observation.quote !== r.quote) problems.push(`${r.id}: la cita o la versión cambió desde la lectura`);
}
const pool = getPool();
// A row whose quote or study version changed is stale: it gets a new reading, like the curation page does.
const existing = new Map((await pool.query<{ annotation_id: string; quote_sha256: string; study_version: string }>(
  "SELECT annotation_id,quote_sha256,study_version FROM ingest.search_human_evaluations WHERE evaluator=$1", [evaluator])).rows
  .filter(r => { const a = annotations.get(r.annotation_id); return a && r.quote_sha256 === hashText(a.observation.quote) && r.study_version === a.study; })
  .map(r => [r.annotation_id, r]));
const summary = { evaluator, files: records.length, annotations: annotations.size, blindNew: 0, blindKept: 0, verdicts: 0,
  pendingVerdict: records.filter(r => !r.verdict).length, problems };

if (!problems.length) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of records) {
      if (existing.has(r.id)) summary.blindKept++;
      else {
        await saveBlindReading(root, client, evaluator, r.id, r.blind);
        await client.query("UPDATE ingest.search_human_evaluations SET blind_at=$3 WHERE annotation_id=$1 AND evaluator=$2", [r.id, evaluator, r.blindAt]);
        summary.blindNew++;
      }
      if (r.verdict) {
        await saveVerdict(root, client, evaluator, r.id, r.verdict, r.note);
        await client.query("UPDATE ingest.search_human_evaluations SET verdict_at=$3 WHERE annotation_id=$1 AND evaluator=$2", [r.id, evaluator, r.verdictAt]);
        summary.verdicts++;
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
console.log(JSON.stringify({ ...summary, applied: apply && !problems.length }, null, 1));
await closeDb();
if (problems.length) process.exit(1);
