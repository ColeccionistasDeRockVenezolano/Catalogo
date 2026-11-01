/** Aplica las portadas de recopilatorios VA capturadas (covers-va.json) por albumId.
 * Verifica sha256 antes y después de copiar al almacén. Rehearsal por defecto.
 * Usage: scripts/with-node22.sh tsx scripts/apply-rhv-va-covers.mts <staging-dir> [--confirm] */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
type Capture = { albumId: number; title: string; year?: number | null; source?: string; cover?: string; sha256?: string; localUrl?: string; error?: string };
const captures = (JSON.parse(readFileSync(path.join(root, 'covers-va.json'), 'utf8')) as Capture[]).filter(c => !c.error && c.sha256 && c.localUrl && c.source && c.cover);
const destDir = path.join('web/public/media', 'rhv-credits-2026-11-02');
mkdirSync(destDir, { recursive: true });
const staged = path.join(root, 'covers-credits');
try {
  const outcome = await withOperatorRun({
    name: 'rhv:va-covers-2026-11-02', operator: 'hermes',
    note: 'Portadas de recopilatorios de Various Artists sin imagen, tomadas de la ficha RHV y verificadas por sha256',
    params: { candidates: captures.length },
  }, async ctx => {
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const vaId = Number((await ctx.client.query("SELECT id FROM ingest.catalog_artists WHERE lower(name) IN ('various artists','varios artistas') ORDER BY id LIMIT 1")).rows[0].id);
    const changed: unknown[] = []; const skipped: unknown[] = [];
    for (const c of captures) {
      const name = path.basename(c.localUrl!);
      const from = path.join(staged, name);
      const to = path.join(destDir, name);
      if (!existsSync(from)) { skipped.push({ albumId: c.albumId, title: c.title, reason: 'sin archivo en staging' }); continue; }
      if (createHash('sha256').update(readFileSync(from)).digest('hex') !== c.sha256) { skipped.push({ albumId: c.albumId, title: c.title, reason: 'sha256 no coincide' }); continue; }
      const album = (await ctx.client.query<{ artistId: number; title: string; cover: string | null }>(
        'SELECT artist_id::int "artistId",title,cover_url cover FROM ingest.catalog_albums WHERE id=$1 FOR UPDATE', [c.albumId])).rows[0];
      if (!album) { skipped.push({ albumId: c.albumId, title: c.title, reason: 'disco ausente' }); continue; }
      if (album.artistId !== vaId) { skipped.push({ albumId: c.albumId, title: c.title, reason: 'ya no es VA' }); continue; }
      if (album.cover) { skipped.push({ albumId: c.albumId, title: c.title, reason: 'ya tiene portada' }); continue; }
      if (!existsSync(to)) copyFileSync(from, to);
      if (createHash('sha256').update(readFileSync(to)).digest('hex') !== c.sha256) throw new Error('Copia publicada no verificada');
      if (confirm) {
        await updateEntity(ctx, 'album', c.albumId, { cover_url: c.localUrl });
        const identity = `rhv-va-cover-2026-11-02:${c.albumId}`;
        const claim = await persistClaim({ entityKind: 'album', albumId: c.albumId, field: 'cover_url', rawValue: c.cover!, normalizedValue: c.localUrl!,
          identity, identitySecondary: identity, originalIdentity: c.title, rawHash: createHash('sha256').update(JSON.stringify([c.albumId, c.cover])).digest('hex'),
          sourceId, runId: ctx.runId, confidence: 'medium', createdBy: 'human', extractor: 'rhv-va-cover', extractorVersion: '1',
          evidence: { url: c.source!, excerpt: `${c.title} (${c.year ?? 's/f'}) — portada ${c.cover}` } }, ctx.client);
        await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
      }
      changed.push({ albumId: c.albumId, title: c.title, localUrl: c.localUrl });
    }
    return { changed, skipped };
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'covers-va-applied.json' : 'covers-va-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, changed: outcome.result.changed.length, skipped: outcome.result.skipped.length }));
} finally { await closeDb(); }
