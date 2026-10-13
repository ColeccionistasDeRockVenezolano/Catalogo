// CRV · Datos ricos de las biografías (Brian, 2026-10-13).
//
// Las biografías dicen el nombre real, el nacimiento, la ciudad, el
// fallecimiento, el género y la nacionalidad de la persona, y los años de cada
// integrante de una banda, pero esos datos se quedaban en el texto. Esta tanda
// los pasa a sus campos. DeepSeek flash propone (una llamada por ficha), el
// código valida que cada dato venga con una cita literal que lo contenga y
// solo se rellenan campos vacíos: nada que ya tenga dato se pisa (lo que lo
// contradice queda en el informe de contradicciones).
//
// Personas
//   --stage=personas-expedientes   una ficha por persona con texto: su biografía,
//                                  la de su proyecto (titular o mismo nombre) y
//                                  los textos de las fuentes de ese proyecto.
//   --stage=personas-extraer [--concurrency=24] [--limit=N] [--ids=…]
//   --stage=personas-aplicar [--confirm]
//       · campos vacíos (nacimiento, ciudad, fallecimiento, género,
//         nacionalidad, venezolano, nombre real) en un run;
//       · plan de nombres (caso Canserbero) para `crv review persons --plan=…`:
//         la persona pasa a llamarse por su nombre real y el artístico queda
//         de alias; si ya lleva una forma del nombre real, solo se suma alias;
//       · tipos: un «grupo» cuya biografía describe a una sola persona pasa a
//         solista y su persona a titular; una «persona» con el nombre de una
//         banda de verdad (crédito «Produced by: Epitafio») se convierte en la
//         banda (`to_artist`: los créditos pasan al artista).
// Integrantes
//   --stage=periodos-expedientes | periodos-extraer | periodos-aplicar [--confirm]
//       Entrada, salida y «sigue» de cada integrante sin periodo completo, con
//       cita. Solo donde falta; «sigue» solo si la banda no está disuelta.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createDeepSeekGateway } from "../src/ai/gateway.js";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = arg("stage");
const confirm = process.argv.includes("--confirm");
const DIR = "reports/primo-datos-ricos";
const BIO_DIR = "reports/primo-etapa2/bio-dossiers";
const ONLY = arg("ids")?.split(",").map(Number);
const TODAY = "2026-10-13";
const NOTE = "Datos ricos de las biografías (Brian, 2026-10-13)";
const pool = getPool();
mkdirSync(DIR, { recursive: true });

const readJsonl = <T,>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T) : []);
const writeJsonl = (file: string, rows: unknown[]) => writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));

const normalize = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
  .replace(/[«»"“”'’`´]/gu, "").replace(/\s+/gu, " ").trim();
const tokens = (text: string) => normalize(text).replace(/[^a-z0-9 ]/gu, " ").split(" ").filter((token) => token.length > 2);
const keyOf = (text: string) => normalize(text).replace(/[^a-z0-9 ]/gu, " ").replace(/\s+/gu, " ").trim();

interface Source { ref: string; source: string; text: string }

/** Textos de las fuentes de cada artista (expedientes de biografías de la etapa 2). */
function artistSources(): Map<number, Source[]> {
  const out = new Map<number, Source[]>();
  for (const file of readdirSync(BIO_DIR).filter((name) => /^artist-\d+\.jsonl$/u.test(name))) {
    for (const dossier of readJsonl<{ entityId: number; sources: Array<{ source: string; text: string }> }>(path.join(BIO_DIR, file))) {
      let budget = 9000;
      out.set(dossier.entityId, dossier.sources.flatMap((source) => {
        const text = (source.text ?? "").slice(0, Math.min(3500, Math.max(0, budget)));
        budget -= text.length;
        return text ? [{ ref: "", source: source.source, text }] : [];
      }));
    }
  }
  return out;
}

/** La cita está literal (sin comillas ni tildes) en el texto. */
function literal(text: string | null | undefined, quote: string): boolean {
  if (!text || !quote.trim()) return false;
  return normalize(text).includes(normalize(quote));
}

/** Una letra de diferencia en palabras de 5+ letras («Gonzáles» ~ «González»). */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const mentions = (text: string, name: string) => { const found = tokens(text); return tokens(name).some((token) => found.some((other) => close(token, other))); };

// ════════════════════════════════════════════════════════════════════════════
// Personas
// ════════════════════════════════════════════════════════════════════════════
const PERSON_DOSSIERS = `${DIR}/personas-expedientes.jsonl`;
const PERSON_EXTRACTION = `${DIR}/personas-extraccion.jsonl`;

interface PersonDossier {
  caseId: string;
  personId: number;
  name: string;
  current: { realName: string | null; birth: string | null; birthCity: string | null; death: string | null; deceased: boolean | null;
    gender: string | null; nationality: string | null; venezuelan: boolean | null };
  aliases: string[];
  /** Proyectos de los que es titular o que llevan su mismo nombre. */
  artists: Array<{ artistId: number; name: string; type: string; role: string | null; members: number }>;
  texts: Array<Source & { about: string }>;
}

async function personasExpedientes(): Promise<void> {
  const sources = artistSources();
  const { rows } = await pool.query<{ id: string; name: string; real_name: string | null; biography: string | null; birth: string | null; birth_city: string | null;
    death: string | null; is_deceased: boolean | null; gender: string | null; nationality: string | null; is_venezuelan: boolean | null;
    aliases: string[] | null; artists: Array<{ artistId: number; name: string; type: string; role: string | null; members: number; bio: string | null }> | null }>(`
    WITH links AS (
      SELECT p.id AS person_id, a.id AS artist_id, a.name, a.artist_type::text AS type, a.biography,
             (SELECT m.role FROM public.artist_members m WHERE m.artist_id = a.id AND m.person_id = p.id ORDER BY m.id LIMIT 1) AS role,
             (SELECT count(*)::int FROM public.artist_members m WHERE m.artist_id = a.id) AS members
        FROM public.persons p JOIN public.artists a ON lower(btrim(a.name)) = lower(btrim(p.name))
      UNION
      SELECT p.id, a.id, a.name, a.artist_type::text, a.biography, m.role,
             (SELECT count(*)::int FROM public.artist_members x WHERE x.artist_id = a.id)
        FROM public.persons p JOIN public.artist_members m ON m.person_id = p.id AND m.role ILIKE 'Titular%'
        JOIN public.artists a ON a.id = m.artist_id)
    SELECT p.id::text, p.name, p.real_name, p.biography, p.birth_date_value AS birth, p.birth_city, p.death_date_value AS death,
           p.is_deceased, p.gender, p.nationality, p.is_venezuelan,
           (SELECT array_agg(alias ORDER BY alias) FROM ingest.person_aliases pa WHERE pa.person_id = p.id) AS aliases,
           (SELECT jsonb_agg(DISTINCT jsonb_build_object('artistId', l.artist_id, 'name', l.name, 'type', l.type, 'role', l.role, 'members', l.members, 'bio', l.biography))
              FROM links l WHERE l.person_id = p.id) AS artists
      FROM public.persons p
     WHERE coalesce(btrim(p.biography), '') <> '' OR EXISTS (SELECT 1 FROM links l WHERE l.person_id = p.id)
     ORDER BY p.id`);
  const out: PersonDossier[] = [];
  for (const row of rows) {
    const texts: PersonDossier["texts"] = [];
    if (row.biography?.trim()) texts.push({ ref: "p", source: "biografía CRV de la persona", text: row.biography.slice(0, 6000), about: row.name });
    for (const artist of row.artists ?? []) {
      if (artist.bio?.trim()) texts.push({ ref: `a${artist.artistId}`, source: `biografía CRV del artista «${artist.name}»`, text: artist.bio.slice(0, 6000), about: artist.name });
      (sources.get(artist.artistId) ?? []).forEach((source, index) => texts.push({ ...source, ref: `a${artist.artistId}s${index + 1}`, about: artist.name }));
    }
    if (!texts.length) continue;
    out.push({
      caseId: `person:${row.id}`, personId: Number(row.id), name: row.name,
      current: { realName: row.real_name, birth: row.birth, birthCity: row.birth_city, death: row.death, deceased: row.is_deceased,
        gender: row.gender, nationality: row.nationality, venezuelan: row.is_venezuelan },
      aliases: row.aliases ?? [],
      artists: (row.artists ?? []).map(({ bio: _bio, ...artist }) => artist),
      texts,
    });
  }
  writeJsonl(PERSON_DOSSIERS, out);
  console.log(JSON.stringify({ persons: rows.length, withTexts: out.length, withArtists: out.filter((d) => d.artists.length).length }));
}

const PERSON_SCHEMA_VERSION = "crv-person-facts.v2";
// Un dato suelto, sin cita, se deja pasar para que la validación lo rechace y se pida otra vez con cita.
const quoted = <T extends z.ZodTypeAny>(value: T) => z.preprocess(
  (input) => (input && typeof input === "object" && "quote" in input ? input
    : typeof input === "string" || typeof input === "number" ? { value: String(input), quote: "", ref: "" } : null),
  z.object({ value, quote: z.string(), ref: z.string() }).nullable());
const personResponse = z.object({
  caseId: z.string(),
  realName: quoted(z.string()),
  otherNames: z.preprocess((value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && typeof item.value === "string" && typeof item.quote === "string" && typeof item.ref === "string") : []),
    z.array(z.object({ value: z.string(), quote: z.string(), ref: z.string() }))),
  birthDate: quoted(z.string()),
  birthPlace: quoted(z.string()),
  deathDate: quoted(z.string()),
  gender: quoted(z.enum(["male", "female"])),
  nationality: quoted(z.string()),
  artistKinds: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.object({
    artistId: z.preprocess((value) => (typeof value === "string" ? Number(value) : value), z.number().int()),
    kind: z.enum(["persona", "grupo", "proyecto", "dudoso"]).catch("dudoso"),
    quote: z.string().catch(""),
    ref: z.string().catch(""),
  }))),
  note: z.preprocess((value) => (typeof value === "string" ? value : null), z.string().nullable()),
});
type PersonAnswer = z.infer<typeof personResponse>;

