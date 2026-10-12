// CRV · Lista fija de instrumentos de un integrante (plan del primo, etapa 2,
// punto 11). `artist_members.role` es texto libre en dos idiomas («Guitar &
// Backing Vocals», «bajo y coros», «Guitars (lead), Vocals (backing)»); la línea
// de tiempo necesita una lista cerrada con un color por instrumento. El rol
// original no se toca: la clave normalizada vive en `ingest.membership_details`.
import { removeDiacritics } from "../normalization/entity-name.js";

export const INSTRUMENTS = [
  { key: "vocals", label: "Voz" },
  { key: "backing_vocals", label: "Coros" },
  { key: "lead_guitar", label: "Guitarra líder" },
  { key: "guitar", label: "Guitarra" },
  { key: "bass", label: "Bajo" },
  { key: "drums", label: "Batería" },
  { key: "percussion", label: "Percusión" },
  { key: "keyboards", label: "Teclados" },
  { key: "programming", label: "Programación y electrónica" },
  { key: "turntables", label: "DJ / tornamesas" },
  { key: "cuatro", label: "Cuatro y cuerdas venezolanas" },
  { key: "strings", label: "Cuerdas" },
  { key: "woodwinds", label: "Vientos de madera" },
  { key: "brass", label: "Metales" },
  { key: "accordion", label: "Acordeón y armónica" },
  { key: "all_instruments", label: "Todos los instrumentos" },
  { key: "direction", label: "Dirección musical" },
] as const;

export type InstrumentKey = (typeof INSTRUMENTS)[number]["key"];

export const INSTRUMENT_LABEL: Readonly<Record<InstrumentKey, string>> =
  Object.fromEntries(INSTRUMENTS.map((item) => [item.key, item.label])) as Record<InstrumentKey, string>;

/** Orden de las barras en la línea de tiempo: voz arriba, batería abajo (como la imagen 4). */
export const INSTRUMENT_ORDER: readonly InstrumentKey[] = INSTRUMENTS.map((item) => item.key);

