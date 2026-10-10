// Caso A'mbar (Brian, 2026-10-04). El artista 33 es un proyecto de Rudy La Scala
// con voz ajena: la regla de bios («creado por X» → «Titular del proyecto»)
// lo trató como el seudónimo de Rudy, y la ficha mostraba su nombre real, su
// nacimiento y su edad, y el caso Canserbero (run 11312) le dio «A'mbar» como alias.
// rudylascala.com/en/productions: «In 1979 He formed the band AMBAR with the lead
// vocal […] Maria Conchita Alonso», «the band's first Disco album».
//
//  1. Rudy pasa de titular a creador, productor y arreglista (1979–1980) y pierde el alias.
//  2. Entran María Conchita Alonso (voz, 1979–1980), Madelyn Farr (voz, 1981) y
//     Enrique Londaits (producción y arreglos, 1981), según la bio y los créditos.
//  3. Formado en 1979; el nombre se apaga tras Californian Shade (1981).
//  4. Disco: principal del artista y de Love Maniac (Pop queda de secundario).
//  5. El 15672 «(María Conchita Alonso) Love Maniac» (Sincopa, 2026-10-04) se fusiona en el 52.
//
//   tsx scripts/fix-ambar.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { confirmGenre } from "../src/genres/human.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { createRelation, updateEntity, updateRelation, withOperatorRun } from "../src/merge/operator.js";

const AMBAR = 33, RUDY = 615, RUDY_MEMBERSHIP = 4784, LOVE_MANIAC = 52, SINCOPA_DUP = 15672;
const MEMBERS = [
  { personId: 610, role: "Voz principal", from: 1979, to: 1980, notes: "rudylascala.com/en/productions: «formed the band AMBAR with the lead vocal […] Maria Conchita Alonso»; Love Maniac y The Witch" },
  { personId: 7484, role: "Voz", from: 1981, to: 1981, notes: "biografía y créditos de Californian Shade (1981)" },
  { personId: 7489, role: "Productor y arreglista", from: 1981, to: 1981, notes: "biografía y créditos de Californian Shade (1981): «Produced & Arranged by»" },
];
const SOURCE = "rudylascala.com/en/productions: «In 1979 He formed the band AMBAR […] the band's first Disco album AMBAR»";

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const pool = getPool();
  const client = await pool.connect();
  try {
    const preview = await previewAlbumMerge(client, LOVE_MANIAC, SINCOPA_DUP);
    console.log(`disco ${SINCOPA_DUP} → ${LOVE_MANIAC}:`, JSON.stringify({ conflicts: (preview as { fieldConflicts?: unknown }).fieldConflicts, matches: (preview as { trackMatches?: unknown[] }).trackMatches?.length }));
  } finally {
    client.release();
  }
  if (!confirm) { await closeDb(); return; }

  const note = "Caso A'mbar: proyecto de Rudy La Scala con voz de María Conchita Alonso, no su seudónimo (Brian, 2026-10-04)";
  const result = await withOperatorRun({ name: "fix-ambar", operator: "brian", note, params: { AMBAR, RUDY, LOVE_MANIAC, SINCOPA_DUP } }, async (context) => {
    const { client: db, runId } = context;
    await updateRelation(context, "artist_membership", RUDY_MEMBERSHIP, {
      role: "Creador, productor y arreglista", from_year: 1979, to_year: 1980,
      notes: `${SOURCE}; antes «Titular del proyecto» por la biografía`,
    });
    const dropped = await db.query("DELETE FROM ingest.person_aliases WHERE person_id=$1 AND alias='A''mbar' RETURNING id", [RUDY]);
    if (dropped.rowCount) {
      await db.query(`
        INSERT INTO ingest.merge_audit(run_id,entity_kind,person_id,field,old_value,new_value,reason,confidence,performed_by)
        VALUES($1,'person',$2,'aliases',$3::jsonb,NULL,$4,'high','human')`,
      [runId, RUDY, JSON.stringify(["A'mbar"]), `${note}; deshace el alias de la run 11312`]);
    }
    const members = [];
    for (const member of MEMBERS) {
      const created = await createRelation(context, "artist_membership", { artistId: AMBAR, personId: member.personId }, {
        role: member.role, from_year: member.from, to_year: member.to, notes: member.notes,
      });
      members.push({ personId: member.personId, ...created });
    }
    await updateEntity(context, "artist", AMBAR, { formed_year: 1979, disbanded_year: 1981 });
    for (const [kind, entityId] of [["artist", AMBAR], ["album", LOVE_MANIAC]] as const) {
      await confirmGenre(db, { kind, entityId, genreSlug: "disco", role: "primary", actor: "brian", reason: SOURCE, runId });
    }
    const merged = await mergeAlbums(context, {
      keepId: LOVE_MANIAC, dropId: SINCOPA_DUP, keepDropNameAsAlias: false,
      previewHash: (await previewAlbumMerge(db, LOVE_MANIAC, SINCOPA_DUP, { lock: true })).previewHash,
    });
    return { aliasDropped: dropped.rowCount, members, merged: { tracksMerged: merged.tracksMerged, tracksMoved: merged.tracksMoved } };
  });
  console.log(JSON.stringify(result));
  await closeDb();
}

await main();
