import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { previewAlbumMerge, mergeAlbums, type AlbumMergePreview } from "../src/merge/album-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { writeAlbumClassifications } from "../src/catalog/album-classifications.js";
const out = process.env["LOBOTO_OUT"];
if (!out) throw new Error("LOBOTO_OUT must point to SSD staging");
const plan = [
  { keep: 433, drop: 41041, source: "https://www.lobotoradio.com/discos/colina", reason: "Mismo LP Colina, año 1984, sello Polydor y catálogo 30.479; la ficha Hippito está vacía de pistas." },
  { keep: 56, drop: 40152, source: "https://www.lobotoradio.com/discos/para-siempre", reason: "Mismo Para Siempre de Billy Se Fue de 2009; conservar EP documentado, digital es formato." },
  { keep: 40208, drop: 40209, source: "https://www.lobotoradio.com/discos/demo-1986", reason: "Mismo Demo 1986 de Cero a la Izquierda, edición digital de 2019 y once pistas idénticas; conservar demo y recopilación." },
  { keep: 3393, drop: 41016, source: "https://www.lobotoradio.com/discos/los-darts", reason: "Mismo LP Los Darts, 1966, Sonus LPS-1129; no incluye el EP 41013." },
];
const confirm = process.argv.includes("--confirm");
const note = "Brian, 2026-10-26: duplicados de discos contrastados con Lobotoradio y las fichas existentes; preservar tipos combinables, pistas, créditos, versiones y marcas de cada video.";
try {
  if (process.argv.includes("--preview")) {
    const db = await getPool().connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const previews = [];
      for (const g of plan) {
        const p = await previewAlbumMerge(db, g.keep, g.drop);
        previews.push(p);
        console.log(JSON.stringify({ keep: g.keep, drop: g.drop, tracks: [p.keep.tracks.length, p.drop.tracks.length], matched: p.matchedTracks, unmatched: p.unmatchedDropTracks, conflicts: p.fieldConflicts, warnings: p.warnings }));
      }
      const ids = plan.flatMap(g => [g.keep, g.drop]);
      const videoTracks = (await db.query("SELECT v.*,t.album_id,t.title FROM media.video_tracks v JOIN public.tracks t ON t.id=v.track_id WHERE t.album_id=ANY($1::bigint[])", [ids])).rows;
      const classifications = (await db.query("SELECT * FROM ingest.effective_album_classifications WHERE album_id=ANY($1::bigint[])", [ids])).rows;
      await db.query("COMMIT");
      writeFileSync(path.join(out, "album-merge-previews.json"), JSON.stringify(previews, null, 2));
      writeFileSync(path.join(out, "album-merge-video-tracks-before.json"), JSON.stringify(videoTracks, null, 2));
      writeFileSync(path.join(out, "album-classifications-before.json"), JSON.stringify(classifications, null, 2));
    } finally { db.release(); }
  } else {
    const baselines = JSON.parse(readFileSync(path.join(out, "album-merge-previews.json"), "utf8")) as AlbumMergePreview[];
    const result = await withOperatorRun({ name: "merge_albums", operator: "brian", note, params: { campaign: "lobotoradio-cotejo-2026-10-26", plan } }, async context => {
      const results = [];
      for (const g of plan) {
        const p = await previewAlbumMerge(context.client, g.keep, g.drop, { lock: true });
        if (baselines.find(b => b.keep.id === g.keep && b.drop.id === g.drop)?.previewHash !== p.previewHash) throw new Error(`Stale album preview ${g.keep}/${g.drop}`);
        if (p.unmatchedDropTracks.length || p.matchedTracks.some(t => t.matchType === "position")) throw new Error(`Ambiguous tracks ${g.keep}/${g.drop}`);
        const item = await mergeAlbums({ ...context, note: `${note} ${g.reason} Fuente: ${g.source}` }, { keepId: g.keep, dropId: g.drop, previewHash: p.previewHash, keepDropNameAsAlias: true, mode: "match" });
        if (g.keep === 40208) await writeAlbumClassifications({ ...context, note: `${g.reason} Fuente: ${g.source}` }, g.keep, ["Demos", "Compilation Album"], { addOnly: true });
        results.push({ ...item, title: p.keep.title, source: g.source, reason: g.reason });
        console.log(`${confirm ? "MERGED" : "DRY RUN"} album ${g.drop} → ${g.keep}: ${p.keep.title}`);
      }
      return results;
    }, { rollbackOnly: !confirm });
    writeFileSync(path.join(out, confirm ? "album-merges-applied.json" : "album-merges-dry-run.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ mode: confirm ? "confirmed" : "rollback", runId: result.runId, merges: result.result.length }));
  }
} finally { await closeDb(); }
