// CRV · Correcciones de Brian (2026-10-14) a 14 bandas de los 60–70: años activos, integrantes con su rol y
// formación inicial, discos con sello y número de catálogo, sencillos con sus dos caras y duplicados evidentes.
// Todo en un run del operador (diario de cambios → `runs undo`).
//
//   ./scripts/with-node22.sh npx tsx scripts/correcciones-bandas-2026-10-14.mts            # ensayo (rollback)
//   ./scripts/with-node22.sh npx tsx scripts/correcciones-bandas-2026-10-14.mts --confirm
import { closeDb } from "../src/db/client.js";
import { instrumentsOf } from "../src/discography/instruments.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import {
  createEntity, createRelation, deleteRelation, updateEntity, updateRelation, withOperatorRun, type OperatorContext,
} from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";
import { mergeInto } from "../src/review/duplicates.js";

const confirm = process.argv.includes("--confirm");
const NOTE = "Correcciones de Brian 2026-10-14 (datos de bandas de los 60–70)";
const FOUNDER_SOURCE = "correcciones Brian 2026-10-14";
const log: string[] = [];

// ── Bandas ────────────────────────────────────────────────────────────────
const HOMER = 1965, LSD = 2248, MONEDAS = 144, L007 = 1479, CLANERS = 1593, DANGERS = 1474,
  DARTS = 1910, HIPPIES = 2074, KINGS = 1, SUPERSONICOS = 1775, LOVE = 245, TSEE = 2249, WORST = 3229;

const ARTISTS: Array<[number, Record<string, unknown>]> = [
  [HOMER, { years_active: "1965-1966", disbanded_year: 1966, status: "split_up" }],
  [LSD, { formed_year: 1969, years_active: "1969-1970", disbanded_year: 1970, status: "split_up" }],
  [MONEDAS, { formed_year: 1968, years_active: "1968-1981", disbanded_year: 1981, status: "split_up" }],
  [L007, { formed_year: 1965, years_active: "1965-1968, 1970, 1974, 1994-2014", disbanded_year: 2014, status: "split_up" }],
  [CLANERS, { years_active: "1965-1969", disbanded_year: 1969, status: "split_up" }],
  [DANGERS, { years_active: "1963-1966", disbanded_year: 1966, status: "split_up" }],
  [DARTS, { years_active: "1964-1968, 1970-1974", disbanded_year: 1974, status: "split_up" }],
  [HIPPIES, { years_active: "1966-1969", disbanded_year: 1969, status: "split_up" }],
  [KINGS, { formed_year: 1966, years_active: "1966-1967, 1969-1979", disbanded_year: 1979, status: "split_up" }],
  [SUPERSONICOS, { years_active: "1961-1963, 1964-1968", disbanded_year: 1968, status: "split_up" }],
  [LOVE, { years_active: "1968-1969", disbanded_year: 1969, status: "split_up" }],
  [TSEE, { formed_year: 1970, years_active: "1970-1971", disbanded_year: 1971, status: "split_up" }],
  [WORST, { years_active: "1968-1969 (as Worst), 1969", disbanded_year: 1969 }],
];

// ── Personas ──────────────────────────────────────────────────────────────
// Fusiones con proyecto común (regla de Brian): [conservar, absorber, motivo]
const PERSON_MERGES: Array<[number, number, string]> = [
  [5933, 18630, "Steve Shook = Stephen Shook (Homer & The Dont's, lista de Discogs)"],
  [602, 15454, "José María Arria «Chema» = José Manuel «Chema» Arria: bajista de Los Claners y Ladies W.C. con Adib Casta y Frank Rojas"],
  [629, 9696, "«Aumaitre», compositor en Los Darts de Etiqueta = Richard Aumaitre, bajista de Los Darts"],
];
// Nombre corregido (el anterior queda como alias).
const RENAMES: Array<[number, string]> = [
  [1929, "Walter Stephen Scott"], [4735, "Luis Emilio Mauri"], [325, "Jorge Chapellín"], [2371, "José Galparsoro"],
  [5202, "Carlos Martínez Montenegro"], [17448, "Leopoldo Bohórquez"], [2868, "Armando Veitía"],
  [15334, "José Alberto Nahón"], [1, "Aquiles Martínez Martino"], [2032, "Manolo Álvarez"],
];
const ALIASES: Array<[number, string, string]> = [
  [5202, "Carr Martin", "stage_name"], [5930, "APP", "nickname"], [5930, "George (APP) Wiltzee Jr", "source_variant"],
  [2370, "Pajarito", "nickname"], [3072, "Ender J. Parra", "name_variant"], [876, "José Ramón Salazar", "name_variant"],
  [2032, "Manolo Alvarez", "name_variant"], [2868, "Armando Veitia", "spelling_variant"],
];

