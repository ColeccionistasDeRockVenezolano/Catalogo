/** Brian: completar Gente en Ambiente y la playlist oficial de Metalkinesia.
 * Ensayo por defecto. Evidencias y resultados en staging; core mediante operador. */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb } from '../src/db/client.js';
import { createEntity, updateEntity, withOperatorRun } from '../src/merge/operator.js';

const out = process.argv[2];
if (!out) throw new Error('Indica carpeta de evidencia en staging');
const confirm = process.argv.includes('--confirm');
const report = 'reports/series-gente-playlist-2026-10-28';
const playlistUrl = 'https://www.youtube.com/playlist?list=PLL10rKUIU0CUyL8xK5LcWCTMlnwtunykh';
type Video = { id: string; snippet: { title: string; description: string }; status: { privacyStatus: string; embeddable: boolean } };
const videos = (JSON.parse(readFileSync(`${out}/videos.json`, 'utf8')) as { items: Video[] }).items;
// Dos pares son el mismo compilado, con distinta disponibilidad de canciones por copyright.
const duplicateVideos = ['3ZvtuAq1oUY', 'CgPWQCGDxzw'];
const unique = videos.filter(v => !duplicateVideos.includes(v.id));
const existing = [1366, 1354, 1343, 1326, 1323, 1322, 1324, 1296, 1295, 1294, 816, 1190, 952, 1185, 798, 958];
const missing = [
  { video: 'MM7qbk9e_HU', title: 'Capítulo Táchira', number: 17, year: 2020 },
  { video: 'm5R77OgOB1w', title: 'Capítulo Migración II', number: 18 },
  { video: 'A2wfYWdZuZY', title: 'Capítulo Bolívar', number: 19 },
  { video: '3ZP5XcSZW9c', title: 'Capítulo Migración III', number: 20 },
  { video: '5S7gBiL3cnQ', title: 'Capítulo Miranda', number: 21 },
  { video: 'VdR-JAunuXc', title: 'Capítulo Migración IV', number: 22 },
  { video: 'KCD_cLzjDlw', title: 'Capítulo Los Inicios', number: 23, year: 2023 },
  { video: 'zU8gTwVgUvg', title: 'Capítulo Guárico', number: 24 },
  { video: 'uSqw2wy3xBo', title: 'Capítulo Tributo al Rock Hecho en Venezuela', number: null },
];

