/**
 * Serie «VenezuelaDemo»: agrupa los 34 volúmenes con su número, para que se
 * naveguen ordenados (la lista de discos pagina de 20 en 20 y el orden
 * alfabético reparte «3…9» y «28…34» en la segunda página).
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-serie.mts [--apply]
 */
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';

const TAG = 'venezuelademo-serie-2026-10-26';
const APPLY = process.argv.includes('--apply');
const TITLE = 'VenezuelaDemo';

const pool = getPool();
const albums = (await pool.query<{id: string; title: string; release_year: number | null}>(
  "SELECT id::text, title, release_year FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows
  .map(a => ({id: Number(a.id), n: Number(a.title.replace(/\D+/g, '')), year: a.release_year}))
  .sort((a, b) => a.n - b.n);
console.log(`volúmenes: ${albums.length} (${albums[0]?.n}–${albums[albums.length - 1]?.n})`);

const existing = (await pool.query<{id: string; title: string}>(
  "SELECT id::text, title FROM ingest.series WHERE title = $1 AND artist_id = 257", [TITLE])).rows[0];
console.log(`serie existente: ${existing ? `id=${existing.id}` : 'no'}`);

if (!APPLY) {
  console.log(`dry-run: crear serie «${TITLE}» con ${albums.length} volúmenes numerados 1–34`);
  await closeDb();
  process.exit(0);
}

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Serie VenezuelaDemo: 34 volúmenes numerados para navegación ordenada en el catálogo.',
  params: {campaign: TAG, volumes: albums.length},
}, async ctx => {
  const found = await ctx.client.query<{id: string}>(
    "SELECT id::text FROM ingest.series WHERE title = $1 AND artist_id = 257", [TITLE]);
  const seriesId = found.rows[0]?.id ?? (await ctx.client.query<{id: string}>(
    `INSERT INTO ingest.series(title, artist_id, description, source, notes, run_id)
     VALUES ($1, 257, $2, 'venezuelademo', $3, $4) RETURNING id::text`,
    [TITLE,
     'Catálogo discográfico de músicos independientes venezolanos (34 volúmenes, 2005–2010), coordinado por el colectivo El G4 y distribuido por el Ministerio de Comunicación e Información.',
     'Volúmenes 1–34; el número de volumen sale del título y de la ficha técnica de cada disco.', ctx.runId])).rows[0]!.id;
  let linked = 0;
  for (const a of albums) {
    const r = await ctx.client.query(
      `INSERT INTO ingest.series_albums(series_id, album_id, volume_number, volume_label, run_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (series_id, album_id) DO NOTHING`,
      [seriesId, a.id, a.n, `Vol. ${a.n}`, ctx.runId]);
    linked += r.rowCount ?? 0;
  }
  return {seriesId: Number(seriesId), linked};
});
console.log(`run ${runId}: serie=${result.seriesId} volúmenes enlazados=${result.linked}`);
await closeDb();
