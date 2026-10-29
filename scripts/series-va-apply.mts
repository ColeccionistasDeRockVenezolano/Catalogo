/** Series solo de Various Artists (Brian, 2026-10-27): reatribuye compilados con titular ficticio y agrupa
 *  las colecciones de VA halladas por título, sello y fuente. Ensayo por defecto; diario y revalidación al aplicar. */
import { writeFileSync } from 'node:fs';
import { closeDb } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { VARIOUS_ARTISTS_ID } from '../src/curation/person-timeline.js';
const out = process.argv[2]; if (!out) throw new Error('Indica carpeta del staging');
const confirm = process.argv.includes('--confirm');
const REPORT = 'reports/series-va-2026-10-27';

// Compilados a nombre del propio compilado u organizador; cada pista acredita otra banda.
const reattribute = [
  { from: 674, ids: [1188, 1217, 1186], evidence: 'Compilado Zuliano Vol. I–III: 20–24 bandas acreditadas por pista; «Cabimas La Cuna Del Rock» es el organizador' },
  { from: 403, ids: [1176, 1174, 1173, 1171, 828], evidence: 'El Delicado Sonido del Rock Vol. I–V: 27–30 bandas por volumen; «Maracaibo» es la escena, no un intérprete' },
  { from: 1782, ids: [3328, 3331], evidence: 'https://rockdevzla.blogspot.com/2010/09/venezuela-ska-compilado-de-bandas-ska.html — compilado de bandas de ska (El Pacto, Palmeras Kanibales, Skabiosis…)' },
  { from: 694, ids: [1298, 1223], evidence: 'https://descargasmetalvenezolano.blogspot.com/2019/10/ciudad-ojeda-es-rock-compilado-01.html — 19 y 25 bandas acreditadas por pista' },
  { from: 396, ids: [820], evidence: 'https://descargasmetalvenezolano.blogspot.com/2020/04/rompiendo-muros-venezuela-rock-y-metal.html — 13 bandas; el Vol. 2 ya es Various Artists' },
  { from: 1636, ids: [2483, 2973, 2482], evidence: 'https://rockdevzla.blogspot.com/2011/07/w.html — documento sonoro del festival W.T.Fest con varias bandas (Buen Invento, Chuck Norris, Monsalve, The Glass, Abures…)' },
];
// Series cuyo titular era el pseudoartista: ahora son de Various Artists.
const seriesOwner = [20, 50, 115, 118];

