/** Cierra las identidades de intérprete de RHV que quedaron marcadas.
 * - Agni es el nombre corto documentado de Agni Mogollón: se registra como alias.
 * - «Frank Quintero y Los Balzehaguaos» es la banda 293, no el solista: el crédito de
 *   intérprete se traslada a la banda en los seis discos donde la fuente la nombra.
 * - «Tributo a los Desconocidos» es un disco propio de Gillman: no lleva crédito ajeno.
 * Usage: scripts/with-node22.sh tsx scripts/fix-rhv-performer-identity-2026-11-02.mts <report-dir> [--confirm] */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createRelation, deleteRelation, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { normalizeIdentity } from '../src/normalization/claims.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
const AGNI = 1832; const BAND = 293;
const transfers = [
  { albumId: 42870, creditId: 125566, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
  { albumId: 43121, creditId: 125744, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
  { albumId: 42848, creditId: 125567, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
  { albumId: 43122, creditId: 125745, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
  { albumId: 4867, creditId: 125568, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
  { albumId: 43125, creditId: 125749, url: 'https://rockhechovenezuela.com/f/frank-quintero/' },
];
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const outcome = await withOperatorRun({
    name: 'rhv:performer-identity-2026-11-02', operator: 'hermes',
    note: 'Brian: cerrar identidades de intérprete de RHV. Alias documentado de Agni Mogollón y crédito de la banda Frank Quintero & Los Balzehaguaos en los discos donde la fuente la nombra',
    params: { transfers: transfers.length, alias: 'Agni' },
  }, async ctx => {
    await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:performer-identity-2026-11-02'))");
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const result = { aliasCreated: false, transferred: [] as unknown[], skipped: [] as unknown[], evidence: 0 };
    // 1) Alias «Agni» para Agni Mogollón, con la ficha como evidencia.
    const agniUrl = 'https://rockhechovenezuela.com/a/agni-mogollon/';
    const existing = (await ctx.client.query('SELECT 1 FROM ingest.artist_aliases WHERE artist_id=$1 AND normalized_alias=$2', [AGNI, normalizeIdentity('Agni')])).rows.length;
    if (existing) result.skipped.push({ alias: 'Agni', reason: 'ya existe' });
    else {
      const identity = `rhv-alias-2026-11-02:${AGNI}:agni`;
      const claim = await persistClaim({ entityKind: 'artist', artistId: AGNI, field: 'alias', rawValue: 'Agni', normalizedValue: 'Agni',
        identity, identitySecondary: identity, originalIdentity: 'Intérprete: Agni', rawHash: sha([identity, 'Agni']), sourceId, runId: ctx.runId,
        confidence: 'medium', createdBy: 'human', extractor: 'rhv-performer-identity', extractorVersion: '1',
        evidence: { url: agniUrl, excerpt: 'La ficha de Agni Mogollón lista sus discos con el intérprete «Agni»' } }, ctx.client);
      await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claim.id]);
      await ctx.client.query(`INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,claim_id,notes)
        VALUES($1,'Agni','name_variant',$2,false,'medium',$3,$4,'Nombre corto usado por la fuente en sus discos')
        ON CONFLICT DO NOTHING`, [AGNI, normalizeIdentity('Agni'), sourceId, claim.id]);
      result.aliasCreated = true; result.evidence++;
    }
    // 2) Traslado del crédito de intérprete del solista a la banda.
    for (const t of transfers) {
      await ctx.client.query('SAVEPOINT transfer');
      try {
        const credit = (await ctx.client.query<{ artistId: number; notes: string | null }>('SELECT artist_id::int "artistId",notes FROM public.album_credits WHERE id=$1 FOR UPDATE', [t.creditId])).rows[0];
        if (!credit) { result.skipped.push({ ...t, reason: 'crédito ausente' }); await ctx.client.query('RELEASE SAVEPOINT transfer'); continue; }
        if (credit.artistId !== 1722) { result.skipped.push({ ...t, reason: 'el crédito ya no es del solista' }); await ctx.client.query('RELEASE SAVEPOINT transfer'); continue; }
        const band = await createRelation(ctx, 'album_credit', { albumId: t.albumId, artistId: BAND }, {
          credit_role: 'Intérprete', credit_type: 'musician',
          notes: `${t.url} — Intérprete según la fuente: Frank Quintero y Los Balzehaguaos (banda). El crédito anterior al solista se retiró en el run ${ctx.runId}.`,
        });
        const claims = (await ctx.client.query<{ id: number }>('SELECT id::int FROM ingest.claims WHERE album_credit_id=$1 AND field=$2', [t.creditId, 'documented_tracks'])).rows;
        for (const claim of claims) {
          await ctx.client.query('UPDATE ingest.claims SET album_credit_id=$1 WHERE id=$2', [band.id, claim.id]);
        }
        await ctx.client.query('UPDATE public.track_credits SET artist_id=$1 WHERE artist_id=1722 AND track_id IN (SELECT id FROM public.tracks WHERE album_id=$2)', [BAND, t.albumId]);
        await deleteRelation(ctx, 'album_credit', t.creditId);
        result.transferred.push({ albumId: t.albumId, from: 1722, to: BAND, creditId: band.id, claims: claims.length });
        await ctx.client.query('RELEASE SAVEPOINT transfer');
      } catch (error) {
        await ctx.client.query('ROLLBACK TO SAVEPOINT transfer');
        result.skipped.push({ ...t, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'performer-identity-applied.json' : 'performer-identity-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, alias: outcome.result.aliasCreated, transferred: outcome.result.transferred.length, skipped: outcome.result.skipped.length }));
} finally { await closeDb(); }