// Personas nuevas (ninguna ficha existente con proyecto común). La clave se usa abajo.
const NEW_PERSONS: Record<string, string> = {
  bertomis: "Constantino Bertomis", suarez: "Germán Suárez", trigo: "Andrés Trigo", mdiaz: "Mario Díaz",
  cperez: "Carlos Pérez", atoro: "Ángel Toro", guzman: "Ernesto Guzmán", bermudez: "Néstor Bermúdez",
  vitela: "Tony Vitela", tdelarosa: "Tony De La Rosa", sposito: "Pasqual Sposito", villano: "Gustavo Villano",
  cortina: "José Vicente Cortina", fasano: "Carmelo Fasano", giambalvo: "Felipe Giambalvo",
  williams: "Glin Ford Williams", jjimenez: "Jesús Jiménez", rramos: "Ramón Ramos", grazy: "Grazy Fer",
  lmedina: "Luis Medina",
};

// ── Membresías ────────────────────────────────────────────────────────────
// Existentes: id de artist_members → campos (role, from_year, to_year) y fundador (true/false/undefined).
type MemberEdit = { role?: string; from_year?: number | null; to_year?: number | null; founder?: boolean };
const MEMBER_EDITS: Record<number, MemberEdit> = {
  // Homer & The Dont's (una sola formación)
  7874: { role: "voz y bajo", from_year: 1965, to_year: 1966, founder: true },
  7875: { role: "guitarra", from_year: 1965, to_year: 1966, founder: true },
  7876: { role: "guitarra líder", from_year: 1965, to_year: 1966, founder: true },
  7877: { role: "guitarra rítmica y voz", from_year: 1965, to_year: 1966, founder: true },
  // LSD
  8231: { role: "guitarra", from_year: 1969, to_year: 1970, founder: true },
  8232: { role: "bajo", from_year: 1969, to_year: 1970, founder: true },
  8233: { role: "batería", from_year: 1969, to_year: 1970, founder: true },
  // Los 007: primera formación y posteriores
  1109: { role: "batería", from_year: 1965, founder: true },
  1119: { role: "voz líder", from_year: 1965, founder: true },
  1118: { role: "guitarra líder", from_year: 1965, founder: true },
  1108: { role: "segunda guitarra y bajo", from_year: 1965, founder: true },
  1111: { role: "segunda guitarra", founder: false },
  1117: { role: "voz líder", founder: false },
  1110: { role: "bajo y coros", founder: false },
  // Los Claners
  577: { role: "segunda guitarra y voz líder", from_year: 1965, founder: true },
  589: { role: "guitarra líder y voz", from_year: 1965, founder: true },
  578: { role: "batería y voz", from_year: 1965, founder: true },
  583: { role: "bajo", from_year: 1965, founder: true },
  579: { role: "bajo", founder: false },
  584: { role: "batería", founder: false },
  // Los Darts
  644: { role: "segunda guitarra, arreglista y coros", from_year: 1964, founder: true },
  639: { role: "bajo y coros", from_year: 1964, founder: true },
  640: { role: "batería", from_year: 1964, founder: true },
  638: { role: "guitarra líder", from_year: 1964, founder: true },
  642: { role: "teclados", from_year: 1964, founder: true },
  641: { role: "voz líder", from_year: 1964, founder: true },
  67: { role: "batería", founder: false },
  643: { role: "bajo y coros", founder: false },
  // Los Hippies
  7968: { role: "guitarra y voz", from_year: 1966, to_year: 1969, founder: true },
  7970: { role: "batería", from_year: 1966, to_year: 1969, founder: true },
  7967: { role: "voz", from_year: 1966, to_year: 1969, founder: true },
  7969: { role: "bajo", from_year: 1966, to_year: 1969, founder: true },
  // Los Kings: Nucho Bellomo es de la primera formación (1966)
  6: { from_year: 1966, founder: true },
  // Los Supersónicos (la primera formación se desconoce: no se marcan fundadores)
  103: { role: "guitarra líder" }, 108: { role: "guitarra rítmica" }, 105: { role: "bajo" },
  107: { role: "batería" }, 104: { role: "voz" }, 102: { role: "voz" },
  106: { role: "teclados", from_year: null, founder: false },
  // The Love Depression
  5270: { role: "guitarra, piano, órgano, armónica y coros", from_year: 1968, to_year: 1969, founder: true },
  5271: { role: "batería y voz líder", from_year: 1968, to_year: 1969, founder: true },
  5272: { role: "bajo y coros", from_year: 1968, to_year: 1969, founder: true },
  9148: { role: "guitarra, órgano y coros", from_year: 1968, to_year: 1969, founder: true },
  // Tsee Mud
  8234: { role: "guitarra", from_year: 1970, to_year: 1971, founder: true },
  8235: { role: "bajo", from_year: 1970, to_year: 1971, founder: true },
  8236: { role: "batería", from_year: 1970, founder: true },
  8237: { role: "batería", to_year: 1971, founder: false },
  // Worst Emotions (como Worst desde 1968; César Sánchez Bello entra en abril de 1969)
  4701: { from_year: 1968, founder: true }, 4700: { from_year: 1968, founder: true },
  4703: { from_year: 1968, founder: true }, 4704: { from_year: 1968, founder: true },
  4702: { founder: false },
};

