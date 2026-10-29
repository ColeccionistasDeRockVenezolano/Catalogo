/**
 * VenezuelaDemo — portadas 1:1 recortadas y asignadas a los álbumes del catálogo.
 *
 * Fuente: miniaturas de 158x157 archivadas de venezuelademo.com (Wayback).
 * Recorta el marco blanco (bbox), cuadra al centro y guarda 600x600 en
 * web/public/media/venezuelademo-2026-10-26/portadas-1x1/.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx scripts/venezuelademo-portadas.mts [--apply]
 */
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-portadas-2026-10-26';
const APPLY = process.argv.includes('--apply');
const SRC = path.resolve('data/raw/venezuelademo-2026-10-23/raw/imagenes');
const DEST_REL = 'venezuelademo-2026-10-26/portadas-1x1';
const DEST = path.resolve('web/public/media', DEST_REL);
const COVER_PREFIX = '/crv/media/' + DEST_REL;

mkdirSync(DEST, {recursive: true});

// recorte con PIL: bbox de lo no blanco, cuadrado centrado, 600x600
const py = `
import sys, os
from PIL import Image, ImageChops
src, dest, name = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGB')
bg = Image.new('RGB', im.size, (255,255,255))
diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 12 else 0)
box = diff.getbbox() or (0,0,im.width,im.height)
im = im.crop(box)
s = min(im.size)
left = (im.width - s)//2; top = (im.height - s)//2
im = im.crop((left, top, left+s, top+s)).resize((600,600), Image.LANCZOS)
im.save(os.path.join(dest, name), quality=92, subsampling=0)
print(f"{name}\\t{box}\\t{os.path.getsize(os.path.join(dest,name))}")
`;

const files = readdirSync(SRC).filter(f => /^cd\d{2}\.jpg$/.test(f)).sort();
const pool = getPool();
const albums = (await pool.query<{id: string; title: string; cover_url: string | null}>(
  "SELECT id::text, title, cover_url FROM public.albums WHERE title ~ '^Venezuelademo [0-9]+$'")).rows;
const byNum = new Map<number, {id: number; cover: string | null}>();
for (const a of albums) byNum.set(Number(a.title.replace(/\D+/g, '')), {id: Number(a.id), cover: a.cover_url});

const plan: {n: number; albumId: number; cover: string; file: string; bytes: number}[] = [];
for (const f of files) {
  const n = Number(f.slice(2, 4));
  const album = byNum.get(n);
  if (!album) { console.log(`sin álbum para cd${n}`); continue; }
  const name = `vd-${String(n).padStart(2, '0')}.jpg`;
  const out = execFileSync('python3', ['-c', py, path.join(SRC, f), DEST, name], {encoding: 'utf8'}).trim();
  const [, , bytes] = out.split('\t');
  plan.push({n, albumId: album.id, cover: `${COVER_PREFIX}/${name}`, file: name, bytes: Number(bytes)});
  console.log(`${f} -> ${name} album=${album.id} actual=${album.cover ?? '—'}`);
}

if (!APPLY) {
  console.log(`\ndry-run: ${plan.length} portadas listas en ${DEST} (usar --apply para asignar)`);
  await closeDb();
  process.exit(0);
}

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Recorte 1:1 de las portadas archivadas de venezuelademo.com y asignación a los álbumes Venezuelademo 1-24.',
  params: {campaign: TAG, covers: plan.length},
}, async ctx => {
  const out: {n: number; albumId: number; cover: string; ok: boolean}[] = [];
  for (const p of plan) {
    const cur = (await ctx.client.query<{cover_url: string | null}>(
      'SELECT cover_url FROM public.albums WHERE id=$1', [p.albumId])).rows[0];
    if (cur?.cover_url) { out.push({...p, ok: false}); continue; }
    await updateEntity(ctx, 'album', p.albumId, {cover_url: p.cover,
      notes: `Portada recortada 1:1 de la miniatura archivada de venezuelademo.com (158x157 px, Wayback 2013).`});
    out.push({...p, ok: true});
  }
  return out;
});
console.log(`run ${runId}: ${result.filter(r => r.ok).length}/${result.length} portadas asignadas`);
for (const r of result) console.log(`  ${r.n} album=${r.albumId} ${r.ok ? 'ok' : 'ya tenía portada'} ${r.cover}`);
await closeDb();