const PERSON_INSTRUCTIONS = `Tarea: extraer datos de UNA persona (la del expediente) SOLO de los textos dados. No inventes ni uses conocimiento propio.
Entrada: {caseId, name, current, aliases, artists:[{artistId, name, type, role, members}], texts:[{ref, source, about, text}]}.
"name" es como la ficha llama hoy a la persona; puede ser su nombre artístico. "artists" son proyectos de los que es titular o que se llaman igual que ella.
CADA dato (realName, birthDate, birthPlace, deathDate, gender, nationality y cada elemento de otherNames) es un OBJETO {"value": …, "quote": …, "ref": …}, nunca un valor suelto. quote es un fragmento LITERAL (copiado tal cual, máximo 250 caracteres) del texto con ese ref, que contiene el dato. Si un dato no está, null.
Ejemplo: "birthDate": {"value": "1978", "quote": "compositora venezolana nacida en Caracas en 1978", "ref": "a3563"}, "gender": {"value": "female", "quote": "Pianista, cantante y compositora venezolana", "ref": "a3563"}.
- realName: nombre legal o completo de la persona SOLO si el texto lo da como tal («su nombre real es…», «cuyo nombre completo es…», «nacido como…», «Daniel Grau Sosa, conocido como Daniel Grau»). Nunca un seudónimo o apodo. Nunca el nombre de otra persona.
- otherNames: otros nombres artísticos o apodos de la persona que el texto da («también conocido como Alex Cahe», «apodado El Cardenal Sabanero»). Lista de {value, quote, ref}.
- birthDate: fecha de nacimiento como "AAAA", "AAAA-MM" o "AAAA-MM-DD", solo si el texto la da para esta persona.
- birthPlace: ciudad o pueblo donde nació («nacido en Maracaibo», «originario de Valle de la Pascua», «oriunda de Barquisimeto»). Solo el nombre del lugar, sin estado ni país. No el lugar donde reside ni donde se formó una banda.
- deathDate: fecha de fallecimiento ("AAAA", "AAAA-MM" o "AAAA-MM-DD") solo si el texto dice que murió.
- gender: "male" o "female" según cómo el texto se refiere a la persona («cantante venezolana», «nacida», «compositor», «él»). null si no se sabe o si el texto habla de un grupo.
- nationality: gentilicio o país de la persona tal como lo dice el texto («venezolano», «colombiana», «de origen cubano»).
- artistKinds: para CADA artista de "artists": kind = "persona" si ese artista es una sola persona actuando con ese nombre (solista, cantautor, DJ, productor); "grupo" si es una banda, dúo, orquesta o agrupación de varias personas; "proyecto" si es el proyecto de una persona con otros músicos; "dudoso" si no se sabe. quote/ref con la frase que lo muestra.
Si los textos hablan de OTRA persona u otro grupo con el mismo nombre, no extraigas nada de ellos y explícalo en note.
Devuelve {caseId, realName, otherNames, birthDate, birthPlace, deathDate, gender, nationality, artistKinds, note}.`;

// Gentilicios → país (como lo guarda `persons.nationality`).
const DEMONYMS: Array<[RegExp, string]> = [
  [/venezolan[oa]s?|venezuela/u, "Venezuela"], [/colombian[oa]|colombia\b/u, "Colombia"], [/cuban[oa]|\bcuba\b/u, "Cuba"],
  [/argentin[oa]|argentina\b/u, "Argentina"], [/espanol[a]?|espana\b/u, "Spain"], [/estadounidense|norteamerican[oa]|estados unidos/u, "United States"],
  [/mexican[oa]|mexico\b/u, "Mexico"], [/chilen[oa]|\bchile\b/u, "Chile"], [/peruan[oa]|\bperu\b/u, "Peru"], [/puertorriquen[oa]|puerto rico/u, "Puerto Rico"],
  [/dominican[oa]|republica dominicana/u, "Dominican Republic"], [/italian[oa]|italia\b/u, "Italy"], [/portugues[a]?|portugal\b/u, "Portugal"],
  [/brasilen[oa]|brasil\b/u, "Brazil"], [/uruguay[oa]|uruguay\b/u, "Uruguay"], [/ecuatorian[oa]|ecuador\b/u, "Ecuador"], [/panamen[oa]|panama\b/u, "Panama"],
  [/frances[a]?|francia\b/u, "France"], [/aleman[a]?|alemania\b/u, "Germany"], [/britanic[oa]|ingles[a]?|reino unido|inglaterra/u, "United Kingdom"],
  [/canadiense|canada\b/u, "Canada"], [/trinitense|trinidad/u, "Trinidad and Tobago"], [/holandes[a]?|neerlandes[a]?|paises bajos/u, "Netherlands"],
];
const PROFESSIONS = "cantante|artista|pianista|interprete|violinista|guitarrista|baterista|bajista|vocalista|dj|flautista|percusionista|cuatrista|arpista|trompetista|saxofonista|tecladista|cantora|cantor|rapera|rapero|bailarina|bailarin";
// Señales fuertes de género: «música venezolana» no cuenta (es la música, no la persona).
const FEMALE = new RegExp(`\\b(nacida|conocida|compositora|cantautora|productora|actriz|soprano|mezzosoprano|contralto|ella|rapera|cantora|bailarina|(${PROFESSIONS}) (venezolana|colombiana|cubana|argentina|espanola|mexicana|chilena|peruana|dominicana|estadounidense y)|una (${PROFESSIONS}|musica)|la (${PROFESSIONS})|she|her)\\b`, "u");
const MALE = new RegExp(`\\b(nacido|conocido|compositor|cantautor|productor|actor|tenor|baritono|bajo profundo|rapero|cantor|bailarin|(${PROFESSIONS}|musico) (venezolano|colombiano|cubano|argentino|espanol|mexicano|chileno|peruano|dominicano)|un (${PROFESSIONS}|musico)|el (${PROFESSIONS}|musico)|he|his)\\b`, "u");
// Señales sobre el texto normalizado (sin tildes), con palabras enteras: «Nacional» no es «nació».
const BIRTH_CUE = /\b(nacio|nacid[oa]|nace|born|natal)\b/u;
const PLACE_CUE = /\b(nacio|nacid[oa]|nace|born|natal|oriund[oa]|originari[oa]|natural de)\b/u;
const DEATH_CUE = /\b(fallecio|fallecid[oa]|fallecimiento|murio|muerte|died|death|deceso|asesinad[oa]|perdio la vida)\b/u;
const REAL_NAME_CUE = /(nombre (real|completo|de pila|verdadero|de nacimiento|legal|de bautizo)|nacid[oa] como|naci[oó] como|bautizad[oa]|born as|real name|birth name|full name|cuyo nombre|whose name|conocid[oa]|apodad[oa]|seud[oó]nimo|alias)/iu;

