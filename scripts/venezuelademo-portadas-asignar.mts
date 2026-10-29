/**
 * Asigna las portadas 1:1 ya recortadas (web/public/media/venezuelademo-2026-10-26/portadas-1x1/vd-NN.jpg)
 * a los álbumes Venezuelademo N existentes. Re-ejecutable: salta las que ya apuntan al mismo archivo.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx scripts/venezuelademo-portadas-asignar.mts [--apply]
 */
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-portadas-2026-10-26';
const APPLY = process.argv.includes('--apply');
const DEST = path.resolve('web/public/media/venezuelademo-2026-10-26/portadas-1x1');
const PREFIX = '/crv/media/venezuelademo-2026-10-26/portadas-1x1';

const pool = getPool();
const albums = (await pool.query<{id: string; title: string; cover_url: string | null}>(
  "SELECT id::text, title, cover_url FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows;
const byNum = new Map<number, {id: number; cover: string | null}>();
for (const a of albums) byNum.set(Number(a.title.replace(/\D+/g, '')), {id: Number(a.id), cover: a.cover_url});

const plan: {n: number; albumId: number; cover: string; previo: string | null}[] = [];
for (const f of readdirSync(DEST).filter(f => /^vd-\d{2}\.jpg$/.test(f)).sort()) {
  const n = Number(f.slice(3, 5));
  const album = byNum.get(n);
  if (!album) continue;
  const cover = `${PREFIX}/${f}`;
  if (album.cover === cover) { console.log(`${n}: ya asignada`); continue; }
  plan.push({n, albumId: album.id, cover, previo: album.cover});
}
console.log(`portadas a escribir: ${plan.length}`);

if (!APPLY) { await closeDb(); process.exit(0); }

const {runId, result} = await withOperatorRun({
  name: TAG + ':asignar', operator: 'hermes (encargo de Brian)',
  note: 'Portadas 1:1 de los volúmenes VenezuelaDemo (arte del catálogo, 180px, sin marco blanco) asignadas a sus álbumes.',
  params: {campaign: TAG, covers: plan.length},
}, async ctx => {
  const done = [];
  for (const p of plan) {
    await updateEntity(ctx, 'album', p.albumId, {cover_url: p.cover});
    done.push(p);
  }
  return done;
});
console.log(`run ${runId}: ${result.length} portadas asignadas`);
for (const r of result) console.log(`  ${r.n} album=${r.albumId} ${r.cover}`);
await closeDb();
