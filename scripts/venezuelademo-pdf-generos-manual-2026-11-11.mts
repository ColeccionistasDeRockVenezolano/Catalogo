/**
 * VenezuelaDemo (PDF) — 17 etiquetas de género que la taxonomía no resolvía:
 * mapeo manual a los géneros existentes, solo en fichas sin principal confirmado.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-generos-manual-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { confirmGenre } from '../src/genres/human.js';
import { withOperatorRun } from '../src/merge/operator.js';

const APPLY = process.argv.includes('--apply');
const fichas = JSON.parse(readFileSync('reports/venezuelademo-pdf-2026-11-11/fichas.json', 'utf8')) as {
  generos: Array<{ artist_id: number; nombre: string; raw: string[]; url: string }>;
};
// nombre del PDF -> géneros de la taxonomía (primero = principal)
const MAPEO: Record<string, string[]> = {
  'Alexander Livinalli y su Zaperoco': ['sangueo', 'tambor-afrovenezolano', 'calipso', 'gaita', 'musica-navidena', 'fulia'],
  'Ensamble enCayapa': ['gaita'],
  'Ensamble Manoroz': ['folclor-fusion'],
  'Grupo Candela': ['gaita'],
  'Grupo Iven': ['nueva-cancion', 'gaita'],
  'Héctor López': ['merengue-venezolano', 'guasa', 'gaita'],
  'La Sonora Balacera': ['reggae', 'fusion-latina'],
  'Los Otros Dos': ['fusion-latina'],
  'Grupo Vocal Oktempo': ['musica-coral'],
  'Ricardo Viloria': ['fusion-latina'],
  'Sol y Sereno': ['aguinaldo'],
  'Tambor veleño La Guanipera': ['tambor-afrovenezolano'],
  'Trío 4B': ['vals-venezolano'],
  'Venezuela un Solo Pueblo': ['musica-tradicional', 'fulia', 'tambor-afrovenezolano', 'musica-navidena'],
};
const objetivos = fichas.generos.filter(g => MAPEO[g.nombre]);
console.log('fichas a mapear:', objetivos.length, '· sin mapeo (se dejan):', 17 - objetivos.length);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: 'venezuelademo-pdf-generos-manual-2026-11-11', operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Mapeo manual de las etiquetas de género de las reseñas PDF de VenezuelaDemo que la taxonomía no reconocía; solo fichas sin principal confirmado.',
}, async (context) => {
  const count = { confirmadas: 0, secundarios: 0, yaTenían: 0, errores: 0 };
  const detalle: unknown[] = [];
  for (const row of objetivos) {
    const live = await context.client.query("SELECT 1 FROM ingest.artist_genres WHERE artist_id=$1 AND role='primary' AND status='confirmed' LIMIT 1", [row.artist_id]);
    if (live.rowCount) { count.yaTenían++; continue; }
    const slugs = MAPEO[row.nombre]!;
    const reason = `La reseña de VenezuelaDemo nombra «${row.raw.join(', ')}»; mapeado a ${slugs.join(', ')} (run ${context.runId})`;
    for (const [i, slug] of slugs.entries()) {
      try {
        await confirmGenre(context.client, {
          kind: 'artist', entityId: row.artist_id, genreSlug: slug,
          actor: 'hermes:venezuelademo-generos', reason, role: i === 0 ? 'primary' : 'secondary', runId: context.runId,
        });
        if (i === 0) count.confirmadas++; else count.secundarios++;
      } catch (error) {
        count.errores++;
        detalle.push({ artist: row.nombre, slug, error: (error as Error).message.slice(0, 160) });
      }
    }
  }
  return { count, detalle };
});
writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-generos-manual.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
