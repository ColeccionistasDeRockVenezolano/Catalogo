/** Aplica el plan de créditos RHV 2026-11-02 (credit-plan.json).
 * Rehearsal por defecto; --confirm escribe en un run con evidencia y es reversible.
 * Usage: scripts/with-node22.sh tsx scripts/apply-rhv-credits-2026-11-02.mts <staging-dir> [--confirm] */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim, type ClaimTargets } from '../src/claims/persistence.js';
import { matchingAppearanceTracks, sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
const only = process.argv.find(a => a.startsWith('--actions='))?.slice('--actions='.length).split(',');
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length) ?? 0);
const offset = Number(process.argv.find(a => a.startsWith('--offset='))?.slice('--offset='.length) ?? 0);
type PlanEntry = {
  artist: string; artistId: number; url: string; title: string; year: number | null; header: string;
  performer: string | null; status: string; tracks: string[]; covers: string[]; action: string;
  albumId?: number; albumTitle?: string; owner?: string; ownerArtistId?: number; trackHits?: number;
};
const plan = (JSON.parse(readFileSync(path.join(root, 'credit-plan.json'), 'utf8')) as { entries: PlanEntry[] }).entries
  .filter(e => ['credit_existing', 'credit_near', 'create_album_and_credit'].includes(e.action))
  .filter(e => !only || only.includes(e.action))
  .slice(offset, limit > 0 ? offset + limit : undefined);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tracksClaim = (e: PlanEntry) => e.tracks;

