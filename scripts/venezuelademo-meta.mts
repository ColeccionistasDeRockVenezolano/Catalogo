/**
 * Completa los metadatos de los 34 volúmenes VenezuelaDemo: año de edición,
 * descripción, formato, sello (CENDIS en 1-5) y fuentes en notes.
 * No toca cover_url ni los títulos.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-meta.mts <plan.json> [--apply]
 */
import {readFileSync, existsSync} from 'node:fs';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, updateEntity} from '../src/merge/operator.js';

const TAG = 'venezuelademo-meta-2026-10-26';
const APPLY = process.argv.includes('--apply');
const file = process.argv[2];
if (!file || !existsSync(file)) throw new Error('falta el plan JSON');

interface M {n: number; anio: number | null; anio_documentado: boolean; subtitulo: string;
  temas: number; artistas: number; label_cendis: boolean; description: string; fuentes: string[]}
const plan: M[] = JSON.parse(readFileSync(file, 'utf8'));
const CENDIS = 536;

const pool = getPool();
const albums = new Map<number, {id: number; year: number | null; desc: string | null; label: string | null}>();
for (const r of (await pool.query<{id: string; title: string; release_year: number | null; description: string | null; label_id: string | null}>(
  "SELECT id::text, title, release_year, description, label_id::text FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows) {
  albums.set(Number(r.title.replace(/\D+/g, '')), {id: Number(r.id), year: r.release_year, desc: r.description, label: r.label_id});
}
console.log(`plan=${plan.length} álbumes=${albums.size}`);

if (!APPLY) {
  for (const p of plan) {
    const a = albums.get(p.n);
    console.log(`  ${p.n}: ${a ? `album=${a.id} year=${a.year ?? '—'} desc=${a.desc ? 'sí' : '—'}` : 'SIN ÁLBUM'} año=${p.anio}`);
  }
  await closeDb();
  process.exit(0);
}

const {runId, result} = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian)',
  note: 'Metadatos documentados de los 34 volúmenes VenezuelaDemo: año, descripción, formato, sello CENDIS (1-5) y fuentes.',
  params: {campaign: TAG, volumes: plan.length},
}, async ctx => {
  const out: {n: number; album: number; ok: boolean; motivo?: string}[] = [];
  for (const p of plan) {
    const a = albums.get(p.n);
    if (!a) { out.push({n: p.n, album: 0, ok: false, motivo: 'sin álbum'}); continue; }
    const values: Record<string, unknown> = {
      description: p.description,
      media_format: 'CD',
      notes: 'Fuentes: ' + p.fuentes.join(' · ')
        + (p.anio_documentado ? '' : `. Año no documentado: se registra ${p.anio} como cota inferior (tema más reciente).`),
    };
    if (p.anio && a.year === null) values['release_year'] = p.anio;
    if (p.label_cendis && !a.label) values['label_id'] = CENDIS;
    try {
      await updateEntity(ctx, 'album', a.id, values);
      out.push({n: p.n, album: a.id, ok: true});
    } catch (e) {
      out.push({n: p.n, album: a.id, ok: false, motivo: String((e as Error).message).slice(0, 120)});
    }
  }
  return out;
});
const ok = result.filter(r => r.ok).length;
console.log(`run ${runId}: ${ok}/${result.length} actualizados`);
for (const r of result.filter(x => !x.ok)) console.log(`  fallo ${r.n} album=${r.album} ${r.motivo}`);
await closeDb();
