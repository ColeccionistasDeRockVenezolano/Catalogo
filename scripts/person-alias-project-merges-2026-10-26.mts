// Brian: alias documentado + proyecto compartido + biografía compatible.
// Dry run preserves the whole transaction only in memory; --confirm commits.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { previewEntityMerge, mergeEntities } from "../src/merge/entity-merge.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const out = process.env["PERSON_AUDIT_OUT"];
if (!out) throw new Error("PERSON_AUDIT_OUT must point to SSD staging");
const confirm = process.argv.includes("--confirm");
const biographyOnly = process.argv.includes("--biography-only");
const prefix = biographyOnly ? "biography-" : "";
const groups = biographyOnly ? [
  { keep: 486, drops: [56449, 55702, 56557] },
  { keep: 8636, drops: [55420] },
] : [
  { keep: 2704, drops: [39898], name: 'Miguel "El Enano" González' },
  { keep: 1672, drops: [1679] },
  { keep: 963, drops: [37085] },
  { keep: 473, drops: [855, 16811] },
  { keep: 112, drops: [4929] },
  { keep: 113, drops: [4928] },
  { keep: 657, drops: [37610] },
  { keep: 29, drops: [36377] },
  { keep: 3332, drops: [34904] },
  { keep: 1267, drops: [3454] },
  { keep: 190, drops: [2697, 5198] },
  { keep: 3779, drops: [5196] },
  { keep: 1081, drops: [5387] },
  { keep: 174, drops: [6611] },
  { keep: 544, drops: [539] },
  { keep: 3289, drops: [7910] },
  { keep: 1494, drops: [12778] },
  { keep: 669, drops: [6786] },
  { keep: 4693, drops: [398] },
];
const note = "Brian, 2026-10-26: misma persona por alias o sobrenombre documentado dentro de la ficha, proyecto común y biografías compatibles. Conservar textos, alias, créditos y redirecciones.";
const audit = JSON.parse(readFileSync(path.join(out, "audit.json"), "utf8")) as {
  candidates: Array<{ a: { id: number; name: string }; b: { id: number; name: string }; sharedArtists: unknown[]; sharedAlias: string[]; nickShared: string[] }>;
};
try {
  if (process.argv.includes("--preview")) {
    const db = await getPool().connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const previews = [];
      for (const group of groups) {
        for (const drop of group.drops) {
          const preview = await previewEntityMerge(db, "person", group.keep, drop);
          const prior = (await db.query("SELECT * FROM ingest.curation_distinct_pairs WHERE kind='person' AND ((a_id=$1 AND b_id=$2) OR (a_id=$2 AND b_id=$1))", [group.keep, drop])).rows;
          previews.push({ ...preview, prior });
          console.log(JSON.stringify({ keep: group.keep, drop, names: [preview.keep.name, preview.drop.name], bios: [preview.keep.fields["biography"], preview.drop.fields["biography"]], era: preview.eraConflict, conflicts: preview.fieldConflicts.filter(c => !["biography", "notes"].includes(c.field)), prior }));
        }
      }
      await db.query("COMMIT");
      writeFileSync(path.join(out, `${prefix}merge-previews.json`), JSON.stringify(previews, null, 2));
    } finally { db.release(); }
  } else {
    const result = await withOperatorRun({ name: "merge_entities", operator: "brian", note, params: { kind: "person", campaign: "personas-alias-2026-10-26", groups } }, async context => {
      const merged = [];
      for (const group of groups) {
        for (const drop of group.drops) {
          let evidence = audit.candidates.find(c => [c.a.id, c.b.id].includes(group.keep) && [c.a.id, c.b.id].includes(drop));
          if (!evidence && biographyOnly) {
            const bridges = JSON.parse(readFileSync(path.join(out, "biography-bridges.json"), "utf8")) as Array<{ a: { id: number; name: string }; b: { id: number; name: string }; quote: string; sharedArtistIds: number[]; matchedForm: string }>;
            const bridge = bridges.find(b => b.a.id === group.keep && b.b.id === drop && b.matchedForm.includes(" "));
            if (bridge) evidence = { a: bridge.a, b: bridge.b, sharedArtists: bridge.sharedArtistIds, sharedAlias: [bridge.matchedForm], nickShared: [] };
          }
          if (!evidence?.sharedArtists.length || (!evidence.sharedAlias.length && !evidence.nickShared.length)) throw new Error(`Missing alias/project evidence: ${group.keep}/${drop}`);
          const prior = await context.client.query("SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind='person' AND ((a_id=$1 AND b_id=$2) OR (a_id=$2 AND b_id=$1))", [group.keep, drop]);
          if (prior.rowCount) throw new Error(`Prior distinct decision: ${group.keep}/${drop}`);
          const preview = await previewEntityMerge(context.client, "person", group.keep, drop, { lock: true });
          const approved = JSON.parse(readFileSync(path.join(out, `${prefix}merge-previews.json`), "utf8")) as Array<{ keep: { id: number }; drop: { id: number }; previewHash: string }>;
          const baseline = approved.find(p => p.keep.id === group.keep && p.drop.id === drop);
          // A second drop in one group sees the first merge's new references.
          if (drop === group.drops[0] && baseline?.previewHash !== preview.previewHash) throw new Error(`Preview changed: ${group.keep}/${drop}`);
          if (preview.fieldConflicts.some(c => ["birth_date", "death_date", "birth_date_value", "death_date_value"].includes(c.field))) throw new Error(`Date conflict: ${group.keep}/${drop}`);
          const item = await mergeEntities(context, { kind: "person", keepId: group.keep, dropId: drop, previewHash: preview.previewHash, keepDropNameAsAlias: true, rewriteLater: true });
          merged.push({ ...item, keepName: preview.keep.name, dropName: preview.drop.name, evidence });
          console.log(`${confirm ? "MERGED" : "DRY RUN"} ${drop} → ${group.keep}: ${preview.drop.name} / ${preview.keep.name}`);
        }
        if (group.name) await updateEntity(context, "person", group.keep, { name: group.name });
      }
      return merged;
    }, { rollbackOnly: !confirm });
    writeFileSync(path.join(out, `${prefix}${confirm ? "merges-applied.json" : "merges-dry-run.json"}`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode: confirm ? "confirmed" : "rollback", runId: result.runId, merges: result.result.length }));
  }
} finally { await closeDb(); }
