/**
 * VenezuelaDemo (PDF) — temas promocionales cuyo disco no estaba en el catálogo:
 * crea el disco cuando la reseña lo documenta y coloca la pista en el disco correcto
 * (propio o colaboración ya catalogada).
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-temas-sin-disco-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, OperatorError, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-temas-sin-disco-2026-11-11';
const APPLY = process.argv.includes('--apply');
const plan = JSON.parse(readFileSync('/tmp/vd_temas_disco_plan.json', 'utf8')) as Array<{
  artist_id: number; artista: string; tema: string; duracion: string | null; genero: string | null;
  accion: 'usar' | 'crear' | 'skip'; album_id?: number; album_title?: string; album_type?: string;
  anio?: number | null; notes?: string;
}>;
console.log(`usar ${plan.filter(p => p.accion === 'usar').length} · crear ${plan.filter(p => p.accion === 'crear').length} · saltar ${plan.filter(p => p.accion === 'skip').length}`);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Temas promocionales de VenezuelaDemo sin disco en el catálogo: altas de disco documentadas y colocación de la pista en su disco (propio o colaboración ya catalogada).',
  params: { campaign: TAG, temas: plan.filter(p => p.accion !== 'skip').length },
}, async (context) => {
  const count = { discosCreados: 0, discosYaEstaban: 0, pistasCreadas: 0, pistasYaEstaban: 0, sinDisco: 0, errores: 0 };
  for (const row of plan) {
    if (row.accion === 'skip') continue;
    let albumId = row.album_id ?? null;
    if (row.accion === 'crear' && row.album_title) {
      const dup = await context.client.query<{ id: string }>(
        "SELECT id::text FROM public.albums WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
        [row.artist_id, row.album_title]);
      if (dup.rows[0]) { albumId = Number(dup.rows[0].id); count.discosYaEstaban++; }
      else {
        try {
          const created = await createEntity(context, 'album', {
            title: row.album_title, release_year: row.anio ?? null, album_type: row.album_type ?? 'other',
            notes: row.notes ?? 'Alta desde el tema promocional de la reseña PDF de VenezuelaDemo (MCI).',
          }, { artistId: row.artist_id, allowSimilar: true });
          albumId = created.id; count.discosCreados++;
        } catch (error) {
          if (error instanceof OperatorError) { count.errores++; continue; }
          throw error;
        }
      }
    }
    if (!albumId) { count.sinDisco++; continue; }
    const existing = await context.client.query<{ id: string }>(
      "SELECT id::text FROM public.tracks WHERE album_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
      [albumId, row.tema]);
    if (existing.rows[0]) { count.pistasYaEstaban++; continue; }
    const max = (await context.client.query<{ n: string | null }>('SELECT max(track_number)::text n FROM public.tracks WHERE album_id=$1', [albumId])).rows[0];
    const seconds = /^\d{1,2}:\d{2}$/u.test(row.duracion ?? '')
      ? Number(row.duracion!.split(':')[0]) * 60 + Number(row.duracion!.split(':')[1]) : undefined;
    try {
      await createEntity(context, 'track', {
        title: row.tema, track_number: max?.n ? Number(max.n) + 1 : 1, disc_number: 1,
        ...(seconds ? { duration_seconds: seconds } : {}),
        notes: `Tema promocional de la reseña de VenezuelaDemo${row.genero ? ` (${row.genero})` : ''}.`,
      }, { albumId, allowSimilar: true });
      count.pistasCreadas++;
    } catch (error) {
      if (error instanceof OperatorError) { count.errores++; continue; }
      throw error;
    }
  }
  return count;
});
writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-temas-sin-disco.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
