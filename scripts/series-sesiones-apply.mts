/** Series que faltaban (Brian, 2026-10-27): «Caracas Sangrante» Vol. 1–2 (Humano Derecho, 2016), ausente del
 *  catálogo, y «Sonó Así» de Urbe, una serie de sesiones (0104) cuyas entregas estaban a nombre del
 *  pseudoartista «Sonó Así» con el nombre de cada banda como título. Ensayo por defecto; diario y revalidación al aplicar. */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb } from '../src/db/client.js';
import { createEntity, createRelation, updateEntity, withOperatorRun, type OperatorContext } from '../src/merge/operator.js';
import { mergeAlbums, previewAlbumMerge } from '../src/merge/album-merge.js';
import { VARIOUS_ARTISTS_ID } from '../src/curation/person-timeline.js';
const out = process.argv[2]; if (!out) throw new Error('Indica carpeta del staging');
const confirm = process.argv.includes('--confirm');
const REPORT = 'reports/series-sesiones-2026-10-27';
const MEDIA = '/crv/media/series-sesiones-2026-10-27';

type Volume = { title: string; volume: number; released: string; url: string; curator: string; tracks: Array<[string, string, string]> };
const evidence = JSON.parse(readFileSync(`${out}/caracas-sangrante.json`, 'utf8')) as { volumes: Volume[]; press: string };
// Intérpretes por nombre de la fuente; cada identidad se contrastó con una pista suya ya catalogada o con su alias.
const performer: Record<string, number> = {
  'Cero a la Izquierda': 60, 'Los Gusanos': 157, '4º Reich': 1009, 'El Enano de la Catedral': 1106, 'Psh-Psh': 285,
  'Claroscuro': 67, 'El Rastro': 89, 'Culto Oculto': 70, 'Dermis Tatú': 76, 'Spias': 229, '20/20': 32,
  'La Seguridad Nacional': 218, 'Víctimas de la Democracia': 1308,
  '11011': 1537, '@patía No': 574, 'Guarapo': 1122, 'Los Dólares': 1163, 'Los Druppies': 7253, 'Más Quejas': 178,
  'Mi amigo el lisiado': 1755, 'Nada': 450, 'Nametai': 1239, 'No me molesten': 1709, 'NPI': 1061, 'Pawnee 16': 7738, 'Zoek': 7432,
};
const HUMANO_DERECHO = 351;

const SONO_ASI_URL = 'https://rockdevzla.blogspot.com/2011/02/sono-asi-12-bandas-en-una-importante.html';
// Entrega del blog (titulada con el nombre de la banda) → banda; `keep`: la misma sesión ya catalogada desde el canal.
const episodes: Array<{ id: number; band: string; artistId: number | null; keep?: number }> = [
  { id: 2330, band: '1era Edición', artistId: 31 }, { id: 2323, band: 'Candy66', artistId: 55 },
  { id: 3009, band: 'Circo Vulkano', artistId: 275 }, { id: 3106, band: 'Famasloop', artistId: 95, keep: 66 },
  { id: 2326, band: 'Fordelucs', artistId: 98 }, { id: 2324, band: 'Fractaler', artistId: 1946 },
  { id: 2327, band: 'La Vida Bohéme', artistId: 139, keep: 556 }, { id: 3104, band: 'Los Mentas', artistId: 277 },
  { id: 2328, band: 'Los Mesoneros', artistId: 159 }, { id: 2319, band: 'Nana Cadavieco', artistId: 179, keep: 563 },
  { id: 2317, band: "Randall's Project", artistId: null },
  { id: 2322, band: 'Subsonus', artistId: 232 }, { id: 2321, band: 'Telegrama', artistId: 241 },
  { id: 2329, band: 'The Asbestos', artistId: 243 }, { id: 3102, band: 'UltraChic', artistId: 255 },
  { id: 2331, band: 'ViniloVersus', artistId: 259, keep: 592 }, { id: 2320, band: 'Wahala', artistId: 262 },
];
const PSEUDO = 1331;
// Pzoom (alias de Salpachino): el video del canal dIoTE9e2510 (ficha 567) dice «Ya No Más / 30000 Pies / Son De Paz»
// y el blog (ficha 3105) «Ya No Más / Resplandor / 30 Mil Pies». La fusión emparejaría por posición
// «Resplandor» con «30000 Pies»: la 567 entra en la serie y la 3105 queda para revisión, sin tocar.
const SALPACHINO_CHANNEL = 567;

function seconds(duration: string): number { const [m, s] = duration.split(':').map(Number); return m! * 60 + s!; }

async function newSeries(ctx: OperatorContext, values: { title: string; kind: string; artistId: number | null; organizationId: number | null; description: string; notes: object }): Promise<number> {
  if ((await ctx.client.query('SELECT 1 FROM ingest.series WHERE lower(title)=lower($1)', [values.title])).rowCount) throw new Error(`La serie «${values.title}» ya existe`);
  return (await ctx.client.query(`INSERT INTO ingest.series(title,kind,artist_id,organization_id,description,source,notes,run_id)
    VALUES($1,$2,$3,$4,$5,'series-sesiones-2026-10-27',$6,$7) RETURNING id::int`,
  [values.title, values.kind, values.artistId, values.organizationId, values.description, JSON.stringify(values.notes), ctx.runId])).rows[0].id;
}