/** Quien habla de la persona: su biografía, o la de un proyecto suyo (la de un grupo, solo si la cita la nombra). */
interface Checked { field: string; value: string; quote: string; ref: string; source: string }

function textOf(dossier: PersonDossier, ref: string) { return dossier.texts.find((text) => text.ref === ref) ?? null; }

/**
 * La cita es literal y habla de esta persona: la nombra (por su nombre, un
 * alias o el nombre de su proyecto solista) o es el arranque del texto de su
 * propia ficha o de un proyecto que es solo suyo.
 */
function aboutPerson(dossier: PersonDossier, ref: string, quote: string, kinds: Map<number, string>): string | null {
  const text = textOf(dossier, ref);
  if (!text) return `ref ${ref} no existe`;
  if (!literal(text.text, quote)) return "la cita no está literal";
  const names = [dossier.name, ...dossier.aliases];
  if (names.some((name) => mentions(quote, name) && tokens(name).length)) return null;
  const artistId = /^a(\d+)/u.exec(ref)?.[1];
  const artist = artistId ? dossier.artists.find((item) => item.artistId === Number(artistId)) : null;
  const solo = ref === "p" || (artist && (artist.type === "solo_artist" || kinds.get(artist.artistId) === "persona" || /^titular/iu.test(artist.role ?? "")));
  if (solo && artist && mentions(quote, artist.name)) return null;
  if (solo && normalize(text.text).indexOf(normalize(quote)) < 400) return null;
  return "la cita no nombra a la persona";
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "AAAA", "AAAA-MM" o "AAAA-MM-DD" que la cita sostiene: el año siempre; el mes y el día, solo si también están. */
function dateIn(value: string, quote: string): string | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const flat = normalize(quote);
  if (!flat.includes(year!) || Number(year) < 1850 || Number(year) > 2025) return null;
  if (!month) return year!;
  const m = Number(month);
  if (m < 1 || m > 12) return year!;
  const monthIn = flat.includes(MONTHS[m - 1]!) || flat.includes(MONTHS_EN[m - 1]!) || new RegExp(`\\b0?${m}[/.-]`, "u").test(flat);
  if (!monthIn) return year!;
  if (!day) return `${year}-${month}`;
  const d = Number(day);
  const dayIn = new RegExp(`(?<!\\d)0?${d}(?!\\d)`, "u").test(flat.replace(year!, ""));
  const date = new Date(Date.UTC(Number(year), m - 1, d));
  return dayIn && date.getUTCDate() === d ? `${year}-${month}-${day}` : `${year}-${month}`;
}

