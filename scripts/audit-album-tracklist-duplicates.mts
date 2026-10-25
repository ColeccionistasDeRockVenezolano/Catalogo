// Solo lectura: ./scripts/with-node22.sh npx tsx scripts/audit-album-tracklist-duplicates.mts
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

interface Track { id: number; disc: number; position: number; title: string; duration: number | null }
interface Album {
  id: number; artistId: number; artist: string; title: string; year: number | null;
  type: string; format: string | null; catalog: string | null; notes: string | null;
  youtube: string | null; aliases: string[]; tracks: Track[];
}
const keys = new Map<string, string>();
const key = (s: string) => {
  let result = keys.get(s);
  if (result === undefined) {
    result = normalizeEntityName(s.replace(/\p{Cf}/gu, "")).compactSecondaryKey;
    keys.set(s, result);
  }
  return result;
};
const numericParts = (s: string) => JSON.stringify(s.match(/\d+/gu) ?? []);
const genericTrack = (title: string) => /^(?:untitled|sintitulo|track|pista|tema|cancion|intro|outro|\d+|[ivxlcdm]+)(?:\d+)?$/u.test(key(title));
const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
// Dice sobre bigramas con multiplicidad: solo propone variantes, nunca decide una fusión.
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) counts.set(a.slice(i, i + 2), (counts.get(a.slice(i, i + 2)) ?? 0) + 1);
  let common = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2); const n = counts.get(gram) ?? 0;
    if (n) { common++; counts.set(gram, n - 1); }
  }
  return 2 * common / (a.length + b.length - 2);
}
const version = (s: string) => {
  const text = normalizeEntityName(s).secondaryKey;
  return [
    /\b(instrumental|instrumentales)\b/u.test(text) ? "instrumental" : "",
    /\b(en vivo|live|directo)\b/u.test(text) ? "vivo" : "",
    /\b(acustico|acoustic|unplugged|desenchufado)\b/u.test(text) ? "acústico" : "",
    /\b(remix|remixes|remezcla)\b/u.test(text) ? "remix" : "",
    /\b(demo|demos)\b/u.test(text) ? "demo" : "",
    /\b(regrabado|re recorded|rerecorded)\b/u.test(text) ? "regrabación" : "",
    /\b(deluxe|expanded|remaster|remastered|remasterizado|reedicion|anniversary|aniversario)\b/u.test(text) ? "edición" : "",
  ].filter(Boolean).join(",");
};
// Emparejamiento máximo uno a uno: preserva canciones repetidas y evita contar dos veces una pista.
function matchTracks(a: Track[], b: Track[], fuzzy: boolean) {
  const ak = a.map(t => key(t.title)); const bk = b.map(t => key(t.title));
  const edges = ak.map((x, i) => bk.flatMap((y, j) => {
    if (!x || !y) return [];
    const exact = x === y;
    return exact || (fuzzy && numericParts(x) === numericParts(y)
      && version(a[i]!.title) === version(b[j]!.title) && similarity(x, y) >= 0.88) ? [j] : [];
  }).sort((x, y) => Number(ak[i] !== bk[x]) - Number(ak[i] !== bk[y])));
  const right = new Map<number, number>();
  const visit = (i: number, seen: Set<number>): boolean => {
    for (const j of edges[i]!) {
      if (seen.has(j)) continue;
      seen.add(j);
      const previous = right.get(j);
      if (previous === undefined || visit(previous, seen)) { right.set(j, i); return true; }
    }
    return false;
  };
  for (let i = 0; i < a.length; i++) visit(i, new Set());
  return [...right].map(([j, i]) => ({ a: a[i]!, b: b[j]!, normalizedEqual: ak[i] === bk[j] }))
    .sort((x, y) => x.a.disc - y.a.disc || x.a.position - y.a.position);
}

const out = process.argv.find(s => s.startsWith("--out="))?.slice(6) ?? "reports/discos-tracklist-2026-10-15";
const pool = getPool();
const client = await pool.connect();
let albums: Album[]; let distinct: Map<string, string>; let snapshotAt: string;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");
  snapshotAt = (await client.query<{ at: string }>("SELECT transaction_timestamp()::text at")).rows[0]!.at;
  albums = (await client.query<Album>(`
    SELECT a.id::int, a.artist_id::int "artistId", ar.name artist, a.title, a.release_year AS "year",
           a.album_type::text type, a.media_format format, a.catalog_id catalog, a.notes,
           a.youtube_url youtube, '[]'::json aliases, '[]'::json tracks
      FROM public.albums a JOIN public.artists ar ON ar.id=a.artist_id ORDER BY a.id`)).rows;
  const byId = new Map(albums.map(a => [a.id, a]));
  for (const t of (await client.query<Track & { album: number }>(`
    SELECT id::int, album_id::int album, disc_number disc, track_number position, title, duration_seconds duration
      FROM public.tracks ORDER BY album_id, disc_number, track_number`)).rows) byId.get(t.album)!.tracks.push(t);
  for (const row of (await client.query<{ album: number; alias: string }>("SELECT album_id::int album, alias FROM ingest.album_aliases")).rows) byId.get(row.album)?.aliases.push(row.alias);
  distinct = new Map((await client.query<{ a: number; b: number; note: string }>(
    "SELECT a_id::int a, b_id::int b, note FROM ingest.curation_distinct_pairs WHERE kind='album'"
  )).rows.map(r => [pairKey(r.a, r.b), r.note]));
  await client.query("ROLLBACK");
} finally { client.release(); await closeDb(); }

