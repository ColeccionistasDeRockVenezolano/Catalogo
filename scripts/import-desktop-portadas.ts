// Importación local autorizada por Brian: vacíos sin claims; alternativas a imágenes.
// Primero --prepare, publicar staging de medios, y después --apply (o --dry-run).
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { proposeImageCandidate } from '../src/merge/image-candidates.js';
import { inspectImage, type ImageInspection } from '../src/verification/image-quality.js';

const campaign = 'portadas-desktop-2026-10-23';
const root = '/home/brian/Desktop/PORTADAS';
const reports = `/home/brian/crv-staging/reports/${campaign}`;
const stagedMedia = `/home/brian/crv-staging/web/public/media/${campaign}`;
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
interface Row {
  file: string; status: string; album_id?: number; catalog_artist?: string;
  catalog_title?: string; current_url?: string | null; label?: string | null;
  sha256?: string; url?: string; inspection?: ImageInspection;
}
interface Prepared extends Row {
  album_id: number; sha256: string; url: string; inspection: ImageInspection;
}

async function prepare() {
  const rows: Row[] = JSON.parse(await readFile(`${reports}/plan.json`, 'utf8'));
  const prepared: Prepared[] = [];
  const failed: unknown[] = [];
  const images = new Map<string, { url: string; inspection: ImageInspection }>();
  for (const row of rows.filter(r => r.status === 'matched')) {
    const input = path.resolve(root, row.file);
    if (!input.startsWith(root + path.sep)) throw new Error('Archivo fuera del origen');
    const bytes = await readFile(input);
    const sha256 = hash(bytes);
    let image = images.get(sha256);
    if (!image) {
      const inspection = await inspectImage(bytes);
      if (!inspection.ok) { failed.push({ file: row.file, inspection }); continue; }
      const ext = inspection.format === 'jpeg' ? 'jpg' : inspection.format;
      const name = `${sha256}.${ext}`;
      await copyFile(input, path.join(stagedMedia, name));
      image = { url: `/crv/media/${campaign}/${name}`, inspection };
      images.set(sha256, image);
    }
    prepared.push({ ...row, album_id: row.album_id!, sha256, ...image });
    if (prepared.length % 100 === 0) console.log(`Inspeccionadas ${prepared.length}`);
  }
  await writeFile(`${reports}/prepared.json`, JSON.stringify(prepared, null, 2));
  await writeFile(`${reports}/invalid-images.json`, JSON.stringify(failed, null, 2));
  await writeFile(`${stagedMedia}/provenance.json`, JSON.stringify({ campaign, root, files: prepared }, null, 2));
  console.log({ prepared: prepared.length, uniqueImages: images.size, failed: failed.length });
}

