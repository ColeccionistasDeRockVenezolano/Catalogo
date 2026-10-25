// CRV · Veredictos de Brian (2026-10-24, artifact «veredictos») sobre los 16 hallazgos de los perfiles por API
// (Apache, Témpano, Zeta, Jeremías, Salomón) más el disco de Hermes. Las dudas abiertas se resolvieron con
// las fuentes (2026-10-25): ver la nota de cada bloque. Todo en un run del operador (diario → `runs undo`).
//
//   ./scripts/with-node22.sh npx tsx scripts/veredictos-hallazgos-api-2026-10-25.mts            # ensayo (rollback)
//   ./scripts/with-node22.sh npx tsx scripts/veredictos-hallazgos-api-2026-10-25.mts --confirm
import { closeDb } from "../src/db/client.js";
import { createEntity, createRelation, deleteEntity, updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const confirm = process.argv.includes("--confirm");
const NOTE = "Veredictos de Brian 2026-10-24 sobre los hallazgos de perfiles por API (Discogs, MusicBrainz, Deezer, iTunes)";
const log: string[] = [];

// ── Años ──────────────────────────────────────────────────────────────────
// Atabal–Yémal (361) se queda en 1979: lo dice la hoja YT Master (grabado en nov.–dic. de 1979; la primera
// tirada de Discogs/MusicBrainz es de 1980).
const YEARS: Array<[number, number, string]> = [
  [3019, 2010, "Lo Necesario: MusicBrainz e iTunes 2010 (Deezer 2016 es la subida digital)"],
  [27681, 2002, "Jeremías: edición original de 2002 (MusicBrainz, Discogs/Sonográfica)"],
  [3281, 1995, "Lo Mejor de Témpano: Discogs 1068820 (Columbia, © y ℗ 1995), mismas 15 pistas"],
];

// ── Títulos de pista ──────────────────────────────────────────────────────
const RETITLES: Array<[number, string, string]> = [
  [10219, "Failing Senses", "Selective Memory: MusicBrainz, Deezer e iTunes"],
  [10234, "A Farewell to Seasons", "Selective Memory: MusicBrainz, Deezer e iTunes (Discogs: «A Farewell To The Seasons»)"],
  [205225, "Los Altos de Santa Fe (feat. Sen Morimoto)", "Mochima: errata «Sante Fe»"],
  [36757, "The Moustache", "Haedo: Deezer e iTunes (MusicBrainz: «The Moustache: Act I»)"],
  [36763, "Get Married with the Pathfinder", "Haedo: Deezer e iTunes"],
];
const TRACK_ALIASES: Array<[number, string]> = [[10234, "A Farewell To The Seasons"]];

// ── Pistas nuevas: [título, duración en segundos, nota] ──────────────────
type NewTrack = [string, number | null, string?];
const JEREMIAS: NewTrack[] = [
  ["Poco A Poco", 263], ["Desde El Bar", 258], ["Tú En Mí", 230], ["Lo Que Yo Quiero", 234], ["Corazón Sin Freno", 239],
  ["Dormida", 271], ["La Cita", 231], ["Cómo Quieres Que Te Diga", 270], ["Porque Me Duele", 220], ["Arriba Mamita", 200],
];
const GRAN_CIRCO: NewTrack[] = [
  ["Un Día Más en el Gran Circo", 187], ["Juan de Afuera", 215], ["El Simple Juego del Amor", 244], ["Hasta el Próximo Invierno", 196],
  ["Este Tiempo Que Se Fue", 201], ["El Seductor", 174], ["Nada Fuera de Control", 174], ["Yo No Busco Nada Más", 190],
  ["Promesa de Amor", 234], ["Comienzo del Final", 265], ["Aire de Abril", 267], ["De Regreso a la Soledad", 203], ["Tu", 238],
  ["Un Día Más en el Gran Circo (Reprise)", 86], ["Tu (Alternative Version)", 232], ["Tu (Salsa Version)", 255],
];
// MusicBrainz trae las 13 de la edición original, «Uno y uno es igual a tres» incluida; la versión acústica
// es la pista extra de la edición digital «Bonus Track Version» (iTunes).
const ESE_QUE_VA: NewTrack[] = [
  ["Uno y Uno Es Igual a Tres", 234], ["Dime", 164], ["Yo Sólo Sé Que Sólo No Sé Nada", 253], ["Ese Que Va por Ahí", 241],
  ["Mientras Tanto", 234], ["Ahora", 213], ["Sin Despedirte", 196], ["Tiempo", 279], ["Demonios", 192], ["Igual Que Ayer", 183],
  ["Hay un Amor Afuera", 205], ["Desde Mi Balcón", 270], ["Yo Sólo Sé Que Sólo No Sé Nada (Radio Edit)", 241],
  ["Yo Sólo Sé Que Sólo No Sé Nada (Acoustic Version)", null, "Pista extra de la edición digital «Bonus Track Version» (iTunes)"],
];
const HAEDO: NewTrack[] = [["Vultures", 299], ["Worship", 155], ["Mel and Colin", 221], ["Constanza", 214], ["Ramen", 489], ["Plusvalida", 395]];

// 30 Grandes Éxitos de Oro (4531): recopilación compartida Témpano/Pentágono, Discogs 2102541 (Sony, 2001).
// [disco, pista, título, duración, intérprete si no es Témpano]
const PENTAGONO = "Pentágono", POSTER = "Poster";
const EXITOS: Array<[number, number, string, number, string | null]> = [
  [1, 1, "Linda (Linda De Mais)", 213, PENTAGONO], [1, 2, "Lobo Hombre En Paris", 229, null],
  [1, 3, "Te Extraño (Mi Manchi)", 195, PENTAGONO], [1, 4, "Amo Y Esclavo", 245, null],
  [1, 5, "Lluvia De Plata (Chuva De Prata)", 145, PENTAGONO], [1, 6, "No, Esta Noche No", 246, null],
  [1, 7, "Vuelve A Mi (Volta Pra Min)", 247, PENTAGONO], [1, 8, "Tengo Edad", 237, null],
  [1, 9, "Hotel California", 329, PENTAGONO], [1, 10, "Dame Solo Un Minuto", 266, null],
  [1, 11, "Amo (Lo Amo)", 222, PENTAGONO], [1, 12, "Drama", 198, null],
  [1, 13, "Tu Y Yo (Entre Nos)", 259, PENTAGONO], [1, 14, "Hablame", 258, null],
  [1, 15, "Aguanta Corazon (Aguenta Coracao)", 284, PENTAGONO],
  [2, 1, "Tardes En Tokyo", 216, null], [2, 2, "Vicio", 232, PENTAGONO], [2, 3, "Tontas Canciones De Amor", 185, null],
  [2, 4, "Sueños (This Dream)", 222, PENTAGONO], [2, 5, "Dame Una Noche", 211, null], [2, 6, "Lolita", 195, PENTAGONO],
  [2, 7, "Cada Vez", 232, null], [2, 8, "Y Que Del Amor (What About Love)", 250, PENTAGONO], [2, 9, "No Te Alejes Mas", 257, POSTER],
  [2, 10, "Ni Un Toque (Nem Um Toque)", 262, PENTAGONO], [2, 11, "El Hombre Del Piano", 300, null],
  [2, 12, "Soledad (Solidao)", 208, PENTAGONO], [2, 13, "Ganas De Llorar", 215, null], [2, 14, "Dueña (Dona)", 215, PENTAGONO],
  [2, 15, "Que Nos Paso", 210, null],
];
const EXITOS_EXISTING: Record<string, number> = { "1-1": 35076, "1-2": 35081 };
const POSTER_ARTIST = 199;

// ── Utilidades ────────────────────────────────────────────────────────────
async function addTrackAlias(context: OperatorContext, trackId: number, alias: string) {
  const done = await context.client.query(`INSERT INTO ingest.track_aliases(track_id,alias,alias_type,normalized_alias,is_primary,confidence,notes)
    SELECT $1::bigint,$2::text,'alternate_title',$3::text,false,'high',$4::text
     WHERE NOT EXISTS (SELECT 1 FROM ingest.track_aliases WHERE track_id=$1::bigint AND alias=$2::text)`,
  [trackId, alias, normalizeEntityName(alias).primaryKey, NOTE]);
  if (done.rowCount) log.push(`pista ${trackId}: alias «${alias}»`);
}
async function trackCount(context: OperatorContext, albumId: number) {
  return Number((await context.client.query<{ n: string }>("SELECT count(*) n FROM public.tracks WHERE album_id=$1", [albumId])).rows[0]!.n);
}
async function addTracks(context: OperatorContext, albumId: number, tracks: NewTrack[], firstNumber: number) {
  for (const [index, [title, seconds, notes]] of tracks.entries()) {
    await createEntity(context, "track", {
      title, track_number: firstNumber + index, ...(seconds ? { duration_seconds: seconds } : {}), ...(notes ? { notes } : {}),
    }, { albumId, allowSimilar: true });
  }
  log.push(`disco ${albumId}: +${tracks.length} pistas`);
}
async function expectEmpty(context: OperatorContext, albumId: number) {
  const n = await trackCount(context, albumId);
  if (n) throw new Error(`disco ${albumId} ya tiene ${n} pistas: revisar antes de añadir`);
}

// ── Ejecución ─────────────────────────────────────────────────────────────
const { runId } = await withOperatorRun({ name: "curation:veredictos-hallazgos-api-2026-10-25", operator: "claude-code", note: NOTE }, async (context) => {
  await context.client.query("SELECT set_config('crv.run_id',$1,true)", [String(context.runId)]);

  for (const [id, year, why] of YEARS) {
    await updateEntity(context, "album", id, { release_year: year });
    log.push(`disco ${id}: año ${year} (${why})`);
  }

  for (const [id, title, why] of RETITLES) {
    await updateEntity(context, "track", id, { title });
    log.push(`pista ${id}: «${title}» (${why})`);
  }
  for (const [id, alias] of TRACK_ALIASES) await addTrackAlias(context, id, alias);

  // Selective Memory (1268): la pista 12 era una copia de «A Farewell…» (Sincopa la numera 5 en otra edición);
  // la 12 real es «El Gran Inquisidor» (Discogs 6271352, MusicBrainz).
  await deleteEntity(context, "track", 155388);
  log.push("pista 155388 (copia de «A Farewell To The Seasons» en la posición 12) retirada");
  await createEntity(context, "track", { title: "El Gran Inquisidor", track_number: 12, duration_seconds: 597 }, { albumId: 1268, allowSimilar: true });
  await addTrackAlias(context, Number((await context.client.query<{ id: string }>(
    "SELECT id::text FROM public.tracks WHERE album_id=1268 AND track_number=12")).rows[0]!.id), "El Grand Inquisodor");
  log.push("disco 1268: pista 12 «El Gran Inquisidor»");

  // 30 Grandes Éxitos de Oro (4531): las 2 pistas existentes se corrigen y se añaden las otras 28.
  for (const [disc, number, title, seconds, performer] of EXITOS) {
    const notes = performer ? `Intérprete: ${performer} (Discogs 2102541)` : undefined;
    const existing = EXITOS_EXISTING[`${disc}-${number}`];
    let trackId: number;
    if (existing) {
      await updateEntity(context, "track", existing, { title, duration_seconds: seconds, ...(notes ? { notes } : {}) });
      trackId = existing;
    } else {
      trackId = (await createEntity(context, "track", { title, track_number: number, disc_number: disc, duration_seconds: seconds, ...(notes ? { notes } : {}) },
        { albumId: 4531, allowSimilar: true })).id;
    }
    if (performer === POSTER) await createRelation(context, "track_credit", { trackId, artistId: POSTER_ARTIST }, { credit_type: "musician", credit_role: "Intérprete" });
  }
  await updateEntity(context, "album", 4531, { title: "30 Grandes Éxitos de Oro" });
  log.push("disco 4531: 30 pistas en 2 CD (2 corregidas, 28 nuevas); Pentágono en notas, Poster acreditado");

  // Haedo (3203): las 2 existentes ya corregidas arriba; faltan 6.
  if (await trackCount(context, 3203) !== 2) throw new Error("Haedo ya no tiene 2 pistas");
  await addTracks(context, 3203, HAEDO, 3);

  // Jeremías
  await expectEmpty(context, 27681); await addTracks(context, 27681, JEREMIAS, 1);
  await expectEmpty(context, 27694); await addTracks(context, 27694, GRAN_CIRCO, 1);
  await expectEmpty(context, 27692); await addTracks(context, 27692, ESE_QUE_VA, 1);
  const unoYUno = Number((await context.client.query<{ id: string }>("SELECT id::text FROM public.tracks WHERE album_id=27692 AND track_number=1")).rows[0]!.id);
  await addTrackAlias(context, unoYUno, "Uno y Uno Igual a Tres");
  // Sello: la ficha ya decía «Universal»; las fuentes precisan Universal Music Latino.
  const latino = await createEntity(context, "organization", { name: "Universal Music Latino", organization_type: "record_label" }, { allowSimilar: true });
  await updateEntity(context, "album", 27692, { label_id: latino.id });
  log.push(`disco 27692: sello Universal Music Latino (organización nueva ${latino.id})`);

  // Salomón: «El Final» es la pista 11 en Deezer e iTunes; el año 2009 se queda.
  if (await trackCount(context, 2005) !== 10) throw new Error("«1986» ya no tiene 10 pistas");
  await addTracks(context, 2005, [["El Final", null, "Pista 11 en la edición digital de 2016 (Deezer e iTunes)"]], 11);
  const deezer = await context.client.query(`UPDATE public.streaming_links SET verified=false,
      notes=notes || ' · sin verificar (2026-10-25): el perfil mezcla discos de varios Salomon homónimos'
    WHERE id=10657 AND artist_id=467 AND platform='deezer' AND verified`);
  log.push(`Salomón: enlace de artista Deezer 1097751 ${deezer.rowCount ? "sin verificar" : "ya estaba sin verificar"}; el del disco «1986» se conserva`);

  // Apache (1681): «Funk Total: Bumbum na Nuca» es de Delano & Apache (Brasil), sin vínculo venezolano.
  for (const row of (await context.client.query<{ id: string }>("SELECT id::text FROM public.tracks WHERE album_id=30570")).rows) {
    await deleteEntity(context, "track", Number(row.id));
  }
  await context.client.query("DELETE FROM public.streaming_links WHERE album_id=30570");
  await deleteEntity(context, "album", 30570);
  log.push("disco 30570 «Funk Total: Bumbum na Nuca» (Delano & Apache) retirado de Apache");

  // Hermes (1961): Sincopa «Hermes y Los Solicitados · Sonográfica · Rock · 1989 (LP)»; el nombre se había partido.
  await updateEntity(context, "artist", 1961, { name: "Hermes y Los Solicitados" });
  await updateEntity(context, "album", 4218, { title: "Hermes y Los Solicitados", release_year: 1989, label_id: 4271, media_format: "Vinyl LP" });
  log.push("Hermes 1961 → «Hermes y Los Solicitados» (alias «Hermes»); disco 4218: título, 1989, Sonográfica, LP");
}, { rollbackOnly: !confirm });

console.log(log.join("\n"));
console.log(`\nrun ${runId}${confirm ? "" : " (ensayo: rollback)"}`);
await closeDb();