// Nuevas: [banda, persona (id o clave de NEW_PERSONS), rol, desde, fundador]
const NEW_MEMBERS: Array<[number, number | string, string, number | null, boolean]> = [
  [L007, "bertomis", "bajo", 1965, true],
  [L007, "suarez", "batería", null, false], [L007, 878, "guitarra", null, false], [L007, 978, "voz", null, false],
  [L007, "trigo", "voz", null, false], [L007, 2510, "batería", null, false], [L007, 629, "bajo", null, false],
  [L007, 2372, "teclados", null, false], [L007, "mdiaz", "teclados", null, false], [L007, 602, "bajo", null, false],
  [L007, "cperez", "teclados", null, false],
  [DARTS, 9732, "voz", null, false], [DARTS, "atoro", "Integrante", null, false], [DARTS, 876, "Integrante", null, false],
  [DARTS, "guzman", "Integrante", null, false], [DARTS, 325, "voz", null, false],
  [HIPPIES, "bermudez", "teclados y coros", null, false],
  [KINGS, "vitela", "Integrante", 1966, true], [KINGS, "tdelarosa", "Integrante", 1966, true],
  [KINGS, "sposito", "Integrante", 1966, true], [KINGS, "villano", "Integrante", 1966, true],
  [KINGS, "cortina", "Integrante", 1966, true], [KINGS, "fasano", "Integrante", 1966, true],
  [KINGS, "giambalvo", "Integrante", null, false], [KINGS, 29955, "Integrante", null, false],
  [KINGS, 2872, "Integrante", null, false], [KINGS, 6692, "Integrante", null, false],
  [KINGS, "williams", "Integrante", null, false], [KINGS, 45, "Integrante", null, false],
  [KINGS, 8624, "Integrante", null, false], [KINGS, "jjimenez", "Integrante", null, false],
  [KINGS, 3396, "Integrante", null, false], [KINGS, "rramos", "Integrante", null, false],
  [KINGS, "grazy", "Integrante", null, false],
  [SUPERSONICOS, "trigo", "voz", null, false], [SUPERSONICOS, "lmedina", "teclados", null, false],
];

