// Discos repetidos en el core tras la Revisión de ingesta 2026-10-04 (Brian,
// 2026-10-04: «fusionar solo los seguros»).
//
//  1. Los Mentas, 2010: 600 (blog), 3390 (Sincopa) y 3360 (rockdevzla) son el
//     mismo disco, con las mismas 12 pistas. Queda el 600 y los otros títulos
//     pasan a alias.
//  2. Aditus «25 Aniversario» (Serie 32, 2000): 4619 y 2134 tienen las mismas
//     38 pistas. Queda el 4619; toma el año y el tipo «compilation» del 2134,
//     porque las dos reseñas lo describen como recopilatorio.
//  3. Aditus «Lo Mejor de» 1991/2000 (3638/3642) y Kiara «Exitos» 1994/2000
//     (4344/4345) se quedan separados como reediciones. Se declaran distintos
//     para que el detector de duplicados no vuelva a proponerlos.
//
// Las reseñas se unen y quedan en la cola de reescritura; las notas no se pierden
// (preserve.ts).
//
//   tsx scripts/fix-discos-repetidos-2026-10-04.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge, type AlbumMergeField } from "../src/merge/album-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";

const MERGES: Array<{ keep: number; drop: number; choices?: Partial<Record<AlbumMergeField, "keep" | "drop">> }> = [
  { keep: 600, drop: 3390 },
  { keep: 600, drop: 3360 },
  { keep: 4619, drop: 2134, choices: { album_type: "drop" } },
];
const REISSUES: Array<[number, number, string]> = [
  [3638, 3642, "Aditus «Lo Mejor de Aditus» (1991) y su reedición «Milenio» (2000)"],
  [4344, 4345, "Kiara «Exitos» (1994) y su reedición «Universal Masters Collection» (2000)"],
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const pool = getPool();
  const client = await pool.connect();
  try {
    for (const item of MERGES) {
      const preview = await previewAlbumMerge(client, item.keep, item.drop);
      console.log(`disco ${item.drop} → ${item.keep}: ${preview.matchedTracks.length} pistas emparejadas, ${preview.unmatchedDropTracks.length} sueltas, conflictos ${preview.fieldConflicts.map((c) => c.field).join(", ") || "—"}, avisos ${preview.warnings.length}`);
      if (preview.unmatchedDropTracks.length > 0 || preview.warnings.length > 0) throw new Error(`el par ${item.keep}/${item.drop} ya no es seguro`);
    }
  } finally {
    client.release();
  }
  for (const [a, b, why] of REISSUES) console.log(`distintos ${a}/${b}: ${why}`);
  if (!confirm) { await closeDb(); return; }

  const note = "Discos repetidos de la Revisión de ingesta 2026-10-04: se fusionan solo los seguros; las reediciones quedan aparte (Brian, 2026-10-04)";
  const result = await withOperatorRun({ name: "fix-discos-repetidos-2026-10-04", operator: "brian", note, params: { MERGES, REISSUES } }, async (context) => {
    const merged = [];
    for (const item of MERGES) {
      const { previewHash } = await previewAlbumMerge(context.client, item.keep, item.drop, { lock: true });
      const out = await mergeAlbums(context, { keepId: item.keep, dropId: item.drop, previewHash, fieldChoices: item.choices, keepDropNameAsAlias: true });
      merged.push({ keep: item.keep, drop: item.drop, tracksMerged: out.tracksMerged, tracksMoved: out.tracksMoved, auditId: out.auditId });
    }
    for (const [a, b, why] of REISSUES) {
      await context.client.query(
        `INSERT INTO ingest.curation_distinct_pairs (kind, a_id, b_id, decided_by, note) VALUES ('album', $1, $2, 'brian', $3)
         ON CONFLICT (kind, a_id, b_id) DO NOTHING`, [Math.min(a, b), Math.max(a, b), `Reedición, no duplicado: ${why} (run ${context.runId})`]);
    }
    return { merged, distinct: REISSUES.length };
  });
  console.log(JSON.stringify(result));
  await closeDb();
}

await main();
