// CRV · Absorción del directorio Rock Hecho en Venezuela (rockhechovenezuela.com), 2026-10-25.
//
// Plan v2 del primo, etapa 6: leer TODAS las pestañas de la discografía de cada
// ficha (LP, CD, EP, Sencillos, Demos, Cassettes, Recopilaciones, Digital), no
// solo la biografía que daba la API de WordPress. El crudo es la captura
// profunda `data/raw/deep-rhv-com-2026-10-25` (511 fichas, letras # y A–K, que
// son todas las que el sitio publica) y la lectura la hace
// `scripts/rhv-directorio-parse.py`.
//
// Mismo patrón que Venciclopedia: la evidencia queda como claims de la fuente
// (con su raw_page) y la escritura va por un run de operador con el diario
// `crv_journal`, así que todo se deshace con `runs undo <run>`.
//
// Reglas:
//   · el directorio solo publica rock venezolano: un artista que no está se crea;
//     uno ambiguo (dos fichas o dos artistas posibles) no se toca y se informa;
//   · solo se rellena lo vacío; una imagen distinta de la actual va a Curaduría;
//   · cruce de discos SOLO por título exacto (sin tildes ni artículos); un disco
//     nuevo cuyo título se parece a otro del artista (≥ 0,6) queda propuesto;
//   · DVD/VCD sin edición de audio no es disco (Audiovisuales): se informa;
//   · pistas solo en discos nuevos o sin pistas; nunca se renumeran;
//   · personas: se reutiliza la ficha ligada a ESE artista (fusión solo con
//     proyecto común); si no, se crea y la cola de duplicados decide después;
//   · formación → créditos de músico y, en bandas, membresía con el periodo de
//     los discos donde figura (etapa 5); invitados → crédito de disco con
//     «(track NN)» y crédito de pista (D8);
//   · recopilatorios de varios artistas: se acredita la pista si el disco y la
//     pista ya existen; si no, se informa.
//
//   RHV_FICHAS=…/fichas.jsonl RHV_OUT=…/dir ./scripts/with-node22.sh npx tsx scripts/rhv-directorio-absorb.mts [--confirm]
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPool, closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { persistClaim, type ClaimToPersist } from "../src/claims/persistence.js";
import { normalizeIdentity, normalizeIdentitySecondary } from "../src/normalization/claims.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";
import { liveTitleVerdict } from "../src/normalization/live-title.js";
import { excludedArtist } from "../src/catalog/editorial-scope.js";
import { audiovisualAlbumConflict } from "../src/youtube/audiovisuals.js";
import { instrumentsOf } from "../src/discography/instruments.js";
import { proposeImageCandidate } from "../src/merge/image-candidates.js";

const TAG = "rhv-directorio-2026-10-25";
const SLUG = "rock-hecho-en-venezuela";
const CAPTURE_DIR = "raw/deep-rhv-com-2026-10-25";
const OPERATOR = "claude-code (encargo de Brian)";
const NOTE = "Absorción del directorio Rock Hecho en Venezuela (etapa 6 del plan v2): fichas, discografía por pestaña, formación, invitados, sellos, portadas y redes; solo rellena vacíos";
const VA_ARTIST_ID = 257;
const FICHAS = process.env["RHV_FICHAS"];
const OUT = process.env["RHV_OUT"];
if (!FICHAS || !OUT) throw new Error("Faltan RHV_FICHAS y RHV_OUT");
const CONFIRM = process.argv.includes("--confirm");