type Member = { id: number; title: string; volumeNumber: number | null; volumeLabel: string | null };
const newSeries: Array<{ title: string; reason: string; sources: string[]; members: Member[] }> = [
  { title: 'Festival Nuevas Bandas', reason: 'Ediciones anuales del festival de la Fundación Nuevas Bandas (decisión de Brian: solo ediciones del festival)',
    sources: ['https://rockzuela.blogspot.com/2008/07/5to-festival-nuevas-bandas.html', 'https://rockzuela.blogspot.com/2008/05/decimo-festival-nuevas-bandas.html',
      'https://rockdevzla.blogspot.com/2010/09/festival-nuevas-bandas-s.html', 'https://descargasmetalvenezolano.blogspot.com/2017/11/fundacion-nuevas-bandas.html'],
    members: [
      { id: 371, title: '5to Festival Nuevas Bandas', volumeNumber: 5, volumeLabel: '5.º' },
      { id: 586, title: 'Noveno Festival Nuevas Bandas', volumeNumber: 9, volumeLabel: 'IX' },
      { id: 581, title: 'Décimo Festival Nuevas Bandas', volumeNumber: 10, volumeLabel: 'X' },
      { id: 583, title: 'Festival Nuevas Bandas Dosmiluno', volumeNumber: null, volumeLabel: '2001' },
      { id: 383, title: 'Festival Nuevas Bandas 20 Años En Vivo', volumeNumber: null, volumeLabel: '20 años' },
      { id: 738, title: 'Compilado - Festival Nuevas Bandas', volumeNumber: null, volumeLabel: '2015' },
    ] },
  { title: 'W.T.Fest', reason: 'Festival con numeración propia I–III', sources: ['https://rockdevzla.blogspot.com/2011/07/w.html'],
    members: [
      { id: 2483, title: 'W.T.Fest I', volumeNumber: 1, volumeLabel: 'I' },
      { id: 2973, title: 'W.T.Fest II', volumeNumber: 2, volumeLabel: 'II' },
      { id: 2482, title: 'W.T.Fest III', volumeNumber: 3, volumeLabel: 'III' },
    ] },
  { title: 'Rock — Kandra', reason: 'Recopilatorios «Rock I» (1983) y «Rock II» (1984) del sello Kandra', sources: ['https://rockdevzla.blogspot.com/2011/11/rock-i-recopilatorio-editado-por-el.html'],
    members: [
      { id: 15726, title: 'Rock', volumeNumber: 1, volumeLabel: 'I' },
      { id: 9968, title: 'Rock II', volumeNumber: 2, volumeLabel: 'II' },
    ] },
  { title: 'En la Onda', reason: 'Serie de Mucer Internacional/Juke Box de 1987 (JB-5003, JB-5005)',
    sources: ['https://sincopa.com/rock_pop/cdinfo_rock/compilations1/enlaonda_1987.htm', 'https://hippitoysuschatarritas.blogspot.com/2012/03/va-en-la-onda-de-los-60-mucer.html', 'https://hippitoysuschatarritas.blogspot.com/2014/05/va-en-la-onda-de-los-70-juke-box-jb.html'],
    members: [
      { id: 4669, title: 'En La Onda', volumeNumber: null, volumeLabel: null },
      { id: 5064, title: 'En la Onda de los 60', volumeNumber: null, volumeLabel: 'De los 60' },
      { id: 4921, title: 'En la Onda de los 70', volumeNumber: null, volumeLabel: 'De los 70' },
    ] },
  { title: 'Páramo Pictures', reason: 'Tres EP colectivos de Los Andes Electrónicos, junio de 2003 (LAE001–LAE003)', sources: [],
    members: [
      { id: 655, title: 'Páramo Pictures "Vida"', volumeNumber: null, volumeLabel: '«Vida»' },
      { id: 630, title: 'Páramo Pictures "Alma"', volumeNumber: null, volumeLabel: '«Alma»' },
      { id: 654, title: 'Páramo Pictures "Sentido"', volumeNumber: null, volumeLabel: '«Sentido»' },
    ] },
  { title: 'Experiencia Psicotomimética', reason: 'Primera (Teatro Caracas, 1968) y Segunda (Aula Magna UCV, 1969), sello Souvenir', sources: [],
    members: [
      { id: 401, title: 'Viva Una Experiencia Psicotomimética', volumeNumber: null, volumeLabel: 'Primera' },
      { id: 395, title: 'Segunda Experiencia Psicotomimética', volumeNumber: null, volumeLabel: 'Segunda' },
    ] },
  { title: 'Gente en Ambiente', reason: 'Recopilatorios «Gente en Ambiente» de Raúl de Freitas (1967 y 1968); la reedición en CD de 2005 no es otra entrega',
    sources: ['https://hippitoysuschatarritas.blogspot.com/2012/07/va-gente-en-ambiente-pop-and-op-musical.html'],
    members: [
      { id: 579, title: 'Caracas 400 Gente En Ambiente', volumeNumber: null, volumeLabel: 'Caracas 400' },
      { id: 5038, title: 'Gente en Ambiente: Pop And Op Musical', volumeNumber: null, volumeLabel: 'Pop and Op Musical' },
    ] },
  { title: 'Escenario Juvenil', reason: 'Recopilatorios del premio Escenario Juvenil (Souvenir)',
    sources: ['https://sincopa.com/rock_pop/cdinfo_rock/compilations1/escenario_juvenil1.htm'],
    members: [
      { id: 4657, title: 'Escenario Juvenil', volumeNumber: null, volumeLabel: null },
      { id: 9989, title: 'Mario Tepedino Presenta: Escenario Juvenil Vol. 3', volumeNumber: 3, volumeLabel: 'Vol. 3' },
    ] },
  { title: 'Guaicaipuro de Oro', reason: 'Discos anuales del premio Guaicaipuro de Oro, FAVEDICA',
    sources: ['https://hippitoysuschatarritas.blogspot.com/2016/07/va-el-guiacaipuro-de-oro-1960-favedica.html', 'https://hippitoysuschatarritas.blogspot.com/2016/07/va-guaicaipuro-de-oro-1961-favedica-sn.html'],
    members: [
      { id: 41008, title: 'El Guiacaipuro de Oro 1960', volumeNumber: null, volumeLabel: '1960' },
      { id: 4844, title: 'Guaicaipuro de Oro 1961', volumeNumber: null, volumeLabel: '1961' },
    ] },
  { title: 'Los Campeones', reason: 'Vol. 1 y Vol. 2, Palacio de la Música', sources: [],
    members: [
      { id: 9976, title: 'Los Campeones Vol.1', volumeNumber: 1, volumeLabel: 'Vol. 1' },
      { id: 9977, title: 'Los Campeones Vol.2', volumeNumber: 2, volumeLabel: 'Vol. 2' },
    ] },
  { title: 'CD Manía — El Nacional', reason: 'Colección de CD del diario El Nacional, 1999',
    sources: ['https://sincopa.com/rock_pop/cdinfo_rock/compilations1/1999_lanuevacancionvzlana.htm'],
    members: [
      { id: 9980, title: 'CD Mania / Aquellos Años 60', volumeNumber: null, volumeLabel: 'Aquellos Años 60' },
      { id: 4680, title: 'La Nueva Canción Venezolana / CD Manía', volumeNumber: null, volumeLabel: 'La Nueva Canción Venezolana' },
    ] },
];
// Las ediciones del festival dejan «Fundación Nuevas Bandas» (144); allí quedan los demás discos de la Fundación.
const leaveFoundation = [586, 581, 583];

