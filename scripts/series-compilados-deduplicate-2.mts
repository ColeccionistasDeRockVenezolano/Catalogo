/** Segunda tanda de duplicados en series: repertorio comparado con la fuente; ensayo por defecto y diario reversible. */
import { writeFileSync } from 'node:fs';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { previewAlbumMerge, mergeAlbums } from '../src/merge/album-merge.js';
const out = process.argv[2]; if (!out) throw new Error('Indica carpeta del staging');
const confirm = process.argv.includes('--confirm');
// keep, drop, pistas emparejadas esperadas, título documentado (null = se conserva)
const pairs = [
  { keep: 400, drop: 4690, matched: 16, title: 'Venezuela 70: Cosmic Visions of a Latin American Earth',
    evidence: 'Mismo repertorio de 16 pistas en el mismo orden; Soul Jazz Records, 2016' },
  { keep: 651, drop: 2618, matched: 16, title: null,
    evidence: 'Discogs 2231361 (Venezuela Electronica Vol. 2 Blanco, 2007): 15 pistas idénticas; la pista 6 es «Canción Para Ti» de Dr. Muu, «Frank King» era un error de captura' },
];
try {
  const result = await withOperatorRun({ name: 'series:compilados-duplicados', operator: 'claude',
    note: 'Fichas repetidas dentro de una serie de compilados; misma edición comprobada por repertorio',
    params: { evidence: ['https://www.discogs.com/release/2231361'] } }, async ctx => {
    const operations = [];
    for (const pair of pairs) {
      const preview = await previewAlbumMerge(ctx.client, pair.keep, pair.drop, { mode: 'match', lock: true });
      if (preview.matchedTracks.length !== pair.matched || preview.unmatchedDropTracks.length !== 0)
        throw new Error(`Revisar repertorio ${pair.keep}/${pair.drop}: ${preview.matchedTracks.length} emparejadas, ${preview.unmatchedDropTracks.length} sueltas`);
      const merged = await mergeAlbums(ctx, { keepId: pair.keep, dropId: pair.drop, previewHash: preview.previewHash, mode: 'match', keepDropNameAsAlias: true });
      if (pair.title) await ctx.client.query('UPDATE public.albums SET title=$2, updated_at=now() WHERE id=$1', [pair.keep, pair.title]);
      operations.push({ ...merged, evidence: pair.evidence, conflicts: preview.fieldConflicts.map(c => ({ field: c.field, keep: c.keepValue, drop: c.dropValue })), warnings: preview.warnings });
    }
    return operations;
  }, { rollbackOnly: !confirm });
  writeFileSync(`${out}/deduplicate-2-${confirm ? 'applied' : 'dry-run'}.json`, JSON.stringify({ confirmed: confirm, ...result }, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally { await closeDb(); }
