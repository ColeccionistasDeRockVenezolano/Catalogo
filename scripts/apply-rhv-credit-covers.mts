/** Aplica las portadas capturadas de los recopilatorios RHV nuevos (covers-credits.json).
 * Verifica sha256 del archivo publicado antes de tocar el álbum. Rehearsal por defecto.
 * Usage: scripts/with-node22.sh tsx scripts/apply-rhv-credit-covers.mts <staging-dir> [--confirm] */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
type Capture = { source: string; artistId?: number; title?: string; year?: number | null; cover: string; sha256?: string; localUrl?: string; error?: string };
const captures = (JSON.parse(readFileSync(path.join(root, 'covers-credits.json'), 'utf8')) as Capture[]).filter(c => !c.error && c.sha256 && c.localUrl);
const destDir = path.join('web/public/media', 'rhv-credits-2026-11-02');
mkdirSync(destDir, { recursive: true });
const staged = path.join(root, 'covers-credits');
try {
  const outcome = await withOperatorRun({
    name: 'rhv:credit-covers-2026-11-02', operator: 'hermes',
    note: 'Portadas de recopilatorios RHV creadas desde la ficha del artista; imagen de la fuente verificada por sha256',
    params: { candidates: captures.length },
  }, async ctx => {
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const vaId = Number((await ctx.client.query("SELECT id FROM ingest.catalog_artists WHERE lower(name) IN ('various artists','varios artistas') ORDER BY id LIMIT 1")).rows[0].id);
    const changed: unknown[] = []; const skipped: unknown[] = [];
    for (const c of captures) {
      const name = path.basename(c.localUrl!);
      const from = path.join(staged, name);
      const to = path.join(destDir, name);
      if (!existsSync(from)) { skipped.push({ title: c.title, reason: 'sin archivo en staging' }); continue; }
      if (createHash('sha256').update(readFileSync(from)).digest('hex') !== c.sha256) { skipped.push({ title: c.title, reason: 'sha256 no coincide' }); continue; }
      const album = (await ctx.client.query<{ id: number; title: string; year: number | null; cover: string | null }>(
        `SELECT id::int,title,release_year "year",cover_url cover FROM ingest.catalog_albums
         WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]+','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]+','','g'))
           AND ($3::int IS NULL OR release_year IS NULL OR release_year=$3) ORDER BY id LIMIT 2`,
        [vaId, c.title, c.year ?? null])).rows;
      if (album.length !== 1) { skipped.push({ title: c.title, reason: album.length ? 'varios discos' : 'disco no encontrado' }); continue; }
      if (album[0]!.cover) { skipped.push({ title: c.title, reason: 'ya tiene portada' }); continue; }
      if (!existsSync(to)) copyFileSync(from, to);
      if (createHash('sha256').update(readFileSync(to)).digest('hex') !== c.sha256) throw new Error('Copia publicada no verificada');
      if (confirm) {
        await updateEntity(ctx, 'album', album[0]!.id, { cover_url: c.localUrl });
        const identity = `rhv-credit-cover-2026-11-02:${album[0]!.id}`;
        const claim = await persistClaim({ entityKind: 'album', albumId: album[0]!.id, field: 'cover_url', rawValue: c.cover, normalizedValue: c.localUrl,
          identity, identitySecondary: identity, originalIdentity: c.title ?? c.cover, rawHash: createHash('sha256').update(JSON.stringify([album[0]!.id, c.cover])).digest('hex'),
          sourceId, runId: ctx.runId, confidence: 'medium', createdBy: 'human', extractor: 'rhv-credit-cover', extractorVersion: '1',
          evidence: { url: c.source, excerpt: `${c.title} (${c.year ?? 's/f'}) — portada ${c.cover}` } }, ctx.client);
        await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
      }
      changed.push({ albumId: album[0]!.id, title: c.title, localUrl: c.localUrl });
    }
    return { changed, skipped };
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'covers-credits-applied.json' : 'covers-credits-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, changed: outcome.result.changed.length, skipped: outcome.result.skipped.length }));
} finally { await closeDb(); }