// Cada patrón se prueba contra un tramo del rol ya sin tildes y en minúsculas.
// El orden importa: «backing vocals» antes que «vocals», «lead guitar» antes
// que «guitar», «bass clarinet» y «contrabajo» antes de decidir «bajo».
const RULES: ReadonlyArray<[RegExp, InstrumentKey]> = [
  [/\b(?:all instruments|everything|todos los instrumentos|multi-?instrumentista|multi-?instrumentalist)\b/u, "all_instruments"],
  [/\b(?:backing|background|back|choirs?|coros?|segunda voz|2das? voces|segundas voces|armonias)\b/u, "backing_vocals"],
  [/\bvocals?\s*\((?:backing|background|choirs?)\)/u, "backing_vocals"],
  [/\blead guitars?\b|\bguitars?\s*\(lead\)|\bguitarras? (?:lider|principal|solista)\b|\bprimera guitarra\b|\b1st guitar\b/u, "lead_guitar"],
  [/\bbass clarinet\b|\bclarinet|\bclarinete|\bflute|\bflauta|\bsax|\bsaxo|\boboe|\bpiccolo|\bfagot|\bbassoon|\bmelodica|\bzampona|\bquena/u, "woodwinds"],
  [/\btrumpet|\btrompeta|\btrombon|\btrombone|\bflugelhorn|\bfrench horn|\btuba|\bcorno|\bmetales|\bbrass/u, "brass"],
  [/\bcontrabajo|\bdouble bass|\bupright bass|\bacoustic bass|\bbass\b|\bbajo\b|\bbajista|\bbass guitar|\bbajos\b/u, "bass"],
  [/\bdrum programming|\bprogramacion de (?:secuencias de )?bateria|\bbateria programada/u, "programming"],
  [/\bdrums?\b|\bbateri[ao]s?\b|\bbaterista|\bdrummer|\bsnare|\bbombo|\bbaquetas|\bplatos\b/u, "drums"],
  [/\bpercussion|\bpercusion|\bcongas?|\bbongos?|\btimbal(?:es)?|\bmaracas|\bguiro|\btambora|\btumbadoras|\bcajon|\bdjembe|\bpandereta|\bcharrasca|\btamborim|\bquinto|\bbata\b|\bguarura|\bhand claps|\bconguero|\bguira|\btambor|\bvibraphone|\bvibrafono/u, "percussion"],
  [/\bguitars?\b|\bguitarras?\b|\bguitarrista|\bviolao|\blap ?steel|\bebow|\b12 string/u, "guitar"],
  [/\bkeyboards?|\bteclados?|\btecladista|\bpiano|\borgan|\borgano|\bsynth|\bsintetizador|\bxylophone|\bxilofono|\brhodes|\bb3\b/u, "keyboards"],
  [/\bprogramming|\bprogramacion|\bprogramaciones|\bsequences?|\bsecuencias|\bsamples?|\bsampler|\bsampling|\bloops?|\belectronic|\belectronicos?|\bcomputadora|\bfx\b|\befectos/u, "programming"],
  [/\bdj\b|\bturntables?|\bscratch|\bgiradiscos|\btornamesas?/u, "turntables"],
  [/\bcuatro|\bbandola|\bmandolin|\bmandolina|\btiple|\btres\b|\bcharango|\barpa|\bharp\b|\blaud|\bvihuela|\bbanjo|\bbandurria|\bguitarron/u, "cuatro"],
  [/\bviolin|\bviola\b|\bcello|\bvioloncel+o|\bcuerdas|\bstrings/u, "strings"],
  [/\baccordion|\bacordeon|\bharmonica|\barmonica|\bharmonica/u, "accordion"],
  [/\b(?:music(?:al)? director|director|directora|direccion musical|conductor)\b/u, "direction"],
  [/\bvocals?\b|\bvoz\b|\bvoces\b|\bvoice\b|\bsinger|\bcantante|\bvocalista|\bmc\b|\bmaestro de ceremonias|\brap|\bscreams?|\bgritos|\bsoprano\b|\bcontralto|\bmezzo|\btenor\b|\bbaritone\b|\bsingers?/u, "vocals"],
];

/** Tramos de un rol: «Guitar & Backing Vocals» → «guitar», «backing vocals». */
function segments(role: string): string[] {
  const clean = removeDiacritics(role.toLowerCase())
    // Periodos anotados («Guitars (2014-present)») no son instrumento.
    .replace(/\((?:\s*\d{4}\s*(?:-|–)\s*(?:\d{4}|present|presente)?\s*,?\s*)+\)/gu, " ")
    // «Vocals (lead)» y «Guitars (rhythm)»: el matiz se queda pegado a su tramo.
    .replace(/\s+/gu, " ");
  return clean.split(/\s*(?:,|&|\+|\/|;|\s+y\s+|\s+and\s+|\s+e\s+|–|—)\s*/u).map((part) => part.trim()).filter(Boolean);
}

/**
 * Claves de instrumento de un rol libre, sin repetir y en el orden de la
 * línea de tiempo. «Titular del proyecto», «Integrante» o «Miembro» no tienen
 * instrumento: devuelven [].
 */
export function instrumentsOf(role: string): InstrumentKey[] {
  const found = new Set<InstrumentKey>();
  for (const segment of segments(role)) {
    // «Lead Vocals & Backing Vocals» → voz y coros; «Vocals (lead)» → voz.
    for (const [pattern, key] of RULES) {
      if (!pattern.test(segment)) continue;
      found.add(key);
      // Un tramo es un instrumento; «guitarra y coros» ya viene partido.
      // Excepción: «Guitars (lead), Vocals (backing)» ya trae su matiz.
      break;
    }
  }
  // «Lead guitar» y «guitar» juntos en la misma persona: se queda la líder.
  if (found.has("lead_guitar")) found.delete("guitar");
  return INSTRUMENT_ORDER.filter((key) => found.has(key));
}
