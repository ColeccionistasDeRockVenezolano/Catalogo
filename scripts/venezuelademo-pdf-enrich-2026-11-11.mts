/**
 * VenezuelaDemo (PDF): altas y complementos de fichas.
 *
 * - Crea los artistas que no existían (2) con la biografía de la reseña.
 * - Completa biografía, ciudad de origen y año de formación SOLO donde están vacíos.
 * - Crea los discos de la discografía que no estaban en el catálogo (solo artistas sin
 *   ningún álbum y títulos sin colaboración con otras agrupaciones).
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-enrich-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, OperatorError, updateEntity, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-enrich-2026-11-11';
const APPLY = process.argv.includes('--apply');
const PLAN = JSON.parse(readFileSync('reports/venezuelademo-pdf-2026-11-11/enrich.json', 'utf8')) as {
  artistas: Array<{ artist_id: number; nombre: string; biography?: string; origin_city?: string; formed_year?: number }>;
  nuevos: Array<{ slug: string; name: string; artist_type: string; biography: string; origin_city: string; origin_country: string; notes: string }>;
  albumes: Array<{ artist_id: number | null; slug: string; artista: string; title: string; release_year: number | null; album_type: string; notes: string }>;
};
console.log(`artistas a completar ${PLAN.artistas.length} · nuevos ${PLAN.nuevos.length} · discos ${PLAN.albumes.length}`);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: TAG,
  operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Reseñas PDF de VenezuelaDemo: altas de artistas y discos, biografías y datos de origen solo en campos vacíos.',
  params: { campaign: TAG, artistas: PLAN.artistas.length, nuevos: PLAN.nuevos.length, discos: PLAN.albumes.length },
}, async (context) => {
  const count = { artistasNuevos: 0, artistasCompletados: 0, campos: 0, discosCreados: 0, discosYaEstaban: 0, discosSimilares: 0 };
  const nuevos = new Map<string, number>();
  for (const n of PLAN.nuevos) {
    const ex = await context.client.query<{ id: string }>('SELECT id::text FROM public.artists WHERE lower(name)=lower($1) LIMIT 1', [n.name]);
    if (ex.rowCount) { nuevos.set(n.slug, Number(ex.rows[0]!.id)); continue; }
    try {
      const a = await createEntity(context, 'artist', {
        name: n.name, artist_type: n.artist_type, biography: n.biography,
        origin_city: n.origin_city, origin_country: n.origin_country, notes: n.notes,
      }, { allowSimilar: true });
      nuevos.set(n.slug, a.id);
      count.artistasNuevos++;
    } catch (error) {
      if (error instanceof OperatorError && error.code === 'already_exists') {
        const id = (error.details as { existingId?: number } | undefined)?.existingId;
        if (id) nuevos.set(n.slug, id);
        continue;
      }
      throw error;
    }
  }
  for (const a of PLAN.artistas) {
    const live = (await context.client.query<{ biography: string | null; origin_city: string | null; formed_year: number | null }>(
      'SELECT biography, origin_city, formed_year FROM public.artists WHERE id=$1', [a.artist_id])).rows[0];
    if (!live) continue;
    const fields: Record<string, unknown> = {};
    if (a.biography && !(live.biography ?? '').trim()) fields['biography'] = a.biography;
    if (a.origin_city && !(live.origin_city ?? '').trim()) fields['origin_city'] = a.origin_city;
    if (a.formed_year && !live.formed_year) fields['formed_year'] = a.formed_year;
    if (!Object.keys(fields).length) continue;
    await updateEntity(context, 'artist', a.artist_id, fields);
    count.artistasCompletados++;
    count.campos += Object.keys(fields).length;
  }
  for (const al of PLAN.albumes) {
    const artistId = al.artist_id ?? nuevos.get(al.slug);
    if (!artistId) continue;
    const dup = await context.client.query(
      "SELECT 1 FROM public.albums WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
      [artistId, al.title]);
    if (dup.rowCount) { count.discosYaEstaban++; continue; }
    try {
      await createEntity(context, 'album', {
        title: al.title, release_year: al.release_year, album_type: al.album_type, notes: al.notes,
      }, { artistId, allowSimilar: true });
      count.discosCreados++;
    } catch (error) {
      if (error instanceof OperatorError && error.code === 'already_exists') { count.discosSimilares++; continue; }
      throw error;
    }
  }
  return count;
});
writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-enrich.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
