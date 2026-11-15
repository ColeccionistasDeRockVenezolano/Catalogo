/**
 * VenezuelaDemo (PDF) — resolución de los créditos del tema promocional que quedaron
 * sin persona única: enlace a persona/artista/organización existente y alta de las
 * personas que la fuente documenta y no están en el catálogo.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-creditos2-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, createRelation, OperatorError, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-creditos2-2026-11-11';
const APPLY = process.argv.includes('--apply');
const plan = JSON.parse(readFileSync('/tmp/vd_credit_plan.json', 'utf8')) as Array<{
  slug: number; tema: string; rol: string; nombre: string; accion: string; id: number | null; motivo: string;
}>;
console.log(`entradas ${plan.length} · ${JSON.stringify(plan.reduce((acc, p) => ({ ...acc, [p.accion]: (acc[p.accion] ?? 0) + 1 }), {} as Record<string, number>))}`);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const fold = (v: string): string => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
const CREDIT_TYPE: Array<[RegExp, string]> = [
  [/producci/iu, 'producer'], [/mezcla|mix/iu, 'mixing'], [/master/iu, 'mastering'],
  [/grabaci|ingenier/iu, 'recording'], [/letra|m[uú]sica|autor|composici/iu, 'composer'],
  [/arregl/iu, 'other'], [/m[uú]sico|instrument|guitarra|bajo|bater|piano|saxo|tromp|percus|voz|voces|cant/iu, 'musician'],
];
const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Créditos del tema promocional de VenezuelaDemo: enlazados a personas, artistas y sellos existentes; personas nuevas solo cuando la fuente las nombra y no están en el catálogo.',
  params: { campaign: TAG, entradas: plan.length },
}, async (context) => {
  const count = { persona: 0, artista: 0, organizacion: 0, personasNuevas: 0, creditos: 0, yaEstaban: 0, sinPista: 0, errores: 0 };
  const creadas = new Map<string, number>();
  for (const item of plan) {
    if (item.accion === 'skip') continue;
    const album = (await context.client.query<{ id: string }>(
      "SELECT a.id::text FROM public.albums a JOIN public.tracks t ON t.album_id=a.id WHERE a.artist_id=$1 AND lower(regexp_replace(t.title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
      [item.slug, item.tema])).rows[0];
    if (!album) { count.sinPista++; continue; }
    const track = (await context.client.query<{ id: string }>(
      "SELECT id::text FROM public.tracks WHERE album_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
      [Number(album.id), item.tema])).rows[0];
    if (!track) { count.sinPista++; continue; }
    const trackId = Number(track.id);
    const type = CREDIT_TYPE.find(([re]) => re.test(item.rol))?.[1] ?? 'other';
    try {
      let relation: Record<string, number>;
      if (item.accion === 'new_person') {
        const key = fold(item.nombre);
        let personId = creadas.get(key);
        if (!personId) {
          const existing = (await context.client.query<{ id: string }>(
            "SELECT id::text FROM public.persons WHERE lower(regexp_replace(name,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($1,'[^a-zA-Z0-9]','','g')) LIMIT 2", [item.nombre])).rows;
          if (existing.length === 1) personId = Number(existing[0]!.id);
          else {
            const created = await createEntity(context, 'person', {
              name: item.nombre,
              notes: 'Acreditada en la reseña PDF de VenezuelaDemo (MCI). Alta desde un crédito del tema promocional.',
            }, { allowSimilar: true });
            personId = created.id;
            count.personasNuevas++;
          }
          creadas.set(key, personId);
        }
        relation = { trackId, personId };
        count.persona++;
      } else if (item.accion === 'person') { relation = { trackId, personId: item.id! }; count.persona++; }
      else if (item.accion === 'artist') { relation = { trackId, artistId: item.id! }; count.artista++; }
      else { relation = { trackId, organizationId: item.id! }; count.organizacion++; }
      await createRelation(context, 'track_credit', relation, {
        credit_type: type, credit_role: item.rol.slice(0, 80),
        notes: 'Crédito de la reseña de VenezuelaDemo (MCI).',
      });
      count.creditos++;
    } catch (error) {
      if (error instanceof OperatorError) { count.yaEstaban++; continue; }
      count.errores++;
    }
  }
  return count;
});
writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-creditos2.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
