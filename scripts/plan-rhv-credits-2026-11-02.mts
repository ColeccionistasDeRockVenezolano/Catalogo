/** Plan de créditos RHV 2026-11-02: resuelve cada participación a un álbum y una acción.
 * Solo lectura: escribe credit-plan.json para revisión antes de aplicar. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { matchingAppearanceTracks, sourceTitleKey as key } from '../src/discography/source-appearances.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
type Matched = { album: { id: number; artistId: number; title: string; year: number | null }; albumCredits: number[]; titles: Array<{ title: string; credited: number[]; documented: boolean }> };
type Entry = { artist: string; artistId: number | null; url: string; title: string; year: number | null; header: string; performer: string | null; tracks: Array<{ title: string; disc?: number }>; covers: string[]; status: string; matched: Matched[]; elsewhere: Array<{ sourceTitle: string; trackId: number; album?: { id: number } }> };
type Album = { id: number; artistId: number; owner: string; title: string; year: number | null; cover: string | null; type: string };
type Artist = { id: number; name: string; names: string[] };

const entries = (JSON.parse(readFileSync(path.join(root, 'compilation-audit.json'), 'utf8')) as { entries: Entry[] }).entries;
const db = getPool();
try {
  const albums = (await db.query<Album>(`SELECT a.id::int,a.artist_id::int "artistId",ar.name owner,a.title,a.release_year "year",a.cover_url cover,a.album_type::text type
    FROM ingest.catalog_albums a JOIN ingest.catalog_artists ar ON ar.id=a.artist_id`)).rows;
  const artists = (await db.query<Artist>(`SELECT a.id::int,a.name,
    ARRAY[a.name] || ARRAY(SELECT alias FROM ingest.artist_aliases WHERE artist_id=a.id) names FROM ingest.catalog_artists a`)).rows;
  const tracks = (await db.query<{ albumId: number; id: number; title: string }>(`SELECT album_id::int "albumId",id::int,title FROM ingest.catalog_tracks`)).rows;
  const byId = new Map(albums.map(a => [a.id, a]));
  const artistById = new Map(artists.map(a => [a.id, a]));
  const vaId = artists.find(a => key(a.name) === 'variousartists')?.id;
  if (!vaId) throw new Error('Falta Various Artists');
  const tracksByAlbum = new Map<number, Array<{ id: number; title: string }>>();
  for (const t of tracks) tracksByAlbum.set(t.albumId, [...tracksByAlbum.get(t.albumId) ?? [], { id: t.id, title: t.title }]);
  const byAlbumKey = new Map<string, Album[]>();
  for (const a of albums) byAlbumKey.set(key(a.title), [...byAlbumKey.get(key(a.title)) ?? [], a]);

  const strip = (s: string) => key(s.replace(/^(?:el|la|los|las|the)\s+/iu, ''));
  const bigrams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const similarity = (a: string, b: string): number => {
    if (a === b) return 1;
    if (a.length < 3 || b.length < 3) return 0;
    const A = bigrams(a), B = bigrams(b); let hit = 0;
    for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
    return (2 * hit) / (a.length - 1 + b.length - 1);
  };
  const prefix4 = new Map<string, Album[]>();
  for (const a of albums) { const p = key(a.title).slice(0, 4); prefix4.set(p, [...prefix4.get(p) ?? [], a]); }
  const volumeOf = (title: string): number | null => {
    const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    const plain = title.normalize('NFD').replace(/\p{M}/gu, '');
    const explicit = /(?:vol{1,2}|vul|volumen|parte)\.?\s*([0-9]{1,2}|[ivx]{1,4})\b/iu.exec(plain);
    if (explicit) {
      const raw = explicit[1]!.toLowerCase();
      return /^\d+$/.test(raw) ? Number(raw) : roman[raw] ?? null;
    }
    const tail = /(?:^|\s)([0-9]{1,2}|[ivx]{1,4})$/iu.exec(plain.trim());
    if (!tail) return null;
    const raw = tail[1]!.toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : roman[raw] ?? null;
    return n !== null && n >= 1 && n <= 12 ? n : null;
  };
  const nearAlbums = (title: string, year: number | null) => {
    const k = key(title);
    if (k.length < 4) return [];
    const vol = volumeOf(title);
    return (prefix4.get(k.slice(0, 4)) ?? []).filter(a => {
      const ak = key(a.title);
      if (Math.abs(ak.length - k.length) > 18) return false;
      const otherVol = volumeOf(a.title);
      if (vol !== null || otherVol !== null) { if (vol === null || otherVol === null || vol !== otherVol) return false; }
      if (similarity(k, ak) < 0.86) return false;
      return year === null || a.year === null || Math.abs(a.year - year) <= 1;
    }).map(a => ({ album: a, score: similarity(k, key(a.title)) })).sort((x, y) => y.score - x.score);
  };
  const plan: Array<Record<string, unknown>> = [];
  const summary: Record<string, number> = {};

  for (const e of entries) {
    if (e.status === 'credit_and_songs_present') continue;
    if (e.artistId === null) { summary['sin_artista'] = (summary['sin_artista'] ?? 0) + 1; continue; }
    const artist = artistById.get(e.artistId);
    if (!artist) throw new Error(`Artista ${e.artistId} no existe`);
    const names = [...new Set([...artist.names, e.artist])];
    const performerOk = !e.performer || key(e.performer) === key(e.artist) || key(e.performer).includes(key(e.artist)) || key(e.artist).includes(key(e.performer)) ||
      names.some(n => key(e.performer!).startsWith(key(n)) || key(n).startsWith(key(e.performer!)));
    const candidates = e.matched.map(m => byId.get(m.album.id)).filter((a): a is Album => !!a);
    const exact = byAlbumKey.get(key(e.title)) ?? [];
    const pool2 = (candidates.length ? candidates : exact);
    // Puntúa cada candidato por pistas documentadas presentes y año.
    const scored = pool2.map(a => {
      if (!a) return null;
      const rows = tracksByAlbum.get(a.id) ?? [];
      const hit = e.tracks.filter(t => matchingAppearanceTracks(rows, t.title, names).length > 0).length;
      return { album: a, trackHits: hit, yearOk: e.year !== null && a.year === e.year, isVA: a.artistId === vaId, isOwn: a.artistId === e.artistId };
    }).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => (Number(y.yearOk) - Number(x.yearOk)) || (y.trackHits - x.trackHits) || (Number(y.isVA) - Number(x.isVA)));
    const best = scored[0];
    const tied = best ? scored.filter(s => s.trackHits === best.trackHits && s.yearOk === best.yearOk && s.album.artistId !== best.album.artistId) : [];
    const base = { artist: e.artist, artistId: e.artistId, url: e.url, title: e.title, year: e.year, header: e.header, performer: e.performer, status: e.status, tracks: e.tracks.map(t => t.title), covers: e.covers };
    if (e.status === 'performer_identity' && !performerOk) {
      plan.push({ ...base, action: 'review', reason: 'performer_identity' });
      summary['review_performer'] = (summary['review_performer'] ?? 0) + 1; continue;
    }
    if (best && tied.length && best.trackHits === 0) {
      plan.push({ ...base, action: 'review', reason: 'album_ambiguous', candidates: scored.slice(0, 5).map(s => ({ id: s.album.id, owner: s.album.owner, year: s.album.year, hits: s.trackHits })) });
      summary['review_ambiguous'] = (summary['review_ambiguous'] ?? 0) + 1; continue;
    }
    if (best) {
      if (best.isOwn) {
        plan.push({ ...base, action: 'skip_own_album', albumId: best.album.id });
        summary['skip_own'] = (summary['skip_own'] ?? 0) + 1;
      } else {
        plan.push({ ...base, action: 'credit_existing', albumId: best.album.id, albumTitle: best.album.title, owner: best.album.owner, trackHits: best.trackHits, yearConflict: !best.yearOk && e.year !== null && best.album.year !== null });
        summary['credit_existing'] = (summary['credit_existing'] ?? 0) + 1;
      }
      continue;
    }
    // No hay álbum exacto: antes de crear, buscar edición equivalente por similitud.
    const near = nearAlbums(e.title, e.year).filter(n => !n.album.artistId || n.album.artistId !== e.artistId);
    if (near.length) {
      const top = near[0]!;
      plan.push({ ...base, action: 'credit_near', albumId: top.album.id, albumTitle: top.album.title, owner: top.album.owner, score: Number(top.score.toFixed(3)), candidates: near.slice(0, 4).map(n => ({ id: n.album.id, title: n.album.title, owner: n.album.owner, year: n.album.year, score: Number(n.score.toFixed(3)) })) });
      summary['credit_near'] = (summary['credit_near'] ?? 0) + 1; continue;
    }
    const sameKey = byAlbumKey.get(key(e.title)) ?? [];
    const sameStrip = byAlbumKey.get(strip(e.title)) ?? [];
    const homonyms = [...sameKey, ...sameStrip].filter(a => a.artistId !== e.artistId);
    // Un recopilatorio de VA del mismo título y año sería la misma edición; el resto son homónimos.
    const vaSameEdition = homonyms.filter(a => a.artistId === vaId && (e.year === null || a.year === null || Math.abs(a.year - e.year) <= 1));
    if (vaSameEdition.length) {
      plan.push({ ...base, action: 'review', reason: 'album_present_other_key', candidates: vaSameEdition.map(a => ({ id: a.id, owner: a.owner, title: a.title, year: a.year })) });
      summary['review_other_key'] = (summary['review_other_key'] ?? 0) + 1; continue;
    }
    plan.push({ ...base, action: 'create_album_and_credit', ownerArtistId: vaId, albumType: 'compilation', homonyms: homonyms.map(a => ({ id: a.id, owner: a.owner, year: a.year })) });
    summary['create_album'] = (summary['create_album'] ?? 0) + 1; continue;
  }
  writeFileSync(path.join(root, 'credit-plan.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, entries: plan }, null, 2));
  console.log(JSON.stringify({ total: plan.length, summary }, null, 2));
} finally { await closeDb(); }
