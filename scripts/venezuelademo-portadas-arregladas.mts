/**
 * Aplica las portadas arregladas de VenezuelaDemo (1–34) a cada volumen de la
 * serie 72. Las fuentes son los PNG de 1254 px de
 * ~/Desktop/VenezuelaDemo/portadas/Arregladas (nombre = número de volumen,
 * verificado contra el número impreso en el arte).
 *
 * El CDN sirve `/crv/media/…` con cache-control inmutable, así que las copias
 * nuevas se guardan como `vd-NN-3.jpg` (nunca se reescribe un nombre ya
 * publicado) y se cambia `cover_url` en el mismo paso.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-portadas-arregladas.mts [--apply]
 */
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-portadas-arregladas-2026-10-27';
const APPLY = process.argv.includes('--apply');
const SRC = '/home/brian/Desktop/VenezuelaDemo/portadas/Arregladas';
const PREFIX = '/crv/media/venezuelademo-2026-10-26/portadas-1x1';
const DEST = path.resolve('web/public/media/venezuelademo-2026-10-26/portadas-1x1');
const SIZE = 1200;

const pool = getPool();
const rows = (await pool.query<{volume_number: string; album_id: string; title: string; cover_url: string | null}>(
  `SELECT sa.volume_number::text, sa.album_id::text, a.title, a.cover_url
     FROM ingest.series_albums sa JOIN public.albums a ON a.id = sa.album_id
    WHERE sa.series_id = 72 ORDER BY sa.volume_number`)).rows;

const plan = rows.map(r => {
  const n = Number(r.volume_number);
  const nn = String(n).padStart(2, '0');
  return {
    n, albumId: Number(r.album_id), title: r.title, before: r.cover_url,
    src: path.join(SRC, `${n}.png`), file: `vd-${nn}-3.jpg`, after: `${PREFIX}/vd-${nn}-3.jpg`,
  };
});

const faltan = plan.filter(p => !existsSync(p.src));
if (faltan.length) {
  console.error(`Faltan fuentes: ${faltan.map(p => p.src).join(', ')}`);
  await closeDb();
  process.exit(1);
}
const yaPublicadas = plan.filter(p => existsSync(path.join(DEST, p.file)));
console.log(`volúmenes: ${plan.length} · fuentes ok · nombres destino ya existentes: ${yaPublicadas.length}`);
const first = plan[0];
if (first) console.log(`ejemplo: vol ${first.n} album=${first.albumId} ${first.before} -> ${first.after}`);

if (!APPLY) {
  console.log('dry-run: usar --apply para escribir las portadas y actualizar cover_url.');
  await closeDb();
  process.exit(0);
}

for (const p of plan) {
  await sharp(p.src).resize(SIZE, SIZE, {fit: 'cover', position: 'centre'})
    .jpeg({quality: 90, mozjpeg: true}).toFile(path.join(DEST, p.file));
}
const escritas = readdirSync(DEST).filter(f => /^vd-\d{2}-3\.jpg$/.test(f));
console.log(`portadas escritas: ${escritas.length} (${SIZE} px, JPEG q90) en ${path.relative(process.cwd(), DEST)}`);

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'VenezuelaDemo: portadas arregladas (34) aplicadas a los volúmenes de la serie, 1200 px 1:1.',
  params: {campaign: TAG, covers: plan.length, size: SIZE},
}, async ctx => {
  for (const p of plan) {
    await updateEntity(ctx, 'album', p.albumId, {cover_url: p.after});
  }
  return plan.map(p => p.n);
});
console.log(`run ${runId}: cover_url actualizado en ${result.length} volúmenes`);

const check = (await pool.query<{n: string; cover_url: string}>(
  `SELECT sa.volume_number::text AS n, a.cover_url
     FROM ingest.series_albums sa JOIN public.albums a ON a.id = sa.album_id
    WHERE sa.series_id = 72 ORDER BY sa.volume_number`)).rows;
const mal = check.filter(r => !/-3\.jpg$/.test(r.cover_url));
console.log(mal.length ? `sin actualizar: ${mal.map(r => r.n).join(', ')}` : 'verificado: los 34 volúmenes apuntan a la copia nueva');
await closeDb();