// ── Discos ────────────────────────────────────────────────────────────────
const SOUVENIR = 364, PALACIO = 1171, TOP_HITS = 388, DISCOMODA = 4272, VIDA = 2034;
const ALBUM_MERGES: Array<[number, number]> = [
  [5006, 2869], // Los Claners Vol. 3 = Volumen 3 (mismas 12 pistas)
  [3944, 2624], // Para La Juventud... El Ritmo De Los Dangers ⊃ Para La Juventud (6 de 12 pistas)
];
const ALBUM_EDITS: Array<[number, Record<string, unknown>]> = [
  [4226, { catalog_id: "LP-6162" }], // Shindig (Palacio de la Música)
  [234, { label_id: SOUVENIR }], // Ladies W.C.
  [2625, { release_year: 1964, catalog_id: "LPV-1181" }], // Los Ases del Sourf
  [3944, { release_year: 1966, catalog_id: "LPV-1212" }], // Para la Juventud
  [350, { label_id: SOUVENIR }], // The Love Depression
  [15611, { title: "Amándote Está Dios / Mundo", release_year: 1971, label_id: TOP_HITS, catalog_id: "3047" }],
  [5517, { title: "You Gotta Understand / Busco Un Camino", label_id: DISCOMODA, catalog_id: "2395" }],
];
const ALBUM_ALIASES: Array<[number, string]> = [[5517, "You Gotta Understand / Busca Un Camino"], [15611, "Amandote Esta Dios / Mundo"]];
// Pistas para sencillos vacíos.
const TRACKS: Array<[number, string[]]> = [[15611, ["Amándote Está Dios", "Mundo"]], [5517, ["You Gotta Understand", "Busco Un Camino"]]];
// Discos nuevos: [banda, valores, pistas]; label "verde" = sello nuevo.
const NEW_ALBUMS: Array<[number, Record<string, unknown>, string[]]> = [
  [HOMER, { title: "Homer And The Don't's", release_year: 1965, album_type: "ep" }, []],
  [HOMER, { title: "You Wouldn't Leave Me / Train Kept A Rollin'", release_year: 1965, album_type: "single", label_id: "verde", catalog_id: "7031" },
    ["You Wouldn't Leave Me", "Train Kept A Rollin'"]],
  [LSD, { title: "Cuando Yo Era Un Muchacho / Un Día A La Semana", release_year: 1969, album_type: "single", label_id: VIDA },
    ["Cuando Yo Era Un Muchacho", "Un Día A La Semana (One Day To The Week)"]],
  [HIPPIES, { title: "La Guerra Cruel / Te Diré Lo Que Siento", release_year: 1968, album_type: "single", label_id: PALACIO, catalog_id: "6766" },
    ["La Guerra Cruel", "Te Diré Lo Que Siento"]],
];

// ── Utilidades ────────────────────────────────────────────────────────────
async function addPersonAlias(context: OperatorContext, personId: number, alias: string, type: string) {
  const key = normalizeEntityName(alias).primaryKey;
  const done = await context.client.query(`INSERT INTO ingest.person_aliases(person_id,alias,alias_type,normalized_alias,is_primary,confidence,notes)
    SELECT $1::bigint,$2::text,$3::ingest.alias_type,$4::text,false,'high',$5::text
     WHERE NOT EXISTS (SELECT 1 FROM ingest.person_aliases WHERE person_id=$1::bigint AND alias=$2::text)`, [personId, alias, type, key, NOTE]);
  if (done.rowCount) log.push(`persona ${personId}: alias «${alias}» (${type})`);
}
async function addAlbumAlias(context: OperatorContext, albumId: number, alias: string) {
  const done = await context.client.query(`INSERT INTO ingest.album_aliases(album_id,alias,alias_type,normalized_alias,is_primary,confidence,notes)
    SELECT $1::bigint,$2::text,'name_variant',$3::text,false,'high',$4::text
     WHERE NOT EXISTS (SELECT 1 FROM ingest.album_aliases WHERE album_id=$1::bigint AND alias=$2::text)`,
  [albumId, alias, normalizeEntityName(alias).primaryKey, NOTE]);
  if (done.rowCount) log.push(`disco ${albumId}: alias «${alias}»`);
}
async function setMembershipDetails(context: OperatorContext, memberId: number, role: string | undefined, founder: boolean | undefined) {
  const current = (await context.client.query<{ role: string }>("SELECT role FROM public.artist_members WHERE id=$1", [memberId])).rows[0]!;
  await context.client.query(`
    INSERT INTO ingest.membership_details(artist_member_id, is_founder, founder_evidence, founder_source, instruments, run_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (artist_member_id) DO UPDATE SET
      is_founder = COALESCE($2, ingest.membership_details.is_founder),
      founder_evidence = CASE WHEN $2 IS NULL THEN ingest.membership_details.founder_evidence ELSE $3 END,
      founder_source = CASE WHEN $2 IS NULL THEN ingest.membership_details.founder_source ELSE $4 END,
      instruments = CASE WHEN $7 THEN $5 ELSE ingest.membership_details.instruments END,
      run_id = $6, updated_at = now()`,
  [memberId, founder ?? null, founder === undefined ? null : (founder ? "Primera formación según las correcciones de Brian" : "Músico posterior según las correcciones de Brian"),
    founder === undefined ? null : FOUNDER_SOURCE, instrumentsOf(role ?? current.role), context.runId, role !== undefined]);
}

