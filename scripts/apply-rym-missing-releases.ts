import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, OperatorError, withOperatorRun } from '../src/merge/operator.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
import { assertRymIdentity, normalizeRymIdentity, readRymIdentityLedger, rymHref } from '../src/verification/rym-identity.js';
import { rymReleaseClassifications, rymReleaseDateText, rymTrackPositions, type RymTrackInput, type RymPublicationInput } from '../src/verification/rym-release-plan.js';

const root = 'reports/aprovechamiento-1-5-2026-10-17';
const argument = (name: string): string | undefined => { const index=process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index+1]; };
const directory = argument('--dir') ?? `${root}/rym-resto`;
const richFile = argument('--v4') ?? `${root}/rym-v4-resto/albumes.jsonl`;
const confirm = process.argv.includes('--confirm');
const jsonl = <T>(file: string): T[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
interface Crossing { slug: string; artistId: number; tituloRym: string; reason: string; artistHref: string; sourceHref: string; capturePins: Array<{ path: string; sha256: string }> }
interface Release extends RymPublicationInput { slug: string; href: string; url: string; anio: number | null; catalog_no: string | null; formato: string | null; released_text: string | null; pistas: RymTrackInput[] }
async function main() {
  const ledger = readRymIdentityLedger(`${directory}/identity-ledger.json`);
  const releases = new Map(jsonl<Release>(richFile).map(item => [item.slug,item]));
  const proposals = jsonl<Crossing>(`${directory}/cruce-sobrantes.jsonl`);
  const counts = new Map<string, number>();
  for (const item of proposals) {
    const key = `${item.artistId}|${normalizeRymIdentity(item.tituloRym)}`;
    counts.set(key,(counts.get(key) ?? 0) + 1);
  }
  const existing = new Set((await getPool().query<{ key: string }>("SELECT artist_id::text||'|'||title AS key FROM public.albums")).rows.map(row => {
    const split = row.key.indexOf('|'); return row.key.slice(0,split+1) + normalizeRymIdentity(row.key.slice(split+1));
  }));
  const reviews = new Set((await getPool().query<{ key: string }>("SELECT payload->>'sourceHref' key FROM ingest.review_queue WHERE payload->>'operation'='rym_missing_release'")).rows.map(row => row.key));
  const pending = proposals.filter(item => !existing.has(`${item.artistId}|${normalizeRymIdentity(item.tituloRym)}`) && !reviews.has(item.sourceHref));
  const previous=confirm && existsSync(`${directory}/publicaciones-aplicado.json`) ? JSON.parse(readFileSync(`${directory}/publicaciones-aplicado.json`,'utf8')) as {outcomes:Array<Record<string,unknown>>;runs:number[]} : null;
  const outcomes: Array<Record<string, unknown>> = previous?.outcomes ?? [];
  const runs: number[] = previous?.runs ?? [];
  for (let offset = 0; offset < pending.length; offset += 20) {
    const batch = pending.slice(offset,offset+20);
    const result = await withOperatorRun({ name:'catalogo:rym-publicaciones-faltantes', operator:'Codex (encargo de Brian: puntos 1–5)',
      note:'Publicaciones musicales documentadas en RYM para artistas cuya identidad ya fue acreditada; preservar ediciones y enviar ambigüedades a revisión.',
      params:{ offset, count:batch.length, sourcePins:batch.map(item => item.capturePins), planHash:createHash('sha256').update(JSON.stringify(batch)).digest('hex'),
        trackIdentity:'Solo discos recién creados: identidad de pista por álbum nuevo + CD + posición literal documentada. No se separan candidatos de disco o persona.' },
    }, async context => {
      await context.client.query("SET LOCAL lock_timeout='5s'");
      await context.client.query("SET LOCAL statement_timeout='30s'");
      const results: Array<Record<string, unknown>> = [];
      for (const item of batch) {
        await assertRymIdentity(context.client,ledger,item.artistHref,item.artistId);
        const release = releases.get(item.slug);
        if (!release || rymHref(release.href) !== rymHref(item.sourceHref) || normalizeRymIdentity(release.titulo) !== normalizeRymIdentity(item.tituloRym)) throw new Error('Publicación derivada no corresponde al cruce');
        for (const pin of item.capturePins) {
          if (createHash('sha256').update(readFileSync(pin.path)).digest('hex') !== pin.sha256) throw new Error('Captura modificada');
          if (pin.path.endsWith('.json') && rymHref(JSON.parse(readFileSync(pin.path,'utf8')).href) !== rymHref(item.sourceHref)) throw new Error('URL de la captura no corresponde');
        }
        const live = await context.client.query<{ title: string }>('SELECT title FROM public.albums WHERE artist_id=$1',[item.artistId]);
        if (live.rows.some(row => normalizeRymIdentity(row.title) === normalizeRymIdentity(item.tituloRym))) { results.push({ slug:item.slug,status:'already_exists' }); continue; }
        let reason: string | null = item.reason !== 'missing_title' ? item.reason : null;
        if (release.titulo.length > 250) reason ??= 'title_exceeds_catalog_field_preserved_in_review';
        const type = rymReleaseClassifications(release);
        if (!type) reason ??= 'publication_type_requires_review';
        if (type?.reviewReason) reason ??= type.reviewReason;
        if (counts.get(`${item.artistId}|${normalizeRymIdentity(item.tituloRym)}`)! > 1) reason ??= 'multiple_source_editions';
        const tracks = rymTrackPositions(release.pistas);
        // A documented record can exist without a published tracklist. Ambiguous
        // source numbering stays in the review payload and is never invented.
        const reviewTracks = tracks === null;
        const date = rymReleaseDateText(release.released_text);
        const withheldFields = Object.entries({catalog_id:release.catalog_no,media_format:release.formato}).filter(([field,value])=>!!value && value.length > (field === 'catalog_id' ? 80 : 50));
        await context.client.query('SAVEPOINT rym_release');
        if (!reason) try {
          const album = await createEntity(context,'album',{ title:release.titulo, album_type:type!.albumType,
            ...(release.anio ? { release_year:release.anio } : {}),
            ...(release.catalog_no && release.catalog_no.length <= 80 && release.catalog_no.toLowerCase() !== 'n/a' ? { catalog_id:release.catalog_no } : {}),
            ...(release.formato && release.formato.length <= 50 ? { media_format:release.formato } : {}),
            ...(date ? { release_date_text:date } : {}),
            notes:`Fuente: ${release.url}. Tipo documentado: ${release.tipo}. Captura conservada; alta de publicación musical, sin inferencia desde videos.`,
          },{ artistId:item.artistId });
          await writeAlbumClassifications(context,album.id,type!.classifications);
          // The album was created immediately above in this transaction. Its
          // documented, unique positions cannot identify a pre-existing track:
          // album + disc + position is the native composite identity. Explicit
          // separation here avoids comparing each new recording with every
          // unrelated recording in the catalog. Albums and people retain ER.
          if ((await context.client.query('SELECT 1 FROM public.tracks WHERE album_id=$1 LIMIT 1',[album.id])).rowCount) throw new Error('El alta de pistas exige un disco nuevo vacío');
          for (const track of tracks ?? []) await createEntity(context,'track',track,{ albumId:album.id, allowSimilar:true });
          await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
            SELECT id,$2,$3,0,$5 FROM ingest.claims WHERE run_id=$1 AND (album_id=$4 OR track_id IN (SELECT id FROM public.tracks WHERE album_id=$4)) ON CONFLICT DO NOTHING`,
          [context.runId,release.url,`Tipo: ${release.tipo}; listado musical documentado en la captura RYM.`,album.id,createHash('sha256').update(JSON.stringify(item.capturePins)).digest('hex')]);
          if (reviewTracks) await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,album_id,payload,notes)
            VALUES('manual_review','open',2,$1,$2::jsonb,'La posición de las pistas requiere revisión; no se inventó numeración')`,[album.id,JSON.stringify({operation:'rym_track_positions',sourceHref:item.sourceHref,capturePins:item.capturePins,tracks:release.pistas})]);
          if (withheldFields.length) await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,album_id,payload,notes)
            VALUES('manual_review','open',3,$1,$2::jsonb,'Campos que exceden el tamaño del catálogo; conservar completos, sin truncar')`,[album.id,JSON.stringify({operation:'rym_release_fields',sourceHref:item.sourceHref,capturePins:item.capturePins,withheldFields})]);
          results.push({ slug:item.slug,status:'created',albumId:album.id,artistId:item.artistId,tracks:tracks?.length ?? 0,trackPositionsInReview:reviewTracks });
        } catch (error) {
          if (!(error instanceof OperatorError) || !['needs_review','already_exists','invalid'].includes(error.code)) throw error;
          await context.client.query('ROLLBACK TO SAVEPOINT rym_release');
          reason = `${error.code}: ${error.message}`;
        }
        await context.client.query('RELEASE SAVEPOINT rym_release');
        if (reason) {
          await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,payload,notes)
            SELECT 'manual_review','open',2,$1,$2::jsonb,$3 WHERE NOT EXISTS
            (SELECT 1 FROM ingest.review_queue WHERE artist_a_id=$1 AND payload->>'operation'='rym_missing_release' AND payload->>'sourceHref'=$4)`,
          [item.artistId,JSON.stringify({operation:'rym_missing_release',...item,sourceType:release.tipo,reason}),reason,item.sourceHref]);
          results.push({ slug:item.slug,status:'needs_review',reason });
        }
      }
      return results;
    },{ rollbackOnly:!confirm });
    if (confirm) {
      runs.push(result.runId);
      writeFileSync(`${directory}/publicaciones-run${result.runId}.json`,JSON.stringify({runId:result.runId,outcomes:result.result,planHash:createHash('sha256').update(JSON.stringify(batch)).digest('hex')},null,2)+'\n');
    }
    outcomes.push(...result.result);
    writeFileSync(`${directory}/publicaciones-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify({ runs,dryRun:!confirm,planned:pending.length,pending:pending.length-offset-batch.length,outcomes },null,2)+'\n');
    console.log(`Lote ${offset+1}–${offset+batch.length}: ${result.result.filter(item=>item['status']==='created').length} altas ${confirm?'aplicadas':'ensayadas y revertidas'}`);
  }
  if (!pending.length) writeFileSync(`${directory}/publicaciones-repeticion.json`,JSON.stringify({ pending:0,existingOrReviewed:proposals.length },null,2)+'\n');
}
main().catch((error: unknown) => { console.error(error); process.exitCode=1; }).finally(()=>closeDb());
