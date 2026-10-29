/**
 * Asigna las portadas que faltaban (20-23, 1254 px) y mejora 30, 33 y 34
 * (400 px) en el catálogo.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-portadas-v3.mts [--apply]
 */
import {existsSync} from 'node:fs';
import path from 'node:path';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-portadas-v3-2026-10-26';
const APPLY = process.argv.includes('--apply');
const PREFIX = '/crv/media/venezuelademo-2026-10-26/portadas-1x1';
const DEST = path.resolve('web/public/media/venezuelademo-2026-10-26/portadas-1x1');
// volumen -> archivo
const FILES: Record<number, string> = {
  20: 'vd-20.jpg', 21: 'vd-21.jpg', 22: 'vd-22.jpg', 23: 'vd-23.jpg',
  30: 'vd-30-2.jpg', 33: 'vd-33-2.jpg', 34: 'vd-34-2.jpg',
};

const pool = getPool();
const albums = new Map<number, {id: number; cover: string | null}>();
for (const r of (await pool.query<{id: string; title: string; cover_url: string | null}>(
  "SELECT id::text, title, cover_url FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows) {
  albums.set(Number(r.title.replace(/\D+/g, '')), {id: Number(r.id), cover: r.cover_url});
}

const plan = Object.entries(FILES)
  .map(([n, file]) => ({n: Number(n), file, album: albums.get(Number(n))!}))
  .filter(p => p.album && existsSync(path.join(DEST, p.file)));
console.log(`portadas a asignar: ${plan.length}`);
for (const p of plan) console.log(`  vol ${p.n} album=${p.album.id} ${p.album.cover} -> ${PREFIX}/${p.file}`);

if (!APPLY) { await closeDb(); process.exit(0); }

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Portadas 20-23 (1254 px) y mejora de 30, 33 y 34 (400 px) de VenezuelaDemo.',
  params: {campaign: TAG, covers: plan.length},
}, async ctx => {
  for (const p of plan) {
    await updateEntity(ctx, 'album', p.album.id, {
      cover_url: `${PREFIX}/${p.file}`,
      notes: p.n >= 20 && p.n <= 23
        ? 'Portada 1:1 de 1254 px; lista de artistas cotejada con el tracklist del volumen.'
        : 'Portada: escaneo de 400 px, recortada 1:1.',
    });
  }
  return plan.map(p => p.n);
});
console.log(`run ${runId}: ${result.length} portadas actualizadas`);
await closeDb();