try {
  const result = await withOperatorRun({ name: 'series:caracas-sangrante-sono-asi', operator: 'claude',
    note: 'Brian (2026-10-27): faltaban Caracas Sangrante Vol. 1–2 y Sonó Así (Urbe), serie de sesiones como caso especial',
    params: { report: REPORT } }, async ctx => {
    // 1. Caracas Sangrante: dos compilados de Various Artists con sus intérpretes por pista.
    const albums = [];
    for (const volume of evidence.volumes) {
      if ((await ctx.client.query('SELECT 1 FROM public.albums WHERE lower(title)=lower($1)', [volume.title])).rowCount) throw new Error(`«${volume.title}» ya está catalogado`);
      const c = { ...ctx, note: `Compilado de Humano Derecho — ${volume.url}` };
      const id = (await createEntity(c, 'album', {
        title: volume.title, release_year: 2016, release_date_text: volume.released, album_type: 'compilation', label_id: HUMANO_DERECHO,
        cover_url: `${MEDIA}/caracas-sangrante-${volume.volume}.jpg`,
        notes: `Recopilatorio de libre descarga por el primer aniversario del radioweb show Humano Derecho (Redes Ayuda y Provea). Selección y curaduría: ${volume.curator}. Portada: «Caracas sangrante» de Nelson Garrido. Fuentes: ${volume.url} ; ${evidence.press}`,
      }, { artistId: VARIOUS_ARTISTS_ID, allowSimilar: true })).id;
      let n = 0;
      for (const [band, title, duration] of volume.tracks) {
        const artistId = performer[band]; if (!artistId) throw new Error(`Sin intérprete para ${band}`);
        const trackId = (await createEntity(c, 'track', { title, track_number: ++n, disc_number: 1, duration_seconds: seconds(duration) }, { albumId: id, allowSimilar: true })).id;
        await createRelation(c, 'track_credit', { trackId, artistId }, { credit_type: 'musician', credit_role: 'Intérprete' });
      }
      albums.push({ id, title: volume.title, tracks: n });
    }
    const caracas = await newSeries(ctx, { title: 'Caracas Sangrante', kind: 'compilation', artistId: VARIOUS_ARTISTS_ID, organizationId: HUMANO_DERECHO,
      description: 'Recopilatorios de canciones olvidadas del rock venezolano publicados por Humano Derecho en 2016: post-punk y hardcore de los 80 y 90 (Vol. 1) y punk de finales de los 90 y comienzos de los 2000 (Vol. 2).',
      notes: { sourceUrls: [...evidence.volumes.map(v => v.url), evidence.press], report: REPORT } });
    for (const [index, album] of albums.entries()) await ctx.client.query(
      'INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label,run_id) VALUES($1,$2,$3,$4,$5)',
      [caracas, album.id, index + 1, `Vol. ${index + 1}`, ctx.runId]);

    // 2. Sonó Así: cada entrega pasa a su banda con el título de la serie; la sesión repetida desde el canal se une a esa ficha.
    const c = { ...ctx, note: `Sesión acústica «Sonó Así» de UrbeVisión (Urbe), una banda por entrega — ${SONO_ASI_URL}` };
    const members: number[] = []; const moved = []; let createdArtist: number | null = null;
    for (const episode of episodes) {
      const row = (await ctx.client.query('SELECT artist_id::int, title FROM public.albums WHERE id=$1', [episode.id])).rows[0];
      if (row?.artist_id !== PSEUDO || row.title.normalize('NFC') !== episode.band.normalize('NFC')) throw new Error(`La entrega ${episode.id} cambió`);
      let artistId = episode.artistId;
      if (artistId === null) {
        artistId = createdArtist = (await createEntity(c, 'artist', { name: episode.band, origin_country: 'Venezuela',
          notes: `Banda nacional de la sesión acústica «Sonó Así» de UrbeVisión (2010). Fuente: ${SONO_ASI_URL}` }, { allowSimilar: true })).id;
      }
      await updateEntity(c, 'album', episode.id, { title: 'Sonó Así' }, { parentId: artistId });
      let id = episode.id;
      if (episode.keep) {
        const keep = (await ctx.client.query('SELECT artist_id::int FROM public.albums WHERE id=$1', [episode.keep])).rows[0];
        if (keep?.artist_id !== artistId) throw new Error(`La sesión ${episode.keep} no es de ${episode.band}`);
        const preview = await previewAlbumMerge(ctx.client, episode.keep, episode.id, { mode: 'match' });
        await mergeAlbums(c, { keepId: episode.keep, dropId: episode.id, previewHash: preview.previewHash, mode: 'match' });
        id = episode.keep;
      }
      members.push(id); moved.push({ from: episode.id, band: episode.band, artistId, album: id, merged: Boolean(episode.keep) });
    }
    members.push(SALPACHINO_CHANNEL);
    const sono = await newSeries(ctx, { title: 'Sonó Así', kind: 'sessions', artistId: null, organizationId: null,
      description: 'Sesiones acústicas de bandas nacionales organizadas por UrbeVisión (Urbe) en 2009 y 2010: cada banda grabó tres de sus temas.',
      notes: { sourceUrls: [SONO_ASI_URL], report: REPORT } });
    for (const id of members) await ctx.client.query(
      'INSERT INTO ingest.series_albums(series_id,album_id,run_id) VALUES($1,$2,$3)', [sono, id, ctx.runId]);
    const mergedTracks = (await ctx.client.query(`SELECT album_id::int, string_agg(track_number||'. '||title, ' / ' ORDER BY disc_number, track_number) tracks
      FROM public.tracks WHERE album_id = ANY($1::bigint[]) GROUP BY album_id`, [episodes.flatMap(e => e.keep ?? [])])).rows;
    return { caracasSangrante: { series: caracas, albums }, sonoAsi: { series: sono, createdArtist, moved, mergedTracks } };
  }, { rollbackOnly: !confirm });
  writeFileSync(`${out}/apply-${confirm ? 'applied' : 'dry-run'}.json`, JSON.stringify({ confirmed: confirm, ...result }, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: result.runId, ...result.result }, null, 1));
} finally { await closeDb(); }
