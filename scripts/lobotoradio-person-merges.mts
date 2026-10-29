import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { previewEntityMerge, mergeEntities, type EntityMergePreview } from "../src/merge/entity-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";

const out = process.env["LOBOTO_OUT"];
if (!out) throw new Error("LOBOTO_OUT must point to SSD staging");
const confirm = process.argv.includes("--confirm");
interface Evidence { a: { id: number; name: string }; b: { id: number; name: string }; conflicts: string[]; sourceRecords: Array<{ url: string; forms: string[]; bio: string; projectIds: number[] }> }
interface Group { keep: number; drops: number[]; evidence: Evidence[] }
const plan = JSON.parse(readFileSync(path.join(out, "person-merge-plan.json"), "utf8")) as Group[];
const note = "Brian, 2026-10-26: cruce Lobotoradio con CRV. Misma identidad por nombre completo/alias documentado, proyecto común y biografías compatibles. Conservar biografías, créditos, fuentes y redirecciones.";
try {
  if (process.argv.includes("--preview")) {
    const db = await getPool().connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const previews: EntityMergePreview[] = [];
      for (const group of plan) for (const drop of group.drops) {
        const preview = await previewEntityMerge(db, "person", group.keep, drop);
        previews.push(preview);
        console.log(JSON.stringify({ keep: group.keep, drop, names: [preview.keep.name, preview.drop.name], conflicts: preview.fieldConflicts.filter(c => !["biography", "notes"].includes(c.field)), warnings: preview.warnings, era: preview.eraConflict }));
      }
      await db.query("COMMIT");
      writeFileSync(path.join(out, "person-merge-previews.json"), JSON.stringify(previews, null, 2));
    } finally { db.release(); }
  } else {
    const baselines = JSON.parse(readFileSync(path.join(out, "person-merge-previews.json"), "utf8")) as EntityMergePreview[];
    const result = await withOperatorRun({ name: "merge_entities", operator: "brian", note, params: { campaign: "lobotoradio-cotejo-2026-10-26", plan } }, async context => {
      const merged = [];
      for (const group of plan) for (const drop of group.drops) {
        const evidence = group.evidence.find(p => [p.a.id, p.b.id].includes(group.keep) && [p.a.id, p.b.id].includes(drop));
        if (!evidence || evidence.conflicts.length || !evidence.sourceRecords.some(r => r.projectIds.length)) throw new Error(`Missing approved evidence ${group.keep}/${drop}`);
        const distinct = await context.client.query("SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind='person' AND ((a_id=$1 AND b_id=$2) OR (a_id=$2 AND b_id=$1))", [group.keep, drop]);
        if (distinct.rowCount) throw new Error(`Prior distinct decision ${group.keep}/${drop}`);
        const preview = await previewEntityMerge(context.client, "person", group.keep, drop, { lock: true });
        const baseline = baselines.find(p => p.keep.id === group.keep && p.drop.id === drop);
        if (drop === group.drops[0] && baseline?.previewHash !== preview.previewHash) throw new Error(`Stale preview ${group.keep}/${drop}`);
        if (preview.eraConflict || preview.fieldConflicts.some(c => ["birth_date", "death_date"].includes(c.field))) throw new Error(`Dates/era conflict ${group.keep}/${drop}`);
        const mergeContext = { ...context, note: `${note} Evidencia: ${evidence.sourceRecords.map(r => r.url).join(", ")}` };
        const item = await mergeEntities(mergeContext, { kind: "person", keepId: group.keep, dropId: drop, previewHash: preview.previewHash, keepDropNameAsAlias: true, rewriteLater: true });
        merged.push({ ...item, keepName: preview.keep.name, dropName: preview.drop.name, sources: evidence.sourceRecords });
        console.log(`${confirm ? "MERGED" : "DRY RUN"} ${drop} → ${group.keep}: ${preview.drop.name} / ${preview.keep.name}`);
      }
      return merged;
    }, { rollbackOnly: !confirm });
    writeFileSync(path.join(out, confirm ? "person-merges-applied.json" : "person-merges-dry-run.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode: confirm ? "confirmed" : "rollback", runId: result.runId, merges: result.result.length }));
  }
} finally { await closeDb(); }
