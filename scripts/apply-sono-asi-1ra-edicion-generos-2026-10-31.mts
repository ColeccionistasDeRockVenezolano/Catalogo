// CRV · Géneros del EP «Sonó Así» de 1ra Edición (disco 2330), 2026-10-31.
//
// Ninguna fuente atribuye género a este EP (la IA del catálogo se abstuvo en
// la propuesta 88; la web solo etiqueta al artista). Decisión expresa de
// Brian: el disco toma el principal y el secundario confirmados del artista
// (Pop rock / Rock latino). Primer caso de la regla de AGENTS.md
// «Géneros de un disco sin fuente». Decisión humana, reversible por run.
//
//   scripts/with-node22.sh npx tsx scripts/apply-sono-asi-1ra-edicion-generos-2026-10-31.mts [--dry-run]
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { confirmGenre } from "../src/genres/human.js";

const ALBUM_ID = 2330;
const ARTIST_ID = 31;
const dryRun = process.argv.includes("--dry-run");
// La marca inicial la lee la radio (genreOrigin album:artist); se añadió al
// convertir este caso en la regla general (segunda pasada, mismo resultado).
const reason = "[herencia:artist] Sin fuente para el EP; Brian pidió heredar los géneros confirmados del artista 1ra Edición (2026-10-31)";

try {
  const { runId, result } = await withOperatorRun({
    name: "sono-asi-1ra-edicion-generos", operator: "claude", note: reason, params: { albumId: ALBUM_ID, artistId: ARTIST_ID },
  }, async (context) => {
    const artist = (await context.client.query<{ slug: string; role: "primary" | "secondary" }>(
      `SELECT g.slug, x.role FROM ingest.artist_genres x JOIN ingest.genres g ON g.id=x.genre_id
        WHERE x.artist_id=$1 AND x.status='confirmed' ORDER BY (x.role='primary') DESC, g.slug`, [ARTIST_ID])).rows;
    if (!artist.some((row) => row.role === "primary")) throw new Error("el artista no tiene principal confirmado");
    for (const row of artist) {
      await confirmGenre(context.client, { kind: "album", entityId: ALBUM_ID, genreSlug: row.slug, role: row.role,
        actor: "brian (vía claude)", reason, runId: context.runId });
    }
    const album = (await context.client.query(
      `SELECT g.name, x.role, x.status, x.decision_kind FROM ingest.album_genres x JOIN ingest.genres g ON g.id=x.genre_id
        WHERE x.album_id=$1 ORDER BY (x.role='primary') DESC`, [ALBUM_ID])).rows;
    return { inherited: artist, album };
  }, { rollbackOnly: dryRun });
  console.log(JSON.stringify({ dryRun, runId: dryRun ? null : runId, ...result }, null, 1));
} finally {
  await closeDb();
}
