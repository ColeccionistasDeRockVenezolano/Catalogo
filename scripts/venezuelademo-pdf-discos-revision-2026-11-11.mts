/**
 * VenezuelaDemo (PDF) — discos que quedaron en revisión: crea los 132 confirmados
 * contra el catálogo (los 36 dudosos siguen en la lista de revisión).
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-discos-revision-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, OperatorError, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-discos-revision-2026-11-11';
const APPLY = process.argv.includes('--apply');
const plan = JSON.parse(readFileSync('/tmp/vd_discos_revision.json', 'utf8')) as Array<{
  artist_id: number; artista: string; title: string; release_year: number | null; album_type: string; notes: string;
}>;
console.log(`discos a crear ${plan.length}`);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: TAG, operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Discos de la discografía de VenezuelaDemo que quedaron en revisión: creados tras cotejar título y artista contra el catálogo; los dudosos no se tocan.',
  params: { campaign: TAG, discos: plan.length },
}, async (context) => {
  const count = { creados: 0, yaEstaban: 0, similares: 0 };
  for (const al of plan) {
    const dup = await context.client.query(
      "SELECT 1 FROM public.albums WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
      [al.artist_id, al.title]);
    if (dup.rowCount) { count.yaEstaban++; continue; }
    try {
      await createEntity(context, 'album', {
        title: al.title, release_year: al.release_year, album_type: al.album_type, notes: al.notes,
      }, { artistId: al.artist_id, allowSimilar: true });
      count.creados++;
    } catch (error) {
      if (error instanceof OperatorError && error.code === 'already_exists') { count.similares++; continue; }
      throw error;
    }
  }
  return count;
});
writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-discos-revision.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