try {
  const result = await withOperatorRun({ name: 'series:solo-various-artists', operator: 'claude',
    note: 'Brian (2026-10-27): las series son solo de Various Artists; compilados con titular ficticio pasan a Various Artists',
    params: { report: REPORT } }, async ctx => {
    const reattributed = [];
    for (const group of reattribute) for (const id of group.ids) {
      const current = (await ctx.client.query('SELECT artist_id::int FROM public.albums WHERE id=$1', [id])).rows[0];
      if (current?.artist_id !== group.from) throw new Error(`Ficha ${id} ya no es del artista ${group.from}`);
      await updateEntity({ ...ctx, note: `serie de Various Artists — ${group.evidence}` }, 'album', id, {}, { parentId: VARIOUS_ARTISTS_ID });
      reattributed.push(id);
    }
    await ctx.client.query('UPDATE ingest.series SET artist_id=$2 WHERE id = ANY($1::bigint[])', [seriesOwner, VARIOUS_ARTISTS_ID]);
    const removed = await ctx.client.query('DELETE FROM ingest.series_albums WHERE series_id=144 AND album_id = ANY($1::bigint[])', [leaveFoundation]);
    const created = [];
    for (const item of newSeries) {
      for (const member of item.members) {
        const row = (await ctx.client.query('SELECT title, artist_id::int FROM ingest.catalog_albums WHERE id=$1', [member.id])).rows[0];
        if (!row || row.title !== member.title || row.artist_id !== VARIOUS_ARTISTS_ID) throw new Error(`Ficha ${member.id} cambió o no es de Various Artists`);
      }
      if ((await ctx.client.query('SELECT 1 FROM ingest.series WHERE title=$1', [item.title])).rowCount) throw new Error(`La serie «${item.title}» ya existe`);
      const notes = JSON.stringify({ reason: item.reason, sourceUrls: item.sources, report: REPORT });
      const id = (await ctx.client.query(`INSERT INTO ingest.series(title,artist_id,source,notes,run_id) VALUES($1,$2,'series-va-2026-10-27',$3,$4) RETURNING id::int`,
        [item.title, VARIOUS_ARTISTS_ID, notes, ctx.runId])).rows[0].id;
      for (const member of item.members) await ctx.client.query(
        'INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label,run_id) VALUES($1,$2,$3,$4,$5)',
        [id, member.id, member.volumeNumber, member.volumeLabel, ctx.runId]);
      created.push({ id, title: item.title, members: item.members.length });
    }
    return { reattributed, removedFromFoundation: removed.rowCount, created };
  }, { rollbackOnly: !confirm });
  writeFileSync(`${out}/apply-${confirm ? 'applied' : 'dry-run'}.json`, JSON.stringify({ confirmed: confirm, ...result }, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: result.runId, ...result.result }, null, 1));
} finally { await closeDb(); }
