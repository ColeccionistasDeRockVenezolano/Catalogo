/** Resuelve a mano los homónimos de recopilatorios RHV que el plan dejó en revisión.
 * Cada decisión es explícita y con evidencia de la ficha; el resto queda en la cola.
 * Usage: scripts/with-node22.sh tsx scripts/resolve-rhv-ambiguities-2026-11-02.mts <staging-dir> [--confirm] */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim, type ClaimTargets } from '../src/claims/persistence.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
const confirm = process.argv.includes('--confirm');
type Entry = { artist: string; artistId: number; url: string; title: string; year: number | null; header: string; performer: string | null; tracks: Array<{ title: string }>; covers: string[]; status: string };
const entries = (JSON.parse(readFileSync(path.join(root, 'compilation-audit.json'), 'utf8')) as { entries: Entry[] }).entries;
const pick = (artist: string, title: string): Entry => {
  const found = entries.find(e => e.artist === artist && e.title === title);
  if (!found) throw new Error(`Sin entrada: ${artist} — ${title}`);
  return found;
};
// Asociaciones verificadas a mano (título y año documentados en la ficha).
const link = [
  { entry: pick('Caramelos de Cianuro', 'Grabaciones Olvidadas'), albumId: 384, why: 'VA «Grabaciones Olvidadas» 2001, mismo título y año; el otro candidato es un artista homónimo' },
  { entry: pick('Colina', 'Lo Mejor de los 60 y 70'), albumId: 4647, why: 'VA «Lo Mejor de los 60 y 70» 1991; el otro candidato es el disco de Los 007' },
  { entry: pick('Fordelucs', 'Tratándose de Colina'), albumId: 2721, why: '«Tratándose de Colina» 2010 es el tributo donde participa Fordelucs' },
];
// Recopilatorios que no existen y comparten título con discos homónimos de otros artistas.
const create = [
  { title: 'Venezuela', year: 2000, artists: ['Bacalao Men', 'Claroscuro', 'Dermis Tatú'] },
  { title: 'Alma', year: 2003, artists: ['Dúplex'] },
  { title: 'Legado', year: 2000, artists: ['Decibel'] },
  { title: 'Two Headed Beast-A Journey of Venezuelan Black Metal', year: 2011, artists: ['Funebria'] },
];
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const outcome = await withOperatorRun({
    name: 'rhv:ambiguities-2026-11-02', operator: 'hermes',
    note: 'Homónimos de recopilatorios RHV resueltos uno a uno con la ficha del artista como evidencia',
    params: { link: link.length, create: create.length },
  }, async ctx => {
    await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('rhv:ambiguities-2026-11-02'))");
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const vaId = Number((await ctx.client.query("SELECT id FROM ingest.catalog_artists WHERE lower(name) IN ('various artists','varios artistas') ORDER BY id LIMIT 1")).rows[0].id);
    const pages = (await ctx.client.query<{ id: number; url: string }>("SELECT id::int,canonical_url url FROM ingest.raw_pages WHERE canonical_url LIKE 'https://rockhechovenezuela.com/%'")).rows;
    const result = { linked: [] as unknown[], created: [] as unknown[], skipped: [] as unknown[] };
    async function evidence(kind: 'album' | 'album_credit', targets: ClaimTargets, field: string, value: unknown, url: string, excerpt: string) {
      const identity = `rhv-ambiguity-2026-11-02:${kind}:${JSON.stringify(targets)}:${field}`;
      const claimed = await persistClaim({ entityKind: kind, ...targets, field, rawValue: value, normalizedValue: value, identity, identitySecondary: identity,
        originalIdentity: excerpt.slice(0, 250), rawHash: sha([identity, value, url]), sourceId, ...(pages.find(p => p.url === url) ? { rawPageId: pages.find(p => p.url === url)!.id } : {}),
        runId: ctx.runId, confidence: 'medium', createdBy: 'human', extractor: 'rhv-ambiguity-resolution', extractorVersion: '1', evidence: { url, excerpt: excerpt.slice(0, 1000) } }, ctx.client);
      await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'", [claimed.id]);
      return claimed.id;
    }
    for (const item of link) {
      const e = item.entry;
      const live = (await ctx.client.query<{ artistId: number }>('SELECT artist_id::int "artistId" FROM ingest.catalog_albums WHERE id=$1 FOR SHARE', [item.albumId])).rows[0];
      if (!live) { result.skipped.push({ ...item, reason: 'disco ausente' }); continue; }
      if (live.artistId === e.artistId) { result.skipped.push({ ...item, reason: 'disco propio del artista' }); continue; }
      const rel = await createRelation(ctx, 'album_credit', { albumId: item.albumId, artistId: e.artistId }, {
        credit_role: 'Intérprete', credit_type: 'musician', notes: `${e.url} — ${item.why}. Temas documentados: ${e.tracks.map(t => t.title).join('; ')}`,
      });
      if (e.tracks.length) {
        await evidence('album_credit', { albumCreditId: rel.id }, 'documented_tracks', e.tracks.map(t => t.title), e.url, `${e.title} (${e.year ?? 's/f'}): ${e.tracks.map(t => t.title).join(', ')}`);
      }
      result.linked.push({ albumId: item.albumId, artist: e.artist, created: rel.created, why: item.why });
    }
    for (const group of create) {
      const first = pick(group.artists[0]!, group.title);
      let albumId: number;
      const existing = (await ctx.client.query<{ id: number }>(
        `SELECT id::int FROM ingest.catalog_albums WHERE artist_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]+','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]+','','g')) AND ($3::int IS NULL OR release_year IS NULL OR release_year=$3)`, [vaId, group.title, group.year])).rows;
      if (existing.length === 1) albumId = existing[0]!.id;
      else {
        const created = await createEntity(ctx, 'album', {
          title: group.title, release_year: group.year, album_type: 'compilation',
          description: `Recopilatorio documentado en Rock Hecho en Venezuela. Participan: ${group.artists.join(', ')}. La fuente enumera solo los temas de cada artista, no el tracklist completo.`,
          notes: `Fuente: ${first.url}`,
        }, { artistId: vaId, allowSimilar: true });
        albumId = created.id;
        await evidence('album', { albumId }, 'title', group.title, first.url, `${group.title} (${group.year ?? 's/f'})`);
      }
      for (const artist of group.artists) {
        const e = pick(artist, group.title);
        const rel = await createRelation(ctx, 'album_credit', { albumId, artistId: e.artistId }, {
          credit_role: 'Intérprete', credit_type: 'musician', notes: `${e.url} — Temas documentados: ${e.tracks.map(t => t.title).join('; ')}`,
        });
        if (e.tracks.length) await evidence('album_credit', { albumCreditId: rel.id }, 'documented_tracks', e.tracks.map(t => t.title), e.url, `${e.title}: ${e.tracks.map(t => t.title).join(', ')}`);
        result.created.push({ albumId, title: group.title, artist, created: rel.created });
      }
    }
    return result;
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? 'ambiguities-applied.json' : 'ambiguities-rehearsal.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, linked: outcome.result.linked.length, created: outcome.result.created.length, skipped: outcome.result.skipped.length }));
} finally { await closeDb(); }
