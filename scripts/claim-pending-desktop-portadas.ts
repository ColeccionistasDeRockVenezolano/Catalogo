// Campaña autorizada: un claim por cada una de las 240 imágenes sin destino seguro.
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { normalizeIdentity, normalizeIdentitySecondary } from '../src/normalization/claims.js';
import { inspectImage, type ImageInspection } from '../src/verification/image-quality.js';
import { getClaimReviewGroup } from '../src/review/visual-workbench.js';

const campaign = 'portadas-pendientes-claims-2026-10-23';
const root = '/home/brian/Desktop/PORTADAS';
const reports = `/home/brian/crv-staging/reports/${campaign}`;
const media = `/home/brian/crv-staging/web/public/media/${campaign}`;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
interface Row { file: string; artist: string | null; title: string | null; status: string; suggestions?: unknown[]; }
interface Prepared extends Row { sha256: string; url: string; inspection: ImageInspection; identity: string; }

async function prepare() {
  const rows: Row[] = JSON.parse(await readFile('reports/portadas-desktop-2026-10-23/pending-review.json', 'utf8'));
  if (rows.length !== 240 || new Set(rows.map(r => r.file)).size !== 240) throw new Error('Inventario inesperado');
  const prepared: Prepared[] = [];
  for (const row of rows) {
    const input = path.resolve(root, row.file);
    if (!input.startsWith(root + path.sep)) throw new Error('Ruta fuera del origen');
    const bytes = await readFile(input);
    const sha256 = hash(bytes);
    const inspection = await inspectImage(bytes);
    if (!inspection.ok) throw new Error(`Imagen inválida: ${row.file}`);
    const name = `${sha256}.${inspection.format === 'jpeg' ? 'jpg' : inspection.format}`;
    await copyFile(input, path.join(media, name));
    prepared.push({ ...row, sha256, inspection, url: `/crv/media/${campaign}/${name}`,
      identity: row.artist && row.title ? `${row.artist} — ${row.title}` : row.file.replace(/^crv-thumbnail-covers\//, '').replace(/\/cover\.[^.]+$/, '') });
  }
  await writeFile(`${reports}/prepared.json`, JSON.stringify(prepared, null, 2));
  await writeFile(`${media}/provenance.json`, JSON.stringify({ campaign, root, files: prepared }, null, 2));
  console.log({ prepared: prepared.length, uniqueImages: new Set(prepared.map(r => r.sha256)).size });
}

async function apply(dryRun: boolean) {
  const rows: Prepared[] = JSON.parse(await readFile(`${reports}/prepared.json`, 'utf8'));
  if (rows.length !== 240) throw new Error('Se esperan 240 imágenes');
  for (const row of rows) {
    if (hash(await readFile(path.join('web/public/media', row.url.slice('/crv/media/'.length)))) !== row.sha256) throw new Error(`Hash diferente: ${row.file}`);
  }
  const { runId, result } = await withOperatorRun({ name: 'desktop_portadas_pending_claims', operator: 'brian',
    note: 'Brian: Haz claim con esas 240 imagenes. Identidad pendiente de revisión; conservar posibles coincidencias sin asignar un destino arbitrario.',
    params: { campaign, sourceDirectory: root, images: rows.length },
  }, async context => {
    const outcomes: unknown[] = [];
    for (const row of rows) {
      const excerpt = `Archivo: ${row.file}; identidad según nombre: ${row.identity}; coincidencia: ${row.status}; SHA-256: ${row.sha256}; sugerencias NO confirmadas: ${JSON.stringify(row.suggestions ?? [])}`;
      const claim = await persistClaim({ entityKind: 'album', field: 'cover_url',
        identity: normalizeIdentity(row.identity), identitySecondary: normalizeIdentitySecondary(row.identity), originalIdentity: row.identity,
        rawValue: row.url, normalizedValue: row.url, rawHash: hash(JSON.stringify([campaign, row.file, row.sha256])),
        extractor: 'desktop-portadas-pending', extractorVersion: '1', confidence: 'low', createdBy: 'human',
        sourceId: context.sourceId, runId: context.runId, evidence: { url: row.url, excerpt },
      }, context.client);
      if (claim.inserted) {
        await context.client.query('UPDATE ingest.claims SET notes=$2 WHERE id=$1', [claim.id, excerpt]);
        await context.client.query(`INSERT INTO ingest.review_queue(kind,claim_a_id,payload,notes)
          VALUES('manual_review',$1,$2::jsonb,$3)`, [claim.id, JSON.stringify({ campaign, reason: 'album_identity_unresolved',
          file: row.file, artist: row.artist, title: row.title, imageUrl: row.url, sha256: row.sha256, inspection: row.inspection,
          matchingStatus: row.status, suggestions: row.suggestions ?? [] }), 'Revisar identidad del disco antes de vincular esta portada.']);
      }
      outcomes.push({ file: row.file, claimId: claim.id, inserted: claim.inserted, url: row.url });
    }
    const counts = (await context.client.query(`SELECT
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1) AS claims,
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1 AND status='candidate' AND album_id IS NULL) AS pending_unlinked,
      (SELECT count(*)::int FROM ingest.claim_evidence e JOIN ingest.claims c ON c.id=e.claim_id WHERE c.run_id=$1) AS evidence,
      (SELECT count(*)::int FROM ingest.review_queue q JOIN ingest.claims c ON c.id=q.claim_a_id WHERE c.run_id=$1 AND q.status='open') AS reviews,
      (SELECT count(*)::int FROM ingest.change_journal WHERE run_id=$1 AND table_name LIKE 'public.%') AS core_changes`, [context.runId])).rows[0];
    if (counts.claims !== 0 && (counts.claims !== 240 || counts.pending_unlinked !== 240 || counts.evidence !== 240 || counts.reviews !== 240 || counts.core_changes !== 0)) throw new Error(JSON.stringify(counts));
    return { counts, outcomes };
  }, { rollbackOnly: dryRun });
  await writeFile(`${reports}/${dryRun ? 'dry-run' : 'applied'}.json`, JSON.stringify({ dryRun, runId, ...result }, null, 2));
  console.log({ dryRun, runId, ...result.counts });
  if (!dryRun) {
    const ids = (await getPool().query('SELECT min(id)::text AS id FROM ingest.claims WHERE run_id=$1 GROUP BY identity_key', [runId])).rows;
    let visibleClaims = 0;
    for (const row of ids) {
      const group = await getClaimReviewGroup(Number(row.id), { limit: 100, offset: 0, bucket: 'candidate' });
      if (!group) throw new Error(`Claim no visible: ${row.id}`);
      visibleClaims += group.changes.filter(c => (result.outcomes as Array<{claimId: number}>).some(o => o.claimId === c.id)).length;
    }
    if (visibleClaims !== 240) throw new Error(`Claims visibles: ${visibleClaims}`);
    await writeFile(`${reports}/validation.json`, JSON.stringify({ runId, visibleClaims, groups: ids.length, ...result.counts }, null, 2));
    console.log({ visibleClaims, groups: ids.length });
  }
}
try {
  if (process.argv.includes('--prepare')) await prepare();
  else if (process.argv.includes('--apply') || process.argv.includes('--dry-run')) await apply(!process.argv.includes('--apply'));
  else throw new Error('Usar --prepare, --dry-run o --apply');
} finally { await closeDb(); }
