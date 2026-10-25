// Clasificaciones de la hoja por disco (migración 0011).
//
// El core guarda un solo `album_type`; la hoja maestra, fuente de los tipos por
// decisión del propietario, escribe varias por disco ("Solo Artist, Studio
// Album"). Esta proyección las guarda todas sin tocar el core y se regenera
// desde `ingest.seed_uploads`, conservando los aportes sin seed_upload_id.
//
// Una fila con video se ata a su disco SOLO por el enlace del video: por nombre,
// el videoclip "Otra Tarde Más" acabaría clasificando al single del mismo
// título. Las filas sin video se atan por artista (o alias) + título + año, y
// solo cuando el resultado es único.
import { getPool } from "../db/client.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import { inferSheetType, inferredTypeLabel, sheetClassifications } from "./normalization.js";

export interface ClassificationSyncResult {
  rows: number; matched: number; unmatched: number; ambiguous: number;
  albums: number; classifications: number; inferred: number; dryRun: boolean;
}

export interface SheetClassificationRow {
  type_raw: string | null; artist_name_raw: string | null; album_name_raw: string | null;
}

/** Lo que la celda dice, en su orden; vacía, el tipo inferido y marcado como tal. */
export function rowClassifications(row: SheetClassificationRow): Array<{ classification: string; inferred: boolean }> {
  const written = sheetClassifications(row.type_raw).filter((part) => part.toLowerCase() !== "empty");
  if (written.length > 0) return written.map((classification) => ({ classification: classification.slice(0, 60), inferred: false }));
  const inferred = inferSheetType(row.artist_name_raw, row.album_name_raw);
  return inferred ? [{ classification: inferredTypeLabel(inferred), inferred: true }] : [];
}

interface SeedRow extends SheetClassificationRow { id: string; album_year_raw: number | null; video_id: string | null; }

const nameKey = (value: string): string => normalizeEntityName(value).secondaryKey;

export interface PlannedClassification { classification: string; inferred: boolean; seedUploadId: string | null }

/** La hoja manda en orden y certeza; un aporte independiente conserva su origen. */
export function mergeSheetAndLocalClassifications(sheet: PlannedClassification[], local: PlannedClassification[]): PlannedClassification[] {
  const result = sheet.map(item => ({ ...item }));
  for (const item of local) {
    const existing = result.find(candidate => candidate.classification.toLowerCase() === item.classification.toLowerCase());
    if (existing) {
      existing.classification = item.classification;
      existing.inferred = existing.inferred && item.inferred;
      existing.seedUploadId = null;
    } else result.push({ ...item, seedUploadId: null });
  }
  return result;
}

export async function syncAlbumClassifications(options: { dryRun?: boolean } = {}): Promise<ClassificationSyncResult> {
  const pool = getPool();
  const seeds = (await pool.query<SeedRow>(`
    SELECT id::text, artist_name_raw, album_name_raw, album_year_raw, type_raw, video_id
      FROM ingest.seed_uploads ORDER BY upload_order`)).rows;
  const links = (await pool.query<{ video_id: string; album_id: string }>(`
    SELECT v.video_id, va.album_id::text FROM media.video_albums va JOIN media.youtube_videos v ON v.id=va.video_id`)).rows;
  const albums = (await pool.query<{ id: string; title: string; release_year: number | null; names: string[] }>(`
    SELECT a.id::text, a.title, a.release_year,
           array_remove(array_agg(DISTINCT ar.name) || array_agg(DISTINCT al.alias), NULL) AS names
      FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id
      LEFT JOIN ingest.artist_aliases al ON al.artist_id=ar.id
     GROUP BY a.id`)).rows;

  const albumsByVideo = new Map<string, Set<string>>();
  for (const link of links) albumsByVideo.set(link.video_id, (albumsByVideo.get(link.video_id) ?? new Set()).add(link.album_id));
  const albumsByName = new Map<string, Array<{ id: string; year: number | null }>>();
  for (const album of albums) {
    for (const name of new Set(album.names.map(nameKey))) {
      const releaseKey = `${name}::${nameKey(album.title)}`;
      albumsByName.set(releaseKey, [...(albumsByName.get(releaseKey) ?? []), { id: album.id, year: album.release_year }]);
    }
  }

  const planned = new Map<string, PlannedClassification[]>();
  const result: ClassificationSyncResult = { rows: seeds.length, matched: 0, unmatched: 0, ambiguous: 0, albums: 0, classifications: 0, inferred: 0, dryRun: options.dryRun === true };
  for (const row of seeds) {
    const classes = rowClassifications(row);
    if (classes.length === 0 || !row.artist_name_raw || !row.album_name_raw) continue;
    let targets: string[];
    if (row.video_id) {
      targets = [...(albumsByVideo.get(row.video_id) ?? [])];
    } else {
      const candidates = albumsByName.get(`${nameKey(row.artist_name_raw)}::${nameKey(row.album_name_raw)}`) ?? [];
      const sameYear = candidates.filter((album) => row.album_year_raw === null || album.year === null || album.year === row.album_year_raw);
      targets = [...new Set(sameYear.map((album) => album.id))];
    }
    if (targets.length === 0) { result.unmatched += 1; continue; }
    if (targets.length > 1) { result.ambiguous += 1; continue; }
    result.matched += 1;
    const list = planned.get(targets[0]!) ?? [];
    for (const item of classes) {
      if (!list.some((existing) => existing.classification.toLowerCase() === item.classification.toLowerCase())) list.push({ ...item, seedUploadId: row.id });
    }
    planned.set(targets[0]!, list);
  }
  const local = (await pool.query<{ album_id: string; classification: string; inferred: boolean }>(`
    SELECT album_id::text, classification, inferred FROM ingest.album_classifications
     WHERE seed_upload_id IS NULL
    UNION ALL SELECT d.album_id::text,d.classification,false FROM ingest.album_classification_decisions d
     WHERE d.selected AND NOT EXISTS(SELECT 1 FROM ingest.album_classifications c WHERE c.album_id=d.album_id AND c.classification=d.classification AND c.seed_upload_id IS NULL)`)).rows;
  const localByAlbum = new Map<string, PlannedClassification[]>();
  for (const row of local) {
    const list = localByAlbum.get(row.album_id) ?? [];
    list.push({ classification: row.classification, inferred: row.inferred, seedUploadId: null });
    localByAlbum.set(row.album_id, list);
  }
  for (const [albumId, list] of localByAlbum) planned.set(albumId, mergeSheetAndLocalClassifications(planned.get(albumId) ?? [], list));
  result.albums = planned.size;
  for (const list of planned.values()) {
    result.classifications += list.length;
    result.inferred += list.filter((item) => item.inferred).length;
  }
  if (options.dryRun === true) return result;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ingest.album_classifications WHERE seed_upload_id IS NOT NULL");
    for (const [albumId, list] of planned) {
      for (const [index, item] of list.entries()) {
        await client.query(`
          INSERT INTO ingest.album_classifications(album_id,classification,position,inferred,seed_upload_id)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT (album_id, classification) DO UPDATE SET
            position=EXCLUDED.position,
            inferred=ingest.album_classifications.inferred AND EXCLUDED.inferred`, [albumId, item.classification, index + 1, item.inferred, item.seedUploadId]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return result;
}
