// Solo previsualizaciones dentro de una transacción READ ONLY.
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { previewAlbumMerge } from "../src/merge/album-merge.js";

const dir = "reports/discos-tracklist-2026-10-15";
const editorial = JSON.parse(readFileSync(`${dir}/analisis-editorial.json`, "utf8")) as {
  decisions: Array<{ pair: string; verdict: string; suggestedKeep: number | null; albums: Array<{ id: number }> }>;
};
const rows = [];
const client = await getPool().connect();
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='60s'");
  for (const decision of editorial.decisions) {
    if (decision.verdict !== "consolidar" || !decision.suggestedKeep) continue;
    const keep = decision.suggestedKeep;
    const drop = decision.albums.find(a => a.id !== keep)!.id;
    const preview = await previewAlbumMerge(client, keep, drop);
    rows.push({
      pair: decision.pair, keep, drop, mode: preview.mode,
      matched: preview.matchedTracks.length,
      unmatched: preview.unmatchedDropTracks,
      positionOnlyMatches: preview.matchedTracks.filter(m => m.matchType === "position"),
      conflicts: preview.fieldConflicts, fill: preview.fieldsFilledFromDrop,
      warnings: preview.warnings, suggestion: preview.suggestion,
      hash: preview.previewHash,
    });
  }
  await client.query("ROLLBACK");
} finally { client.release(); await closeDb(); }
writeFileSync(`${dir}/previsualizaciones-sin-aplicar.json`, JSON.stringify({
  checkedAt: new Date().toISOString(), databaseWrites: 0, previews: rows,
}, null, 2) + "\n");
console.log(JSON.stringify(rows.map(r => ({
  pair: r.pair, matched: r.matched, unmatched: r.unmatched.length,
  positionOnly: r.positionOnlyMatches.length, suggestedMode: r.suggestion.mode,
  suggestedTitle: r.suggestion.title, conflicts: r.conflicts.map(c => c.field),
})), null, 2));
