// CRV · Aplicador del cotejo de trayectoria con fuentes oficiales (Brian, 2026-10-13).
//
// Lee la salida de cotejar-trayectoria.mts (propuestas ya validadas contra sus citas) y escribe
// SOLO huecos, en un run del operador (diario de cambios: se deshace por run):
//
//   integrantes  Faltantes → membresía con rol, años y cita. Persona: la ya integrante (misma o casi
//                misma firma), la acreditada en sus discos, o la homónima ligada a otro proyecto que las
//                citas nombran (regla de Brian: solo con proyecto común); si no, persona nueva y el par
//                homónimo va al informe. Solistas y proyectos: no se crean integrantes (van al informe).
//   existentes   Años de entrada/salida solo si faltan; fundador (membership_details) solo si no estaba
//                decidido; rol solo si era genérico («Integrante»).
//   ficha        Año de formación, ciudad y año de separación solo si faltan (la separación, además, sin
//                actividad posterior); nombres anteriores como alias former_name.
//   personas     Fallecimiento, nacimiento y ciudad de nacimiento solo si faltan, y solo de personas de
//                la ficha.
//
// Nada se pisa: lo que choca con el catálogo va a la lista de contradicciones del informe.
// Sin --confirm la transacción se revierte (vista previa exacta).
// Uso: tsx scripts/fuentes-oficiales/aplicar-trayectoria.mts [--in=…jsonl] [--ids=…] [--confirm]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { createEntity, createRelation, updateEntity, updateRelation, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { createAlias } from "../../src/api/repositories/aliases.js";
import { nameWithoutNickname } from "../../src/review/person-names.js";
import type { OutputRow, Trajectory } from "./cotejar-trayectoria.mjs";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const IN = arg("in") ?? "reports/fuentes-oficiales-2026-10-13/trayectoria.jsonl";
const ONLY = arg("ids")?.split(",").map(Number);
const CONFIRM = process.argv.includes("--confirm");
const REPORT = arg("report") ?? `reports/fuentes-oficiales-2026-10-13/aplicar-trayectoria-${CONFIRM ? "aplicado" : "vista-previa"}.json`;
const OPERATOR = "claude-code (delegado por Brian)";
const GENERIC_ROLES = new Set(["integrante", "miembro", "member", ""]);
// Un «rol» que describe la ficha y no un instrumento o función no reemplaza a «Integrante».
const NOT_A_ROLE = /\b(?:proyecto|artista|banda|band|project|solista|grupo)\b/iu;
// Vetos manuales tras revisar la cita: {artistId, name, why}.
const VETOS_FILE = "reports/fuentes-oficiales-2026-10-13/vetos.json";
// Unificaciones manuales dentro de una ficha: {artistId, names:[…], name} → una sola persona con ese nombre.
const SAME_FILE = "reports/fuentes-oficiales-2026-10-13/unificar.json";
const SAME: Array<{ artistId: number; names: string[]; name: string }> = existsSync(SAME_FILE) ? JSON.parse(readFileSync(SAME_FILE, "utf8")) as Array<{ artistId: number; names: string[]; name: string }> : [];
const VETOS: Array<{ artistId: number; name: string; why: string }> = existsSync(VETOS_FILE) ? JSON.parse(readFileSync(VETOS_FILE, "utf8")) as Array<{ artistId: number; name: string; why: string }> : [];
// La «ubicación» de un perfil (Bandcamp foundingLocation, cabecera de Twitter) es donde vive hoy, no el origen
// (Los Mentas → «Mexico», Op3rador → «Samaipata, Bolivia»). Sirve solo si es una ciudad venezolana; si no, hace
// falta una frase de origen («formada en», «hailing from», «nació en»).
const ORIGIN_PHRASE = /\b(?:formad[oa]s?|fundad[oa]s?|founded|formed|hailing from|(?:is|are|band|based) from|originari[oa]s?|oriund[oa]s?|naci[oó]|nacid[oa]|born|surgi[oó]|naci[oó])\b/iu;
const VENEZUELAN_CITY = /\b(?:venezuela|caracas|maracaibo|valencia|barquisimeto|maracay|m[eé]rida|puerto la cruz|barcelona|cuman[aá]|puerto ordaz|ciudad guayana|san crist[oó]bal|los teques|lecher[ií]a|ciudad bol[ií]var|matur[ií]n|coro|punto fijo|acarigua|barinas|valera|porlamar|guarenas|guatire|san f[eé]lix|el tigre|cabimas|carora|tucupita|puerto cabello|san juan de los morros)\b/iu;