async function apply(dryRun: boolean) {
  const rows: Prepared[] = JSON.parse(await readFile(`${reports}/prepared.json`, 'utf8'));
  const before = JSON.parse(await readFile(`${reports}/catalog-before.json`, 'utf8')) as Array<{ id: number; title: string; artist_id: number }>;
  const identities = new Map(before.map(a => [a.id, a]));
  // Toda URL debe estar publicada y conservar exactamente los bytes inspeccionados.
  for (const row of rows) {
    const local = path.resolve('web/public/media', row.url.slice('/crv/media/'.length));
    await access(local);
    if (hash(await readFile(local)) !== row.sha256) throw new Error(`Hash diferente: ${row.file}`);
  }
  const groups = new Map<number, Prepared[]>();
  for (const row of rows) groups.set(row.album_id, [...(groups.get(row.album_id) ?? []), row]);
  const counts = { assigned: 0, proposed: 0, claims: 0, known: 0, already: 0, duplicateFiles: 0, spareImagesForEmpty: 0 };
  const outcomes: unknown[] = [];
  const { runId } = await withOperatorRun({
    name: 'desktop_portadas_import', operator: 'brian',
    note: 'Portadas de Desktop/PORTADAS: asignar sin claim si el disco no tiene portada; si tiene, conservarla y crear claim y candidata en Curaduría de imágenes.',
    params: { campaign, sourceDirectory: root, albums: groups.size },
  }, async context => {
    for (const [albumId, alternatives] of groups) {
      const album = (await context.client.query<{ cover_url: string | null; title: string; artist_id: string }>(
        'SELECT cover_url,title,artist_id FROM public.albums WHERE id=$1 FOR UPDATE', [albumId])).rows[0];
      if (!album) throw new Error(`Desapareció el disco ${albumId}`);
      const snapshot = alternatives[0]!;
      const original = identities.get(albumId)!;
      if (album.title !== original.title || Number(album.artist_id) !== original.artist_id) throw new Error(`Cambió la identidad de ${albumId}`);
      const unique = [...new Map(alternatives.map(r => [r.sha256, r])).values()];
      counts.duplicateFiles += alternatives.length - unique.length;
      if (!album.cover_url?.trim()) {
        // La mejor resolución útil va primero; la portada alternativa no desplaza la normal.
        const rank = { high: 3, medium: 2, low: 1, failed: 0 };
        unique.sort((a, b) => Number(Boolean(a.label)) - Number(Boolean(b.label)) ||
          rank[b.inspection.quality] - rank[a.inspection.quality] ||
          (b.inspection.effectiveWidth ?? 0) - (a.inspection.effectiveWidth ?? 0) ||
          (b.inspection.width ?? 0) - (a.inspection.width ?? 0));
        const chosen = unique[0]!;
        await context.client.query('UPDATE public.albums SET cover_url=$2,updated_at=now() WHERE id=$1', [albumId, chosen.url]);
        await context.client.query(`INSERT INTO ingest.merge_audit
          (run_id,entity_kind,album_id,field,old_value,new_value,reason,confidence,performed_by)
          VALUES($1,'album',$2,'cover_url',$3::jsonb,to_jsonb($4::text),$5,'high','human')`,
        [context.runId, albumId, JSON.stringify(album.cover_url), chosen.url, `${context.note} Archivo: ${chosen.file}; SHA-256: ${chosen.sha256}`]);
        counts.assigned++;
        counts.spareImagesForEmpty += unique.length - 1;
        outcomes.push({ albumId, artist: snapshot.catalog_artist, title: album.title, action: 'assigned_without_claim', ...chosen });
        continue;
      }
      let currentHash: string | undefined;
      if (album.cover_url.startsWith('/crv/media/')) {
        const local = path.resolve('web/public/media', album.cover_url.slice('/crv/media/'.length));
        if (local.startsWith(path.resolve('web/public/media') + path.sep)) {
          try { currentHash = hash(await readFile(local)); } catch { /* Se conserva la URL actual aunque falte su copia. */ }
        }
      }
      for (const row of unique) {
        if (row.sha256 === currentHash) { counts.known++; outcomes.push({ albumId, file: row.file, action: 'identical_to_current' }); continue; }
        const result = await proposeImageCandidate(context.client, {
          kind: 'album', targetId: albumId, currentUrl: album.cover_url, candidateUrl: row.url,
          source: 'Brian · PORTADAS local', origin: campaign, runId: context.runId,
          pageUrl: row.url, width: row.inspection.width, height: row.inspection.height,
          context: `Portada identificada por Brian: ${row.file}`,
        });
        if (result !== 'proposed') { counts[result]++; continue; }
        counts.proposed++;
        const inspection = row.inspection;
        await context.client.query(`UPDATE ingest.image_candidates SET
          stored_url=$3,stored_sha256=$4,natural_width=$5,natural_height=$6,effective_width=$7,
          sharpness=$8,quality=$9,image_use='cover',fingerprint=$10,inspection_reasons=$11,inspected_at=now()
          WHERE album_id=$1 AND candidate_url=$2`,
        [albumId, row.url, row.url, row.sha256, inspection.width, inspection.height, inspection.effectiveWidth,
          inspection.sharpness, inspection.quality, inspection.fingerprint, inspection.reasons]);
        const claim = await context.client.query<{ id: string }>(`INSERT INTO ingest.claims
          (source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,
           confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'album',$2,'cover_url',to_jsonb($3::text),to_jsonb($3::text),$4,'desktop-portadas','1',
                 'high','candidate','human',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
        [context.sourceId, albumId, row.url, hash(JSON.stringify([campaign, albumId, row.sha256])), context.runId,
          `Alternativa en Curaduría de imágenes. Origen: ${path.join(root, row.file)}. SHA-256: ${row.sha256}`, `desktop-portadas:album:${albumId}`]);
        if (claim.rows[0]) {
          counts.claims++;
          await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
            VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`, [claim.rows[0].id, row.url,
            `Archivo local: ${row.file}; ${inspection.width}×${inspection.height}; SHA-256: ${row.sha256}`, hash(row.file + row.sha256)]);
        }
        outcomes.push({ albumId, file: row.file, url: row.url, action: 'candidate', claimId: claim.rows[0]?.id ?? null });
      }
    }
  }, { rollbackOnly: dryRun });
  const report = { dryRun, runId, counts, albums: groups.size, outcomes };
  await writeFile(`${reports}/${dryRun ? 'dry-run' : 'applied'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ dryRun, runId, counts, albums: groups.size }, null, 2));
  if (!dryRun) {
    const validation = (await getPool().query(`SELECT
      (SELECT count(*) FROM ingest.claims WHERE run_id=$1)::int claims,
      (SELECT count(*) FROM ingest.image_candidates WHERE run_id=$1 AND status='open')::int open_candidates,
      (SELECT count(*) FROM ingest.merge_audit WHERE run_id=$1)::int assignments,
      (SELECT count(*) FROM ingest.change_journal WHERE run_id=$1)::int journal_entries`, [runId])).rows[0];
    await writeFile(`${reports}/validation.json`, JSON.stringify(validation, null, 2));
    console.log(validation);
  }
}

try {
  if (process.argv.includes('--prepare')) await prepare();
  else if (process.argv.includes('--apply') || process.argv.includes('--dry-run')) await apply(!process.argv.includes('--apply'));
  else throw new Error('Usar --prepare, --dry-run o --apply');
} finally { await closeDb(); }