// ── Tipos de la lectura ─────────────────────────────────────────────────────
interface Person { name: string; role: string }
interface Track { title: string; disc: number; side?: string; bonus?: boolean }
interface Entry {
  tab: string; title: string; years_raw: string; header: string; covers: string[]; lineup: Person[]; guests: Person[];
  tracks: Track[]; appearance: string | null; notes: string[]; links: Array<{ href: string; text: string }>;
  labels: string[]; catalog: string[]; formats: string[]; types: string[]; raw: string;
}
interface Ficha {
  url: string; name: string; site_name: string; picture: string | null; bio: string[]; bio_roles: Record<string, string[]>;
  socials: Array<{ platform: string; url: string }>; albums: Entry[]; sha256: string; slug: string; letter: string;
}
const fichas: Ficha[] = readFileSync(FICHAS, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Ficha)
// RHV_ONLY=c/cronica,a/aborigen limita el simulacro a esas fichas y muestra cómo quedan sus discos.
const ONLY = (process.env["RHV_ONLY"] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
if (ONLY.length) fichas.splice(0, fichas.length, ...fichas.filter((ficha) => ONLY.includes(`${ficha.letter}/${ficha.slug}`)));

// ── Utilidades ──────────────────────────────────────────────────────────────
const fold = (value: string): string => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
function titleKey(value: string): string {
  return fold(value)
    .replace(/\((?:ft|feat|featuring|con)\b\.?[^)]*\)/g, " ")
    .replace(/&|\band\b|\by\b/g, " ")
    .replace(/^\s*(los|las|el|la|the)\s+/u, "")
    .replace(/[^a-z0-9]+/g, "");
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter)) return 0.9;
  const grams = (text: string): Set<string> => { const set = new Set<string>(); for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2)); return set; };
  const left = grams(longer); const right = grams(shorter);
  let shared = 0; for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size || 1);
}
// Firma numérica de un título: «Vol. III», «Volumen 3» y «Vol. 3» dan {3}; «Diez Años» da {10}.
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const SPELLED: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, one: 1, two: 2, three: 3 };
function numberSignature(title: string): string {
  const out = new Set<number>();
  for (const token of fold(title).split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) out.add(Number(token));
    else if (ROMAN[token] !== undefined && token !== "v" && token !== "x") out.add(ROMAN[token]!);
    else if (SPELLED[token] !== undefined) out.add(SPELLED[token]!);
  }
  return [...out].sort((a, b) => a - b).join(",");
}
const catalogKey = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const personKey = (name: string): string => fold(name).replace(/[«»"“”'’´`.]/g, "").replace(/\s+/g, " ").trim();
const urlKey = (url: string): string => url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const absolute = (url: string): string => new URL(url, "https://rockhechovenezuela.com/").toString();
const firstYear = (raw: string): number | null => { const m = /(1[89]\d\d|20[0-3]\d)/.exec(raw); return m ? Number(m[1]) : null; };
const cleanTitle = (value: string): string => value.replace(/\s+/g, " ").replace(/^[«"“]+|[»"”]+$/g, "").replace(/\s*\.\s*$/, "").trim();
const INDEPENDENT = /^(?:independiente|independent|autoproducci[oó]n|autoproducido|autoeditado|auto-?producci[oó]n|edici[oó]n independiente|sin sello|n\/?a|s\/s)$/i;
/** La base es SQL_ASCII: varchar(n) cuenta bytes, no caracteres. */
function fit(value: string, bytes: number): string {
  let out = value;
  while (Buffer.byteLength(out, "utf8") > bytes) out = out.slice(0, -1);
  return out;
}
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

type TypeClass = "album" | "single" | "ep" | "demo" | "compilation" | "video";
const TAB_FORMAT: Record<string, string> = { LP: "LP", CD: "CD", Cassettes: "Cassette", Digital: "Digital" };
function entryClass(entry: Entry): TypeClass {
  const audio = entry.formats.some((format) => /CD|LP|Cassette|Digital|7"|12"|USB/.test(format)) || ["LP", "CD", "Cassettes", "Digital"].includes(entry.tab);
  if (entry.formats.some((format) => /DVD|VCD|Blu-ray/.test(format)) && !entry.formats.some((format) => /CD$|LP|Cassette|Digital/.test(format)) && entry.tab !== "LP") {
    if (!audio || entry.tab === "CD") return "video";
  }
  if (entry.types.includes("single")) return "single";
  if (entry.types.includes("ep")) return "ep";
  if (entry.types.includes("demo")) return "demo";
  switch (entry.tab) {
    case "Sencillos": return entry.types.includes("album") ? "album" : "single";
    case "EP": return "ep";
    case "Demos": return "demo";
    case "Recopilaciones": return "compilation";
    default: return "album";
  }
}
function entryFormat(entry: Entry): string | null {
  return entry.formats[0] ?? TAB_FORMAT[entry.tab] ?? null;
}
const ALBUM_TYPE: Record<Exclude<TypeClass, "video">, string> = { album: "studio_album", single: "single", ep: "ep", demo: "demo", compilation: "compilation" };

/**
 * «bajo en Samsara, Canción modal, coros en Dime; voz» → [{bajo, [Samsara, Canción modal]}, {coros, [Dime]}, {voz, []}].
 * Tras un «rol en tema», las piezas sueltas son más temas; un nuevo «rol en …» abre otro tramo.
 */
const EN_TRACKS = /^(.*?)\s+en\s+(?:el tema |los temas |el track |los tracks |la canci[oó]n )?(.+)$/i;
function guestParts(role: string): Array<{ role: string; tracks: string[] }> {
  const out: Array<{ roles: string[]; tracks: string[] }> = [];
  for (const segment of role.split(/\s*;\s*/)) {
    let current = { roles: [] as string[], tracks: [] as string[] };
    out.push(current);
    for (const piece of segment.split(/\s*,\s*|\s+y\s+/).map((item) => item.trim()).filter(Boolean)) {
      const m = EN_TRACKS.exec(piece);
      if (m && !/todos los temas|todo el disco|varios temas|vivo|directo/i.test(m[2]!)) {
        if (current.tracks.length) { current = { roles: [], tracks: [] }; out.push(current); }
        current.roles.push(m[1]!.trim());
        current.tracks.push(cleanTitle(m[2]!));
      } else if (m) {
        current.roles.push(m[1]!.trim());
      } else if (current.tracks.length) {
        current.tracks.push(cleanTitle(piece));
      } else {
        current.roles.push(piece);
      }
    }
  }
  return out.filter((part) => part.roles.length).map((part) => ({ role: part.roles.join(", "), tracks: part.tracks.filter(Boolean) }));
}
// Rol de la ficha → vocabulario del catálogo (Musicians / Guest Musicians):
// «voz» → Lead Vocals, «guitarra» → Guitars, «bajo» → Bass, «batería» → Drums.
// Lo que no está en la lista se conserva tal cual, con mayúscula inicial.
const ROLE_EN: ReadonlyArray<[RegExp, string]> = [
  [/^(?:voz|voces|voz principal|voz lider|vocalista|cantante|canto|voz y canto)$/, "Lead Vocals"],
  [/^(?:coros?|segunda voz|segundas voces|voces de apoyo|armonias vocales)$/, "Backing Vocals"],
  [/^coros infantiles$/, "Children's Choir"],
  [/^(?:voz gutural|guturales|gritos|voces guturales)$/, "Screams"],
  [/^(?:rap|rapeo|mc)$/, "Rap"],
  [/^(?:guitarras?|guitarrista)$/, "Guitars"],
  [/^(?:guitarras? (?:lider|lideres|principal|solista|solos?)|primera guitarra|solos? de guitarra|guitarra lider)$/, "Lead Guitar"],
  [/^(?:guitarras? ritmicas?|segunda guitarra)$/, "Rhythm Guitar"],
  [/^guitarras? acusticas?$/, "Acoustic Guitar"],
  [/^guitarras? electricas?$/, "Electric Guitar"],
  [/^guitarra de 12 cuerdas$/, "12-String Guitar"],
  [/^(?:bajo|bajos|bajista|bajo electrico)$/, "Bass"],
  [/^(?:contrabajo|bajo acustico)$/, "Double Bass"],
  [/^(?:bateria|baterias|baterista)$/, "Drums"],
  [/^(?:percusion|percusiones|percusionista)$/, "Percussion"],
  [/^(?:teclados?|tecladista)$/, "Keyboards"],
  [/^piano$/, "Piano"],
  [/^(?:sintetizador(?:es)?|synths?)$/, "Synthesizer"],
  [/^(?:organo|organo hammond)$/, "Organ"],
  [/^(?:programacion(?:es)?|secuencias|programacion de bateria)$/, "Programming"],
  [/^(?:samples?|samplers?)$/, "Samples"],
  [/^(?:scratch(?:es)?|tornamesas?|dj|turntables?)$/, "Turntables"],
  [/^(?:saxo|saxofon|saxos|saxofones)$/, "Sax"],
  [/^saxo(?:fon)? tenor$/, "Tenor Sax"],
  [/^saxo(?:fon)? alto$/, "Alto Sax"],
  [/^(?:trompetas?)$/, "Trumpet"],
  [/^(?:trombon|trombones)$/, "Trombone"],
  [/^(?:flautas?|flauta traversa)$/, "Flute"],
  [/^clarinete$/, "Clarinet"],
  [/^(?:violin|violines)$/, "Violin"],
  [/^viola$/, "Viola"],
  [/^(?:violonchelo|violoncello|chelo|cello)$/, "Cello"],
  [/^cuatro$/, "Cuatro"],
  [/^arpa$/, "Harp"],
  [/^maracas$/, "Maracas"],
  [/^(?:armonica|harmonica)$/, "Harmonica"],
  [/^acordeon$/, "Accordion"],
  [/^mandolina$/, "Mandolin"],
  [/^congas?$/, "Congas"],
  [/^(?:bongos|bongo)$/, "Bongos"],
  [/^timbales?$/, "Timbales"],
  [/^(?:efectos|fx)$/, "Effects"],
  [/^(?:arreglos|arreglista)$/, "Arrangements"],
  [/^(?:produccion|productor)$/, "Producer"],
  [/^(?:voz solista|voz lider|voz principal)$/, "Lead Vocals"],
  [/^(?:voz adicional|voces adicionales)$/, "Additional Vocals"],
  [/^(?:vocal|vocales)$/, "Vocals"],
  [/^voz femenina$/, "Female Vocals"],
  [/^(?:voz infantil|voces infantiles)$/, "Children's Vocals"],
  [/^(?:vibrafono|vibrafon)$/, "Vibraphone"],
  [/^(?:compositor|composicion|composiciones)$/, "Composer"],
  [/^saxo(?:fon)? soprano$/, "Soprano Sax"],
  [/^saxo(?:fon)? baritono$/, "Baritone Sax"],
  [/^oboe$/, "Oboe"],
  [/^fagot$/, "Bassoon"],
  [/^piano electrico$/, "Electric Piano"],
  [/^piano acustico$/, "Acoustic Piano"],
  [/^(?:rhodes|fender rhodes|piano rhodes)$/, "Fender Rhodes"],
  [/^(?:flugelhorn|flugerhorn|fliscorno)$/, "Flugelhorn"],
  [/^(?:corno|corno frances|cornos)$/, "French Horn"],
  [/^(?:seccion de metales|metales|vientos)$/, "Horns"],
  [/^(?:seccion de cuerdas|cuerdas|string ensemble)$/, "Strings"],
  [/^(?:programacion de baterias?|bateria programada)$/, "Drum Programming"],
  [/^programacion de teclados$/, "Keyboard Programming"],
  [/^(?:programacion de secuencias|secuenciadores?)$/, "Sequencer"],
  [/^(?:percusion menor|percusion adicional)$/, "Additional Percussion"],
  [/^percusion electronica$/, "Electronic Percussion"],
  [/^(?:bateria electronica|baterias electronicas)$/, "Electronic Drums"],
  [/^(?:tambores bata|bata)$/, "Batá Drums"],
  [/^tambores$/, "Drums (tambores)"],
  [/^(?:guiro|guira)$/, "Güiro"],
  [/^(?:tumbadoras?)$/, "Congas"],
  [/^(?:palmadas|palmas)$/, "Handclaps"],
  [/^pandereta$/, "Tambourine"],
  [/^cajon$/, "Cajón"],
  [/^(?:locucion|locucion final|narracion|narrador)$/, "Narration"],
  [/^(?:director|director musical|direccion musical)$/, "Musical Director"],
  [/^(?:arreglo|arreglos)$/, "Arrangements"],
  [/^arreglos? de cuerdas$/, "String Arrangements"],
  [/^arreglos? de metales$/, "Horn Arrangements"],
  [/^guitarra espanola$/, "Spanish Guitar"],
  [/^(?:guitarra adicional|guitarras adicionales)$/, "Additional Guitar"],
  [/^(?:slide|guitarra slide)$/, "Slide Guitar"],
  [/^(?:acustica|guitarra acustica)$/, "Acoustic Guitar"],
  [/^bajo sin trastes$/, "Fretless Bass"],
  [/^teclados adicionales$/, "Additional Keyboards"],
  [/^(?:electronicos|electronica)$/, "Electronics"],
  [/^loops$/, "Loops"],
  [/^tres$/, "Tres"],
  [/^bandola$/, "Bandola"],
  [/^melodica$/, "Melodica"],
  [/^(?:moog|sintetizador moog)$/, "Moog Synthesizer"],
  [/^vocoder$/, "Vocoder"],
  [/^theremin$/, "Theremin"],
  [/^tabla$/, "Tabla"],
  [/^marimba$/, "Marimba"],
  [/^shekere$/, "Shekere"],
  [/^tambora$/, "Tambora"],
];
const untranslatedRoles = new Map<string, number>();
function roleInEnglish(role: string): string {
  const pieces = role.split(/\s*(?:,|;|&|\/|\s+y\s+|\s+e\s+)\s*/u).map((piece) => piece.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of pieces) {
    const key = fold(piece).replace(/[.()]/g, "").replace(/\s+/g, " ").trim();
    const known = ROLE_EN.find(([pattern]) => pattern.test(key))?.[1];
    if (!known) untranslatedRoles.set(key, (untranslatedRoles.get(key) ?? 0) + 1);
    const hit = known ?? piece.charAt(0).toUpperCase() + piece.slice(1);
    if (!out.includes(hit)) out.push(hit);
  }
  return out.join(" & ");
}

// Agrupaciones, frases y restos de rol que la ficha escribe donde va un nombre: no son personas.
const NOT_PERSON = /dirigid[ao] por|\b(?:orquesta|orfe[oó]n|mariachi|secci[oó]n|amigos|amiguitos|hijos)\b/i;
const skippedNames = new Set<string>();
function splitNames(name: string): string[] {
  const cleaned = name.replace(/^(?:formaci[oó]n|integrantes)\s*:\s*/i, "").replace(/\s*:\s.*$/, "");
  return cleaned.split(/\s*&\s*|\s+y\s+(?=[A-ZÁÉÍÓÚÑ])/).map((part) => part.trim()).filter((part) => {
    const ok = Boolean(part) && /^[A-ZÁÉÍÓÚÑÜ"'«¨]/u.test(part) && part.split(/\s+/).length <= 6 && !NOT_PERSON.test(part);
    if (!ok && part) skippedNames.add(part);
    return ok;
  });
}

// Ciudades venezolanas que el catálogo ya usa; la biografía las nombra al presentar la banda.
const ORIGIN = /\b(?:surg(?:e|ió|io)|nac(?:e|ió|io)|formad[ao]|fundad[ao]|cread[ao]|originari[ao]|oriund[ao]|proveniente|conformad[ao]|se form[aó]|se fund[aó]|inici[aó]|naci[oó])\b[^.]{0,80}?\ben (?:la ciudad de |el estado |la población de )?([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?: (?:de |del |la |los )?[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,3})/u;
function artistTypeOf(bio: string[]): string | null {
  const first = (bio.find((p) => !p.startsWith("## ")) ?? "").split(/(?<=\.)\s/)[0] ?? "";
  const checks: Array<[RegExp, string]> = [
    [/\bd[uú]o\b/iu, "duo"],
    [/\b(?:banda|agrupaci[oó]n|grupo|conjunto|orquesta|ensamble|colectivo|tr[ií]o|cuarteto|quinteto|combo)\b/iu, "band"],
    [/\b(?:cantante|cantautora?|solista|guitarrista|compositora?|pianista|baterista|bajista|productora?|m[uú]sico|violinista|saxofonista|percusionista|tecladista|vocalista|int[eé]rprete|DJ|arreglista|multiinstrumentista)\b/u, "solo_artist"],
  ];
  let best: { at: number; type: string } | null = null;
  for (const [pattern, type] of checks) {
    const m = pattern.exec(first);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, type };
  }
  return best?.type ?? null;
}

// ── Identidades revisadas a mano (2026-10-25) ───────────────────────────────
// Ficha → artista del catálogo, o alta con otro nombre. Lo demás se resuelve solo.
const SAME: Readonly<Record<string, number>> = {
  "a/aborigen": 720, "a/aborigen-2": 720,            // dos fichas de la misma banda (Viraha Shanti, 2007)
  "a/ambar": 33,                                      // A'mbar, no María Conchita Alonso
  "c/clan-spiteri-el": 87, "e/e-on": 85,
  "a/antonio-mazei": 3448, "e/espiga": 2467, "g/grupo-ciruela": 2465, "c/clippers-ii-los": 1439,
  "k/kleyder-dcanterville": 3074, "f/fe-perdida-la": 2463, "f/franklin-holland-proyecto": 1950,
  "f/furia-del-buzo-ciego": 1080,
};
// Distintas de su parecido del catálogo: se crean con este nombre.
const CREATE_AS: Readonly<Record<string, { name: string; alias?: string; type?: string }>> = {
  "a/aurora-boreal": { name: "Aurora Boreal" }, "e/eduardo-noriega": { name: "Eduardo Noriega", type: "solo_artist" },
  "e/elangel": { name: "Elangel" }, "g/grupo-chicless": { name: "Grupo Chicless" },
  "k/kamara-de-la-tortura-la": { name: "La Kámara De la Tortura" },
  "k/kinttero-charles-alexander": { name: "Kinttero", alias: "Charles Alexander", type: "solo_artist" },
  // «no tiene ninguna relación con la banda de» Los Clippers de 1967 (artista 1439).
  "c/clippers-i-los": { name: "Los Clippers (1962)", alias: "Los Clippers" },
};
// Discos del catálogo que la fuente atribuye a la otra banda homónima.
const REPARENT: Readonly<Record<string, number[]>> = { "c/clippers-i-los": [4392, 5039] };
// Nombre del catálogo que la fuente corrige (el anterior queda como alias).
const RENAME: Readonly<Record<number, string>> = { 3074: "Kleyder D'Canterville" };
const fichaKey = (ficha: { letter: string; slug: string }): string => `${ficha.letter}/${ficha.slug}`;

// ── Informe ─────────────────────────────────────────────────────────────────
const report = {
  mode: CONFIRM ? "confirm" : "dry-run", runId: 0, fichas: fichas.length,
  artists: { matched: 0, created: 0, ambiguous: [] as unknown[], excluded: [] as string[], similarSkipped: [] as unknown[], filled: {} as Record<string, number>, imageCandidates: 0 },
  albums: { matched: 0, created: 0, proposed: [] as unknown[], matchedNear: [] as unknown[], matchedCatalog: [] as unknown[], ambiguous: [] as unknown[], video: [] as unknown[], audiovisualConflict: [] as unknown[], filled: {} as Record<string, number>, versions: 0, labels: 0, coverCandidates: 0, extraArt: 0, tracklistDiffers: [] as unknown[] },
  tracks: { created: 0 },
  persons: { reused: 0, created: 0 },
  credits: { musician: 0, guest: 0, trackGuest: 0, trackMusician: 0, guestTrackUnmatched: 0 },
  members: { created: 0, periodsFilled: 0 },
  organizations: { matched: 0, created: 0, createdList: [] as string[] },
  links: { social: 0, artistStreaming: 0, albumStreaming: 0, youtubeVideos: [] as unknown[] },
  appearances: { credited: 0, alreadyCredited: 0, albumMissing: [] as unknown[], trackMissing: [] as unknown[] },
  documents: 0, claims: { inserted: 0, reused: 0 }, rawPages: 0,
  createdArtists: [] as Array<{ id: number; name: string; url: string }>,
  createdAlbums: [] as Array<{ id: number; artist: string; title: string; year: number | null; type: string; tracks: number }>,
  artistIds: {} as Record<string, number>,
};
const bump = (bucket: Record<string, number>, key: string): void => { bucket[key] = (bucket[key] ?? 0) + 1; };

async function apply(client: PoolClient, runId: number, sourceId: number): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '30s'");
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;

  // ── Índices del catálogo ──
  const artistRows = await q<{ id: string; name: string; artist_type: string; biography: string | null; picture_url: string | null; origin_city: string | null }>(
    "SELECT id::text,name,artist_type::text,biography,picture_url,origin_city FROM public.artists");
  const artistById = new Map(artistRows.map((row) => [Number(row.id), row]));
  const byVariant = new Map<string, Set<number>>();
  const addVariant = (name: string, id: number): void => {
    for (const variant of predictableNameVariants(name)) (byVariant.get(variant) ?? byVariant.set(variant, new Set()).get(variant)!).add(id);
  };
  for (const row of artistRows) addVariant(row.name, Number(row.id));
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) addVariant(row.alias, Number(row.artist_id));
  const compactIndex = artistRows.map((row) => ({ id: Number(row.id), key: titleKey(row.name) }));
  const cities = new Set((await q<{ city: string }>(
    "SELECT split_part(origin_city, ',', 1) AS city FROM public.artists WHERE origin_country='Venezuela' AND origin_city IS NOT NULL GROUP BY 1 HAVING count(*) >= 2")).map((row) => row.city.trim()));

  const albumRows = await q<{ id: string; artist_id: string; title: string; release_year: number | null; album_type: string; label_id: string | null; cover_url: string | null; catalog_id: string | null; media_format: string | null }>(
    "SELECT id::text,artist_id::text,title,release_year,album_type::text,label_id::text,cover_url,catalog_id,media_format FROM public.albums");
  const albumsByArtist = new Map<number, typeof albumRows>();
  for (const row of albumRows) (albumsByArtist.get(Number(row.artist_id)) ?? albumsByArtist.set(Number(row.artist_id), []).get(Number(row.artist_id))!).push(row);
  const trackCount = new Map<number, number>();
  for (const row of await q<{ album_id: string; n: string }>("SELECT album_id::text, count(*)::text n FROM public.tracks GROUP BY 1")) trackCount.set(Number(row.album_id), Number(row.n));

  const orgByVariant = new Map<string, Set<number>>();
  const addOrg = (name: string, id: number): void => { for (const variant of predictableNameVariants(name)) (orgByVariant.get(variant) ?? orgByVariant.set(variant, new Set()).get(variant)!).add(id); };
  for (const row of await q<{ id: string; name: string }>("SELECT id::text,name FROM public.organizations")) addOrg(row.name, Number(row.id));
  for (const row of await q<{ organization_id: string; alias: string }>("SELECT organization_id::text,alias FROM ingest.organization_aliases")) addOrg(row.alias, Number(row.organization_id));

  // Personas ya ligadas a cada artista (miembro, crédito de disco o de pista).
  const linkedPersons = new Map<number, Map<string, number>>();
  const linkPerson = (artistId: number, name: string, personId: number, prefer = false): void => {
    const map = linkedPersons.get(artistId) ?? linkedPersons.set(artistId, new Map()).get(artistId)!;
    const key = personKey(name);
    if (prefer || !map.has(key)) map.set(key, personId);
  };
  for (const row of await q<{ artist_id: string; person_id: string; name: string; member: boolean }>(`
      SELECT al.artist_id::text, p.id::text person_id, p.name, false member FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id JOIN public.persons p ON p.id=c.person_id
      UNION SELECT al.artist_id::text, p.id::text, p.name, false FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id JOIN public.persons p ON p.id=c.person_id
      UNION SELECT m.artist_id::text, p.id::text, p.name, true FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id`)) {
    linkPerson(Number(row.artist_id), row.name, Number(row.person_id), row.member);
  }
  for (const row of await q<{ person_id: string; alias: string; artist_id: string }>(`
      SELECT pa.person_id::text, pa.alias, m.artist_id::text FROM ingest.person_aliases pa JOIN public.artist_members m ON m.person_id=pa.person_id`)) {
    linkPerson(Number(row.artist_id), row.alias, Number(row.person_id));
  }
  const memberships = new Map<string, { id: number; from: number | null; to: number | null }>();
  for (const row of await q<{ id: string; artist_id: string; person_id: string; from_year: number | null; to_year: number | null }>(
    "SELECT id::text,artist_id::text,person_id::text,from_year,to_year FROM public.artist_members")) {
    memberships.set(`${row.artist_id}|${row.person_id}`, { id: Number(row.id), from: row.from_year, to: row.to_year });
  }
  const titular = new Map<number, number>();
  for (const row of await q<{ artist_id: string; person_id: string }>("SELECT artist_id::text,person_id::text FROM public.artist_members WHERE role ILIKE 'titular%'")) titular.set(Number(row.artist_id), Number(row.person_id));
  const socialPlatforms = new Set((await q<{ k: string }>("SELECT artist_id||'|'||platform k FROM public.social_links")).map((row) => row.k));
  const knownUrls = new Set((await q<{ url: string }>("SELECT url FROM public.social_links UNION SELECT url FROM public.streaming_links")).map((row) => urlKey(row.url)));
  const streamingPlatforms = new Set((await q<{ k: string }>("SELECT COALESCE('a'||artist_id,'d'||album_id)||'|'||platform k FROM public.streaming_links")).map((row) => row.k));

  // ── Crudo: una raw_page por ficha (procedencia de los claims) ──
  const rawPageId = new Map<string, number>();
  for (const ficha of fichas) {
    const stored = `${CAPTURE_DIR}/${ficha.sha256}.html`;
    const file = path.resolve("data", stored);
    const bytes = statSync(file).size;
    const row = (await q<{ id: string }>(`
      INSERT INTO ingest.raw_pages(source_id,url,canonical_url,http_status,content_type,sha256,byte_size,stored_path,fetched_at,run_id)
      VALUES($1,$2,$2,200,'text/html; charset=UTF-8',$3,$4,$5,'2026-10-25T05:00:00Z',$6)
      ON CONFLICT (source_id,sha256) DO UPDATE SET url=EXCLUDED.url RETURNING id::text`, [sourceId, ficha.url, ficha.sha256, bytes, stored, runId]))[0]!;
    rawPageId.set(ficha.url, Number(row.id));
    report.rawPages += 1;
  }
  const claim = async (ficha: Ficha, kind: ClaimToPersist["entityKind"], identity: string, field: string, value: unknown, targets: Partial<ClaimToPersist>, excerpt?: string): Promise<void> => {
    if (!CONFIRM || value === null || value === undefined || value === "") return;
    const persisted = await persistClaim({
      entityKind: kind, identity: normalizeIdentity(identity), identitySecondary: normalizeIdentitySecondary(identity), originalIdentity: identity,
      field, rawValue: value, normalizedValue: value, rawHash: sha(JSON.stringify([kind, identity, field, value])),
      extractor: "rhv-directorio", extractorVersion: "1",
      evidence: { url: ficha.url, ...(excerpt ? { excerpt: excerpt.slice(0, 2000) } : {}) },
      sourceId, rawPageId: rawPageId.get(ficha.url)!, runId, confidence: "medium", ...targets,
    }, client);
    if (persisted.inserted) report.claims.inserted += 1; else report.claims.reused += 1;
  };

  // ── Resolución de artistas ──
  const siteNameCount = new Map<string, number>();
  for (const ficha of fichas) siteNameCount.set(normalizeIdentity(ficha.name), (siteNameCount.get(normalizeIdentity(ficha.name)) ?? 0) + 1);
  const resolveArtist = (ficha: Ficha): number[] => {
    const found = new Set<number>();
    for (const name of new Set([ficha.name, ficha.site_name])) for (const variant of predictableNameVariants(name)) for (const id of byVariant.get(variant) ?? []) found.add(id);
    return [...found];
  };
  const cityOf = (ficha: Ficha): string | null => {
    const text = ficha.bio.filter((p) => !p.startsWith("## ")).slice(0, 2).join(" ");
    const m = ORIGIN.exec(text);
    if (!m) return null;
    const words = m[1]!.split(" ");
    for (let n = words.length; n >= 1; n -= 1) {
      const candidate = words.slice(0, n).join(" ");
      if (cities.has(candidate)) return candidate;
    }
    return null;
  };

  // ── Organizaciones ──
  const orgCache = new Map<string, number | null>();
  const resolveLabel = async (name: string): Promise<number | null> => {
    const display = name.replace(/\s+/g, " ").trim();
    if (!display || INDEPENDENT.test(display) || display.length > 120) return null;
    const cacheKey = normalizeIdentity(display);
    if (orgCache.has(cacheKey)) return orgCache.get(cacheKey)!;
    const ids = new Set<number>();
    for (const variant of predictableNameVariants(display)) for (const id of orgByVariant.get(variant) ?? []) ids.add(id);
    let id: number;
    if (ids.size >= 1) { id = Math.min(...ids); report.organizations.matched += 1; }
    else {
      id = Number((await q<{ id: string }>(`INSERT INTO public.organizations(name,organization_type,notes) VALUES($1,'record_label',$2) RETURNING id::text`,
        [display, `Sello citado en el directorio Rock Hecho en Venezuela (${TAG}).`]))[0]!.id);
      addOrg(display, id);
      report.organizations.created += 1; report.organizations.createdList.push(display);
    }
    orgCache.set(cacheKey, id);
    return id;
  };

  const firstLabel = async (labels: string[]): Promise<number | null> => {
    for (const label of labels) { const id = await resolveLabel(label); if (id !== null) return id; }
    return null;
  };

  // ── Personas ──
  const resolvePerson = async (artistId: number, artistName: string, name: string, ficha: Ficha): Promise<number> => {
    const clean = name.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
    const linked = linkedPersons.get(artistId)?.get(personKey(clean));
    if (linked) { report.persons.reused += 1; return linked; }
    const id = Number((await q<{ id: string }>("INSERT INTO public.persons(name,notes) VALUES($1,$2) RETURNING id::text",
      [fit(clean, 200), `Acreditado en ${artistName} según el directorio Rock Hecho en Venezuela: ${ficha.url}`]))[0]!.id);
    linkPerson(artistId, clean, id);
    report.persons.created += 1;
    return id;
  };

  // ── Enlaces ──
  const platformOf = (url: string, icon = ""): { kind: "social" | "streaming"; platform: string } | null => {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
    if (!host) return null;
    if (/facebook\.com|fb\.com/.test(host)) return { kind: "social", platform: "facebook" };
    if (/instagram\.com/.test(host)) return { kind: "social", platform: "instagram" };
    if (/twitter\.com|^x\.com/.test(host)) return { kind: "social", platform: "x" };
    if (/tiktok\.com/.test(host)) return { kind: "social", platform: "tiktok" };
    if (/linktr\.ee/.test(host)) return { kind: "social", platform: "linktree" };
    if (/spotify\.com/.test(host)) return { kind: "streaming", platform: "spotify" };
    if (/bandcamp\.com/.test(host)) return { kind: "streaming", platform: "bandcamp" };
    if (/soundcloud\.com/.test(host)) return { kind: "streaming", platform: "soundcloud" };
    if (/deezer\.com/.test(host)) return { kind: "streaming", platform: "deezer" };
    if (/music\.apple\.com|itunes\.apple\.com/.test(host)) return { kind: "streaming", platform: "apple_music" };
    if (/tidal\.com/.test(host)) return { kind: "streaming", platform: "tidal" };
    if (/music\.youtube\.com/.test(host)) return { kind: "streaming", platform: "youtube_music" };
    if (/youtube\.com|youtu\.be/.test(host)) return { kind: "streaming", platform: "youtube" };
    if (/amazon\./.test(host)) return { kind: "streaming", platform: "amazon_music" };
    if (/myspace|reverbnation|wordpress|blogspot|google|wikipedia|rockhechovenezuela/.test(host)) return null;
    if (/globe|website|link/.test(icon)) return { kind: "social", platform: "website" };
    return null;
  };
  const addArtistLink = async (artistId: number, url: string, icon: string, note: string): Promise<void> => {
    const kind = platformOf(url, icon);
    if (!kind || knownUrls.has(urlKey(url))) return;
    if (kind.kind === "social") {
      if (socialPlatforms.has(`${artistId}|${kind.platform}`)) return;
      await client.query(`INSERT INTO public.social_links(artist_id,platform,url,method,source,verified,notes) VALUES($1,$2,$3,'scrape',$4,false,$5)`, [artistId, kind.platform, url, TAG, note]);
      socialPlatforms.add(`${artistId}|${kind.platform}`); report.links.social += 1;
    } else {
      if (streamingPlatforms.has(`a${artistId}|${kind.platform}`)) return;
      if (kind.platform === "youtube" && !/\/(channel|c|user|@)/.test(url)) return; // un video no es el canal del artista
      await client.query(`INSERT INTO public.streaming_links(artist_id,platform,url,method,source,verified,notes) VALUES($1,$2,$3,'scrape',$4,false,$5)`, [artistId, kind.platform, url, TAG, note]);
      streamingPlatforms.add(`a${artistId}|${kind.platform}`); report.links.artistStreaming += 1;
    }
    knownUrls.add(urlKey(url));
  };

  // ── Recorrido ──
  const appearances: Array<{ ficha: Ficha; artistId: number; entry: Entry }> = [];
  for (const ficha of fichas) {
    const fixed = SAME[fichaKey(ficha)];
    const createAs = CREATE_AS[fichaKey(ficha)];
    if (createAs) { ficha.site_name = ficha.name; ficha.name = createAs.name; }
    const ambiguousSite = fixed === undefined && !createAs && (siteNameCount.get(normalizeIdentity(ficha.name)) ?? 0) > 1;
    let candidates = fixed !== undefined ? [fixed] : createAs ? [] : resolveArtist(ficha);
    const city = cityOf(ficha);
    if (candidates.length > 1 && city) {
      const sameCity = candidates.filter((id) => (artistById.get(id)?.origin_city ?? "").startsWith(city));
      if (sameCity.length === 1) candidates = sameCity;
    }
    if (ambiguousSite && candidates.length > 0) {
      const sameCity = city ? candidates.filter((id) => (artistById.get(id)?.origin_city ?? "").startsWith(city)) : [];
      if (sameCity.length !== 1) { report.artists.ambiguous.push({ url: ficha.url, name: ficha.name, why: "dos fichas del sitio con el mismo nombre", candidates }); continue; }
      candidates = sameCity;
    }
    if (candidates.length > 1) { report.artists.ambiguous.push({ url: ficha.url, name: ficha.name, candidates }); continue; }
    const bioText = ficha.bio.filter((p) => !p.startsWith("## ")).join("\n\n");
    const type = artistTypeOf(ficha.bio);
    let artistId: number;
    if (candidates.length === 1) {
      artistId = candidates[0]!;
      report.artists.matched += 1;
      const row = artistById.get(artistId)!;
      const rename = RENAME[artistId];
      if (rename && row.name !== rename) {
        await client.query(`INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,notes)
          VALUES($1,$2,'misspelling',$3,false,'medium',$4,$5) ON CONFLICT DO NOTHING`, [artistId, row.name, normalizeIdentity(row.name), sourceId, `Nombre anterior; la ficha RHV escribe «${rename}» (${TAG})`]);
        await client.query("UPDATE public.artists SET name=$2 WHERE id=$1", [artistId, rename]);
        row.name = rename; bump(report.artists.filled, "renamed");
      }
      if (!row.biography?.trim() && bioText.length > 80) {
        await client.query("UPDATE public.artists SET biography=$2 WHERE id=$1 AND (biography IS NULL OR biography='')", [artistId, bioText]);
        bump(report.artists.filled, "biography");
        await claim(ficha, "artist", row.name, "biography", bioText, { artistId });
      }
      if (city && !row.origin_city) {
        await client.query("UPDATE public.artists SET origin_city=$2 WHERE id=$1 AND origin_city IS NULL", [artistId, city]);
        bump(report.artists.filled, "origin_city");
        await claim(ficha, "artist", row.name, "origin_city", city, { artistId });
      }
      if (type && row.artist_type === "other") {
        await client.query("UPDATE public.artists SET artist_type=$2::artist_type WHERE id=$1 AND artist_type='other'", [artistId, type]);
        bump(report.artists.filled, "artist_type");
      }
      if (ficha.picture) {
        const picture = absolute(ficha.picture);
        if (!row.picture_url) {
          await client.query("UPDATE public.artists SET picture_url=$2 WHERE id=$1 AND picture_url IS NULL", [artistId, picture]);
          bump(report.artists.filled, "picture_url");
          await claim(ficha, "artist", row.name, "picture_url", picture, { artistId });
        } else if (await proposeImageCandidate(client, { kind: "artist", targetId: artistId, currentUrl: row.picture_url, candidateUrl: picture, sourceId, pageUrl: ficha.url, origin: TAG, runId }) === "proposed") {
          report.artists.imageCandidates += 1;
        }
      }
    } else {
      if (await excludedArtist(client, { name: ficha.name })) { report.artists.excluded.push(ficha.name); continue; }
      const key = titleKey(ficha.name);
      const near = createAs ? [] : compactIndex.filter((row) => key.length >= 4 && similarity(key, row.key) >= 0.88);
      if (near.length) { report.artists.similarSkipped.push({ url: ficha.url, name: ficha.name, near: near.map((row) => artistById.get(row.id)?.name) }); continue; }
      const picture = ficha.picture ? absolute(ficha.picture) : null;
      artistId = Number((await q<{ id: string }>(`
        INSERT INTO public.artists(name,artist_type,biography,picture_url,origin_city,origin_country,notes)
        VALUES($1,$2::artist_type,$3,$4,$5,'Venezuela',$6) RETURNING id::text`,
      [ficha.name, createAs?.type ?? type ?? "band", bioText || null, picture, city, `Alta desde el directorio Rock Hecho en Venezuela: ${ficha.url}`]))[0]!.id);
      artistById.set(artistId, { id: String(artistId), name: ficha.name, artist_type: createAs?.type ?? type ?? "band", biography: bioText, picture_url: picture, origin_city: city });
      addVariant(ficha.name, artistId);
      compactIndex.push({ id: artistId, key });
      if (createAs?.alias) {
        await client.query(`INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,notes)
          VALUES($1,$2,'stage_name',$3,false,'medium',$4,$5) ON CONFLICT DO NOTHING`, [artistId, createAs.alias, normalizeIdentity(createAs.alias), sourceId, `Según el directorio RHV (${TAG}): ${ficha.url}`]);
      }
      for (const albumId of REPARENT[fichaKey(ficha)] ?? []) {
        const moved = await client.query("UPDATE public.albums SET artist_id=$2 WHERE id=$1 RETURNING id", [albumId, artistId]);
        if (moved.rowCount) {
          const row = albumRows.find((item) => Number(item.id) === albumId);
          if (row) {
            albumsByArtist.set(Number(row.artist_id), (albumsByArtist.get(Number(row.artist_id)) ?? []).filter((item) => item !== row));
            row.artist_id = String(artistId);
            (albumsByArtist.get(artistId) ?? albumsByArtist.set(artistId, []).get(artistId)!).push(row);
          }
          bump(report.albums.filled, "reparented");
        }
      }
      if (ficha.site_name !== ficha.name) {
        await client.query(`INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,notes)
          VALUES($1,$2,'source_variant',$3,false,'medium',$4,$5) ON CONFLICT DO NOTHING`, [artistId, ficha.site_name, normalizeIdentity(ficha.site_name), sourceId, `Grafía del directorio RHV (${TAG})`]);
      }
      report.artists.created += 1;
      report.createdArtists.push({ id: artistId, name: ficha.name, url: ficha.url });
      await claim(ficha, "artist", ficha.name, "name", ficha.name, { artistId });
      await claim(ficha, "artist", ficha.name, "biography", bioText, { artistId });
      if (city) await claim(ficha, "artist", ficha.name, "origin_city", city, { artistId });
      if (picture) await claim(ficha, "artist", ficha.name, "picture_url", picture, { artistId });
    }
    report.artistIds[ficha.url] = artistId;
    const artist = artistById.get(artistId)!;

    // Documento de la biografía de la fuente (siempre: es la evidencia citable).
    if (bioText.length > 80) {
      const inserted = await client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata)
        VALUES($1,$2,'biography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT (artist_id,source_key) DO NOTHING`,
      [artistId, `${TAG}:bio:${ficha.letter}/${ficha.slug}`, `Biografía — Rock Hecho en Venezuela`, bioText, ficha.url, [TAG], JSON.stringify({ campaign: TAG, roles: ficha.bio_roles })]);
      report.documents += inserted.rowCount ?? 0;
    }
    for (const social of ficha.socials) await addArtistLink(artistId, social.url, social.platform, `Red citada en la ficha de Rock Hecho en Venezuela: ${ficha.url}`);

    // ── Discos ──
    const bandLike = ["band", "group", "duo", "project", "other"].includes(artist.artist_type);
    const groups = new Map<string, { key: string; cls: TypeClass; entries: Entry[] }>();
    for (const entry of ficha.albums) {
      if (entry.appearance || (entry.tab === "Recopilaciones" && entry.tracks.length > 0 && /interpretad|^temas? de/i.test(entry.header))) {
        appearances.push({ ficha, artistId, entry });
        continue;
      }
      const cls = entryClass(entry);
      const key = titleKey(cleanTitle(entry.title));
      if (!key) continue;
      const groupKey = `${key}|${cls === "album" || cls === "compilation" ? "album" : cls}`;
      const group = groups.get(groupKey) ?? groups.set(groupKey, { key, cls, entries: [] }).get(groupKey)!;
      group.entries.push(entry);
      if (group.cls === "video" && cls !== "video") group.cls = cls;
    }
    const existing = albumsByArtist.get(artistId) ?? [];
    const usedExisting = new Set<number>();
    const lineupYears = new Map<string, { name: string; years: number[]; titles: string[]; role: string }>();
    let latestYear = 0;
    const sortedGroups = [...groups.values()].map((group) => {
      group.entries.sort((a, b) => (firstYear(a.years_raw) ?? 9999) - (firstYear(b.years_raw) ?? 9999));
      return group;
    });
    for (const group of sortedGroups) {
      const first = group.entries[0]!;
      const year = group.entries.map((entry) => firstYear(entry.years_raw)).find((value) => value !== null) ?? null;
      const title = cleanTitle(first.title);
      if (group.cls === "video") { report.albums.video.push({ artist: artist.name, title, year, header: first.header, url: ficha.url }); continue; }
      const albumType = (() => {
        const base = ALBUM_TYPE[group.cls as Exclude<TypeClass, "video">];
        return base === "studio_album" && liveTitleVerdict(title, artist.name).live ? "live_album" : base;
      })();
      // Cruce exacto por título.
      const sameTitle = existing.filter((row) => titleKey(row.title) === group.key && !usedExisting.has(Number(row.id)));
      let target: typeof albumRows[number] | undefined;
      let typedSplit = false;
      if (sameTitle.length === 1) target = sameTitle[0];
      else if (sameTitle.length > 1) {
        const sameType = sameTitle.filter((row) => row.album_type === albumType);
        const pool = sameType.length ? sameType : sameTitle;
        const sameYear = pool.filter((row) => year !== null && row.release_year === year);
        if (pool.length === 1) target = pool[0];
        else if (sameYear.length === 1) target = sameYear[0];
        else { report.albums.ambiguous.push({ artist: artist.name, title, year, candidates: sameTitle.map((row) => Number(row.id)) }); continue; }
      }
      // Un sencillo homónimo de un álbum no es el álbum: si el sitio trae ambos, cada uno busca su tipo.
      if (target && target.album_type !== albumType && target.album_type !== "other" &&
          sortedGroups.some((other) => other !== group && other.key === group.key)) {
        const typed = sameTitle.find((row) => row.album_type === albumType);
        target = typed;
        typedSplit = target === undefined;
      }
      const lineup = group.entries.flatMap((entry) => entry.lineup);
      const guests = group.entries.flatMap((entry) => entry.guests);
      const best = [...group.entries].sort((a, b) => b.tracks.length - a.tracks.length)[0]!;
      let tracks = best.tracks;
      if (tracks.length === 0 && group.cls === "single") {
        tracks = title.includes(" / ") ? title.split(" / ").map((part) => ({ title: part, disc: 1 })) : [{ title, disc: 1 }];
      }
      let albumId = 0;
      let created = false;
      if (!target) {
        // Mismo número de catálogo en el mismo artista: «2» de la ficha es «Aditus/2» (GM 200.2615).
        const catalogKeys = new Set(group.entries.flatMap((entry) => entry.catalog).map(catalogKey).filter((value) => value.length >= 5 && /\d/.test(value)));
        const byCatalog = existing.filter((row) => row.catalog_id && catalogKeys.has(catalogKey(row.catalog_id)) && !usedExisting.has(Number(row.id))
          && (year === null || row.release_year === null || Math.abs(row.release_year - year) <= 1));
        if (byCatalog.length === 1) {
          target = byCatalog[0];
          report.albums.matchedCatalog.push({ artist: artist.name, title, year, catalog: target!.title, catalogId: target!.catalog_id });
        }
      }
      if (!target) {
        // Títulos parecidos: otro volumen/año es otro disco; mismo año y casi idéntico es el mismo.
        const signature = numberSignature(title);
        const nearRows = existing.filter((row) => !usedExisting.has(Number(row.id)) || titleKey(row.title) !== group.key)
          .map((row) => ({ row, score: similarity(group.key, titleKey(row.title)) }))
          .filter((item) => item.score >= 0.6 && !(typedSplit && titleKey(item.row.title) === group.key))
          .filter((item) => {
            const other = numberSignature(item.row.title);
            if (signature && other && signature !== other) return false;
            if (year !== null && item.row.release_year !== null && Math.abs(year - item.row.release_year) >= 2 && item.score < 1) return false;
            return true;
          })
          .sort((a, b) => b.score - a.score);
        const near = nearRows[0];
        if (near && near.score >= 0.9 && year !== null && near.row.release_year !== null && Math.abs(year - near.row.release_year) <= 1
            && !usedExisting.has(Number(near.row.id)) && (near.row.album_type === albumType || near.row.album_type === "other")) {
          target = near.row;
          report.albums.matchedNear.push({ artist: artist.name, title, year, catalog: near.row.title, catalogYear: near.row.release_year, score: Number(near.score.toFixed(2)) });
        } else if (near) {
          report.albums.proposed.push({ artist: artist.name, artistId, title, year, type: albumType, near: near.row.title, nearYear: near.row.release_year, nearId: Number(near.row.id), score: Number(near.score.toFixed(2)), url: ficha.url });
          continue;
        }
      }
      if (target) {
        albumId = Number(target.id);
        usedExisting.add(albumId);
        report.albums.matched += 1;
        const labelId = await firstLabel(first.labels);
        const fills: Array<[string, unknown, string]> = [
          ["release_year", target.release_year === null ? year : null, "release_year"],
          ["album_type", target.album_type === "other" ? albumType : null, "album_type"],
          ["label_id", target.label_id === null ? labelId : null, "label_id"],
          ["catalog_id", target.catalog_id === null && first.catalog[0] ? fit(first.catalog[0], 80) : null, "catalog_id"],
          ["media_format", target.media_format === null ? entryFormat(first) : null, "media_format"],
        ];
        for (const [column, value, field] of fills) {
          if (value === null || value === undefined) continue;
          const cast = column === "album_type" ? "::album_type" : "";
          await client.query(`UPDATE public.albums SET ${column}=$2${cast} WHERE id=$1 AND ${column} IS NOT DISTINCT FROM $3${column === "album_type" ? "::album_type" : ""}`,
            [albumId, value, column === "album_type" ? "other" : null]);
          bump(report.albums.filled, field);
          await claim(ficha, "album", `${artist.name}::${title}`, field === "label_id" ? "label" : field, field === "label_id" ? first.labels[0] : value, { albumId });
        }
      }
      if (!target) {
        if (await audiovisualAlbumConflict(client, artistId, title)) { report.albums.audiovisualConflict.push({ artist: artist.name, title }); continue; }
        const labelId = await firstLabel(first.labels);
        const yearText = year === null ? first.years_raw : null;
        albumId = Number((await q<{ id: string }>(`
          INSERT INTO public.albums(artist_id,title,release_year,release_date_text,album_type,label_id,catalog_id,media_format,notes)
          VALUES($1,$2,$3,$4,$5::album_type,$6,$7,$8,$9) RETURNING id::text`,
        [artistId, fit(title, 200), year, yearText, albumType, labelId, first.catalog[0] ? fit(first.catalog[0], 80) : null, entryFormat(first) ? fit(entryFormat(first)!, 50) : null,
          `Fuente: Rock Hecho en Venezuela (${first.tab}) — ${ficha.url}`]))[0]!.id);
        created = true;
        existing.push({ id: String(albumId), artist_id: String(artistId), title, release_year: year, album_type: albumType, label_id: labelId === null ? null : String(labelId), cover_url: null, catalog_id: first.catalog[0] ?? null, media_format: entryFormat(first) });
        usedExisting.add(albumId);
        report.albums.created += 1;
        await claim(ficha, "album", `${artist.name}::${title}`, "title", title, { albumId }, first.header);
        if (year !== null) await claim(ficha, "album", `${artist.name}::${title}`, "release_year", year, { albumId });
        await claim(ficha, "album", `${artist.name}::${title}`, "album_type", albumType, { albumId });
      }

      // Portada: la primera imagen de la edición más antigua; las demás, candidatas o arte adicional.
      const current = (await q<{ cover_url: string | null }>("SELECT cover_url FROM public.albums WHERE id=$1", [albumId]))[0]?.cover_url ?? null;
      let cover = current;
      for (const entry of group.entries) {
        const [front, ...rest] = entry.covers.map(absolute);
        if (front) {
          if (!cover) {
            await client.query("UPDATE public.albums SET cover_url=$2 WHERE id=$1 AND cover_url IS NULL", [albumId, front]);
            cover = front; bump(report.albums.filled, "cover_url");
            await claim(ficha, "album", `${artist.name}::${title}`, "cover_url", front, { albumId });
          } else if (front !== cover && await proposeImageCandidate(client, { kind: "album", targetId: albumId, currentUrl: cover, candidateUrl: front, sourceId, pageUrl: ficha.url, origin: TAG, runId, context: entry.header }) === "proposed") {
            report.albums.coverCandidates += 1;
          }
        }
        for (const extra of rest) {
          const inserted = await client.query(`INSERT INTO media.media_links(entity_kind,album_id,url,media_type,source_id,meta) VALUES('album',$1,$2,'scan',$3,$4::jsonb) ON CONFLICT DO NOTHING`,
            [albumId, extra, sourceId, JSON.stringify({ campaign: TAG, page: ficha.url, edition: entry.header })]);
          report.albums.extraArt += inserted.rowCount ?? 0;
        }
      }

      // Versiones y sellos con rol (0068): una versión por edición citada.
      const versionPos = Number((await q<{ n: string }>("SELECT COALESCE(max(position),0)::text n FROM ingest.album_versions WHERE album_id=$1", [albumId]))[0]!.n);
      let position = versionPos;
      for (const entry of group.entries) {
        const ref = `${ficha.url}#${entry.tab}:${entry.header}`.slice(0, 1000);
        const dup = await q("SELECT 1 FROM ingest.album_versions WHERE album_id=$1 AND source=$2 AND source_ref=$3", [albumId, SLUG, ref]);
        if (dup.length) continue;
        position += 1;
        const yearOf = firstYear(entry.years_raw);
        const version = Number((await q<{ id: string }>(`
          INSERT INTO ingest.album_versions(album_id,position,format,format_details,catalog_number,release_year,cover_url,notes,is_primary,source,source_ref,run_id,edition_types)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12) RETURNING id::text`,
        [albumId, position, entryFormat(entry), fit([entry.tab, ...entry.formats].join(", "), 200) || null, fit(entry.catalog.join(" / "), 120) || null,
          yearOf, entry.covers[0] ? absolute(entry.covers[0]) : null, entry.notes.join(" · ").slice(0, 2000) || null, SLUG, ref, runId,
          yearOf !== null && year !== null && yearOf > year ? ["reissue"] : []]))[0]!.id);
        report.albums.versions += 1;
        let labelPos = 0;
        for (const label of entry.labels) {
          const orgId = await resolveLabel(label);
          if (orgId === null) continue;
          const inserted = await client.query(`INSERT INTO ingest.album_labels(album_id,version_id,organization_id,role,position,source_text,run_id) VALUES($1,$2,$3,'label',$4,$5,$6) ON CONFLICT DO NOTHING`,
            [albumId, version, orgId, labelPos, entry.raw.slice(0, 500), runId]);
          labelPos += 1; report.albums.labels += inserted.rowCount ?? 0;
        }
      }

      // Pistas: solo en discos nuevos o vacíos.
      const has = trackCount.get(albumId) ?? 0;
      const trackIds = new Map<string, number[]>();
      if (has === 0 && tracks.length > 0) {
        const perDisc = new Map<number, number>();
        let inserted = 0;
        for (const track of tracks) {
          const disc = track.disc || 1;
          const number = (perDisc.get(disc) ?? 0) + 1; perDisc.set(disc, number);
          const titleTrack = fit(cleanTitle(track.title), 200);
          if (!titleTrack) continue;
          const notes = [track.side ? `Lado ${track.side}` : "", track.bonus ? "Bonus" : ""].filter(Boolean).join(" · ") || null;
          const id = Number((await q<{ id: string }>("INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes) VALUES($1,$2,$3,$4,$5) RETURNING id::text",
            [albumId, disc, number, titleTrack, notes]))[0]!.id);
          (trackIds.get(titleKey(titleTrack)) ?? trackIds.set(titleKey(titleTrack), []).get(titleKey(titleTrack))!).push(id);
          report.tracks.created += 1; inserted += 1;
          await claim(ficha, "track", `${artist.name}::${title}::${disc}-${number}`, "title", titleTrack, { trackId: id });
        }
        trackCount.set(albumId, inserted);
      } else {
        for (const row of await q<{ id: string; title: string }>("SELECT id::text,title FROM public.tracks WHERE album_id=$1", [albumId])) {
          (trackIds.get(titleKey(row.title)) ?? trackIds.set(titleKey(row.title), []).get(titleKey(row.title))!).push(Number(row.id));
        }
        if (has > 0 && tracks.length > 0 && Math.abs(has - tracks.length) > 0) report.albums.tracklistDiffers.push({ artist: artist.name, title, albumId, catalog: has, site: tracks.length });
      }
      if (created) report.createdAlbums.push({ id: albumId, artist: artist.name, title, year, type: albumType, tracks: (has === 0 ? tracks.length : has) });

      // Formación → créditos de músico.
      const credited = new Set((await q<{ person_id: string; credit_type: string }>("SELECT person_id::text, credit_type::text FROM public.album_credits WHERE album_id=$1 AND person_id IS NOT NULL", [albumId]))
        .map((row) => `${row.person_id}|${row.credit_type}`));
      const numbers = new Map<number, string>();
      for (const row of await q<{ id: string; disc_number: number; track_number: number }>("SELECT id::text,disc_number,track_number FROM public.tracks WHERE album_id=$1", [albumId])) {
        numbers.set(Number(row.id), `${row.disc_number > 1 ? `${row.disc_number}-` : ""}${String(row.track_number).padStart(2, "0")}`);
      }
      const trackCredited = new Set((await q<{ k: string }>("SELECT tc.track_id||'|'||tc.person_id||'|'||tc.credit_type k FROM public.track_credits tc JOIN public.tracks t ON t.id=tc.track_id WHERE t.album_id=$1 AND tc.person_id IS NOT NULL", [albumId])).map((row) => row.k));
      // «Bass (track 04)»: el rol del disco nombra las pistas; cada pista lleva además su crédito (D8).
      const creditTracks = async (personId: number, parts: Array<{ role: string; tracks: string[] }>, type: "musician" | "guest", note: string): Promise<string> => {
        const labels: string[] = [];
        for (const part of parts) {
          const ids = part.tracks.flatMap((trackTitle) => {
            const found = trackIds.get(titleKey(trackTitle)) ?? [];
            if (!found.length) report.credits.guestTrackUnmatched += 1;
            return found;
          });
          for (const trackId of ids) {
            if (trackCredited.has(`${trackId}|${personId}|${type}`)) continue;
            trackCredited.add(`${trackId}|${personId}|${type}`);
            await client.query("INSERT INTO public.track_credits(track_id,person_id,credit_type,role,notes) VALUES($1,$2,$3,$4,$5)",
              [trackId, personId, type, fit(part.role, 200), note]);
            if (type === "guest") report.credits.trackGuest += 1; else report.credits.trackMusician += 1;
          }
          const numbered = ids.map((id) => numbers.get(id)).filter(Boolean);
          labels.push(numbered.length ? `${part.role} (track ${numbered.join(", ")})` : part.role);
        }
        return [...new Set(labels)].join("; ");
      };
      const translated = (role: string): Array<{ role: string; tracks: string[] }> =>
        guestParts(role).map((part) => ({ ...part, role: roleInEnglish(part.role) })).filter((part) => part.role);

      const seenLineup = new Set<string>();
      for (const member of lineup) {
        for (const name of splitNames(member.name)) {
          const key = personKey(name);
          if (!key || seenLineup.has(key) || key.length < 3) continue;
          seenLineup.add(key);
          // «Sus integrantes son Freddy Contreras (voz)» deja la frase pegada al primer nombre.
          const bioRole = Object.entries(ficha.bio_roles).find(([bioName]) => { const bioKey = personKey(bioName); return bioKey === key || bioKey.endsWith(` ${key}`); })?.[1]?.join(", ") ?? "";
          const parts = translated(member.role || bioRole);
          const role = [...new Set(parts.map((part) => part.role))].join(" & ");
          let personId: number;
          if (!bandLike && (key === personKey(artist.name) || titular.get(artistId) !== undefined && linkedPersons.get(artistId)?.get(key) === titular.get(artistId))) {
            personId = titular.get(artistId) ?? await resolvePerson(artistId, artist.name, name, ficha);
            if (!titular.has(artistId)) {
              await client.query("INSERT INTO public.artist_members(artist_id,person_id,role,notes) VALUES($1,$2,'Titular del proyecto',$3)", [artistId, personId, `Titular: ${ficha.url}`]);
              titular.set(artistId, personId); report.members.created += 1;
            }
          } else {
            personId = await resolvePerson(artistId, artist.name, name, ficha);
          }
          if (!credited.has(`${personId}|musician`)) {
            const label = await creditTracks(personId, parts, "musician", "Formación según Rock Hecho en Venezuela");
            await client.query("INSERT INTO public.album_credits(album_id,person_id,credit_type,role,notes) VALUES($1,$2,'musician',$3,$4)",
              [albumId, personId, fit((label || "Musician"), 200), `Formación según Rock Hecho en Venezuela`]);
            credited.add(`${personId}|musician`); report.credits.musician += 1;
          }
          if (bandLike && group.cls !== "compilation") {
            const span = lineupYears.get(`${personId}`) ?? lineupYears.set(`${personId}`, { name, years: [], titles: [], role }).get(`${personId}`)!;
            if (year !== null) span.years.push(year);
            span.titles.push(title);
            if (!span.role && role) span.role = role;
          }
        }
      }
      if (year !== null && group.cls !== "compilation") latestYear = Math.max(latestYear, year);

      // Invitados → crédito de disco «rol (track NN)» y crédito de pista (D8).
      for (const guest of guests) {
        const parts = translated(guest.role);
        for (const name of splitNames(guest.name)) {
          if (personKey(name).length < 3) continue;
          const personId = await resolvePerson(artistId, artist.name, name, ficha);
          // Invitado ya acreditado por otra fuente: solo se suman sus créditos de pista.
          if (credited.has(`${personId}|guest`)) { await creditTracks(personId, parts, "guest", "Músico invitado según Rock Hecho en Venezuela"); continue; }
          const label = await creditTracks(personId, parts, "guest", "Músico invitado según Rock Hecho en Venezuela");
          await client.query("INSERT INTO public.album_credits(album_id,person_id,credit_type,role,notes) VALUES($1,$2,'guest',$3,$4)",
            [albumId, personId, fit(label || "Guest Musician", 200), "Músico invitado según Rock Hecho en Venezuela"]);
          credited.add(`${personId}|guest`); report.credits.guest += 1;
        }
      }

      // Enlaces del disco (Bandcamp, Spotify…); los videos se informan.
      for (const entry of group.entries) {
        for (const link of entry.links) {
          let href: string;
          try { href = absolute(link.href); } catch { continue; }
          const kind = platformOf(href);
          if (!kind || kind.kind !== "streaming") continue;
          if (kind.platform === "youtube") { report.links.youtubeVideos.push({ albumId, artist: artist.name, title, url: href }); continue; }
          if (streamingPlatforms.has(`d${albumId}|${kind.platform}`) || knownUrls.has(urlKey(href))) continue;
          await client.query(`INSERT INTO public.streaming_links(album_id,platform,url,method,source,verified,notes) VALUES($1,$2,$3,'scrape',$4,false,$5)`,
            [albumId, kind.platform, href, TAG, `Enlace de la discografía en Rock Hecho en Venezuela: ${ficha.url}`]);
          streamingPlatforms.add(`d${albumId}|${kind.platform}`); knownUrls.add(urlKey(href)); report.links.albumStreaming += 1;
        }
      }
    }

    // Membresías de bandas con el periodo de los discos donde figuran (etapa 5).
    for (const [personIdText, span] of lineupYears) {
      const personId = Number(personIdText);
      if (titular.get(artistId) === personId) continue;
      const from = span.years.length ? Math.min(...span.years) : null;
      const last = span.years.length ? Math.max(...span.years) : null;
      const to = last !== null && last < latestYear ? last : null;
      const note = `Periodo deducido de la discografía en Rock Hecho en Venezuela: ${[...new Set(span.titles)].join(", ")}`.slice(0, 1000);
      const key = `${artistId}|${personId}`;
      const membership = memberships.get(key);
      if (!membership) {
        const id = Number((await q<{ id: string }>("INSERT INTO public.artist_members(artist_id,person_id,role,from_year,to_year,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text",
          [artistId, personId, fit((span.role || "integrante"), 200), from, to, note]))[0]!.id);
        memberships.set(key, { id, from, to });
        const instruments = instrumentsOf(span.role || "");
        if (instruments.length) {
          await client.query("INSERT INTO ingest.membership_details(artist_member_id,instruments,run_id) VALUES($1,$2,$3) ON CONFLICT (artist_member_id) DO NOTHING", [id, instruments, runId]);
        }
        report.members.created += 1;
      } else if (membership.from === null && membership.to === null && from !== null) {
        await client.query("UPDATE public.artist_members SET from_year=$2,to_year=$3,notes=concat_ws(' · ',notes,$4::text) WHERE id=$1 AND from_year IS NULL AND to_year IS NULL",
          [membership.id, from, to, note]);
        membership.from = from; membership.to = to;
        report.members.periodsFilled += 1;
      }
    }
  }

  // ── Apariciones en recopilatorios de varios artistas ──
  const vaAlbums = (albumsByArtist.get(VA_ARTIST_ID) ?? []);
  for (const { ficha, artistId, entry } of appearances) {
    const title = cleanTitle(entry.title);
    const year = firstYear(entry.years_raw);
    const key = titleKey(title);
    let candidates = vaAlbums.filter((row) => titleKey(row.title) === key);
    if (candidates.length > 1 && year !== null) candidates = candidates.filter((row) => row.release_year === year);
    if (candidates.length !== 1) { report.appearances.albumMissing.push({ artist: artistById.get(artistId)?.name, title, year, tracks: entry.tracks.map((t) => t.title), candidates: candidates.length, url: ficha.url }); continue; }
    const albumId = Number(candidates[0]!.id);
    const rows = await q<{ id: string; title: string }>("SELECT id::text,title FROM public.tracks WHERE album_id=$1", [albumId]);
    for (const track of entry.tracks) {
      const matches = rows.filter((row) => titleKey(row.title) === titleKey(track.title));
      if (matches.length !== 1) { report.appearances.trackMissing.push({ artist: artistById.get(artistId)?.name, album: title, albumId, track: track.title, matches: matches.length }); continue; }
      const trackId = Number(matches[0]!.id);
      const prior = await q("SELECT 1 FROM public.track_credits WHERE track_id=$1 AND artist_id=$2", [trackId, artistId]);
      if (prior.length) { report.appearances.alreadyCredited += 1; continue; }
      await client.query("INSERT INTO public.track_credits(track_id,artist_id,credit_type,role,notes) VALUES($1,$2,'musician','Intérprete',$3)",
        [trackId, artistId, `Según Rock Hecho en Venezuela: ${ficha.url}`]);
      report.appearances.credited += 1;
    }
  }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
const pool = getPool();
const source = (await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SLUG])).rows[0];
if (!source) throw new Error(`fuente desconocida: ${SLUG}`);
const SOURCE_ID = Number(source.id);
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "rhv-directorio:absorb", operator: OPERATOR, note: NOTE, params: { campaign: TAG, fichas: fichas.length } },
    async (context) => { report.runId = context.runId; await apply(context.client, context.runId, SOURCE_ID); });
  report.runId = outcome.runId;
} else {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>("INSERT INTO ingest.scrape_runs(kind,source_id,status,params) VALUES('manual',$1,'running',$2::jsonb) RETURNING id::text",
      [SOURCE_ID, JSON.stringify({ action: "rhv-directorio:dry-run" })]);
    await apply(client, Number(run.rows[0]!.id), SOURCE_ID);
    if (ONLY.length) {
      const ids = Object.values(report.artistIds).map(Number);
      const shown = await client.query(`SELECT al.title, al.release_year, al.album_type, l.name AS label, al.catalog_id,
          (SELECT string_agg(lpad(t.track_number::text,2,'0')||' - '||t.title, ' | ' ORDER BY t.disc_number,t.track_number) FROM public.tracks t WHERE t.album_id=al.id) AS tracklist,
          (SELECT string_agg(p.name||' ['||ac.credit_type||'] '||COALESCE(ac.role,''), ' | ' ORDER BY ac.credit_type DESC, ac.id) FROM public.album_credits ac JOIN public.persons p ON p.id=ac.person_id WHERE ac.album_id=al.id) AS credits
        FROM public.albums al LEFT JOIN public.organizations l ON l.id=al.label_id WHERE al.artist_id = ANY($1::bigint[]) ORDER BY al.release_year, al.title`, [ids]);
      console.log(JSON.stringify(shown.rows, null, 1));
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
(report as Record<string, unknown>)['skippedNames'] = [...skippedNames].sort();
(report as Record<string, unknown>)['untranslatedRoles'] = Object.fromEntries([...untranslatedRoles].sort((a, b) => b[1] - a[1]));
mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, CONFIRM ? "aplicacion.json" : "aplicacion-dry-run.json");
writeFileSync(file, JSON.stringify(report, null, 1));
const summary = { ...report, createdArtists: report.createdArtists.length, createdAlbums: report.createdAlbums.length, artistIds: Object.keys(report.artistIds).length,
  artists: { ...report.artists, ambiguous: report.artists.ambiguous.length, similarSkipped: report.artists.similarSkipped.length, excluded: report.artists.excluded.length },
  albums: { ...report.albums, proposed: report.albums.proposed.length, matchedNear: report.albums.matchedNear.length, matchedCatalog: report.albums.matchedCatalog.length, ambiguous: report.albums.ambiguous.length, video: report.albums.video.length, audiovisualConflict: report.albums.audiovisualConflict.length, tracklistDiffers: report.albums.tracklistDiffers.length },
  organizations: { ...report.organizations, createdList: report.organizations.createdList.length },
  links: { ...report.links, youtubeVideos: report.links.youtubeVideos.length },
  appearances: { ...report.appearances, albumMissing: report.appearances.albumMissing.length, trackMissing: report.appearances.trackMissing.length } };
console.log(JSON.stringify(summary, null, 1));
console.log(`-> ${file}`);
await closeDb();
