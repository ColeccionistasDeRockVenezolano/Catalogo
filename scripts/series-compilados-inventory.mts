/** Auditoría de sólo lectura; el informe debe apuntar al staging SSD. */
import { writeFileSync } from 'node:fs';
import { getPool, closeDb } from '../src/db/client.js';
const out=process.argv[2]; if(!out) throw new Error('Indica directorio de staging');
const client=await getPool().connect();
try {
  await client.query('BEGIN READ ONLY');
  const albums=(await client.query(`SELECT a.*, ar.name artist,
    (SELECT jsonb_agg(jsonb_build_object('classification',c.classification,'inferred',c.inferred)) FROM ingest.effective_album_classifications c WHERE c.album_id=a.id) classifications,
    (SELECT jsonb_agg(sa.series_id) FROM ingest.series_albums sa WHERE sa.album_id=a.id) series,
    (SELECT jsonb_agg(e) FROM (SELECT DISTINCT c.field,c.raw_value,c.notes,p.canonical_url url FROM ingest.claims c LEFT JOIN ingest.raw_pages p ON p.id=c.raw_page_id WHERE c.album_id=a.id AND c.entity_kind='album' AND c.field IN ('title','album_type','description') LIMIT 12) e) evidence
    FROM ingest.catalog_albums a JOIN ingest.catalog_artists ar ON ar.id=a.artist_id
    WHERE a.album_type='compilation' OR EXISTS(SELECT 1 FROM ingest.effective_album_classifications ac WHERE ac.album_id=a.id AND ac.classification='Compilation Album') OR ar.name ILIKE '%various%' OR ar.name ILIKE '%compil%'
      OR a.id IN (SELECT album_id FROM ingest.series_albums)
      OR a.title ~* '(compil|recopil|volumen|vol[. ]|antolog|colecci|serie|cap[ií]tulo|rocker|melomani|bruthal)' ORDER BY ar.name,a.title`)).rows;
  writeFileSync(`${out}/catalog-evidence.json`,JSON.stringify({queriedAt:new Date().toISOString(),albums},null,2));
  console.log({albums:albums.length,compilations:albums.filter(a=>a.album_type==='compilation').length});
  await client.query('ROLLBACK');
} finally { client.release(); await closeDb(); }
