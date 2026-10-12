// CRV · Lugares de los créditos (plan del primo, etapa 2, punto 8).
//
// Decisión de Brian (2026-10-12): el lugar tiene página propia, no es una
// búsqueda filtrada. Las fuentes lo escriben de muchas formas —«Hollywood, CA»,
// «Hollywood, California», «Caracas (Venezuela)», «Caracas. Venezuela»—: todas
// son alias de un mismo lugar. El nombre canónico va en español para el país
// («Países Bajos»), con el estado completo en Estados Unidos («Hollywood,
// California») y la ciudad como la escribe la fuente más frecuente.
//
// Lo que no se puede resolver con seguridad (una ciudad en el país equivocado,
// una región ambigua) sale con `doubt` y entra ligado pero en revisión.
import { removeDiacritics } from "../normalization/entity-name.js";

export type PlaceType = "city" | "region" | "country" | "area";

export interface ResolvedPlace {
  /** Nombre canónico: «Hollywood, California», «Caracas, Venezuela», «Venezuela». */
  name: string;
  placeType: PlaceType;
  city: string | null;
  region: string | null;
  country: string | null;
  /** Por qué esta variante va a revisión. */
  doubt: string | null;
}

const US_STATES: Readonly<Record<string, string>> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut",
  de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawái", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Luisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Míchigan",
  mn: "Minnesota", ms: "Misisipi", mo: "Misuri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "Nuevo Hampshire",
  nj: "Nueva Jersey", nm: "Nuevo México", ny: "New York", nc: "Carolina del Norte", nd: "Dakota del Norte", oh: "Ohio",
  ok: "Oklahoma", or: "Oregón", pa: "Pensilvania", ri: "Rhode Island", sc: "Carolina del Sur", sd: "Dakota del Sur",
  tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "Virginia Occidental",
  wi: "Wisconsin", wy: "Wyoming", dc: "Washington D. C.",
};

/** Nombre completo (inglés o español) → nombre canónico del estado. */
const US_STATE_NAMES: ReadonlyMap<string, string> = new Map([
  ...Object.values(US_STATES).map((name) => [key(name), name] as const),
  ["new jersey", "Nueva Jersey"], ["pennsylvania", "Pensilvania"], ["north carolina", "Carolina del Norte"],
  ["south carolina", "Carolina del Sur"], ["michigan", "Míchigan"], ["louisiana", "Luisiana"], ["hawaii", "Hawái"],
  ["oregon", "Oregón"], ["new mexico", "Nuevo México"], ["new hampshire", "Nuevo Hampshire"], ["nyc", "New York"],
]);

const COUNTRIES: ReadonlyMap<string, string> = new Map([
  ["venezuela", "Venezuela"], ["ve", "Venezuela"], ["vzla", "Venezuela"], ["venezueka", "Venezuela"],
  ["usa", "Estados Unidos"], ["us", "Estados Unidos"], ["u s a", "Estados Unidos"], ["united states", "Estados Unidos"], ["eeuu", "Estados Unidos"], ["estados unidos", "Estados Unidos"],
  ["uk", "Reino Unido"], ["united kingdom", "Reino Unido"], ["united kindom", "Reino Unido"], ["england", "Reino Unido"], ["inglaterra", "Reino Unido"], ["reino unido", "Reino Unido"],
  ["netherlands", "Países Bajos"], ["holland", "Países Bajos"], ["holanda", "Países Bajos"], ["paises bajos", "Países Bajos"],
  ["spain", "España"], ["espana", "España"], ["mexico", "México"], ["italy", "Italia"], ["italia", "Italia"],
  ["belgium", "Bélgica"], ["belgica", "Bélgica"], ["germany", "Alemania"], ["alemania", "Alemania"], ["denmark", "Dinamarca"],
  ["dinamarca", "Dinamarca"], ["brazil", "Brasil"], ["brasil", "Brasil"], ["argentina", "Argentina"], ["chile", "Chile"],
  ["colombia", "Colombia"], ["peru", "Perú"], ["ecuador", "Ecuador"], ["cuba", "Cuba"], ["panama", "Panamá"],
  ["puerto rico", "Puerto Rico"], ["australia", "Australia"], ["france", "Francia"], ["francia", "Francia"],
  ["canada", "Canadá"], ["japan", "Japón"], ["japon", "Japón"], ["portugal", "Portugal"], ["sweden", "Suecia"],
  ["suecia", "Suecia"], ["costa rica", "Costa Rica"], ["dominican republic", "República Dominicana"],
  ["republica dominicana", "República Dominicana"], ["uruguay", "Uruguay"],
]);

/** Estados de Venezuela: «Carabobo, Venezuela» es una región, no una ciudad. */
const VE_STATES: ReadonlyMap<string, string> = new Map([
  "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro", "Falcón",
  "Guárico", "Lara", "Mérida", "Miranda", "Monagas", "Nueva Esparta", "Portuguesa", "Sucre", "Táchira", "Trujillo",
  "Vargas", "La Guaira", "Yaracuy", "Zulia", "Distrito Capital",
].map((name) => [key(name), name] as const));