/** Nombre real utilizable: dos palabras o más, solo letras. */
function cleanRealName(value: string): string | null {
  const cleaned = value.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/[«»"“”]/gu, "").replace(/\s+/gu, " ").trim();
  if (cleaned.split(" ").length < 2 || cleaned.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{M}.'’ -]+$/u.test(cleaned)) return null;
  return cleaned;
}

/** ¿El nombre de la ficha ya es una forma del nombre real? (mismo criterio que plan-canserbero-extendido.ts) */
function isFormOfRealName(current: string, real: string): boolean {
  if ([...tokens(current)].sort().join(" ") === [...tokens(real)].sort().join(" ")) return true;
  const mine = tokens(current).slice(1);
  const theirs = tokens(real).slice(1);
  return mine.some((token) => theirs.some((other) => close(token, other)));
}

function validatePerson(dossier: PersonDossier, answer: PersonAnswer): { facts: Checked[]; kinds: Array<{ artistId: number; kind: string; quote: string }>; problems: string[] } {
  const problems: string[] = [];
  const facts: Checked[] = [];
  const kinds = new Map<number, string>();
  const kindRows: Array<{ artistId: number; kind: string; quote: string }> = [];
  for (const item of answer.artistKinds) {
    const artist = dossier.artists.find((candidate) => candidate.artistId === item.artistId);
    if (!artist) { problems.push(`artistId ${item.artistId} no está en el expediente`); continue; }
    if (item.kind === "dudoso") continue;
    const text = textOf(dossier, item.ref);
    if (!text || !literal(text.text, item.quote)) { problems.push(`tipo de «${artist.name}»: la cita no está literal`); continue; }
    kinds.set(item.artistId, item.kind);
    kindRows.push({ artistId: item.artistId, kind: item.kind, quote: item.quote });
  }
  // Si algún proyecto suyo es un grupo, el texto de ese grupo no habla de la persona.
  const groupRefs = new Set(dossier.artists.filter((artist) => kinds.get(artist.artistId) === "grupo").map((artist) => `a${artist.artistId}`));
  const accept = (field: string, item: { value: string; quote: string; ref: string } | null, extra: (quote: string, value: string) => string | null) => {
    if (!item) return;
    const ref = item.ref;
    if ([...groupRefs].some((group) => ref === group || ref.startsWith(`${group}s`))) { problems.push(`${field}: el texto es de un grupo`); return; }
    const problem = aboutPerson(dossier, ref, item.quote, kinds) ?? extra(item.quote, item.value);
    if (problem) { problems.push(`${field}: ${problem}`); return; }
    facts.push({ field, value: item.value, quote: item.quote, ref, source: textOf(dossier, ref)!.source });
  };
  accept("realName", answer.realName, (quote, value) => {
    const real = cleanRealName(value);
    if (!real) return "no parece un nombre completo";
    if (!tokens(real).every((token) => tokens(quote).some((other) => close(token, other)))) return "el nombre no está entero en la cita";
    if (!REAL_NAME_CUE.test(quote)) return "la cita no dice que sea su nombre real";
    // «X, conocido como Y»: el nombre real va antes de «conocido»; lo que va después es el artístico.
    const flat = normalize(quote);
    const cue = flat.search(/conocid|apodad|alias|seudonimo/u);
    if (cue >= 0 && !/(nombre (real|completo|de pila|verdadero)|nacid[oa] como|cuyo nombre|bautizad)/u.test(flat)) {
      const at = flat.indexOf(normalize(real).split(" ")[0]!);
      if (at < 0 || at > cue) return "el nombre va después de «conocido como»: es un nombre artístico";
    }
    return null;
  });
  for (const other of answer.otherNames.slice(0, 6)) {
    accept("alias", other, (quote, value) => {
      if (value.trim().length < 2 || value.length > 40 || value.split(/\s+/u).length > 4 || !mentions(quote, value)) return "el alias no está en la cita";
      if (!/(conocid[oa]|apodad[oa]|apodo|seud[oó]nimo|alias|\baka\b|nombre art[ií]stico|firm[oó]|llamad[oa]|bautizad[oa]|called)/iu.test(quote)) return "la cita no lo da como nombre";
      if (DEMONYMS.some(([pattern]) => pattern.test(normalize(value)))) return "es una descripción, no un nombre";
      return null;
    });
  }
  accept("birthDate", answer.birthDate, (quote, value) => (!BIRTH_CUE.test(normalize(quote)) && !/\(\s*[\p{L}][^)]*(19|20)\d\d\s*\)|\((19|20)\d\d\s*[-–]/u.test(quote) ? "la cita no habla de nacimiento" : dateIn(value, quote) ? null : "la fecha no está en la cita"));
  accept("birthPlace", answer.birthPlace, (quote, value) => {
    if (!PLACE_CUE.test(normalize(quote)) && !/\(\s*[\p{Lu}][^)]*,\s*\d/u.test(quote)) return "la cita no habla de nacimiento";
    if (!normalize(quote).includes(normalize(value)) || value.length > 60 || !/^[\p{L}][\p{L}\p{M} .'’-]+$/u.test(value)) return "el lugar no está en la cita";
    if (/^(venezuela|caracas, venezuela)$/iu.test(value.trim()) && normalize(value) === "venezuela") return "es un país, no una ciudad";
    if (DEMONYMS.some(([, country]) => normalize(country) === normalize(value))) return "es un país, no una ciudad";
    return null;
  });
  accept("deathDate", answer.deathDate, (quote, value) => (!DEATH_CUE.test(normalize(quote)) && !/\u2020|[-–]\s*(19|20)\d\d\s*\)/u.test(quote) ? "la cita no habla de su muerte" : dateIn(value, quote) ? null : "la fecha no está en la cita"));
  accept("gender", answer.gender, (quote, value) => {
    const flat = normalize(quote);
    const female = FEMALE.test(flat); const male = MALE.test(flat);
    if (female && male) return "la cita tiene señales de los dos géneros";
    if (value === "female" ? female : male) return null;
    return "la cita no muestra el género";
  });
  accept("nationality", answer.nationality, (quote, value) => {
    if (!DEMONYMS.some(([pattern]) => pattern.test(normalize(quote)))) return "la cita no da un país";
    if (/(origen|ascendencia|descendiente|descendencia|padres|hij[oa] de)/iu.test(quote) && !/venezolan/iu.test(normalize(value))) return "la cita habla de su origen, no de su nacionalidad";
    return null;
  });
  return { facts, kinds: kindRows, problems };
}

interface PersonOutput { caseId: string; personId: number; name: string; facts: Checked[]; kinds: Array<{ artistId: number; kind: string; quote: string }>; note: string | null; dropped: string[]; model: string }

async function extract<D extends { caseId: string }, O extends { caseId: string }>(dossiersFile: string, outFile: string,
  run: (dossier: D, gateway: ReturnType<typeof createDeepSeekGateway>) => Promise<O>, filter: (dossier: D) => boolean): Promise<void> {
  const concurrency = Number(arg("concurrency") ?? 24);
  const limit = Number(arg("limit") ?? Infinity);
  const done = new Map(readJsonl<O>(outFile).map((row) => [row.caseId, row]));
  const pending = readJsonl<D>(dossiersFile).filter(filter).filter((dossier) => !done.has(dossier.caseId)).slice(0, limit);
  const gateway = createDeepSeekGateway();
  const stats = { pending: pending.length, written: 0, failed: [] as Array<{ caseId: string; error: string }> };
  let dirty = 0;
  const flush = () => writeJsonl(outFile, [...done.values()]);
  const queue = [...pending];
  const worker = async () => {
    for (let dossier = queue.shift(); dossier; dossier = queue.shift()) {
      try {
        done.set(dossier.caseId, await run(dossier, gateway));
        stats.written += 1;
        if (++dirty >= 25) { flush(); dirty = 0; }
        if (stats.written % 250 === 0) console.error(`${stats.written}/${pending.length}`);
      } catch (error) {
        stats.failed.push({ caseId: dossier.caseId, error: (error as Error).message.slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  flush();
  writeJsonl(outFile.replace(/\.jsonl$/u, "-fallos.jsonl"), stats.failed);
  console.log(JSON.stringify({ ...stats, failed: stats.failed.length }, null, 2));
}

/** ¿Falta algo que el texto pueda dar? Las fichas completas no se mandan. */
function personNeedsWork(dossier: PersonDossier): boolean {
  const c = dossier.current;
  return !c.realName || !c.birth || !c.birthCity || !c.gender || !c.nationality || (c.deceased === true && !c.death)
    || dossier.artists.some((artist) => artist.type !== "solo_artist") || /muri|falleci/iu.test(dossier.texts.map((text) => text.text).join(" "));
}

async function personasExtraer(): Promise<void> {
  await extract<PersonDossier, PersonOutput>(PERSON_DOSSIERS, PERSON_EXTRACTION, async (dossier, gateway) => {
    const ask = (fix?: string) => gateway.propose({
      taskKind: "narrative_extraction", modelClass: "fast", schemaVersion: PERSON_SCHEMA_VERSION, instructions: PERSON_INSTRUCTIONS, responseSchema: personResponse,
      input: fix ? { ...dossier, correccion: fix } : dossier,
    });
    let result = await ask();
    let checked = validatePerson(dossier, result.proposal);
    const fixable = checked.problems.filter((problem) => /literal|no existe|no nombra|no está en la cita/u.test(problem));
    if (fixable.length) {
      const retry = await ask(`Tu respuesta anterior tuvo estos errores: ${fixable.slice(0, 12).join("; ")}. Cada dato debe ser un objeto {"value", "quote", "ref"} con una cita LITERAL del texto con ese ref que contenga el dato y hable de esta persona; si no hay cita, null.`);
      const second = validatePerson(dossier, retry.proposal);
      if (second.facts.length + second.kinds.length >= checked.facts.length + checked.kinds.length) { result = retry; checked = second; }
    }
    return { caseId: dossier.caseId, personId: dossier.personId, name: dossier.name, facts: checked.facts, kinds: checked.kinds, note: result.proposal.note, dropped: checked.problems, model: result.model };
  }, (dossier) => (!ONLY || ONLY.includes(dossier.personId)) && personNeedsWork(dossier));
}

// ── Aplicar personas ───────────────────────────────────────────────────────
interface Correction { op: string; [key: string]: unknown }

async function personasAplicar(): Promise<void> {
  const dossiers = new Map(readJsonl<PersonDossier>(PERSON_DOSSIERS).map((dossier) => [dossier.personId, dossier]));
  const outputs = readJsonl<PersonOutput>(PERSON_EXTRACTION).filter((row) => !ONLY || ONLY.includes(row.personId));
  const live = new Map((await pool.query<{ id: string; name: string; real_name: string | null; birth: string | null; birth_city: string | null; death: string | null;
    is_deceased: boolean | null; gender: string | null; nationality: string | null; is_venezuelan: boolean | null }>(`
    SELECT id::text, name, real_name, birth_date_value AS birth, birth_city, death_date_value AS death, is_deceased, gender, nationality, is_venezuelan
      FROM public.persons WHERE id = ANY($1::bigint[])`, [outputs.map((row) => row.personId)])).rows.map((row) => [Number(row.id), row]));
  const allNames = new Map<string, number[]>();
  for (const row of (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons")).rows) {
    allNames.set(keyOf(row.name), [...(allNames.get(keyOf(row.name)) ?? []), Number(row.id)]);
  }
  // Nombres de pila frecuentes en el catálogo: «Claudio Corsi» es una persona aunque su grupo se llame igual.
  const ARTICLES = new Set(["los", "las", "el", "la", "the", "dj", "mc", "grupo", "banda", "orquesta", "conjunto", "trio", "cuarteto", "quinteto", "proyecto"]);
  const givenNames = new Map<string, number>();
  for (const key of allNames.keys()) { const first = key.split(" ")[0]; if (first) givenNames.set(first, (givenNames.get(first) ?? 0) + 1); }
  // Revisados a mano en el ensayo del 2026-10-13: nombres de persona con pila poco frecuente.
  const HUMAN = new Set(["ale ramirez", "carmencita moleiro"]);
  const looksHuman = (name: string) => { if (HUMAN.has(keyOf(name))) return true; const words = keyOf(name).split(" "); return words.length >= 2 && words.length <= 4 && !ARTICLES.has(words[0]!) && (givenNames.get(words[0]!) ?? 0) >= 4; };
  const artistsLive = new Map((await pool.query<{ id: string; name: string; artist_type: string; disbanded_year: number | null }>(
    "SELECT id::text, name, artist_type::text, disbanded_year FROM public.artists")).rows.map((row) => [Number(row.id), row]));
  const memberships = (await pool.query<{ id: string; artist_id: string; person_id: string; role: string }>(
    "SELECT id::text, artist_id::text, person_id::text, role FROM public.artist_members")).rows;
  const membershipsOf = new Map<number, typeof memberships>();
  for (const row of memberships) membershipsOf.set(Number(row.person_id), [...(membershipsOf.get(Number(row.person_id)) ?? []), row]);

  const updates: Array<{ personId: number; name: string; field: string; column: string; value: string | boolean; quote: string; source: string }> = [];
  const contradictions: Array<{ personId: number; name: string; field: string; stored: string; text: string; quote: string; source: string }> = [];
  const corrections: Correction[] = [];
  const renameSkipped: Array<{ personId: number; name: string; real: string; reason: string }> = [];
  const retype: Array<{ artistId: number; name: string; from: string; personId: number; person: string; quote: string; membershipId: number | null; role: string | null }> = [];
  const toArtist: Array<{ personId: number; person: string; artistId: number; artist: string; quote: string }> = [];
  const kindSkipped: Array<{ personId: number; person: string; artist: string; kind: string; reason: string }> = [];
  const renamedTo = new Map<number, string>();

  for (const output of outputs) {
    const person = live.get(output.personId);
    const dossier = dossiers.get(output.personId);
    if (!person || !dossier) continue;
    // Una «persona» que es un grupo: no se le pone nada de persona.
    const sameNameGroup = output.kinds.find((item) => item.kind === "grupo" && keyOf(artistsLive.get(item.artistId)?.name ?? "") === keyOf(person.name));
    if (sameNameGroup) {
      const artist = artistsLive.get(sameNameGroup.artistId)!;
      const others = (membershipsOf.get(output.personId) ?? []).filter((row) => Number(row.artist_id) !== sameNameGroup.artistId);
      const ownBioHuman = dossier.texts.some((text) => text.ref === "p") && output.facts.some((fact) => ["birthDate", "birthPlace", "gender", "realName"].includes(fact.field) && fact.ref === "p");
      const own = (membershipsOf.get(output.personId) ?? []).find((row) => Number(row.artist_id) === sameNameGroup.artistId);
      if (looksHuman(person.name)) kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "grupo", reason: "el nombre parece de una persona (grupo que lleva su nombre): revisar a mano" });
      else if (own) kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "grupo", reason: `figura como integrante («${own.role}») del grupo homónimo: revisar a mano` });
      else if (others.length) kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "grupo", reason: `también es integrante de otros artistas (${others.map((row) => row.artist_id).join(", ")})` });
      else if (ownBioHuman) kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "grupo", reason: "su propia biografía la describe como persona" });
      else if (!["band", "group", "duo"].includes(artist.artist_type)) kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "grupo", reason: `el artista es de tipo ${artist.artist_type}` });
      else toArtist.push({ personId: output.personId, person: person.name, artistId: sameNameGroup.artistId, artist: artist.name, quote: sameNameGroup.quote });
      continue;
    }
    // Grupo cuya biografía describe a una sola persona → solista, y su persona, titular.
    for (const item of output.kinds.filter((kind) => kind.kind === "persona")) {
      const artist = artistsLive.get(item.artistId);
      if (!artist || !["band", "group", "duo"].includes(artist.artist_type)) continue;
      const own = (membershipsOf.get(output.personId) ?? []).find((row) => Number(row.artist_id) === item.artistId) ?? null;
      const sameName = keyOf(artist.name) === keyOf(person.name) || dossier.aliases.some((alias) => keyOf(alias) === keyOf(artist.name));
      if (!sameName && !own) continue;
      const titulares = memberships.filter((row) => Number(row.artist_id) === item.artistId && /^titular/iu.test(row.role) && Number(row.person_id) !== output.personId);
      if (titulares.length) { kindSkipped.push({ personId: output.personId, person: person.name, artist: artist.name, kind: "persona", reason: "el artista ya tiene otro titular" }); continue; }
      retype.push({ artistId: item.artistId, name: artist.name, from: artist.artist_type, personId: output.personId, person: person.name, quote: item.quote,
        membershipId: own ? Number(own.id) : null, role: own?.role ?? null });
      artist.artist_type = "solo_artist";
    }

    const byField = new Map<string, Checked>();
    for (const fact of output.facts) if (fact.field !== "alias" && !byField.has(fact.field)) byField.set(fact.field, fact);
    const fill = (field: string, column: string, stored: string | null, value: string | boolean, fact: Checked, same: (a: string, b: string) => boolean) => {
      if (stored === null || stored === "") { updates.push({ personId: output.personId, name: person.name, field, column, value, quote: fact.quote, source: fact.source }); return; }
      if (!same(String(stored), String(value))) contradictions.push({ personId: output.personId, name: person.name, field, stored: String(stored), text: String(value), quote: fact.quote, source: fact.source });
    };
    const sameDate = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
    const birth = byField.get("birthDate");
    const death = byField.get("deathDate");
    const birthValue = birth ? dateIn(birth.value, birth.quote) : null;
    const deathValue = death ? dateIn(death.value, death.quote) : null;
    const birthYear = Number((birthValue ?? person.birth ?? "").slice(0, 4)) || null;
    const deathYear = Number((deathValue ?? person.death ?? "").slice(0, 4)) || null;
    const datesOk = !(birthYear && deathYear && deathYear < birthYear);
    if (birth && birthValue && datesOk) fill("nacimiento", "birth_date_value", person.birth, birthValue, birth, sameDate);
    if (death && deathValue && datesOk) {
      fill("fallecimiento", "death_date_value", person.death, deathValue, death, sameDate);
      if (person.is_deceased === null) updates.push({ personId: output.personId, name: person.name, field: "fallecido", column: "is_deceased", value: true, quote: death.quote, source: death.source });
    }
    const place = byField.get("birthPlace");
    if (place) fill("ciudad de nacimiento", "birth_city", person.birth_city, place.value.trim(), place, (a, b) => keyOf(a) === keyOf(b) || keyOf(a).includes(keyOf(b)) || keyOf(b).includes(keyOf(a)));
    const gender = byField.get("gender");
    if (gender) fill("género", "gender", person.gender, gender.value, gender, (a, b) => a === b);
    const nationality = byField.get("nationality");
    // El país sale del valor que da el modelo (validado contra la cita); dos gentilicios («cubano-venezolano») no fijan nacionalidad.
    const countries = nationality ? [...new Set(DEMONYMS.filter(([pattern]) => pattern.test(normalize(nationality.value)) && pattern.test(normalize(nationality.quote))).map(([, country]) => country))] : [];
    if (nationality && countries.length === 1) fill("nacionalidad", "nationality", person.nationality, countries[0]!, nationality, (a, b) => keyOf(a) === keyOf(b) || (b !== "Venezuela" && a !== "Venezuela"));
    if (nationality && countries.includes("Venezuela") && person.is_venezuelan === null) updates.push({ personId: output.personId, name: person.name, field: "venezolano", column: "is_venezuelan", value: true, quote: nationality.quote, source: nationality.source });

    // Nombre real (caso Canserbero).
    const realFact = byField.get("realName");
    const real = realFact ? cleanRealName(realFact.value) : null;
    let currentName = person.name;
    // Si la ficha ya guarda otro nombre real, la biografía no decide: queda solo la contradicción.
    const realConflict = !!(realFact && real && person.real_name && keyOf(person.real_name) !== keyOf(real) && !isFormOfRealName(person.real_name, real));
    if (realConflict) contradictions.push({ personId: output.personId, name: person.name, field: "nombre real", stored: person.real_name!, text: real!, quote: realFact!.quote, source: realFact!.source });
    if (realFact && real && !realConflict && keyOf(real) !== keyOf(person.name)) {
      if (!person.real_name) updates.push({ personId: output.personId, name: person.name, field: "nombre real", column: "real_name", value: real, quote: realFact.quote, source: realFact.source });
      const why = `«${person.name}» es el nombre artístico; la persona se llama «${real}» (${realFact.source}: «${realFact.quote}»). El nombre artístico queda de alias (caso Canserbero).`;
      if (isFormOfRealName(person.name, real)) {
        corrections.push({ op: "add_alias", person: { id: output.personId, name: person.name }, alias: real, why: `Nombre completo de la persona (${realFact.source}); la ficha ya lleva una forma de ese nombre.` });
      } else {
        const collision = (allNames.get(keyOf(real)) ?? []).filter((id) => id !== output.personId);
        if (collision.length) {
          renameSkipped.push({ personId: output.personId, name: person.name, real, reason: `«${real}» ya es el nombre de otra ficha (${collision.join(", ")}); se decide con la regla de proyecto común` });
          corrections.push({ op: "add_alias", person: { id: output.personId, name: person.name }, alias: real, why: `Nombre real según la biografía; no se renombra porque ya es el nombre de otra ficha.` });
        } else {
          corrections.push({ op: "rename", person: { id: output.personId, name: person.name }, to: real, keepOldNameAsAlias: true, why });
          allNames.set(keyOf(real), [output.personId]);
          renamedTo.set(output.personId, real);
          currentName = real;
        }
      }
    }
    for (const alias of output.facts.filter((fact) => fact.field === "alias")) {
      const value = alias.value.trim();
      if (keyOf(value) === keyOf(currentName) || keyOf(value) === keyOf(person.name) || dossier.aliases.some((item) => keyOf(item) === keyOf(value))) continue;
      if (real && keyOf(value) === keyOf(real)) continue;
      corrections.push({ op: "add_alias", person: { id: output.personId, name: currentName }, alias: value, why: `Otro nombre de la persona según ${alias.source}: «${alias.quote}».` });
    }
  }

  // Los alias de una persona renombrada deben ir después del renombre (el plan valida el nombre actual).
  const ordered = [...corrections.filter((item) => item.op === "rename"), ...corrections.filter((item) => item.op !== "rename")];
  const plan = { decidedAt: TODAY, evidence: "Datos ricos de las biografías (Brian, 2026-10-13): nombre real con cita (caso Canserbero) y otros nombres. Ver scripts/primo-datos-ricos.mts.", corrections: ordered };
  const absorbPlan = { decidedAt: TODAY, evidence: "Datos ricos de las biografías (Brian, 2026-10-13): «personas» que son una banda (la biografía del artista homónimo describe un grupo) pasan al artista con sus créditos.",
    corrections: toArtist.map((item) => ({ op: "to_artist", person: { id: item.personId, name: item.person }, artist: { id: item.artistId, name: item.artist }, keepNameAsAlias: false,
      why: `La biografía del artista homónimo describe un grupo: «${item.quote.slice(0, 200)}».` })) };
  const fieldCount = new Map<string, number>();
  for (const item of updates) fieldCount.set(item.field, (fieldCount.get(item.field) ?? 0) + 1);
  const label = confirm ? "aplicado" : "ensayo";
  writeFileSync(`${DIR}/personas-plan-nombres.json`, `${JSON.stringify(plan, null, 2)}\n`);
  writeFileSync(`${DIR}/personas-plan-a-banda.json`, `${JSON.stringify(absorbPlan, null, 2)}\n`);
  writeJsonl(`${DIR}/personas-campos-${label}.jsonl`, updates);
  writeJsonl(`${DIR}/contradicciones.jsonl`, contradictions);
  writeFileSync(`${DIR}/personas-${label}.md`, [
    `# Datos de persona desde las biografías — ${label}`, "",
    `${outputs.length} personas leídas.`, "",
    "## Campos vacíos que se rellenan", "", ...[...fieldCount.entries()].map(([field, count]) => `- ${field}: ${count}`), "",
    `## Nombres (caso Canserbero)`, "",
    `${ordered.filter((item) => item.op === "rename").length} renombres; ${ordered.filter((item) => item.op === "add_alias").length} alias; ${renameSkipped.length} sin renombrar por choque con otra ficha.`, "",
    ...ordered.filter((item) => item.op === "rename").map((item) => `- ${(item["person"] as { name: string }).name} → **${String(item["to"])}** — ${String(item["why"]).slice(0, 300)}`), "",
    "### Sin renombrar", "", ...renameSkipped.map((item) => `- ${item.name} (${item.personId}) → ${item.real}: ${item.reason}`), "",
    `## Grupos que son una persona → solista (${retype.length})`, "",
    ...retype.map((item) => `- **${item.name}** (${item.artistId}, ${item.from}) · titular ${item.person} (${item.personId})${item.role ? ` [antes «${item.role}»]` : " [se enlaza]"} — «${item.quote.slice(0, 200)}»`), "",
    `## «Personas» que son una banda → la banda (${toArtist.length})`, "",
    ...toArtist.map((item) => `- ${item.person} (${item.personId}) → artista ${item.artist} (${item.artistId}) — «${item.quote.slice(0, 200)}»`), "",
    `## Tipos sin tocar (${kindSkipped.length})`, "", ...kindSkipped.map((item) => `- ${item.person} (${item.personId}) / ${item.artist}: ${item.kind} — ${item.reason}`), "",
    `## Contradicciones con lo guardado (${contradictions.length}, no se pisan)`, "",
    ...contradictions.map((item) => `- ${item.name} (${item.personId}) · ${item.field}: guardado «${item.stored}», la biografía dice «${item.text}» — «${item.quote.slice(0, 200)}» (${item.source})`), "",
    "## Muestra de campos", "", ...updates.slice(0, 300).map((item) => `- ${item.name} (${item.personId}) · ${item.field} = ${String(item.value)} — «${item.quote.slice(0, 160)}»`),
  ].join("\n") + "\n");
  console.log(JSON.stringify({ persons: outputs.length, fields: Object.fromEntries(fieldCount), renames: ordered.filter((item) => item.op === "rename").length,
    aliases: ordered.filter((item) => item.op === "add_alias").length, renameSkipped: renameSkipped.length, retype: retype.length, toArtist: toArtist.length,
    kindSkipped: kindSkipped.length, contradictions: contradictions.length }, null, 2));
  if (!confirm) return;

  const { runId, result } = await withOperatorRun({ name: "datos-ricos:personas", operator: "claude-code",
    note: `${NOTE}: campos vacíos de persona (nacimiento, ciudad, fallecimiento, género, nacionalidad, venezolano, nombre real) y tipos solista/titular, con cita (DeepSeek flash propone, el código valida)` }, async (context) => {
    let fields = 0; let retyped = 0; let titulares = 0; let linked = 0;
    for (const item of updates) {
      const done = await context.client.query(`UPDATE public.persons SET ${item.column} = $2, updated_at = now() WHERE id = $1 AND ${item.column} IS NULL`, [item.personId, item.value]);
      fields += done.rowCount ?? 0;
    }
    for (const item of retype) {
      const done = await context.client.query("UPDATE public.artists SET artist_type = 'solo_artist', updated_at = now() WHERE id = $1 AND artist_type::text = $2", [item.artistId, item.from]);
      retyped += done.rowCount ?? 0;
      if (item.membershipId !== null) {
        const role = await context.client.query("UPDATE public.artist_members SET role = 'Titular del proyecto' WHERE id = $1 AND role NOT ILIKE 'Titular%'", [item.membershipId]);
        titulares += role.rowCount ?? 0;
      } else {
        await context.client.query("INSERT INTO public.artist_members(artist_id, person_id, role, is_current) VALUES ($1, $2, 'Titular del proyecto', false)", [item.artistId, item.personId]);
        linked += 1;
      }
    }
    return { fields, retyped, titulares, linked };
  });
  console.log(`run ${runId}:`, result);
}