// ── Ejecución ─────────────────────────────────────────────────────────────
const { runId } = await withOperatorRun({ name: "curation:correcciones-bandas-2026-10-14", operator: "claude-code", note: NOTE }, async (context) => {
  for (const [keep, drop, why] of PERSON_MERGES) {
    await mergeInto(context.client, "person", keep, drop, `${NOTE}: ${why}`, context.runId, { alias: true });
    log.push(`persona ${drop} → ${keep} (${why})`);
  }
  // Tras fusionar a Steve Shook, su membresía «Integrante» (Discogs) duplica la de Stephen Shook.
  const dupShook = await context.client.query<{ id: string }>(
    "SELECT id::text FROM public.artist_members WHERE artist_id=$1 AND person_id=5933 AND id<>7876", [HOMER]);
  for (const row of dupShook.rows) { await deleteRelation(context, "artist_membership", Number(row.id)); log.push(`membresía ${row.id} (Steve Shook, duplicada) retirada`); }

  for (const [id, name] of RENAMES) {
    const old = (await context.client.query<{ name: string }>("SELECT name FROM public.persons WHERE id=$1", [id])).rows[0]!.name;
    if (old === name) continue;
    await addPersonAlias(context, id, old, "name_variant");
    await updateEntity(context, "person", id, { name });
    log.push(`persona ${id}: «${old}» → «${name}»`);
  }
  for (const [id, alias, type] of ALIASES) await addPersonAlias(context, id, alias, type);

  for (const [id, values] of ARTISTS) {
    const result = await updateEntity(context, "artist", id, values);
    log.push(`artista ${id}: ${result.fields.filter((f) => f.action !== "unchanged").map((f) => f.field).join(", ") || "sin cambios"}`);
  }

  for (const [memberId, edit] of Object.entries(MEMBER_EDITS)) {
    const id = Number(memberId);
    const values: Record<string, unknown> = {};
    if (edit.role !== undefined) values["role"] = edit.role;
    if (edit.from_year !== undefined) values["from_year"] = edit.from_year;
    if (edit.to_year !== undefined) values["to_year"] = edit.to_year;
    if (Object.keys(values).length) await updateRelation(context, "artist_membership", id, values);
    await setMembershipDetails(context, id, edit.role, edit.founder);
    log.push(`membresía ${id}: ${JSON.stringify(edit)}`);
  }

  const created = new Map<string, number>();
  for (const [key, name] of Object.entries(NEW_PERSONS)) {
    const person = await createEntity(context, "person", { name }, { allowSimilar: true });
    created.set(key, person.id);
    log.push(`persona nueva ${person.id}: ${name}`);
  }
  for (const [artistId, who, role, from, founder] of NEW_MEMBERS) {
    const personId = typeof who === "number" ? who : created.get(who)!;
    const relation = await createRelation(context, "artist_membership", { artistId, personId }, {
      role, from_year: from ?? undefined, is_current: "false", notes: NOTE,
    });
    await setMembershipDetails(context, relation.id, role, founder);
    log.push(`membresía ${relation.created ? "nueva" : "existente"} ${relation.id}: artista ${artistId} ← persona ${personId} (${role})`);
  }

  for (const [keepId, dropId] of ALBUM_MERGES) {
    const preview = await previewAlbumMerge(context.client, keepId, dropId);
    await mergeAlbums(context, { keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: true });
    log.push(`disco ${dropId} → ${keepId}`);
  }
  for (const [id, values] of ALBUM_EDITS) {
    await updateEntity(context, "album", id, values);
    log.push(`disco ${id}: ${JSON.stringify(values)}`);
  }
  for (const [id, alias] of ALBUM_ALIASES) await addAlbumAlias(context, id, alias);
  for (const [albumId, titles] of TRACKS) {
    for (const [index, title] of titles.entries()) await createEntity(context, "track", { title, track_number: index + 1 }, { albumId, allowSimilar: true });
    log.push(`disco ${albumId}: ${titles.length} pistas`);
  }

  const verde = await createEntity(context, "organization", { name: "Verde", organization_type: "record_label" }, { allowSimilar: true });
  log.push(`sello nuevo ${verde.id}: Verde`);
  for (const [artistId, values, titles] of NEW_ALBUMS) {
    const fields = { ...values, label_id: values["label_id"] === "verde" ? verde.id : values["label_id"] };
    const album = await createEntity(context, "album", fields, { artistId, allowSimilar: true });
    for (const [index, title] of titles.entries()) await createEntity(context, "track", { title, track_number: index + 1 }, { albumId: album.id, allowSimilar: true });
    log.push(`disco nuevo ${album.id}: ${String(values["title"])} (${titles.length} pistas)`);
  }
}, { rollbackOnly: !confirm });

console.log(log.join("\n"));
console.log(`\nrun ${runId}${confirm ? "" : " (ensayo: rollback)"}`);
await closeDb();
