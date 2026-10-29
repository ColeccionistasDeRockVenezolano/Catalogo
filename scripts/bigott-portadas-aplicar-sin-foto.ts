// Asignación directa de las portadas de Fundación Bigott SOLO a los discos que
// no tienen imagen. Los que ya tienen portada siguen como aportes pendientes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { decideClaimReview, getClaimReviewGroup } from '../src/review/visual-workbench.js';

const campaign = 'bigott-cds-2026-10-26';
const reports = path.resolve('reports', campaign);
const RUN = 34397;
const NOTE = 'Brian: asignación directa de la portada de Fundación Bigott a fichas que no tenían imagen.';

interface Target { claimId: number; albumId: number; title: string; artist: string; url: string; version: string; }

async function targets(): Promise<Target[]> {
  const pool = getPool();
  const rows = (await pool.query<{ id: number; album_id: number; title: string; artist: string; raw_value: string }>(
    `SELECT c.id::int, c.album_id::int, a.title, ar.name AS artist, c.raw_value #>> '{}' AS raw_value
       FROM ingest.claims c
       JOIN public.albums a ON a.id = c.album_id
       JOIN public.artists ar ON ar.id = a.artist_id
      WHERE c.run_id = $1 AND c.field = 'cover_url' AND c.status = 'candidate' AND a.cover_url IS NULL
      ORDER BY c.id`, [RUN])).rows;
  const out: Target[] = [];
  for (const row of rows) {
    const group = await getClaimReviewGroup(row.id, { limit: 100, offset: 0, bucket: 'candidate' });
    const change = (group as { changes?: Array<{ id: number; version: string; canAccept?: boolean; value?: unknown }> } | null)
      ?.changes?.find((item) => item.id === row.id);
    if (!change) throw new Error(`El aporte ${row.id} no está visible en la bandeja`);
    if (!change.canAccept) throw new Error(`El aporte ${row.id} pide comparación antes de aceptarse`);
    if (String(change.value) !== row.raw_value) throw new Error(`Valor inesperado en el aporte ${row.id}`);
    out.push({ claimId: row.id, albumId: row.album_id, title: row.title, artist: row.artist, url: row.raw_value, version: change.version });
  }
  return out;
}

async function snapshot(): Promise<Record<number, string | null>> {
  const rows = (await getPool().query<{ id: number; cover_url: string | null }>(
    `SELECT a.id::int, a.cover_url FROM public.albums a
       JOIN ingest.claims c ON c.album_id = a.id AND c.run_id = $1
      WHERE c.field = 'cover_url' ORDER BY a.id`, [RUN])).rows;
  return Object.fromEntries(rows.map((row) => [row.id, row.cover_url]));
}

async function main(apply: boolean): Promise<void> {
  const list = await targets();
  const before = await snapshot();
  console.log(apply ? 'APLICANDO' : 'DRY-RUN', list.length, 'discos sin portada');
  for (const item of list) console.log(` ${item.claimId} → ${item.albumId} ${item.artist} — ${item.title}`);

  const results: unknown[] = [];
  if (apply) {
    for (const item of list) {
      const outcome = await decideClaimReview({
        groupId: item.claimId, claims: [{ id: item.claimId, version: item.version }],
        action: 'accept', note: NOTE, operator: 'brian',
      });
      const row = outcome.results[0];
      if (!row || row.action !== 'accepted') throw new Error(`No se aplicó el aporte ${item.claimId}: ${JSON.stringify(outcome.results)}`);
      results.push({ ...item, runId: outcome.runId, detail: row.detail });
    }
  }

  const after = await snapshot();
  const changed = Object.keys(after).filter((id) => after[Number(id)] !== before[Number(id)]);
  const expected = list.map((item) => item.albumId).sort((a, b) => a - b);
  if (apply) {
    for (const item of list) {
      if (after[item.albumId] !== item.url) throw new Error(`La portada de ${item.albumId} no quedó asignada`);
    }
    const unexpected = changed.map(Number).filter((id) => !expected.includes(id));
    if (unexpected.length) throw new Error(`Se tocaron portadas ajenas: ${unexpected.join(', ')}`);
    if (changed.length !== list.length) throw new Error(`Cambiaron ${changed.length} portadas y se esperaban ${list.length}`);
  }

  const claims = (await getPool().query<{ status: string; total: number }>(
    `SELECT status::text, count(*)::int AS total FROM ingest.claims WHERE run_id=$1 GROUP BY 1 ORDER BY 1`, [RUN])).rows;
  await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, apply ? 'asignacion-directa.json' : 'asignacion-directa-dry.json'),
    JSON.stringify({ apply, note: NOTE, discos: list, portadasTocadas: changed.length, claims, results }, null, 2));
  console.log({ portadasTocadas: changed.length, claims });
}

try { await main(process.argv.includes('--apply')); }
finally { await closeDb(); }
