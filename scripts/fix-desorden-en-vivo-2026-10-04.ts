// Desorden Público «En Vivo en el Teatro Teresa Carreño» (Brian, 2026-10-04:
// «fusionar 3979 en 169»).
//
//  1. 169 (CD doble, 2004) y 3979 (Sincopa, «2013») son el mismo disco: el 3979
//     suma Diablo, Esto Es Ska y Rosas Azules, que pasan al 169. El título del
//     3979 queda como alias y se conservan el año y el tipo del 169.
//     Antes de fusionar se ajustan las pistas del 3979 para que el emparejador no
//     cruce canciones por posición: cuatro títulos abreviados toman el del 169 y
//     las tres pistas propias pasan a números altos (101–103) para que se muevan.
//  2. Los Vol. 1/2 digitales (13978/13979) y el DVD «18 años de Ska» (1977) son
//     ediciones distintas del mismo concierto: se declaran distintos frente al
//     169 y entre sí, para que el detector de duplicados no vuelva a proponerlos.
//
//   tsx scripts/fix-desorden-en-vivo-2026-10-04.ts [--confirm]
import type { PoolClient } from "pg";
import { closeDb, getPool } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";

const KEEP = 169;
const DROP = 3979;
const RETITLE: Array<[string, string]> = [
  ["Cosquillas", "Hay Cosquillas Que No Dan Risa"],
  ["Skápate", "Skápate Conmigo"],
  ["Canto Popular/D.P.", "Canto Popular/DP"],
  ["El Racismo", "El Racismo Es Una Enfermedad"],
];
const RENUMBER: Array<[string, number]> = [["Diablo", 101], ["Esto Es Ska", 102], ["Rosas Azules", 103]];

// Tras la fusión, las tres pistas movidas siguen el orden del 169 (32–34).
async function renumberMoved(client: PoolClient): Promise<number> {
  let n = 0;
  for (const [i, [title, num]] of RENUMBER.entries()) {
    const r = await client.query(`UPDATE public.tracks SET track_number = $3 WHERE album_id = $1 AND track_number = $2`, [KEEP, num, 32 + i]);
    n += r.rowCount ?? 0;
    if (r.rowCount !== 1) throw new Error(`«${title}» no está en el ${num} del ${KEEP}`);
  }
  return n;
}

async function prepare(client: PoolClient): Promise<void> {
  for (const [from, to] of RETITLE) {
    const r = await client.query(`UPDATE public.tracks SET title = $2 WHERE album_id = $3 AND title = $1`, [from, to, DROP]);
    if (r.rowCount !== 1) throw new Error(`«${from}» no está una sola vez en el ${DROP}`);
  }
  for (const [title, num] of RENUMBER) {
    const r = await client.query(`UPDATE public.tracks SET track_number = $2 WHERE album_id = $3 AND title = $1`, [title, num, DROP]);
    if (r.rowCount !== 1) throw new Error(`«${title}» no está una sola vez en el ${DROP}`);
  }
}

const EDITIONS: Array<[number, string]> = [
  [13978, "Vol. 1 digital"],
  [13979, "Vol. 2 digital"],
  [1977, "DVD «18 años de Ska»"],
];
const DISTINCT: Array<[number, number, string]> = [];
for (const [id, label] of EDITIONS) DISTINCT.push([KEEP, id, `el CD doble (169) y su edición ${label} (${id})`]);
DISTINCT.push([13978, 13979, "Vol. 1 y Vol. 2 digitales, mitades distintas del concierto"]);
DISTINCT.push([1977, 13978, "DVD y Vol. 1 digital"]);
DISTINCT.push([1977, 13979, "DVD y Vol. 2 digital"]);

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  if (process.argv.includes("--solo-numeros")) {
    // La primera pasada (run 12166) dejó las pistas en 101–103.
    const r = await withOperatorRun({ name: "fix-desorden-en-vivo-2026-10-04-numeros", operator: "brian", note: "Diablo, Esto Es Ska y Rosas Azules pasan del 101–103 al 32–34 en el 169 (sigue al run 12166)", params: { KEEP, RENUMBER } }, async (context) => ({ renumbered: await renumberMoved(context.client) }));
    console.log(JSON.stringify(r));
    await closeDb();
    return;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await prepare(client);
    const p = await previewAlbumMerge(client, KEEP, DROP);
    console.log(`emparejadas ${p.matchedTracks.length}`);
    for (const m of p.matchedTracks) if (m.matchType !== "position_and_title") console.log(`  ${m.matchType}: ${m.dropTrackNumber}. ${m.dropTitle} → ${m.keepTrackNumber}. ${m.keepTitle}`);
    console.log(`sueltas: ${p.unmatchedDropTracks.map((t) => `${t.trackNumber}. ${t.title}`).join(" | ")}`);
    console.log(`conflictos: ${p.fieldConflicts.map((c) => `${c.field}=${JSON.stringify(c.keepValue)}/${JSON.stringify(c.dropValue)}`).join(", ")}`);
    console.log(`avisos: ${p.warnings.join(" ")}`);
    if (p.matchedTracks.some((m) => m.matchType === "position") || p.unmatchedDropTracks.length !== RENUMBER.length) throw new Error("el emparejado ya no es el esperado");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  if (!confirm) { await closeDb(); return; }

  const note = "Desorden Público en el Teresa Carreño: 3979 se fusiona en 169; Vol. 1/2 y DVD quedan como ediciones distintas (Brian, 2026-10-04)";
  const result = await withOperatorRun({ name: "fix-desorden-en-vivo-2026-10-04", operator: "brian", note, params: { KEEP, DROP, DISTINCT } }, async (context) => {
    await prepare(context.client);
    const { previewHash } = await previewAlbumMerge(context.client, KEEP, DROP, { lock: true });
    const out = await mergeAlbums(context, { keepId: KEEP, dropId: DROP, previewHash, keepDropNameAsAlias: true });
    await renumberMoved(context.client);
    for (const [a, b, why] of DISTINCT) {
      await context.client.query(
        `INSERT INTO ingest.curation_distinct_pairs (kind, a_id, b_id, decided_by, note) VALUES ('album', $1, $2, 'brian', $3)
         ON CONFLICT (kind, a_id, b_id) DO NOTHING`, [Math.min(a, b), Math.max(a, b), `Misma grabación, otra edición: ${why} (run ${context.runId})`]);
    }
    return { tracksMerged: out.tracksMerged, tracksMoved: out.tracksMoved, auditId: out.auditId, distinct: DISTINCT.length };
  });
  console.log(JSON.stringify(result));
  await closeDb();
}

await main();