try {
  const outcome = await withOperatorRun({
    name: 'rhv:credits-2026-11-02', operator: 'hermes',
    note: 'Brian: importa audiovisuales y créditos de RHV. Créditos de intérprete y temas documentados por ficha de artista; sin inventar posiciones ni tracklists',
    params: { plan: path.join(root, 'credit-plan.json'), entries: plan.length, actions: [...new Set(plan.map(e => e.action))] },
  }, async ctx => {
    await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:credits-2026-11-02'))");
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const pages = (await ctx.client.query<{ id: number; url: string }>("SELECT id::int,canonical_url url FROM ingest.raw_pages WHERE canonical_url LIKE 'https://rockhechovenezuela.com/%'")).rows;
    const vaId = Number((await ctx.client.query("SELECT id FROM ingest.catalog_artists WHERE lower(name) IN ('various artists','varios artistas') ORDER BY id LIMIT 1")).rows[0]?.id);
    if (!vaId) throw new Error('Falta Various Artists');
    async function evidence(kind: 'album' | 'album_credit' | 'track_credit', targets: ClaimTargets, field: string, value: unknown, url: string, excerpt: string) {
      const identity = `rhv-credits-2026-11-02:${kind}:${JSON.stringify(targets)}:${field}`;
      const rawPageId = pages.find(p => p.url === url)?.id;
      const persisted = await persistClaim({ entityKind: kind, ...targets, field, rawValue: value, normalizedValue: value,
        identity, identitySecondary: identity, originalIdentity: excerpt.slice(0, 250), rawHash: sha([identity, value, url]),
        sourceId, ...(rawPageId === undefined ? {} : { rawPageId }), runId: ctx.runId, confidence: 'medium', createdBy: 'human',
        extractor: 'rhv-credits-recovery', extractorVersion: '1', evidence: { url, excerpt: excerpt.slice(0, 1000) } }, ctx.client);
      await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [persisted.id]);
      return persisted.id;
    }
    const result = { albumsCreated: 0, albumCreditsCreated: 0, existingCredits: 0, trackCreditsCreated: 0, documentedTracks: 0, evidence: 0, failures: [] as unknown[], albumIds: [] as Array<{ source: string; albumId: number; title: string }> };
    const cache = new Map<string, number>();
    let processed = 0;
    for (const e of plan) {
      await ctx.client.query('SAVEPOINT credit');
      const before = { albumsCreated: result.albumsCreated, albumCreditsCreated: result.albumCreditsCreated, existingCredits: result.existingCredits, trackCreditsCreated: result.trackCreditsCreated, evidence: result.evidence, documentedTracks: result.documentedTracks };
      try {
        let albumId: number | undefined = e.albumId ?? cache.get(key(e.title));
        if (albumId === undefined) {
          const existing = (await ctx.client.query<{ id: number; artistId: number; title: string; year: number | null }>(
            `SELECT id::int,artist_id::int "artistId",title,release_year "year" FROM ingest.catalog_albums
             WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]+','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]+','','g'))`, [vaId, e.title])).rows;
          if (existing.length > 1) throw new Error('Varios discos VA con el mismo título');
          if (existing[0] && (existing[0].year === null || e.year === null || existing[0].year === e.year)) albumId = existing[0].id;
          else if (existing[0]) throw new Error(`Año distinto en disco VA existente (${existing[0].year} vs ${e.year})`);
          else {
            const created = await createEntity(ctx, 'album', {
              title: e.title, release_year: e.year, album_type: 'compilation',
              description: `Recopilatorio documentado en Rock Hecho en Venezuela. Participación de ${e.artist}: ${e.header}. La fuente enumera solo los temas de este artista, no el tracklist completo.`,
              notes: `Fuente: ${e.url}`,
            }, { artistId: vaId, allowSimilar: true });
            albumId = created.id; result.albumsCreated++;
            result.albumIds.push({ source: e.url, albumId, title: e.title });
            await evidence('album', { albumId }, 'title', e.title, e.url, e.header);
            result.evidence++;
          }
        }
        const live = (await ctx.client.query<{ artistId: number; title: string }>(`SELECT artist_id::int "artistId",title FROM ingest.catalog_albums WHERE id=$1 FOR SHARE`, [albumId])).rows[0];
        if (!live) throw new Error('El disco desapareció');
        if (live.artistId === e.artistId) { cache.set(key(e.title), albumId); await ctx.client.query('RELEASE SAVEPOINT credit'); processed++; continue; }
        const names = [e.artist];
        const relation = await createRelation(ctx, 'album_credit', { albumId, artistId: e.artistId }, {
          credit_role: 'Intérprete', credit_type: 'musician',
          notes: `${e.url} — Intérprete según la fuente: ${e.performer ?? e.artist}. Temas documentados: ${e.tracks.join('; ') || 'sin lista'}${e.owner ? ` (disco a nombre de ${e.owner})` : ''}`,
        });
        if (relation.created) result.albumCreditsCreated++; else result.existingCredits++;
        if (!relation.created) {
          const claimed = (await ctx.client.query(`SELECT 1 FROM ingest.claims WHERE field='documented_tracks' AND album_credit_id=$1 LIMIT 1`, [relation.id])).rows.length;
          if (claimed) { cache.set(key(e.title), albumId); await ctx.client.query('RELEASE SAVEPOINT credit'); processed++; continue; }
        }
        if (e.tracks.length) {
          await evidence('album_credit', { albumCreditId: relation.id }, 'documented_tracks', tracksClaim(e), e.url,
            `${e.title} (${e.year ?? 's/f'}). Temas interpretados por ${e.performer ?? e.artist}: ${e.tracks.join(', ')}`);
          result.evidence++; result.documentedTracks += e.tracks.length;
        }
        const rows = (await ctx.client.query<{ id: number; title: string }>('SELECT id::int,title FROM ingest.catalog_tracks WHERE album_id=$1', [albumId])).rows;
        for (const title of e.tracks) {
          const matches = matchingAppearanceTracks(rows, title, names);
          if (matches.length === 1) {
            const credit = await createRelation(ctx, 'track_credit', { trackId: matches[0]!.id, artistId: e.artistId }, { credit_role: 'Intérprete', credit_type: 'musician', notes: `Según ${e.url}` });
            if (credit.created) result.trackCreditsCreated++;
            if (credit.created) { await evidence('track_credit', { trackCreditId: credit.id }, 'credit_role', 'Intérprete', e.url, `${e.artist}: ${title} en ${e.title}`); result.evidence++; }
          }
        }
        cache.set(key(e.title), albumId);
        await ctx.client.query('RELEASE SAVEPOINT credit');
      } catch (error) {
        await ctx.client.query('ROLLBACK TO SAVEPOINT credit');
        Object.assign(result, before);
        result.failures.push({ artist: e.artist, title: e.title, action: e.action, error: error instanceof Error ? error.message : String(error) });
      }
      processed++;
      if (processed % 25 === 0) console.log(JSON.stringify({ processed, total: plan.length, albumsCreated: result.albumsCreated, credits: result.albumCreditsCreated, failures: result.failures.length }));
    }
    return result;
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'credits-applied.json' : 'credits-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, ...outcome.result, failures: outcome.result.failures.length, albumIds: undefined }));
} finally { await closeDb(); }
