// Campaña autorizada (Brian, 2026-10-26): las 27 portadas del Fondo Editorial de
// Fundación Bigott entran como CLAIMS de cover_url. No se toca ninguna ficha:
// 22 apuntan al disco identificado y 5 quedan sin destino, en revisión.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';
import { normalizeIdentity, normalizeIdentitySecondary } from '../src/normalization/claims.js';
import { inspectImage, type ImageInspection } from '../src/verification/image-quality.js';

const campaign = 'bigott-cds-2026-10-26';
const mediaDir = path.resolve('web/public/media', campaign);
const reports = path.resolve('reports', campaign);
const EXPECTED = 27;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

interface Item {
  position: number; album_title: string; artist_credit: string; source_image_url: string;
  wp_media_id: number | null; cover_1x1_file: string; match_candidates?: unknown[];
  link: { status: string; album_id: number | null; db_artist?: string; db_title?: string; db_year?: number | null;
          confidence?: number; nota?: string; artist?: string; title?: string };
}
interface Prepared extends Item { sha256: string; url: string; inspection: ImageInspection; identity: string; }

async function prepare(): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(mediaDir, 'manifest.json'), 'utf8'));
  const items: Item[] = manifest.items;
  if (items.length !== EXPECTED) throw new Error(`Se esperan ${EXPECTED} portadas, hay ${items.length}`);
  if (new Set(items.map((i) => i.source_image_url)).size !== EXPECTED) throw new Error('URLs de origen repetidas');

  const prepared: Prepared[] = [];
  for (const item of items) {
    const file = path.resolve(mediaDir, item.cover_1x1_file);
    if (!file.startsWith(mediaDir + path.sep)) throw new Error('Ruta fuera de la campaña');
    const bytes = await readFile(file);
    const inspection = await inspectImage(bytes);
    if (!inspection.ok) throw new Error(`Imagen inválida: ${item.cover_1x1_file} (${inspection.error})`);
    if (inspection.width !== 1000 || inspection.height !== 1000) throw new Error(`No es 1:1: ${item.cover_1x1_file}`);
    // El arte nativo mide ~520-575 px: el 1000x1000 es una ampliación controlada del
    // recorte, no una copia falsa. Se registra en la evidencia, no se rechaza.
    const artist = item.link.db_artist ?? item.link.artist ?? item.artist_credit;
    const title = item.link.db_title ?? item.link.title ?? item.album_title;
    prepared.push({ ...item, sha256: hash(bytes), inspection,
      url: `/crv/media/${campaign}/${item.cover_1x1_file.split(path.sep).join('/')}`,
      identity: `${artist} — ${title}` });
  }
  if (new Set(prepared.map((p) => p.sha256)).size !== EXPECTED) throw new Error('Imágenes repetidas (sha256)');

  const linked = prepared.filter((p) => p.link.album_id !== null);
  const ids = linked.map((p) => p.link.album_id as number);
  const found = (await getPool().query<{ id: number }>('SELECT id::int FROM public.albums WHERE id = ANY($1::bigint[])', [ids])).rows.map((r) => r.id);
  const missing = ids.filter((id) => !found.includes(id));
  if (missing.length) throw new Error(`Álbumes inexistentes: ${missing.join(', ')}`);

  await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, 'prepared.json'), JSON.stringify({ campaign, mediaDir, linked: linked.length, unlinked: prepared.length - linked.length, files: prepared }, null, 2));
  console.log({ prepared: prepared.length, linked: linked.length, unlinked: prepared.length - linked.length,
    uniqueImages: new Set(prepared.map((p) => p.sha256)).size });
}