// ════════════════════════════════════════════════════════════════════════════
// Periodos de integrantes
// ════════════════════════════════════════════════════════════════════════════
const PERIOD_DOSSIERS = `${DIR}/periodos-expedientes.jsonl`;
const PERIOD_EXTRACTION = `${DIR}/periodos-extraccion.jsonl`;

interface PeriodDossier {
  caseId: string; artistId: number; name: string; formedYear: number | null; disbandedYear: number | null; status: string | null;
  members: Array<{ memberId: number; name: string; role: string; fromYear: number | null; toYear: number | null; current: boolean; complete: boolean }>;
  texts: Source[];
}

async function periodosExpedientes(): Promise<void> {
  const sources = artistSources();
  const { rows } = await pool.query<{ artist_id: string; name: string; biography: string | null; formed_year: number | null; disbanded_year: number | null; status: string | null;
    members: PeriodDossier["members"] }>(`
    SELECT a.id::text AS artist_id, a.name, a.biography, a.formed_year, a.disbanded_year, a.status::text AS status,
           jsonb_agg(jsonb_build_object('memberId', m.id, 'name', p.name, 'role', m.role, 'fromYear', m.from_year, 'toYear', m.to_year, 'current', m.is_current,
             'complete', m.from_year IS NOT NULL AND (m.to_year IS NOT NULL OR m.is_current)) ORDER BY m.id) AS members
      FROM public.artists a JOIN public.artist_members m ON m.artist_id = a.id JOIN public.persons p ON p.id = m.person_id
     GROUP BY a.id
    HAVING count(*) >= 2 AND bool_or(NOT (m.from_year IS NOT NULL AND (m.to_year IS NOT NULL OR m.is_current)))
     ORDER BY a.id`);
  const out = rows.map((row): PeriodDossier => ({
    caseId: `artist:${row.artist_id}`, artistId: Number(row.artist_id), name: row.name, formedYear: row.formed_year, disbandedYear: row.disbanded_year, status: row.status,
    members: row.members,
    texts: [...(row.biography?.trim() ? [{ ref: "bio", source: "biografía CRV", text: row.biography.slice(0, 8000) }] : []),
      ...(sources.get(Number(row.artist_id)) ?? []).map((source, index) => ({ ...source, ref: `s${index + 1}` }))],
  })).filter((dossier) => dossier.texts.length && /(19|20)\d\d|actual|hoy|sigue|current|present/iu.test(dossier.texts.map((text) => text.text).join(" ")));
  writeJsonl(PERIOD_DOSSIERS, out);
  console.log(JSON.stringify({ bands: rows.length, withTexts: out.length }));
}

