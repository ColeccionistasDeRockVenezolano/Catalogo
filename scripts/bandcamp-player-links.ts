// Repair embed metadata without changing URLs, ownership, or editorial verification.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { writePlatformLink } from '../src/merge/platform-links.js';

const [mode, directory] = process.argv.slice(2);
if (!directory || !['export', 'scope', 'apply'].includes(mode ?? '')) throw new Error('Usage: bandcamp-player-links.ts export|scope|apply STAGING_DIRECTORY');
try {
  if (mode !== 'apply') {
    const { rows } = await getPool().query(`
      SELECT id::int, 'streaming_links' AS storage, url, external_id, verified,
        artist_id::int, album_id::int FROM public.streaming_links WHERE platform='bandcamp'
        AND (artist_id IS NULL OR artist_id IN (SELECT id FROM ingest.catalog_artists))
        AND (album_id IS NULL OR album_id IN (SELECT id FROM ingest.catalog_albums))
      UNION ALL SELECT id::int, 'album_disc_links', url, external_id, verified,
        NULL::int, album_id::int FROM public.album_disc_links WHERE platform='bandcamp'
        AND album_id IN (SELECT id FROM ingest.catalog_albums)`);
    writeFileSync(path.join(directory, mode === 'scope' ? 'scope.json' : 'input.json'), JSON.stringify(rows, null, 2));
    console.log({ links: rows.length });
  } else {
    const rows = JSON.parse(readFileSync(path.join(directory, 'results.json'), 'utf8')) as Array<{
      id: number; storage: string; url: string; external_id: string | null; resolvedId?: string; status: string;
    }>;
    const changes = rows.filter(row => {
      const route = new URL(row.url).pathname.replace(/\/$/, '');
      // Profiles may already carry a deliberately selected older publication.
      if (['', '/music', '/releases'].includes(route) && /^(album|track)=[1-9]\d*$/.test(row.external_id ?? '')) return false;
      return row.status === 'ok' && row.resolvedId !== row.external_id;
    });
    const additionalPath = path.join(directory, 'additional-links.json');
    const additional = existsSync(additionalPath) ? JSON.parse(readFileSync(additionalPath, 'utf8')) as Array<{
      albumId: number; title: string; url: string; externalId: string;
    }> : [];
    const result = await withOperatorRun({ name: 'bandcamp-player-repair', operator: 'Codex, autorizado por Brian',
      note: 'Completar identificadores de reproductores desde páginas Bandcamp originales. Conservar URL, autoría y verificación editorial. Evidencia: data/research/bandcamp-players-2026-10-26.' }, async context => {
      let updated = 0;
      for (const row of changes) {
        if (!['streaming_links', 'album_disc_links'].includes(row.storage) || !/^(album|track)=[1-9]\d*$/.test(row.resolvedId ?? '')) throw new Error('Invalid evidence');
        const profileScope = row.storage === 'streaming_links' ? `AND (target.artist_id IS NULL OR (
          target.artist_id IN (SELECT id FROM ingest.catalog_artists) AND NOT EXISTS (
            SELECT 1 FROM ingest.artist_editorial_identifiers blocked WHERE
              (blocked.namespace='url' AND blocked.identifier=target.url) OR
              (blocked.namespace='platform:bandcamp' AND blocked.identifier=$1))))` : '';
        const update = await context.client.query(`UPDATE public.${row.storage} AS target SET external_id=$1
          WHERE id=$2 AND platform='bandcamp' AND url=$3 AND external_id IS NOT DISTINCT FROM $4
          AND (target.album_id IS NULL OR target.album_id IN (SELECT id FROM ingest.catalog_albums)) ${profileScope}`,
        [row.resolvedId, row.id, row.url, row.external_id]);
        updated += update.rowCount ?? 0;
      }
      let added = 0;
      for (const link of additional) {
        if (!/^(album|track)=[1-9]\d*$/.test(link.externalId) || !new URL(link.url).hostname.endsWith('.bandcamp.com')) throw new Error('Invalid additional link');
        const owner = await context.client.query('SELECT title FROM public.albums WHERE id=$1 FOR KEY SHARE', [link.albumId]);
        if (owner.rows[0]?.title !== link.title) throw new Error('Album changed since review');
        const existing = await context.client.query("SELECT id FROM public.streaming_links WHERE album_id=$1 AND platform='bandcamp'", [link.albumId]);
        if (existing.rowCount) continue;
        await writePlatformLink(context, 'album', link.albumId, 'streaming', 'bandcamp', {
          url: link.url, externalId: link.externalId, verified: true, handle: null,
        });
        added++;
      }
      return { updated, added, candidates: changes.length };
    });
    writeFileSync(path.join(directory, `application-run${result.runId}.json`), JSON.stringify(result, null, 2));
    writeFileSync(path.join(directory, 'application.json'), JSON.stringify(result, null, 2));
    console.log(result);
  }
} finally { await closeDb(); }