async function apply(dryRun: boolean): Promise<void> {
  const { files: rows } = JSON.parse(await readFile(path.join(reports, 'prepared.json'), 'utf8')) as { files: Prepared[] };
  if (rows.length !== EXPECTED) throw new Error(`Se esperan ${EXPECTED} imágenes`);

  // Estado previo de las portadas: el run no debe cambiar ninguna.
  const ids = rows.map((r) => r.link.album_id).filter((id): id is number => id !== null);
  const before = (await getPool().query<{ id: number; cover_url: string | null }>(
    'SELECT id::int, cover_url FROM public.albums WHERE id = ANY($1::bigint[]) ORDER BY id', [ids])).rows;

  for (const row of rows) {
    const bytes = await readFile(path.resolve(mediaDir, row.cover_1x1_file));
    if (hash(bytes) !== row.sha256) throw new Error(`Hash diferente: ${row.cover_1x1_file}`);
  }

  const { runId, result } = await withOperatorRun({
    name: 'bigott_fondo_editorial_portadas_claims', operator: 'brian',
    note: 'Brian: Genera claims con las 27 portadas del Fondo Editorial de Fundación Bigott. No reemplaces ninguna portada: quedan como aportes pendientes de revisión.',
    params: { campaign, source: 'https://fundacionbigott.org/fondo-editorial/cds/', images: rows.length, linked: ids.length },
  }, async (context) => {
    const outcomes: unknown[] = [];
    for (const row of rows) {
      const albumId = row.link.album_id;
      const excerpt = [
        `Portada del Fondo Editorial de Fundación Bigott (${campaign}), posición ${row.position} de ${EXPECTED}.`,
        `Archivo original: ${row.source_image_url} (wp_media_id ${row.wp_media_id ?? 'n/d'}).`,
        `Recorte 1:1 verificado: 1000x1000, nitidez ${row.inspection.sharpness?.toFixed(1) ?? 'n/d'}, sha256 ${row.sha256}.`,
        albumId === null
          ? `Disco no identificado en el catálogo: ${row.identity}. ${row.link.nota ?? ''}`
          : `Disco del catálogo: ${row.identity} (album_id ${albumId}). Coincidencia título+artista ${(row.link.confidence ?? 0).toFixed(2)}.`,
        'Propuesta: usar esta portada. No se modificó la ficha al crear el claim.',
      ].join(' ');

      const claim = await persistClaim({
        entityKind: 'album', field: 'cover_url',
        ...(albumId === null ? {} : { albumId }),
        identity: normalizeIdentity(row.identity), identitySecondary: normalizeIdentitySecondary(row.identity),
        originalIdentity: row.identity,
        rawValue: row.url, normalizedValue: row.url,
        rawHash: hash(JSON.stringify([campaign, row.cover_1x1_file, row.sha256])),
        extractor: 'bigott-fondo-editorial', extractorVersion: '1',
        confidence: albumId === null ? 'low' : (row.link.confidence ?? 0) >= 0.9 ? 'medium' : 'low',
        createdBy: 'human', sourceId: context.sourceId, runId: context.runId,
        evidence: { url: row.source_image_url, excerpt },
      }, context.client);

      if (claim.inserted) {
        await context.client.query('UPDATE ingest.claims SET notes=$2 WHERE id=$1', [claim.id, excerpt]);
        if (albumId === null) {
          await context.client.query(`INSERT INTO ingest.review_queue(kind,claim_a_id,payload,notes)
            VALUES('manual_review',$1,$2::jsonb,$3)`, [claim.id, JSON.stringify({
              campaign, reason: 'album_identity_unresolved', position: row.position,
              file: row.cover_1x1_file, imageUrl: row.url, originalTitle: row.album_title,
              originalArtist: row.artist_credit, sha256: row.sha256, inspection: row.inspection,
              suggestions: row.match_candidates ?? [],
            }), 'Falta el disco en el catálogo: crear la ficha y luego aceptar esta portada.']);
        }
      }
      outcomes.push({ position: row.position, albumId, claimId: claim.id, inserted: claim.inserted, url: row.url });
    }

    const counts = (await context.client.query(`SELECT
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1) AS claims,
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1 AND status='candidate') AS candidates,
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1 AND album_id IS NOT NULL) AS linked,
      (SELECT count(*)::int FROM ingest.claims WHERE run_id=$1 AND album_id IS NULL) AS unlinked,
      (SELECT count(*)::int FROM ingest.claim_evidence e JOIN ingest.claims c ON c.id=e.claim_id WHERE c.run_id=$1) AS evidence,
      (SELECT count(*)::int FROM ingest.review_queue q JOIN ingest.claims c ON c.id=q.claim_a_id WHERE c.run_id=$1 AND q.status='open') AS reviews,
      (SELECT count(*)::int FROM ingest.change_journal WHERE run_id=$1 AND table_name LIKE 'public.%') AS core_changes`,
      [context.runId])).rows[0];
    const expectedUnlinked = rows.filter((r) => r.link.album_id === null).length;
    if (counts.claims !== 0 && (counts.claims !== EXPECTED || counts.candidates !== EXPECTED ||
        counts.linked !== ids.length || counts.unlinked !== expectedUnlinked ||
        counts.evidence !== EXPECTED || counts.reviews !== expectedUnlinked || counts.core_changes !== 0)) {
      throw new Error(JSON.stringify(counts));
    }
    return { counts, outcomes };
  }, { rollbackOnly: dryRun });

  const after = (await getPool().query<{ id: number; cover_url: string | null }>(
    'SELECT id::int, cover_url FROM public.albums WHERE id = ANY($1::bigint[]) ORDER BY id', [ids])).rows;
  const changed = after.filter((row, index) => row.cover_url !== before[index]?.cover_url);
  if (changed.length) throw new Error(`Portadas modificadas: ${changed.map((c) => c.id).join(', ')}`);

  await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, dryRun ? 'dry-run.json' : 'applied.json'),
    JSON.stringify({ dryRun, runId, coversUnchanged: after.length, ...result }, null, 2));
  console.log({ dryRun, runId, coversUnchanged: after.length, ...result.counts });
}

try {
  if (process.argv.includes('--prepare')) await prepare();
  else if (process.argv.includes('--apply') || process.argv.includes('--dry-run')) await apply(!process.argv.includes('--apply'));
  else throw new Error('Usar --prepare, --dry-run o --apply');
} finally { await closeDb(); }
