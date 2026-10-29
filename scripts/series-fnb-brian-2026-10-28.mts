/** Selección expresa de Brian según su captura; conserva discos y sellos. */
import { writeFileSync, copyFileSync } from 'node:fs';
import { getPool, closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { deleteSeries, writeSeries, writeSeriesEntry } from '../src/catalog/series.js';
const out = process.argv[2];
if (!out) throw new Error('Indica carpeta de informes en staging');
const confirm = process.argv.includes('--confirm');
const selected = [586, 376, 581, 393, 383];
try {
  const before = (await getPool().query(`SELECT s.*, (SELECT jsonb_agg(sa) FROM ingest.series_albums sa WHERE sa.series_id=s.id) entries
    FROM ingest.series s WHERE id IN (144,145,195) ORDER BY id`)).rows;
  writeFileSync(`${out}/before.json`, JSON.stringify(before, null, 2));
  copyFileSync('/home/brian/Desktop/42b12500-a74c-479a-8a18-036f76824ce9.jpg', `${out}/seleccion-brian.jpg`);
  const result = await withOperatorRun({ name: 'series:fnb-brian', operator: 'codex',
    note: 'Brian pide eliminar series 144 y 195 y sustituirlas por Festival Nuevas Bandas con los cinco discos de su captura. Conservar Venezuela Pop & Rock y los compilados bajo FNB Grabaciones C.A.', params: { selected, removed: [144,195] } }, async ctx => {
    if (before.length !== 3 || before.find(s => Number(s.id)===144)?.title !== 'Fundación Nuevas Bandas') throw new Error('Estado inesperado');
    const albums = (await ctx.client.query('SELECT id,title,artist_id FROM ingest.catalog_albums WHERE id=ANY($1::bigint[])', [selected])).rows;
    if (albums.length !== 5 || albums.some(a => Number(a.artist_id)!==257)) throw new Error('Selección no disponible');
    await deleteSeries(ctx,144);
    await deleteSeries(ctx,195);
    const seriesId = await writeSeries(ctx, {title:'Festival Nuevas Bandas',kind:'compilation',artistId:257,
      description:'Ediciones en vivo de Nuevas Bandas seleccionadas por Brian.',
      notes: JSON.stringify({reason:'La agrupación anterior mezclaba compilados y grabaciones en vivo. Selección expresa de Brian en captura de cinco discos; Venezuela Pop & Rock se conserva como boxset independiente. No se alteran las clasificaciones ni los años de los discos a partir de nombres de carpetas.',report:'reports/series-fnb-brian-2026-10-28',selected})});
    for (const id of selected) await writeSeriesEntry(ctx,seriesId,{albumId:id,volumeNumber:null,volumeLabel:albums.find(a=>Number(a.id)===id)!.title});
    const after = (await ctx.client.query('SELECT s.id,s.title,sa.album_id FROM ingest.series s JOIN ingest.series_albums sa ON sa.series_id=s.id WHERE s.id=ANY($1::bigint[]) ORDER BY s.id,sa.id',[[145,seriesId]])).rows;
    if (after.length!==12) throw new Error('Conteo inesperado');
    return {seriesId,selected,removed:[144,195],preserved:145,after};
  },{rollbackOnly:!confirm});
  writeFileSync(`${out}/${confirm?'applied':'preview'}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await closeDb();}
