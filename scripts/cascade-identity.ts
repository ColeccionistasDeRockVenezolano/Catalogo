// CRV · Cascada de identidad para artistas que ya tenían duplicados internos.
//
// Une personas homónimas exactas y discos idénticos que quedaron de fusiones
// anteriores. Es el mismo código que corre dentro de `mergeArtistVerified`.
// Uso: tsx scripts/cascade-identity.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { dedupeArtistPersons } from "../src/review/person-dedupe.js";
import { dedupeArtistAlbums } from "../src/review/album-dedupe.js";

const confirm = process.argv.includes("--confirm");
const { rows } = await getPool().query<{ artist_id: string }>(`
  SELECT DISTINCT artist_id::text FROM (
    SELECT m.artist_id
      FROM public.artist_members m
      JOIN public.persons p ON p.id = m.person_id
     GROUP BY m.artist_id, lower(p.name)
    HAVING count(DISTINCT m.person_id) > 1
  ) groups
   ORDER BY artist_id`);
const artists = rows.map((row) => Number(row.artist_id));
console.error(`artistas con personas homónimas: ${artists.length}${confirm ? "" : " (dry-run)"}`);
if (!confirm) {
  console.log(JSON.stringify({ mode: "dry-run", artists }, null, 2));
  await closeDb();
  process.exit(0);
}
const report: Array<{ artistId: number; runId: number; persons: unknown; albums: unknown }> = [];
for (const artistId of artists) {
  const { runId, result } = await withOperatorRun({
    name: "cli:cascade:identity", operator: "Brian", note: "Cascada de identidad posterior a fusiones (2026-10-29)",
    params: { artistId },
  }, async (context) => ({
    persons: await dedupeArtistPersons(context, artistId),
    albums: await dedupeArtistAlbums(context, artistId),
  }));
  report.push({ artistId, runId, ...result });
}
console.log(JSON.stringify(report, null, 2));
await closeDb();