const byArtist = new Map<number, Album[]>();
const signatureGroups = new Map<string, Album[]>();
for (const a of albums) {
  (byArtist.get(a.artistId) ?? byArtist.set(a.artistId, []).get(a.artistId)!).push(a);
  if (a.tracks.length >= 2 && a.tracks.every(t => key(t.title))) {
    const signature = JSON.stringify(a.tracks.map(t => key(t.title)).sort());
    (signatureGroups.get(signature) ?? signatureGroups.set(signature, []).get(signature)!).push(a);
  }
}
const candidates = new Map<string, [Album, Album]>();
let sameArtistPairs = 0;
for (const list of byArtist.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  sameArtistPairs++;
  const a = list[i]!; const b = list[j]!;
  const ka = key(a.title); const kb = key(b.title);
  const sameCount = a.tracks.length > 0 && a.tracks.length === b.tracks.length;
  const aliasMatch = a.aliases.some(s => key(s) === kb) || b.aliases.some(s => key(s) === ka);
  const related = ka === kb || aliasMatch || similarity(ka, kb) >= 0.8
    || (Math.min(ka.length, kb.length) >= 5 && (ka.startsWith(kb) || kb.startsWith(ka)));
  if (related || (sameCount && a.tracks.length >= 2 && matchTracks(a.tracks, b.tracks, false).length / a.tracks.length >= 0.7)) {
    candidates.set(pairKey(a.id, b.id), [a, b]);
  }
}
for (const list of signatureGroups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const a = list[i]!; const b = list[j]!;
  candidates.set(pairKey(a.id, b.id), [a, b]);
}
const results = [...candidates.values()].map(([a, b]) => {
  const exact = matchTracks(a.tracks, b.tracks, false);
  const matches = matchTracks(a.tracks, b.tracks, true);
  const sameCount = a.tracks.length > 0 && a.tracks.length === b.tracks.length;
  const fullExact = sameCount && exact.length === a.tracks.length;
  const fullFuzzy = sameCount && matches.length === a.tracks.length;
  const genericOnly = a.tracks.length > 0 && b.tracks.length > 0
    && [...a.tracks, ...b.tracks].every(t => genericTrack(t.title));
  const samePositions = fullExact && a.tracks.every((t, i) => {
    const other = b.tracks[i]!;
    return t.disc === other.disc && t.position === other.position && key(t.title) === key(other.title);
  });
  const durationConflicts = matches.filter(m => m.a.duration !== null && m.b.duration !== null
    && Math.abs(m.a.duration - m.b.duration) > Math.max(5, Math.min(m.a.duration, m.b.duration) * 0.03));
  const warnings: string[] = [];
  const prior = distinct.get(pairKey(a.id, b.id));
  if (prior) warnings.push(`Decisión previa: ${prior}`);
  if (genericOnly) warnings.push("Solo títulos genéricos: no permiten identificar el repertorio");
  if (a.artistId !== b.artistId) warnings.push("Artistas distintos: verificar atribución o colaboración");
  if (a.year !== null && b.year !== null && a.year !== b.year) warnings.push(`Años distintos: ${a.year}/${b.year}`);
  if (a.year === null || b.year === null) warnings.push("Falta año en una o ambas fichas");
  if (a.type !== b.type) warnings.push(`Tipos distintos: ${a.type}/${b.type}`);
  if (version(a.title) !== version(b.title)) warnings.push(`Versiones o ediciones distintas en el título: ${version(a.title) || 'sin marca'}/${version(b.title) || 'sin marca'}`);
  if (a.format && b.format && a.format !== b.format) warnings.push(`Formatos distintos: ${a.format}/${b.format}`);
  if (a.catalog && b.catalog && a.catalog !== b.catalog) warnings.push(`Números de catálogo distintos: ${a.catalog}/${b.catalog}`);
  if (durationConflicts.length) warnings.push(`${durationConflicts.length} duraciones incompatibles (más de 5 s y 3 %)`);
  if (fullExact && !samePositions) warnings.push("Mismas canciones con distinto orden o numeración de discos/pistas");
  if (sameCount && a.tracks.length === 1) warnings.push("Solo una pista: evidencia insuficiente para confirmar duplicación");
  const sameTitle = key(a.title) === key(b.title);
  let category: string;
  if (prior) category = "decision_previa_distintos";
  else if (!a.tracks.length || !b.tracks.length) category = "sin_tracklist_comparable";
  else if (genericOnly) category = "pistas_genericas_sin_evidencia";
  else if (fullExact && samePositions && warnings.length === 0 && a.tracks.length >= 2 && a.artistId === b.artistId) category = "coincidencia_fuerte";
  else if (fullExact) category = "tracklist_igual_revisar_contexto";
  else if (fullFuzzy) category = "tracklist_con_variantes";
  else if (matches.length / Math.max(a.tracks.length, b.tracks.length) >= 0.7) category = "coincidencia_parcial";
  else category = "titulo_parecido_pistas_distintas";
  return {
    pair: pairKey(a.id, b.id), category, sameTitle, titleSimilarity: similarity(key(a.title), key(b.title)),
    sameCount, exactMatches: exact.length, variantMatches: matches.length, samePositions, genericOnly,
    warnings, albums: [a, b], matches,
    unmatchedA: a.tracks.filter(t => !matches.some(m => m.a.id === t.id)),
    unmatchedB: b.tracks.filter(t => !matches.some(m => m.b.id === t.id)),
  };
});
const categories = ["coincidencia_fuerte", "tracklist_igual_revisar_contexto", "tracklist_con_variantes", "coincidencia_parcial", "sin_tracklist_comparable", "pistas_genericas_sin_evidencia", "titulo_parecido_pistas_distintas", "decision_previa_distintos"];
results.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category)
  || b.exactMatches - a.exactMatches || a.albums[0]!.artist.localeCompare(b.albums[0]!.artist, 'es'));
