/**
 * Reasigna las portadas mejoradas (400 px de Soinuenea) de los volúmenes
 * VenezuelaDemo 25-29, 31 y 32, que se guardaron como vd-NN-2.jpg para
 * romper la caché inmutable del CDN.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-portadas-v2.mts [--apply]
 */
import {existsSync} from 'node:fs';
import path from 'node:path';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-portadas-v2-2026-10-26';
const APPLY = process.argv.includes('--apply');
const PREFIX = '/crv/media/venezuelademo-2026-10-26/portadas-1x1';
const DEST = path.resolve('web/public/media/venezuelademo-2026-10-26/portadas-1x1');
const VOLS = [18, 25, 26, 27, 28, 29, 31, 32];

const pool = getPool();
const albums = new Map<number, {id: number; cover: string | null}>();
for (const r of (await pool.query<{id: string; title: string; cover_url: string | null}>(
  "SELECT id::text, title, cover_url FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows) {
  albums.set(Number(r.title.replace(/\D+/g, '')), {id: Number(r.id), cover: r.cover_url});
}

const plan = VOLS.map(n => ({n, album: albums.get(n)!, cover: `${PREFIX}/vd-${n}-2.jpg`}))
  .filter(p => p.album && existsSync(path.join(DEST, `vd-${p.n}-2.jpg`)));
console.log(`portadas nuevas: ${plan.length}`);
for (const p of plan) console.log(`  vol ${p.n} album=${p.album.id} ${p.album.cover} -> ${p.cover}`);

if (!APPLY) { await closeDb(); process.exit(0); }

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Portadas de mejor calidad (escaneo de 400 px de Soinuenea) para los volúmenes 25-29, 31 y 32 de VenezuelaDemo.',
  params: {campaign: TAG, covers: plan.length},
}, async ctx => {
  for (const p of plan) {
    await updateEntity(ctx, 'album', p.album.id, {
      cover_url: p.cover,
      notes: `Portada: escaneo de Soinuenea (Herri Musikaren Txokoa), 400 px, recortada 1:1.`,
    });
  }
  return plan.map(p => p.n);
});
console.log(`run ${runId}: ${result.length} portadas actualizadas`);
await closeDb();
