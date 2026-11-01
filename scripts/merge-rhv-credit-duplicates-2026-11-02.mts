/** Fusiona los recopilatorios VA duplicados que creó el plan de créditos 2026-11-02.
 * Solo pares del mismo año, sin pistas y con títulos equivalentes; el motor mueve créditos y claims.
 * Usage: scripts/with-node22.sh tsx scripts/merge-rhv-credit-duplicates-2026-11-02.mts <staging-dir> [--confirm] */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { mergeAlbums, previewAlbumMerge, type AlbumMergePreview } from '../src/merge/album-merge.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
// keep conserva el título con más créditos; drop es la ficha creada de más.
const decisions = [
  { keep: 43092, drop: 43101, why: '«Los 15 Años del Hit Parade de Venezuela» vs «Los 15 Años de el Hit Parade…»' },
  { keep: 43159, drop: 43094, why: '«La Gran Parada de las Canciones: Éxitos 60 & 70» vs «… . Exitos 60 & 70»' },
  { keep: 43083, drop: 43128, why: '«Gente de la Música» vs «La Gente de la Música», mismo año' },
  { keep: 43092, drop: 43146, why: '«Los 15 Años del Hit Parade de Venezuela» vs «15 Años del Hit Parade de Venezuela», mismo año' },
];
const pin = path.join(root, 'credit-duplicate-previews.json');
const baselines = confirm && exists(pin) ? (JSON.parse(readFileSync(pin, 'utf8')) as AlbumMergePreview[]) : [];
function exists(p: string) { try { readFileSync(p); return true; } catch { return false; } }
try {
  const outcome = await withOperatorRun({
    name: 'rhv:credit-duplicate-albums-2026-11-02', operator: 'hermes',
    note: 'Duplicados de recopilatorio creados al importar créditos RHV: mismo año, sin pistas y títulos equivalentes; se conserva la ficha con más créditos',
    params: { decisions },
  }, async ctx => {
    const previews: AlbumMergePreview[] = []; const merged: unknown[] = [];
    for (const d of decisions) {
      await ctx.client.query('SAVEPOINT pair');
      try {
        const present = (await ctx.client.query('SELECT count(*)::int n FROM ingest.catalog_albums WHERE id IN ($1,$2)', [d.keep, d.drop])).rows[0].n;
        if (present !== 2) { merged.push({ ...d, skipped: 'par ya fusionado' }); await ctx.client.query('RELEASE SAVEPOINT pair'); continue; }
        const preview = await previewAlbumMerge(ctx.client, d.keep, d.drop, { lock: true, mode: 'match' });
        const va = Number((await ctx.client.query("SELECT id FROM ingest.catalog_artists WHERE lower(name) IN ('various artists','varios artistas') ORDER BY id LIMIT 1")).rows[0].id);
        if (preview.keep.artistId !== va || preview.drop.artistId !== va) throw new Error('Alguno no es VA');
        if (preview.keep.fields['release_year'] !== preview.drop.fields['release_year']) throw new Error('Años distintos');
        if (preview.keep.tracks.length || preview.drop.tracks.length) throw new Error('Tienen pistas: revisar a mano');
        if (confirm) {
          const prior = baselines.find(p => p.keep.id === d.keep && p.drop.id === d.drop);
          if (!prior || prior.previewHash !== preview.previewHash) throw new Error(`Cambió la previsualización de ${d.keep}`);
        }
        const operation = await mergeAlbums(ctx, { keepId: d.keep, dropId: d.drop, previewHash: preview.previewHash, mode: 'match', keepDropNameAsAlias: true });
        previews.push(preview); merged.push({ ...d, operation });
        await ctx.client.query('RELEASE SAVEPOINT pair');
      } catch (error) {
        await ctx.client.query('ROLLBACK TO SAVEPOINT pair');
        merged.push({ ...d, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!confirm) writeFileSync(pin, JSON.stringify(previews, null, 2));
    return merged;
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'credit-duplicates-applied.json' : 'credit-duplicates-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, merged: outcome.result.length, errors: (outcome.result as Array<{ error?: string }>).filter(r => r.error).length, detail: outcome.result }));
} finally { await closeDb(); }