const PERIOD_SCHEMA_VERSION = "crv-member-periods.v3";
const yearOrNull = z.preprocess((value) => (typeof value === "string" && /^\d{4}$/u.test(value) ? Number(value) : typeof value === "number" ? value : null), z.number().int().nullable());
const evidenceOrNull = z.preprocess((value) => (value && typeof value === "object" && "quote" in value ? value : null), z.object({ quote: z.string(), ref: z.string() }).nullable());
const periodResponse = z.object({
  caseId: z.string(),
  members: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.object({
    memberId: z.preprocess((value) => (typeof value === "string" ? Number(value) : value), z.number().int()),
    fromYear: yearOrNull, fromEvidence: evidenceOrNull,
    toYear: yearOrNull, toEvidence: evidenceOrNull,
    current: z.preprocess((value) => (typeof value === "boolean" ? value : null), z.boolean().nullable()), currentEvidence: evidenceOrNull,
  }))),
  note: z.preprocess((value) => (typeof value === "string" ? value : null), z.string().nullable()),
});
type PeriodAnswer = z.infer<typeof periodResponse>;

const PERIOD_INSTRUCTIONS = `Tarea: completar el periodo de los integrantes YA REGISTRADOS de una banda, SOLO con los textos del expediente.
Entrada: {caseId, name, formedYear, disbandedYear, status, members:[{memberId, name, role, fromYear, toYear, current, complete}], texts:[{ref, source, text}]}.
Solo interesan los integrantes con complete=false. Para cada uno, y solo si el texto lo dice para ESA persona:
- fromYear: año en que entró (o el año de fundación si el texto dice que fue fundador o de la formación original y da ese año). fromEvidence {quote, ref}.
- toYear: año en que salió («dejó la banda en 1993», «hasta 2004», «(1985–1990)»). toEvidence {quote, ref}.
- current: true si el texto dice que hoy sigue en la banda («actualmente», «la formación actual», «hoy la integran», «sigue siendo», «currently»), o si describe la formación en presente («La integran X, Y y Z», «está integrada por») y la banda no está disuelta; false si dice que salió sin dar año. currentEvidence {quote, ref}.
Cada evidencia es un OBJETO {"quote": …, "ref": …}. En Sincopa, «(1985-)» junto a un integrante es su año de entrada y que sigue; «(1974)» solo, de un exintegrante, es su año de salida.
Cada quote es un fragmento LITERAL (máximo 250 caracteres) del texto con ese ref, que nombra a la persona (nombre o apellido) y contiene el año o la palabra que lo prueba.
No uses décadas («los años 80») como año. No agregues personas nuevas. Omite a los integrantes sin nada.
Si los textos hablan de otra banda homónima, ignóralos y explícalo en note.
Devuelve {caseId, members:[{memberId, fromYear, fromEvidence, toYear, toEvidence, current, currentEvidence}], note}.`;