// «4.º Reich» = «4to Reich»: los ordinales se reducen al número.
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/(\d+)\s*(?:\.\s*)?(?:º|°|o\b|to\b|vo\b|ro\b|do\b|er\b|ero\b)/gu, "$1");
const clean = (name: string) => name.replace(/[«»"“”]/gu, " ").replace(/\s+/gu, " ").trim();
const key = (name: string) => nameWithoutNickname(clean(name));
const tokens = (name: string) => key(name).split(/\s+/u).filter((token) => token.length > 1);

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length]!;
}
const close = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && editDistance(a, b) <= 1);
/**
 * Misma persona dentro de UNA ficha: cada palabra del nombre corto (≥2 palabras) está, igual o a una letra,
 * en el largo, con el mismo nombre de pila («Daniel Hernandez» ⊂ «Daniel Hernadez Saud»); o un solo apellido
 * coincide con el de un integrante y no hay otro con ese apellido.
 */
function samePerson(left: string, right: string): boolean {
  if (key(left) === key(right)) return true;
  const a = tokens(left), b = tokens(right);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  return close(short[0]!, long[0]!) && short.every((token) => long.some((other) => close(token, other)));
}

type Quote = OutputRow["quotes"][number];
const evidenceOf = (row: OutputRow, ids: readonly string[]) => {
  const quotes = ids.map((id) => row.quotes.find((quote) => quote.id === id)).filter((quote): quote is Quote => !!quote);
  const first = quotes[0];
  return first ? `Fuente oficial ${first.url}: «${first.text.replace(/\s+/gu, " ").slice(0, 380)}»` : "Fuente oficial";
};

interface Report {
  runs: number[];
  artists: number;
  membersCreated: Array<{ artistId: number; artist: string; person: string; personId: number; how: string; role: string; fromYear: number | null; toYear: number | null; homonyms: number[] }>;
  membersUpdated: Array<{ artistId: number; artist: string; person: string; changes: Record<string, unknown> }>;
  founders: Array<{ artistId: number; artist: string; person: string }>;
  artistFields: Array<{ artistId: number; artist: string; changes: Record<string, unknown> }>;
  aliases: Array<{ artistId: number; artist: string; alias: string }>;
  persons: Array<{ personId: number; person: string; changes: Record<string, unknown> }>;
  review: {
    identity: Array<{ artistId: number; artist: string; identity: string; note: string | null }>;
    contradictions: Array<{ artistId: number; artist: string; field: string; catalogValue: string; sourceValue: string; evidence: string }>;
    soloMembers: Array<{ artistId: number; artist: string; person: string; role: string | null }>;
    notMembers: Array<{ artistId: number; artist: string; person: string; status: string; role: string | null }>;
    roleDiffs: Array<{ artistId: number; artist: string; person: string; catalog: string; source: string }>;
    yearDiffs: Array<{ artistId: number; artist: string; person: string; field: string; catalog: number; source: number }>;
    parallelProjects: Array<{ artistId: number; artist: string; person: string; project: string; projectArtistId: number | null }>;
    possibleDuplicates: Array<{ artistId: number; artist: string; person: string; personId: number; homonyms: number[] }>;
    failed: Array<{ artistId: number; artist: string; error: string }>;
    notes: Array<{ artistId: number; artist: string; note: string }>;
  };
}

const readJsonl = <T,>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);