try {
  if (unique.length !== 25) throw new Error('La playlist cambió: revisar');
  const result = await withOperatorRun({ name: 'series:gente-metalkinesia', operator: 'codex',
    note: 'Brian pide añadir tres discos a Gente en Ambiente y completar Metalkinesia desde la playlist oficial',
    params: { report, playlistUrl } }, async ctx => {
    const before = (await ctx.client.query(`SELECT s.id,s.title,sa.album_id,sa.volume_number,sa.volume_label
      FROM ingest.series s JOIN ingest.series_albums sa ON sa.series_id=s.id WHERE s.id IN (116,201) ORDER BY s.id,sa.id`)).rows;
    writeFileSync(`${out}/before-${confirm ? 'apply' : 'dry-run'}.json`, JSON.stringify(before, null, 2));
    if (before.filter(x => Number(x.id) === 116).length !== 15 || before.filter(x => Number(x.id) === 201).length !== 2)
      throw new Error('Las series cambiaron; revisar antes de aplicar');
    for (const id of [379, 395, 401]) {
      const row = (await ctx.client.query('SELECT artist_id::int,title FROM ingest.catalog_albums WHERE id=$1', [id])).rows[0];
      if (row?.artist_id !== 257) throw new Error(`Disco ${id} no es de Various Artists`);
      await ctx.client.query(`INSERT INTO ingest.series_albums(series_id,album_id,volume_label,run_id) VALUES(201,$1,$2,$3)`, [id, row.title, ctx.runId]);
    }
    await ctx.client.query('UPDATE ingest.series SET notes=$1,run_id=$2 WHERE id=201', [JSON.stringify({
      reason: 'Colección ampliada por indicación expresa de Brian: El Alucinante Mundo del Soul, Segunda Experiencia Psicotomimética y Viva Una Experiencia Psicotomimética.',
      report, previousNotes: (await ctx.client.query('SELECT notes FROM ingest.series WHERE id=201')).rows[0].notes,
    }), ctx.runId]);
    // La ficha alternativa del mismo LP conserva 1968 y el número SLP 1347; fuente archivada en el catálogo.
    await updateEntity({ ...ctx, note: 'Año 1968 confirmado por Brian y ficha 41025, Souvenir SLP 1347; https://hippitoysuschatarritas.blogspot.com/2016/08/va-el-alucinante-mundo-del-soul.html' }, 'album', 379, { release_year: 1968 });
    const members: Array<{ id: number; number: number | null; title: string }> = [];
    for (const [i, id] of existing.entries()) {
      const video = unique[i]!;
      if (!video.status.embeddable || !['public', 'unlisted'].includes(video.status.privacyStatus)) throw new Error(`Video no reproducible: ${video.id}`);
      const row = (await ctx.client.query('SELECT title,artist_id::int,youtube_url FROM public.albums WHERE id=$1', [id])).rows[0];
      if (row?.artist_id !== 257 || row.youtube_url) throw new Error(`La ficha ${id} cambió`);
      await updateEntity({ ...ctx, note: `Video del compilado publicado por Metal Lethal: https://www.youtube.com/watch?v=${video.id}` }, 'album', id,
        { youtube_url: `https://www.youtube.com/watch?v=${video.id}`, youtube_status: 'published' });
      members.push({ id, number: i + 1, title: row.title });
    }
    const created = [];
    for (const item of missing) {
      const video = unique.find(v => v.id === item.video)!;
      if (!video?.status.embeddable || !['public', 'unlisted'].includes(video.status.privacyStatus)) throw new Error(`Video no reproducible: ${item.video}`);
      // Fuente primaria: anuncio explícito del sello de una edición descargable, con productores,
      // remasterización y repertorio. No se infiere un disco de la mera existencia del video.
      if (!/DESCARG/i.test(video.snippet.description.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) throw new Error(`Sin edición musical documentada: ${item.video}`);
      const url = `https://www.youtube.com/watch?v=${item.video}`;
      const notes = `Compilado de Various Artists editado por Metal Lethal Records, serie Metalkinesia. El sello documenta la edición musical de descarga en su descripción oficial (${url}), separada de la edición de video. Evidencia: ${report}/videos.json. Sitio oficial con error 502 al consultar. No se deduce la fecha del disco de la fecha del video. Repertorio original y créditos conservados en la evidencia; sin generar pistas ni marcas de tiempo desde el video.`;
      const id = (await createEntity({ ...ctx, note: notes }, 'album', {
        title: `Metalkinesia — ${item.title}`, album_type: 'compilation', media_format: 'Digital',
        ...('year' in item ? { release_year: item.year } : {}),
        youtube_url: url, youtube_status: 'published', notes,
      }, { artistId: 257, allowSimilar: true })).id;
      members.push({ id, number: item.number, title: item.title });
      created.push({ id, ...item });
    }
    for (const member of members) await ctx.client.query(`INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label,run_id)
      VALUES(116,$1,$2,$3,$4) ON CONFLICT(series_id,album_id) DO UPDATE SET volume_number=excluded.volume_number,volume_label=excluded.volume_label,run_id=excluded.run_id`,
    [member.id, member.number, member.number === null ? 'Tributo al Rock Hecho en Venezuela' : member.title, ctx.runId]);
    await ctx.client.query('UPDATE ingest.series SET description=$1,notes=$2,run_id=$3 WHERE id=116', [
      'La enciclopedia sonora del rock y metal venezolano, publicada por Metal Lethal Records. Compilados regionales y ediciones especiales.',
      JSON.stringify({ playlistUrl, report, duplicateVideos, unnumbered: 'Tributo al Rock Hecho en Venezuela: el sello no indica número en el video.',
        previousNotes: (await ctx.client.query('SELECT notes FROM ingest.series WHERE id=116')).rows[0].notes }), ctx.runId]);
    const counts = (await ctx.client.query('SELECT series_id::int,count(*)::int FROM ingest.series_albums WHERE series_id IN (116,201) GROUP BY series_id ORDER BY series_id')).rows;
    if (counts[0]?.count !== 25 || counts[1]?.count !== 5) throw new Error('Conteos inesperados');
    return { created, counts, duplicateVideos, addedToGente: [379, 395, 401], linkedExisting: 1185 };
  }, { rollbackOnly: !confirm });
  writeFileSync(`${out}/${confirm ? 'applied' : 'dry-run'}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await closeDb(); }