// Sobre el texto normalizado (sin tildes) y con palabras enteras: «Castillo» no es «still».
const CURRENT_CUE = /\b(actualmente|actual|hoy|hoy en dia|sigue|siguen|continua|continuan|currently|present|today|still|la integran|lo integran|esta integrad[oa]|esta conformad[oa]|esta compuest[oa]|esta formad[oa]|la conforman|lo conforman)\b/u;
const PAST_CUE = /\b(dejo|salio|abandono|se retiro|reemplaz\w*|sustitu\w*|se separo|left|replaced|quit|hasta|ex ?integrante|former|ha contado|han pasado|conto|integraron|integraba|integraban|conformaban|conformaron|fue|fueron|estuvo|estaba|incluia|paso por|pasaron)\b/u;
const FOUNDING_CUE = /\b(fundad[oa]s?|fundo|fundaron|formad[oa]|formo|formaron|formacion original|nucleo inicial|original|creada|creado|creo|crearon|inicio|iniciaron|nacio|surgio|founded|formed)\b/u;

/** Posiciones de cada palabra del texto normalizado. */
function spans(text: string): Array<{ token: string; at: number }> {
  const flat = normalize(text).replace(/[^a-z0-9 ]/gu, " ");
  return [...flat.matchAll(/[a-z0-9]{3,}/gu)].map((match) => ({ token: match[0], at: match.index ?? 0 }));
}
/** La cita nombra a la persona con dos palabras de su nombre (o la única que tenga); devuelve dónde. */
function namedAt(quote: string, name: string): number[] | null {
  const words = [...new Set(tokens(name))];
  if (!words.length) return null;
  const found = spans(quote);
  const hits = words.map((word) => found.filter((item) => close(item.token, word)).map((item) => item.at));
  if (hits.filter((list) => list.length).length < Math.min(2, words.length)) return null;
  return hits.flat();
}
interface PeriodChecked { memberId: number; name: string; fromYear: number | null; toYear: number | null; current: boolean | null; quotes: string[] }

