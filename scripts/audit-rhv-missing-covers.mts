import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { sourceTitleKey as key } from '../src/discography/source-appearances.js';

const out = process.argv[2];
if (!out || !path.resolve(out).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
type Entry = { title: string; years_raw: string; covers: string[]; appearance: string | null; header: string };
type Ficha = { url: string; name: string; albums: Entry[] };
const fichas = readFileSync('reports/rhv-directorio-2026-10-25/fichas.jsonl', 'utf8').trim().split('\n').map(x => JSON.parse(x) as Ficha);
const db = getPool();
try {
  const docs = (await db.query<{url:string; artistId:number}>(`SELECT source_url url,artist_id::int "artistId" FROM media.artist_documents WHERE source_url LIKE 'https://rockhechovenezuela.com/%'`)).rows;
  const albums = (await db.query<{id:number; artistId:number; title:string; year:number|null; cover:string|null}>(`SELECT id::int,artist_id::int "artistId",title,release_year AS "year",cover_url cover FROM ingest.catalog_albums`)).rows;
  const candidates: unknown[] = []; const ambiguous: unknown[] = [];
  for (const ficha of fichas) {
    const ids = [...new Set(docs.filter(d => d.url === ficha.url).map(d => d.artistId))];
    if (ids.length !== 1) continue;
    for (const entry of ficha.albums.filter(a => !a.appearance && a.covers.length)) {
      const years = entry.years_raw.match(/(?:19|20)\d{2}/g) ?? [];
      const year = years.length === 1 ? Number(years[0]) : null;
      const matched = albums.filter(a => a.artistId === ids[0] && key(a.title) === key(entry.title));
      const missing = matched.filter(a => !a.cover?.trim());
      if (!missing.length) continue;
      const record = { artist: ficha.name, artistId: ids[0], source: ficha.url, header: entry.header, sourceTitle: entry.title, year, cover: new URL(entry.covers[0]!, ficha.url).href, matched };
      if (matched.length === 1 && year !== null && matched[0]!.year === year) candidates.push(record);
      else ambiguous.push(record);
    }
  }
  writeFileSync(path.join(out, 'cover-audit.json'), JSON.stringify({fichas:fichas.length,candidates,ambiguous},null,2));
  console.log(JSON.stringify({fichas:fichas.length,candidates:candidates.length,ambiguous:ambiguous.length}));
} finally { await closeDb(); }