const counts = Object.fromEntries(categories.map(c => [c, results.filter(r => r.category === c).length]));
const summary = {
  snapshotAt, albums: albums.length, tracks: albums.reduce((n, a) => n + a.tracks.length, 0),
  sameArtistPairs, evaluatedPairs: results.length, counts,
  equalNonemptyCount: results.filter(r => r.sameCount).length,
  exactFullTracklist: results.filter(r => r.sameCount && !r.genericOnly && r.exactMatches === r.albums[0]!.tracks.length).length,
  crossArtistExact: results.filter(r => r.sameCount && !r.genericOnly && r.exactMatches === r.albums[0]!.tracks.length && r.albums[0]!.artistId !== r.albums[1]!.artistId).length,
  databaseWrites: 0,
};
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/evaluacion.json`, JSON.stringify({ summary, results }, null, 2) + "\n");
const esc = (s: string) => s.replace(/\|/gu, "\\|").replace(/\s+/gu, " ");
const lines = [
  "# Evaluación de discos por título y tracklist", "", `Instantánea de la base: ${snapshotAt}.`, "",
  `Se revisaron ${summary.albums} discos y ${summary.tracks} pistas; ${sameArtistPairs} pares dentro de cada artista. Se evaluaron ${results.length} pares candidatos. No se escribió en la base ni se fusionaron fichas.`, "",
  "## Criterios", "",
  "Se comparan títulos actuales y alias; se normalizan mayúsculas, tildes, espacios y signos. Se conserva la multiplicidad de canciones repetidas. Las coincidencias exactas de repertorio también se buscan entre títulos totalmente diferentes y artistas distintos (mínimo dos pistas). Se distingue el orden y la posición en cada disco. Una misma cantidad de pistas nunca confirma identidad.", "",
  "Los títulos parecidos (Dice ≥0,80, prefijo de al menos cinco caracteres o alias) se revisan incluso con cantidades distintas o sin pistas. También se revisan pares del mismo artista con igual cantidad (mínimo dos pistas) y ≥70 % de títulos normalizados idénticos. Para variantes de canción se exige Dice ≥0,88, los mismos números y la misma marca de versión; esos emparejamientos son propuestas, no equivalencias confirmadas. No se eliminan palabras como live, remix o instrumental. Se ignoran los caracteres Unicode invisibles de formato. Las listas que solo contienen nombres genéricos (untitled, números, etc.) se clasifican aparte y no prueban repertorio común.", "",
  "Coincidencia fuerte significa mismo artista, canciones y posiciones iguales, al menos dos pistas y ausencia de alertas en los metadatos comparados. No confirma que sean la misma edición o grabación. Las decisiones anteriores de mantener separados se conservan. Para resolver los casos pendientes hace falta cotejar las fuentes y las grabaciones; esta auditoría compara datos del catálogo, sin verificación web.", "",
  "## Resumen", "", "| Categoría | Pares |", "|---|---:|",
  ...categories.map(c => `| ${c} | ${counts[c]} |`), "",
  `Tracklist completo idéntico tras normalización, excluyendo listas solo genéricas: ${summary.exactFullTracklist} pares (incluye decisiones previas y cambios de orden). De ellos, ${summary.crossArtistExact} tienen distintos identificadores de artista.`, "",
];
for (const category of categories) {
  lines.push(`## ${category}`, "", "| Artista | Fichas: título (año) | Pistas A/B | Coincidencias exactas / con variantes | Alertas |", "|---|---|---:|---:|---|");
  for (const r of results.filter(r => r.category === category)) {
    const [a, b] = r.albums as [Album, Album];
    lines.push(`| ${esc(a.artistId === b.artistId ? a.artist : `${a.artist} (#${a.artistId}) / ${b.artist} (#${b.artistId})`)} | ${a.id}: ${esc(a.title)} (${a.year ?? '?'}) ↔ ${b.id}: ${esc(b.title)} (${b.year ?? '?'}) | ${a.tracks.length}/${b.tracks.length} | ${r.exactMatches}/${r.variantMatches} | ${esc(r.warnings.join('; ') || 'Sin alertas en los campos comparados')} |`);
  }
  lines.push("");
}
lines.push("El JSON adjunto incluye los tracklists completos, el emparejamiento uno a uno, las canciones sin pareja, años, formatos, catálogos, notas, alias y enlaces de YouTube para cada caso.", "");
writeFileSync(`${out}/evaluacion.md`, lines.join("\n"));
const strong = results.filter(r => r.category === "coincidencia_fuerte");
const short = [
  "# Posibles duplicados de discos: evaluación prioritaria", "",
  `Base analizada: ${snapshotAt}. ${summary.albums} discos y ${summary.tracks} pistas.`, "",
  `Hay **${strong.length} pares prioritarios** con el mismo artista, año, canciones y posiciones, sin conflictos detectados en los metadatos comparados. Recomiendo cotejar primero estos pares para una posible consolidación, conservando los títulos alternativos como alias. Son candidatos del catálogo, no fusiones aprobadas ni identidades de edición confirmadas.`, "",
  `Otros **${counts['tracklist_con_variantes']} pares** tienen igual cantidad y todas las pistas emparejables al admitir pequeñas variantes de escritura. **${counts['tracklist_igual_revisar_contexto']} pares** tienen los mismos títulos de pistas, pero alertas de año, tipo, duración, orden, atribución o escasez de evidencia. Requieren resolver esas diferencias antes de recomendar una fusión.`, "",
  "## Pares prioritarios", "", "| Artista | IDs | Títulos | Año | Pistas idénticas |", "|---|---|---|---:|---:|",
  ...strong.map(r => { const [a, b] = r.albums as [Album, Album]; return `| ${esc(a.artist)} | ${r.pair} | ${esc(a.title)} ↔ ${esc(b.title)} | ${a.year} | ${a.tracks.length}/${b.tracks.length} |`; }), "",
  "## Hallazgos que cambian la decisión", "",
  "- Lvctvs (5312/28730) y Sphingomyelinase (5383/28768): los títulos parecen iguales a simple vista; una ficha contiene caracteres invisibles. El repertorio, el orden y el año coinciden.",
  "- Floria Márquez (7075/7077): las 16 canciones coinciden, pero los años son 1993/1998 y una ficha se titula «En Vivo». Verificar grabación y edición antes de consolidar.",
  "- José Luis Rodríguez (14495/14520): coinciden 20 títulos de canciones, pero cinco duraciones difieren de forma relevante. La igualdad de nombres no confirma la misma grabación.",
  `- ${summary.crossArtistExact} pares con repertorio completo idéntico están bajo distintos IDs de artista. Revisar primero la atribución: puede haber una colaboración, nombre alternativo, proyecto distinto o dos fichas del artista.`,
  `- ${counts['pistas_genericas_sin_evidencia']} pares solo tienen nombres de pistas genéricos: la coincidencia carece de valor identificador.`,
  `- ${counts['decision_previa_distintos']} pares candidatos ya estaban declarados distintos; esa decisión se conserva.`, "",
  "## Evidencia y límites", "",
  "La misma cantidad de pistas solo sirve como filtro. La evaluación compara cada canción una a una y conserva repeticiones, posiciones y diferencias de versión. No hubo consultas web ni cambios en la base. El informe completo está en evaluacion.md y el detalle verificable, incluidos ambos tracklists y las pistas sin pareja, en evaluacion.json.", "",
];
writeFileSync(`${out}/resumen.md`, short.join("\n"));
console.log(JSON.stringify(summary, null, 2));