function validatePeriods(dossier: PeriodDossier, answer: PeriodAnswer): { clean: PeriodChecked[]; problems: string[] } {
  const problems: string[] = [];
  const clean: PeriodChecked[] = [];
  const byId = new Map(dossier.members.map((member) => [member.memberId, member]));
  const vague = (year: number, quote: string) => new RegExp(`(?:d[eé]cada\\s+de(?:\\s+los)?|a[nñ]os)\\s+${year}|${year}\\s*'?s\\b`, "iu").test(quote);
  for (const item of answer.members) {
    const member = byId.get(item.memberId);
    if (!member) { problems.push(`memberId ${item.memberId} no existe`); continue; }
    if (member.complete) continue;
    const check = (label: string, evidence: { quote: string; ref: string } | null, test: (quote: string) => boolean): string | null => {
      if (!evidence) { problems.push(`«${member.name}» ${label}: sin cita`); return null; }
      const text = dossier.texts.find((candidate) => candidate.ref === evidence.ref)?.text;
      if (!literal(text, evidence.quote)) { problems.push(`«${member.name}» ${label}: la cita no está literal`); return null; }
      if (!namedAt(evidence.quote, member.name)) { problems.push(`«${member.name}» ${label}: la cita no nombra a la persona`); return null; }
      if (!test(evidence.quote)) { problems.push(`«${member.name}» ${label}: la cita no lo prueba`); return null; }
      return evidence.quote;
    };
    // El año va con esta persona si en la cita no hay otro integrante más cerca de él.
    const yearIsTheirs = (quote: string, year: number) => {
      const flat = normalize(quote).replace(/[^a-z0-9 ]/gu, " ");
      const at = [...flat.matchAll(new RegExp(`(?<!\\d)${year}(?!\\d)`, "gu"))].map((match) => match.index ?? 0);
      if (!at.length) return false;
      const distance = (positions: number[] | null) => (positions?.length ? Math.min(...positions.flatMap((p) => at.map((y) => Math.abs(p - y)))) : Infinity);
      const mine = distance(namedAt(quote, member.name));
      return dossier.members.every((other) => other.memberId === member.memberId || keyOf(other.name) === keyOf(member.name) || distance(namedAt(quote, other.name)) >= mine);
    };
    // «Formada en 1997. Está integrada por…»: la lista en presente no dice quién estaba en 1997.
    const founding = (quote: string, year: number) => FOUNDING_CUE.test(normalize(quote)) && !CURRENT_CUE.test(normalize(quote))
      && (dossier.formedYear === null || dossier.formedYear === year) && normalize(quote).includes(String(year));
    const quotes: string[] = [];
    let fromYear: number | null = null; let toYear: number | null = null; let current: boolean | null = null;
    if (item.fromYear !== null && member.fromYear === null) {
      const year = item.fromYear;
      // El año de formación vale para quien la cita presenta como fundador o de la formación original.
      const quote = check("entrada", item.fromEvidence, (q) => !vague(year, q) && (yearIsTheirs(q, year) || founding(q, year)
        || (year === dossier.formedYear && FOUNDING_CUE.test(normalize(q)) && !CURRENT_CUE.test(normalize(q)))));
      if (quote) { fromYear = year; quotes.push(quote); }
    }
    if (item.toYear !== null && member.toYear === null && !member.current) {
      const year = item.toYear;
      const quote = check("salida", item.toEvidence ?? item.fromEvidence, (q) => !vague(year, q) && yearIsTheirs(q, year));
      if (quote) { toYear = year; quotes.push(quote); }
    }
    if (item.current === true && !member.current && member.toYear === null && toYear === null && dossier.disbandedYear === null && dossier.status !== "split_up") {
      // Una foto fechada («Para el año 2000 el grupo está formado por…») no dice que siga hoy.
      const quote = check("sigue", item.currentEvidence, (q) => CURRENT_CUE.test(normalize(q)) && !PAST_CUE.test(normalize(q))
        && (!/(?<!\d)(19|20)\d\d(?!\d)/u.test(q) || /\b(actualmente|hoy|currently|formacion actual|actual formacion)\b/u.test(normalize(q))));
      if (quote) { current = true; quotes.push(quote); }
    }
    const from = fromYear ?? member.fromYear;
    if (toYear !== null && from !== null && toYear < from) { problems.push(`«${member.name}»: salida antes de la entrada`); toYear = null; }
    if (fromYear !== null || toYear !== null || current !== null) clean.push({ memberId: item.memberId, name: member.name, fromYear, toYear, current, quotes });
  }
  return { clean, problems };
}

interface PeriodOutput { caseId: string; artistId: number; name: string; members: PeriodChecked[]; note: string | null; dropped: string[]; model: string }

async function periodosExtraer(): Promise<void> {
  await extract<PeriodDossier, PeriodOutput>(PERIOD_DOSSIERS, PERIOD_EXTRACTION, async (dossier, gateway) => {
    const ask = (fix?: string) => gateway.propose({
      taskKind: "narrative_extraction", modelClass: "fast", schemaVersion: PERIOD_SCHEMA_VERSION, instructions: PERIOD_INSTRUCTIONS, responseSchema: periodResponse,
      input: fix ? { ...dossier, correccion: fix } : dossier,
    });
    let result = await ask();
    let checked = validatePeriods(dossier, result.proposal);
    const fixable = checked.problems.filter((problem) => /literal|no nombra|sin cita/u.test(problem));
    if (fixable.length) {
      const retry = await ask(`Tu respuesta anterior tuvo estos errores: ${fixable.slice(0, 12).join("; ")}. Copia citas LITERALES que nombren a la persona y contengan el año o la palabra que lo prueba, o deja null.`);
      const second = validatePeriods(dossier, retry.proposal);
      if (second.clean.length >= checked.clean.length) { result = retry; checked = second; }
    }
    return { caseId: dossier.caseId, artistId: dossier.artistId, name: dossier.name, members: checked.clean, note: result.proposal.note, dropped: checked.problems, model: result.model };
  }, (dossier) => !ONLY || ONLY.includes(dossier.artistId));
}

async function periodosAplicar(): Promise<void> {
  const rows = readJsonl<PeriodOutput>(PERIOD_EXTRACTION).filter((row) => !ONLY || ONLY.includes(row.artistId));
  const items = rows.flatMap((row) => row.members.map((member) => ({ ...member, artistId: row.artistId, artist: row.name })));
  const live = new Map((await pool.query<{ id: string; from_year: number | null; to_year: number | null; is_current: boolean }>(
    "SELECT id::text, from_year, to_year, is_current FROM public.artist_members WHERE id = ANY($1::bigint[])", [items.map((item) => item.memberId)])).rows.map((row) => [Number(row.id), row]));
  const plan = items.flatMap((item) => {
    const row = live.get(item.memberId);
    if (!row) return [];
    const setFrom = row.from_year === null ? item.fromYear : null;
    let setTo = row.to_year === null && !row.is_current ? item.toYear : null;
    const setCurrent = item.current === true && !row.is_current && row.to_year === null && setTo === null;
    const from = setFrom ?? row.from_year;
    if (setTo !== null && from !== null && setTo < from) setTo = null;
    return setFrom !== null || setTo !== null || setCurrent ? [{ ...item, setFrom, setTo, setCurrent }] : [];
  });
  const label = confirm ? "aplicado" : "ensayo";
  writeFileSync(`${DIR}/periodos-${label}.md`, [
    `# Periodos de integrantes — ${label}`, "",
    `${rows.length} bandas leídas; ${plan.length} membresías con datos nuevos: ${plan.filter((item) => item.setFrom !== null).length} entradas, ${plan.filter((item) => item.setTo !== null).length} salidas, ${plan.filter((item) => item.setCurrent).length} «sigue».`, "",
    ...plan.map((item) => `- **${item.artist}** · ${item.name}: ${item.setFrom ?? "…"}–${item.setTo ?? (item.setCurrent ? "hoy" : "…")} — «${item.quotes.join(" / ").slice(0, 300)}»`),
  ].join("\n") + "\n");
  console.log(JSON.stringify({ bands: rows.length, memberships: plan.length, from: plan.filter((item) => item.setFrom !== null).length, to: plan.filter((item) => item.setTo !== null).length, current: plan.filter((item) => item.setCurrent).length }));
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "datos-ricos:periodos", operator: "claude-code",
    note: `${NOTE}: entrada, salida y «sigue» de integrantes desde biografías con cita (DeepSeek flash propone, el código valida); solo donde faltaba` }, async (context) => {
    let written = 0;
    for (const item of plan) {
      const done = await context.client.query(`
        UPDATE public.artist_members SET from_year = COALESCE(from_year, $2), to_year = CASE WHEN is_current THEN to_year ELSE COALESCE(to_year, $3) END,
               is_current = is_current OR ($4 AND to_year IS NULL)
         WHERE id = $1`, [item.memberId, item.setFrom, item.setTo, item.setCurrent]);
      written += done.rowCount ?? 0;
    }
    return { written };
  });
  console.log(`run ${runId}:`, result);
}

if (stage === "personas-expedientes") await personasExpedientes();
else if (stage === "personas-extraer") await personasExtraer();
else if (stage === "personas-aplicar") await personasAplicar();
else if (stage === "periodos-expedientes") await periodosExpedientes();
else if (stage === "periodos-extraer") await periodosExtraer();
else if (stage === "periodos-aplicar") await periodosAplicar();
else throw new Error("uso: --stage=personas-expedientes|personas-extraer|personas-aplicar|periodos-expedientes|periodos-extraer|periodos-aplicar [--confirm]");
await closeDb();