/** Ciudades venezolanas que también son estado: sin «Estado», es la ciudad. */
const VE_CITY_FIRST = new Set(["merida", "trujillo", "barinas", "sucre"]);

/** Formas de una ciudad → su nombre canónico (y el país que se sobrentiende). */
const CITIES: ReadonlyMap<string, { city: string; region?: string; country: string }> = new Map([
  ["caracas", { city: "Caracas", country: "Venezuela" }],
  ["maracaibo", { city: "Maracaibo", country: "Venezuela" }],
  ["valencia venezuela", { city: "Valencia", country: "Venezuela" }],
  ["maracay", { city: "Maracay", country: "Venezuela" }],
  ["barquisimeto", { city: "Barquisimeto", country: "Venezuela" }],
  ["san cristobal", { city: "San Cristóbal", country: "Venezuela" }],
  ["lecheria", { city: "Lechería", country: "Venezuela" }], ["lecherias", { city: "Lechería", country: "Venezuela" }],
  ["pto fijo", { city: "Punto Fijo", country: "Venezuela" }], ["puerto fijo", { city: "Punto Fijo", country: "Venezuela" }], ["punto fijo", { city: "Punto Fijo", country: "Venezuela" }],
  ["pto ordaz", { city: "Puerto Ordaz", country: "Venezuela" }], ["puerto ordaz", { city: "Puerto Ordaz", country: "Venezuela" }],
  ["miami", { city: "Miami", region: "Florida", country: "Estados Unidos" }],
  ["new york", { city: "New York", region: "New York", country: "Estados Unidos" }],
  ["new york city", { city: "New York", region: "New York", country: "Estados Unidos" }],
  ["nyc", { city: "New York", region: "New York", country: "Estados Unidos" }],
  ["a dam", { city: "Ámsterdam", country: "Países Bajos" }], ["amsterdam", { city: "Ámsterdam", country: "Países Bajos" }],
  ["hague", { city: "La Haya", country: "Países Bajos" }], ["the hague", { city: "La Haya", country: "Países Bajos" }],
  ["london", { city: "Londres", country: "Reino Unido" }], ["londres", { city: "Londres", country: "Reino Unido" }],
  ["rome", { city: "Roma", country: "Italia" }], ["roma", { city: "Roma", country: "Italia" }],
  ["milan", { city: "Milán", country: "Italia" }], ["naples", { city: "Nápoles", country: "Italia" }],
  ["brussels", { city: "Bruselas", country: "Bélgica" }], ["copenhagen", { city: "Copenhague", country: "Dinamarca" }],
  ["berlin", { city: "Berlín", country: "Alemania" }], ["rio de janerio", { city: "Río de Janeiro", country: "Brasil" }],
  ["rio de janeiro", { city: "Río de Janeiro", country: "Brasil" }],
  ["distrito federal", { city: "Ciudad de México", country: "México" }], ["d f", { city: "Ciudad de México", country: "México" }],
  ["mexico city", { city: "Ciudad de México", country: "México" }],
]);

/** «Puerto Fijo» no existe: es casi seguro Punto Fijo («Pto. Fijo»). */
const SUSPICIOUS: ReadonlyMap<string, string> = new Map([
  ["puerto fijo", "«Puerto Fijo» no existe: se liga a Punto Fijo"],
]);