interface PersonIndex { byKey: Map<string, number[]> }
let artistNames: Array<{ id: number; name: string }> = [];
const artistIdByName = { get: (id: string) => Number(id) };
/** Fichas de artista cuyo nombre (≥4 letras, palabra completa) aparece en el texto. */
function relatedArtistIds(text: string, self: number): number[] {
  const words = ` ${text.replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return artistNames.filter((artist) => artist.id !== self && artist.name.length >= 4 && words.includes(` ${artist.name} `)).map((artist) => artist.id);
}
async function loadPersons(): Promise<PersonIndex> {
  const { rows } = await getPool().query<{ id: string; name: string }>(
    "SELECT id::text, name FROM public.persons UNION SELECT person_id::text, alias FROM ingest.person_aliases");
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const k = key(row.name);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    if (!list.includes(Number(row.id))) list.push(Number(row.id));
    byKey.set(k, list);
  }
  return { byKey };
}

async function linkedArtistNames(context: OperatorContext, personId: number): Promise<string[]> {
  const { rows } = await context.client.query<{ name: string }>(`
    SELECT ar.name FROM public.artist_members m JOIN public.artists ar ON ar.id=m.artist_id WHERE m.person_id=$1
    UNION SELECT ar.name FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id JOIN public.artists ar ON ar.id=al.artist_id
     WHERE c.person_id=$1 AND ar.name <> 'Various Artists'
    UNION SELECT ar.name FROM public.track_credits tc JOIN public.tracks t ON t.id=tc.track_id JOIN public.albums al ON al.id=t.album_id
      JOIN public.artists ar ON ar.id=al.artist_id WHERE tc.person_id=$1 AND ar.name <> 'Various Artists'`, [personId]);
  return rows.map((row) => row.name);
}

type Member = Trajectory["members"][number];
interface Resolution { personId: number; how: "ya-integrante" | "acreditada" | "proyecto-comun" | "nueva"; memberId?: number; homonyms: number[] }

async function resolvePerson(context: OperatorContext, persons: PersonIndex, row: OutputRow, member: Member, quotesText: string, bioText: string): Promise<Resolution> {
  const { rows: current } = await context.client.query<{ id: string; person_id: string; name: string }>(
    "SELECT m.id::text, m.person_id::text, p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1", [row.artistId]);
  const already = current.find((item) => samePerson(item.name, member.name) || (member.personId !== null && Number(item.person_id) === member.personId));
  if (already) return { personId: Number(already.person_id), how: "ya-integrante", memberId: Number(already.id), homonyms: [] };
  if (member.personId !== null) return { personId: member.personId, how: "acreditada", homonyms: [] };
  const credited = row.catalog.credited.find((person) => samePerson(person.name, member.name));
  if (credited) return { personId: credited.personId, how: "acreditada", homonyms: [] };
  // Integrantes y acreditados de las bandas que nombran las citas o la biografía (Zeta ↔ Zeta Once): misma firma o casi.
  const { rows: related } = await context.client.query<{ person_id: string; name: string; artist: string }>(`
    SELECT DISTINCT x.person_id::text, p.name, a.id::text AS artist FROM (
      SELECT person_id, artist_id FROM public.artist_members
      UNION SELECT c.person_id, al.artist_id FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE c.person_id IS NOT NULL
    ) x JOIN public.persons p ON p.id=x.person_id JOIN public.artists a ON a.id=x.artist_id
    WHERE x.artist_id=ANY($1::bigint[])`, [relatedArtistIds(quotesText, row.artistId)]);
  const near = [...new Set(related.filter((item) => samePerson(item.name, member.name)).map((item) => Number(item.person_id)))];
  if (near.length === 1) return { personId: near[0]!, how: "proyecto-comun", homonyms: [] };
  // Varias: manda la banda que la biografía o los alias de la ficha nombran (su nombre anterior, p. ej.).
  if (near.length > 1) {
    const own = new Set(relatedArtistIds(fold([bioText, ...row.catalog.artist.aliases].join("\n")), row.artistId));
    const closest = [...new Set(related.filter((item) => samePerson(item.name, member.name) && own.has(artistIdByName.get(item.artist) ?? -1)).map((item) => Number(item.person_id)))];
    if (closest.length === 1) return { personId: closest[0]!, how: "proyecto-comun", homonyms: [] };
  }
  const candidates = persons.byKey.get(key(member.name)) ?? [];
  const linked: number[] = [];
  for (const candidate of candidates) {
    const names = await linkedArtistNames(context, candidate);
    if (names.some((name) => fold(name).length >= 4 && fold(name) !== fold(row.name) && quotesText.includes(fold(name)))) linked.push(candidate);
  }
  if (linked.length === 1) return { personId: linked[0]!, how: "proyecto-comun", homonyms: [] };
  const person = await createEntity(context, "person", {
    name: clean(member.name).replace(/\s+[«"“].*?[»"”]\s*/gu, " ").trim(),
    notes: `Alta 2026-10-13 como integrante de ${row.name} (fuente oficial). ${evidenceOf(row, member.quoteIds)}`.slice(0, 1000),
  }, { allowSimilar: true });
  persons.byKey.set(key(member.name), [...candidates, person.id]);
  return { personId: person.id, how: "nueva", homonyms: candidates };
}

async function applyArtist(context: OperatorContext, persons: PersonIndex, row: OutputRow, report: Report): Promise<void> {
  const result = row.result;
  const artist = row.catalog.artist;
  // Para probar el proyecto común también cuentan la biografía y los alias de la ficha (Zeta ↔ «Zeta Once»).
  const bio = (await context.client.query<{ biography: string | null }>("SELECT biography FROM public.artists WHERE id=$1", [row.artistId])).rows[0]?.biography ?? "";
  const quotesText = fold([...row.quotes.map((quote) => quote.text), bio, ...artist.aliases].join("\n"));
  const live = (await context.client.query<{ artist_type: string; formed_year: number | null; disbanded_year: number | null; origin_city: string | null }>(
    "SELECT artist_type::text, formed_year, disbanded_year, origin_city FROM public.artists WHERE id=$1", [row.artistId])).rows[0];
  if (!live) throw new Error("artista inexistente");
  const isBand = live.artist_type === "band";

  // Integrantes de la respuesta sin repetir la misma persona.
  const members: Member[] = [];
  for (const original of result.members) {
    const unify = SAME.find((item) => item.artistId === row.artistId && item.names.some((name) => samePerson(name, original.name)));
    const member = unify ? { ...original, name: unify.name } : original;
    const twin = members.find((other) => samePerson(other.name, member.name) || (member.personId !== null && other.personId === member.personId));
    if (twin) { twin.quoteIds = [...new Set([...twin.quoteIds, ...member.quoteIds])]; twin.fromYear ??= member.fromYear; twin.toYear ??= member.toYear; twin.role = twin.role && member.role && !fold(twin.role).includes(fold(member.role)) ? `${twin.role}; ${member.role}` : twin.role ?? member.role; twin.current = twin.current === true || member.current === true ? true : twin.current ?? member.current; twin.founder ??= member.founder; continue; }
    members.push({ ...member });
  }
  const personByName = new Map<string, number>();
  for (const member of members) {
    const veto = VETOS.find((item) => item.artistId === row.artistId && samePerson(item.name, member.name));
    if (veto) { report.review.notMembers.push({ artistId: row.artistId, artist: row.name, person: member.name, status: `vetado: ${veto.why}`, role: member.role }); continue; }
    if (member.status !== "member") {
      report.review.notMembers.push({ artistId: row.artistId, artist: row.name, person: member.name, status: member.status, role: member.role });
      continue;
    }
    let memberId = member.memberId;
    let personId = member.personId;
    if (memberId === null) {
      if (!isBand) {
        // Los músicos de un solista o proyecto no son integrantes; los ya modelados sí se completan.
        const existing = row.catalog.members.find((item) => samePerson(item.name, member.name));
        if (!existing) { report.review.soloMembers.push({ artistId: row.artistId, artist: row.name, person: member.name, role: member.role }); continue; }
        memberId = existing.memberId; personId = existing.personId;
      } else {
        const resolved = await resolvePerson(context, persons, row, member, quotesText, bio);
        personId = resolved.personId;
        if (resolved.memberId) memberId = resolved.memberId;
        else {
          const toYear = member.toYear !== null && member.fromYear !== null && member.toYear < member.fromYear ? null : member.toYear;
          const relation = await createRelation(context, "artist_membership", { artistId: row.artistId, personId }, {
            role: (member.role ?? "Integrante").slice(0, 200), from_year: member.fromYear ?? undefined, to_year: toYear ?? undefined,
            is_current: member.current === true && !live.disbanded_year && toYear === null ? "true" : "false",
            notes: evidenceOf(row, member.quoteIds).slice(0, 500),
          });
          memberId = relation.id;
          report.membersCreated.push({ artistId: row.artistId, artist: row.name, person: member.name, personId, how: resolved.how, role: member.role ?? "Integrante", fromYear: member.fromYear, toYear, homonyms: resolved.homonyms });
          if (resolved.how === "nueva" && resolved.homonyms.length) report.review.possibleDuplicates.push({ artistId: row.artistId, artist: row.name, person: member.name, personId, homonyms: resolved.homonyms });
          if (member.founder === true) await founder(context, row, memberId, member, report);
          personByName.set(key(member.name), personId);
          continue;
        }
      }
    }
    if (personId !== null) personByName.set(key(member.name), personId);
    // Membresía existente: solo huecos.
    const current = (await context.client.query<{ role: string; from_year: number | null; to_year: number | null }>(
      "SELECT role, from_year, to_year FROM public.artist_members WHERE id=$1", [memberId])).rows[0];
    if (!current) continue;
    const changes: Record<string, unknown> = {};
    if (member.fromYear !== null) {
      if (current.from_year === null && (current.to_year === null || member.fromYear <= current.to_year)) changes["from_year"] = member.fromYear;
      else if (current.from_year !== null && current.from_year !== member.fromYear) report.review.yearDiffs.push({ artistId: row.artistId, artist: row.name, person: member.name, field: "desde", catalog: current.from_year, source: member.fromYear });
    }
    if (member.toYear !== null) {
      const from = (changes["from_year"] as number | undefined) ?? current.from_year;
      if (current.to_year === null && (from === null || member.toYear >= from)) changes["to_year"] = member.toYear;
      else if (current.to_year !== null && current.to_year !== member.toYear) report.review.yearDiffs.push({ artistId: row.artistId, artist: row.name, person: member.name, field: "hasta", catalog: current.to_year, source: member.toYear });
    }
    if (member.role && isBand && !NOT_A_ROLE.test(member.role) && GENERIC_ROLES.has(fold(current.role).trim())) changes["role"] = member.role.slice(0, 200);
    else if (member.role && !fold(current.role).includes(fold(member.role)) && !fold(member.role).includes(fold(current.role)))
      report.review.roleDiffs.push({ artistId: row.artistId, artist: row.name, person: member.name, catalog: current.role, source: member.role });
    if (Object.keys(changes).length) {
      await updateRelation(context, "artist_membership", memberId, changes);
      report.membersUpdated.push({ artistId: row.artistId, artist: row.name, person: member.name, changes });
    }
    if (member.founder === true && isBand) await founder(context, row, memberId, member, report);
  }

  // Ficha del artista: solo huecos.
  const changes: Record<string, unknown> = {};
  if (result.formedYear) {
    if (live.formed_year === null) changes["formed_year"] = result.formedYear.value;
  }
  const originQuotes = result.originCity ? row.quotes.filter((quote) => result.originCity!.quoteIds.includes(quote.id)).map((quote) => quote.text).join("\n") : "";
  const originOk = !!result.originCity && (ORIGIN_PHRASE.test(originQuotes.replace(/foundingLocation/gu, "")) || VENEZUELAN_CITY.test(result.originCity.value));
  if (result.originCity && !originOk) report.review.notes.push({ artistId: row.artistId, artist: row.name, note: `Ciudad «${result.originCity.value}» solo como ubicación del perfil: no se toma como origen.` });
  if (result.originCity && originOk && !live.origin_city) changes["origin_city"] = result.originCity.value.replace(/,\s*Venezuela$/iu, "").slice(0, 120);
  if (result.disbandedYear && !result.laterActivity && live.disbanded_year === null) changes["disbanded_year"] = result.disbandedYear.value;
  if (Object.keys(changes).length) {
    await updateEntity(context, "artist", row.artistId, changes);
    report.artistFields.push({ artistId: row.artistId, artist: row.name, changes });
  }
  const aliases = new Set([fold(row.name), ...artist.aliases.map(fold)]);
  for (const previous of result.previousNames) {
    if (aliases.has(fold(previous.name))) continue;
    await createAlias(context, "artist", row.artistId, { alias: previous.name.slice(0, 200), aliasType: "former_name", isPrimary: false });
    aliases.add(fold(previous.name));
    report.aliases.push({ artistId: row.artistId, artist: row.name, alias: previous.name });
  }

  // Personas de la ficha: fallecimiento, nacimiento y ciudad, solo si faltan.
  for (const person of result.persons) {
    const personId = person.personId ?? personByName.get(key(person.name)) ?? row.catalog.members.find((item) => samePerson(item.name, person.name))?.personId;
    if (!personId) continue;
    const live = (await context.client.query<{ is_deceased: boolean | null; death_date_value: string | null; birth_date_value: string | null; birth_city: string | null }>(
      "SELECT is_deceased, death_date_value, birth_date_value, birth_city FROM public.persons WHERE id=$1", [personId])).rows[0];
    if (!live) continue;
    const fields: Record<string, unknown> = {};
    if (person.deathYear !== null) {
      if (live.is_deceased !== true) fields["is_deceased"] = true;
      if (!live.death_date_value) fields["death_date"] = String(person.deathYear);
    }
    if (person.birthYear !== null && !live.birth_date_value) fields["birth_date"] = String(person.birthYear);
    if (person.birthPlace && !live.birth_city) fields["birth_city"] = person.birthPlace.slice(0, 120);
    if (Object.keys(fields).length) {
      await updateEntity(context, "person", personId, fields);
      report.persons.push({ personId, person: person.name, changes: fields });
    }
  }

  for (const contradiction of result.contradictions) report.review.contradictions.push({ artistId: row.artistId, artist: row.name, ...contradiction, evidence: evidenceOf(row, contradiction.quoteIds) });
  if (result.formedYear && live.formed_year !== null && live.formed_year !== result.formedYear.value && !result.contradictions.some((item) => /formed|forma/iu.test(item.field)))
    report.review.contradictions.push({ artistId: row.artistId, artist: row.name, field: "formedYear", catalogValue: String(live.formed_year), sourceValue: String(result.formedYear.value), evidence: evidenceOf(row, result.formedYear.quoteIds) });
  for (const project of result.parallelProjects) {
    const match = (await context.client.query<{ id: string }>(
      "SELECT id::text FROM public.artists WHERE lower(name)=lower($1) UNION SELECT artist_id::text FROM ingest.artist_aliases WHERE lower(alias)=lower($1) LIMIT 1", [project.project])).rows[0];
    report.review.parallelProjects.push({ artistId: row.artistId, artist: row.name, person: project.person, project: project.project, projectArtistId: match ? Number(match.id) : null });
  }
  if (result.note) report.review.notes.push({ artistId: row.artistId, artist: row.name, note: result.note });
}

async function founder(context: OperatorContext, row: OutputRow, memberId: number, member: Member, report: Report): Promise<void> {
  const done = await context.client.query(`
    INSERT INTO ingest.membership_details(artist_member_id, is_founder, founder_evidence, founder_source, run_id) VALUES ($1, true, $2, 'sitio oficial', $3)
    ON CONFLICT (artist_member_id) DO UPDATE SET is_founder = true, founder_evidence = EXCLUDED.founder_evidence, founder_source = EXCLUDED.founder_source, run_id = EXCLUDED.run_id, updated_at = now()
     WHERE ingest.membership_details.is_founder IS NULL`, [memberId, evidenceOf(row, member.quoteIds), context.runId]);
  if (done.rowCount) report.founders.push({ artistId: row.artistId, artist: row.name, person: member.name });
}

async function main(): Promise<void> {
  const rows = readJsonl<OutputRow>(IN).filter((row) => !ONLY || ONLY.includes(row.artistId));
  const report: Report = { runs: [], artists: 0, membersCreated: [], membersUpdated: [], founders: [], artistFields: [], aliases: [], persons: [],
    review: { identity: [], contradictions: [], soloMembers: [], notMembers: [], roleDiffs: [], yearDiffs: [], parallelProjects: [], possibleDuplicates: [], failed: [], notes: [] } };
  const usable = rows.filter((row) => {
    if (row.result.identity === "same_artist") return true;
    report.review.identity.push({ artistId: row.artistId, artist: row.name, identity: row.result.identity, note: row.result.identityNote });
    return false;
  });
  const persons = await loadPersons();
  artistNames = (await getPool().query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists WHERE name <> 'Various Artists' UNION SELECT artist_id::text, alias FROM ingest.artist_aliases"))
    .rows.map((row) => ({ id: Number(row.id), name: fold(row.name).replace(/[^\p{L}\p{N}]+/gu, " ").trim() }));
  const { runId } = await withOperatorRun({
    name: "fuentes-oficiales:trayectoria",
    operator: OPERATOR,
    note: "Huecos de trayectoria (integrantes, periodos, fundadores, formación, nombres anteriores, fallecimientos) desde fuentes oficiales con cita literal; campaña 2026-10-13 pedida por Brian.",
    params: { fichas: usable.length },
  }, async (context) => {
    for (const row of usable) {
      await context.client.query("SAVEPOINT ficha");
      try {
        await applyArtist(context, persons, row, report);
        await context.client.query("RELEASE SAVEPOINT ficha");
        report.artists += 1;
      } catch (error) {
        await context.client.query("ROLLBACK TO SAVEPOINT ficha");
        report.review.failed.push({ artistId: row.artistId, artist: row.name, error: (error as Error).message.slice(0, 300) });
      }
    }
  }, { rollbackOnly: !CONFIRM });
  if (CONFIRM) report.runs.push(runId);
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    confirm: CONFIRM, run: CONFIRM ? runId : null, fichas: report.artists, integrantesNuevos: report.membersCreated.length,
    personasNuevas: report.membersCreated.filter((item) => item.how === "nueva").length, integrantesCompletados: report.membersUpdated.length,
    fundadores: report.founders.length, camposFicha: report.artistFields.length, alias: report.aliases.length, personas: report.persons.length,
    revision: Object.fromEntries(Object.entries(report.review).map(([name, list]) => [name, list.length])),
  }, null, 2));
  console.log(`informe: ${REPORT}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