function key(value: string): string {
  return removeDiacritics(value.toLowerCase()).replace(/[.'’]/gu, " ").replace(/[^a-z0-9 ]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/** Clave de la variante: dos escrituras con la misma clave son el mismo alias. */
export function placeAliasKey(raw: string): string {
  return key(raw.replace(/[()]/gu, " "));
}

function titleCase(value: string): string {
  return value.trim().replace(/\s+/gu, " ").replace(/(^|[\s-])(\p{Ll})/gu, (_match, sep: string, letter: string) => sep + letter.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y)\b/gu, (word, _w, offset: number) => offset === 0 ? word : word.toLowerCase());
}

function cityName(city: string, region: string | null, country: string | null): string {
  if (country === "Estados Unidos" && region) return `${city}, ${region}`;
  return country ? `${city}, ${country}` : city;
}

/**
 * Lugar de una variante escrita por la fuente. Devuelve null si el texto no es
 * un lugar (vacío o demasiado largo).
 */
export function resolvePlace(raw: string): ResolvedPlace | null {
  const text = raw.replace(/[()]/gu, " ").replace(/\s+/gu, " ").trim().replace(/[.,;]+$/u, "");
  if (!text || text.length > 80 || /^[\d\s/-]+$/u.test(text)) return null;
  // «Caracas. Venezuela» y «Caracas Venezuela»: el país pegado al final.
  let parts = text.split(/\s*,\s*/u).map((part) => part.trim().replace(/\.$/u, '')).filter(Boolean);
  if (parts.length === 1) {
    const words = parts[0]!.split(/(?:\.\s*|\s+)/u).filter(Boolean);
    const lastCountry = COUNTRIES.get(key(words.at(-1)!));
    if (words.length > 1 && lastCountry && !CITIES.has(key(parts[0]!))) parts = [words.slice(0, -1).join(" "), words.at(-1)!];
  }
  const doubts: string[] = [];
  // Variantes que casi seguro son otra cosa: se ligan, pero a revisión.
  const suspicious = SUSPICIOUS.get(key(parts[0]!));
  if (suspicious) doubts.push(suspicious);
  if (parts.length === 1) {
    const only = key(parts[0]!);
    const country = COUNTRIES.get(only);
    if (country) return { name: country, placeType: "country", city: null, region: null, country, doubt: null };
    const known = CITIES.get(only);
    if (known) return { name: cityName(known.city, known.region ?? null, known.country), placeType: "city", city: known.city, region: known.region ?? null, country: known.country, doubt: null };
    const veState = VE_STATES.get(only.replace(/^(?:estado|edo) /u, ""));
    if (veState) return { name: `${veState}, Venezuela`, placeType: "region", city: null, region: veState, country: "Venezuela", doubt: null };
    return { name: titleCase(parts[0]!), placeType: "city", city: titleCase(parts[0]!), region: null, country: null, doubt: "sin país ni región" };
  }
  let [first, second] = [parts[0]!, parts.slice(1).join(", ")];
  // «California, Los Angeles»: la región delante.
  if (US_STATE_NAMES.has(key(first)) && !CITIES.has(key(first)) && !US_STATE_NAMES.has(key(second)) && !US_STATES[key(second)] && !COUNTRIES.has(key(second))) [first, second] = [second, first];
  const firstKey = key(first);
  const secondKey = key(second);
  // Región sola: «California, US», «Carabobo, Venezuela», «Estado Bolívar, Venezuela».
  const stateOnly = US_STATE_NAMES.get(firstKey);
  if (stateOnly && !CITIES.has(firstKey) && COUNTRIES.get(secondKey) === "Estados Unidos") {
    return { name: `${stateOnly}, Estados Unidos`, placeType: "region", city: null, region: stateOnly, country: "Estados Unidos", doubt: null };
  }
  const veRegion = VE_STATES.get(firstKey.replace(/^(?:estado|edo|ed) /u, ""));
  if (veRegion && COUNTRIES.get(secondKey) === "Venezuela" && (!VE_CITY_FIRST.has(firstKey) || /^(?:estado|edo|ed) /u.test(firstKey))) {
    return { name: `${veRegion}, Venezuela`, placeType: "region", city: null, region: veRegion, country: "Venezuela", doubt: null };
  }
  // Ciudad + estado de EE. UU. («Hollywood, CA», «Miami, Florida», «Brooklyn, NYC»).
  const usState = US_STATES[secondKey] ?? US_STATE_NAMES.get(secondKey);
  if (usState) {
    const known = CITIES.get(firstKey);
    const city = known?.country === "Estados Unidos" ? known.city : titleCase(first);
    return { name: `${city}, ${usState}`, placeType: "city", city, region: usState, country: "Estados Unidos", doubt: null };
  }
  const country = COUNTRIES.get(secondKey);
  if (country) {
    const known = CITIES.get(firstKey) ?? CITIES.get(`${firstKey} ${secondKey}`);
    if (known && known.country !== country) doubts.push(`«${first}» está en ${known.country}, no en ${country}`);
    if (known && known.country === country) {
      return { name: cityName(known.city, known.region ?? null, country), placeType: "city", city: known.city, region: known.region ?? null, country, doubt: doubts.length ? doubts.join("; ") : null };
    }
    // «New York, USA» y «Miami, US»: el estado se sobrentiende.
    if (country === "Estados Unidos" && known) {
      return { name: cityName(known.city, known.region ?? null, known.country), placeType: "city", city: known.city, region: known.region ?? null, country: known.country, doubt: null };
    }
    const city = titleCase(first);
    return { name: cityName(city, null, country), placeType: "city", city, region: null, country, doubt: doubts.length ? doubts.join("; ") : null };
  }
  // Ciudad + estado venezolano («Cocorote, Yaracuy», «Pto Ordaz, Bolívar»).
  const veState = VE_STATES.get(secondKey.replace(/^(?:estado|edo) /u, ""));
  if (veState) {
    const known = CITIES.get(firstKey);
    const city = known?.country === "Venezuela" ? known.city : titleCase(first);
    return { name: `${city}, Venezuela`, placeType: "city", city, region: veState, country: "Venezuela", doubt: null };
  }
  // Lo demás («Gibraltar, Buenos Aires», «Charlotte, Carolina»): a revisión.
  const known = CITIES.get(firstKey);
  if (known) return { name: cityName(known.city, known.region ?? null, known.country), placeType: "city", city: known.city, region: known.region ?? null, country: known.country, doubt: `«${second}» no es un país ni una región conocidos` };
  const name = `${titleCase(first)}, ${titleCase(second)}`;
  return { name, placeType: "city", city: titleCase(first), region: titleCase(second), country: null, doubt: `«${second}» no es un país ni una región conocidos` };
}
