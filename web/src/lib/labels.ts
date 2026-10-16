import { classificationFilterKey, classificationFilterLabel } from "../../../src/shared/classification-filters";
// CRV · Etiquetas legibles para los enums del core y de ingest (crv_simple_v1.sql,
// migrations/*). Solo presentación: los valores que viajan a la API siguen
// siendo los snake_case originales.
import { TITULAR_ROLE } from "./types";
import { ALBUM_CHARACTERISTICS, ALBUM_EDITION_TYPES } from "../../../src/shared/album-categories";

const EXTRA_CATEGORY_LABELS: Record<string, string> = Object.fromEntries([...ALBUM_CHARACTERISTICS, ...ALBUM_EDITION_TYPES].map(category => [category.key, category.label]));

const DICTS: Record<string, Record<string, string>> = {
  artistType: {
    band: "Banda", solo_artist: "Solista", duo: "Dúo", project: "Proyecto", group: "Agrupación", other: "Otro",
  },
  albumType: {
    studio_album: "Álbum de estudio", live_album: "Álbum en vivo", ep: "EP", single: "Sencillo",
    compilation: "Compilado", demo: "Demo", soundtrack: "Banda sonora",
    collaboration_album: "Colaboración", remix: "Remix", other: "Otro",
  },
  organizationType: {
    record_label: "Sello discográfico", production_company: "Productora", recording_studio: "Estudio de grabación",
    distributor: "Distribuidora", management: "Management", other: "Otro",
  },
  creditType: {
    musician: "Músico", guest: "Invitado", writer: "Autor", composer: "Compositor", producer: "Producción",
    recording: "Grabación", mixing: "Mezcla", mastering: "Masterización", photography: "Fotografía",
    artwork: "Arte", other: "Otro",
  },
  aliasType: {
    name_variant: "Variante de nombre", spelling_variant: "Variante ortográfica", former_name: "Nombre anterior",
    stage_name: "Nombre artístico", acronym: "Sigla", misspelling: "Errata", alternate_title: "Título alterno", other: "Otro",
    nickname: "Apodo", source_variant: "Variante de fuente",
  },
  publicationStatus: {
    published: "Publicado", unlisted: "No listado", unpublished: "Despublicado", copyright_blocked: "Bloqueado por copyright", unknown: "Desconocido",
  },
  reviewKind: {
    possible_duplicate: "Posible duplicado", field_conflict: "Conflicto de campo", ambiguous_alias: "Alias ambiguo",
    album_match: "Coincidencia de álbum", person_match: "Coincidencia de persona", organization_match: "Coincidencia de organización",
    youtube_match: "Coincidencia de YouTube", manual_review: "Revisión manual", missing_url: "URL faltante",
    seed_incomplete: "Fila de semilla incompleta", media_type_no_album: "Contenido audiovisual sin álbum",
    genre_unknown: "Género desconocido", new_source: "Fuente nueva", low_confidence: "Confianza baja",
    ai_biography: "Biografía generada por IA", ai_entity_resolution: "Identidad propuesta por IA",
    person_duplicate: "Posible persona duplicada",
  },
  reviewStatus: {
    open: "Abierta", in_progress: "En curso", accepted: "Aceptada", rejected: "Rechazada", resolved: "Resuelta",
  },
  confidence: { high: "Alta", medium: "Media", low: "Baja" },
  trustLevel: { high: "Alta", medium: "Media", low: "Baja", api: "API oficial" },
  searchType: {
    artist: "Artista", person: "Persona", album: "Disco", track: "Pista", organization: "Organización",
  },
  emotion: {
    emocion: "Amor y sentimiento", tristeza: "Tristeza y melancolía", enfocado: "Enfoque y calma",
    libertad: "Libertad y rebeldía", cachonda: "Sexo y seducción", aumenta_mi_aura: "Poder y energía",
  },
  entityKind: {
    artist: "Artista", person: "Persona", organization: "Organización", album: "Disco", track: "Pista",
  },
  // Clasificación de nombres de persona (E11.7).
  personNameClass: {
    ok: "Nombre", organization_like: "Parece organización", duration: "Duración o número",
    fragment: "Fragmento de texto", multiple_people: "Varias personas",
  },
};

function label(dict: keyof typeof DICTS, value: string | null | undefined): string {
  if (!value) return "—";
  return DICTS[dict]?.[value] ?? value;
}

export const artistTypeLabel = (value: string) => label("artistType", value);
export const albumTypeLabel = (value: string) => label("albumType", value);
export const organizationTypeLabel = (value: string) => label("organizationType", value);
export const creditTypeLabel = (value: string) => label("creditType", value);
/** Encabezado de un grupo de discos por rol en la página de lugar («Grabados», «Mezclados»…). */
const CREDIT_ROLE_GROUP: Record<string, string> = { recording: "Grabados", mixing: "Mezclados", mastering: "Masterizados", producer: "Producidos" };
export const creditRoleGroupLabel = (value: string) => CREDIT_ROLE_GROUP[value] ?? creditTypeLabel(value);
export const aliasTypeLabel = (value: string) => label("aliasType", value);
export const publicationStatusLabel = (value: string) => label("publicationStatus", value);
export const reviewKindLabel = (value: string) => label("reviewKind", value);
export const reviewStatusLabel = (value: string) => label("reviewStatus", value);
export const confidenceLabel = (value: string) => label("confidence", value);
export const trustLevelLabel = (value: string) => label("trustLevel", value);
export const searchTypeLabel = (value: string) => label("searchType", value);
export const emotionLabel = (value: string) => label("emotion", value);
export const entityKindLabel = (value: string) => label("entityKind", value);
export const nameClassLabel = (value: string) => label("personNameClass", value);

export const ARTIST_TYPES = Object.keys(DICTS["artistType"]!);

/**
 * Filtro «Tipos» del catálogo (plan v2 del primo, punto 14): la API agrupa
 * Banda + Agrupación + Proyecto de 3 o más en Bandas, Solista + Proyecto de uno
 * en Solistas y Dúo + Proyecto de dos en Dúos (src/api/repositories/artist-groups.ts).
 * Proyectos y Agrupaciones siguen valiendo en los enlaces viejos.
 */
const ARTIST_GROUP_PLURAL: Record<string, string> = {
  band: "Bandas", solo_artist: "Solistas", duo: "Dúos", project: "Proyectos", group: "Agrupaciones", other: "Otros",
};
export const artistGroupFilterLabel = (value: string) => ARTIST_GROUP_PLURAL[value] ?? artistTypeLabel(value);

/** Chips de la discografía de un artista (plan v2 del primo, punto 6), en este orden. */
export const DISCOGRAPHY_CHIPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "studio_album", label: "Estudio" }, { key: "ep", label: "EP" }, { key: "single", label: "Single" },
  { key: "demo", label: "Demo" }, { key: "remix", label: "Remix" }, { key: "live", label: "En Vivo" },
  { key: "compilation", label: "Compilado" }, { key: "b_sides", label: "B-Sides" }, { key: "others", label: "Otros" },
  ...ALBUM_CHARACTERISTICS.filter(category => category.key !== "remix").map(category => ({ key: category.key, label: category.label })),
  ...ALBUM_EDITION_TYPES.map(category => ({ key: category.key, label: category.label })),
];

/**
 * Chips acumulables: un sencillo en vivo cuenta en Single y en En Vivo (D2);
 * B-Sides conserva también sus tipos y características. Lo que no cae en ninguno (banda sonora,
 * colaboración, otro) va a «Otros», para que ningún disco quede fuera.
 */
export function discographyChipKeys(album: { albumType: string; isLive?: boolean; isBSides?: boolean; classifications?: Array<{ classification: string }>; editionTypes?: string[] }): string[] {
  const keys: string[] = [];
  if (["studio_album", "ep", "single", "demo", "remix", "compilation"].includes(album.albumType)) keys.push(album.albumType);
  if (album.isLive || album.albumType === "live_album") keys.push("live");
  if (album.isBSides) keys.push("b_sides");
  const classified: Record<string, string> = { EP: "ep", Demos: "demo", "Compilation Album": "compilation", Unplugged: "acoustic", ...Object.fromEntries(ALBUM_CHARACTERISTICS.map(category => [category.classification, category.key])) };
  for (const { classification } of album.classifications ?? []) {
    const key = classified[classification] ?? classificationFilterKey(classification);
    if (key && !keys.includes(key)) keys.push(key);
  }
  for (const key of album.editionTypes ?? []) if (EXTRA_CATEGORY_LABELS[key] && !keys.includes(key)) keys.push(key);
  return keys.length ? keys : ["others"];
}
export const ALBUM_TYPES = Object.keys(DICTS["albumType"]!);
/** Filtro de la lista de discos que no es un tipo del core: los clasificados «B-Sides» (son `other`). */
export const B_SIDES_FILTER = "b_sides";
export const LIVE_FILTER = "live";
export const ALBUM_FILTER_TYPES = [...new Set([...ALBUM_TYPES, B_SIDES_FILTER, LIVE_FILTER, ...ALBUM_CHARACTERISTICS.map(category => category.key), ...ALBUM_EDITION_TYPES.map(category => category.key)])];
export const albumFilterTypeLabel = (value: string) => classificationFilterLabel(value) ?? (value === B_SIDES_FILTER ? "B-Sides" : value === LIVE_FILTER ? "En vivo" : EXTRA_CATEGORY_LABELS[value] ?? albumTypeLabel(value));

/** Categorías complementarias y tipos explícitos en fichas mixtas. */
export function albumClassificationBadges(album: { albumType: string; isLive?: boolean; isBSides?: boolean; classifications?: Array<{ classification: string }>; editionTypes?: string[] }): Array<{ key: string; label: string }> {
  const badges: Array<{ key: string; label: string }> = [];
  if (album.isBSides) badges.push({ key: B_SIDES_FILTER, label: "B-Sides" });
  if (album.isLive && album.albumType !== "live_album") badges.push({ key: LIVE_FILTER, label: "En vivo" });
  const labels: Record<string, string> = { EP: "ep", Demos: "demo", "Compilation Album": "compilation", Unplugged: "acoustic", ...Object.fromEntries(ALBUM_CHARACTERISTICS.map(category => [category.classification, category.key])) };
  for (const { classification } of album.classifications ?? []) {
    const key = labels[classification];
    if (key && key !== album.albumType && !badges.some(badge => badge.key === key)) badges.push({ key, label: albumFilterTypeLabel(key) });
    if (!key && !["B-Sides","En vivo","Studio Album","Single","Solo Artist","Live Album"].includes(classification) && !badges.some(badge=>badge.label===classification)) badges.push({key:classificationFilterKey(classification),label:classification});
  }
  for (const key of album.editionTypes ?? []) if (EXTRA_CATEGORY_LABELS[key] && !badges.some(badge => badge.key === key)) badges.push({ key, label: albumFilterTypeLabel(key) });
  return badges;
}
export const ORGANIZATION_TYPES = Object.keys(DICTS["organizationType"]!);
export const CREDIT_TYPES = Object.keys(DICTS["creditType"]!);
export const PERSON_ROLES = ["band_member", ...CREDIT_TYPES];
export const personRoleLabel = (value: string) => ({
  band_member: "Integrantes de bandas", musician: "Músicos", guest: "Invitados", writer: "Autores",
  composer: "Compositores", other: "Otros créditos",
} as Record<string, string>)[value] ?? creditTypeLabel(value);
export const ALIAS_TYPES = Object.keys(DICTS["aliasType"]!);
export const PUBLICATION_STATUSES = Object.keys(DICTS["publicationStatus"]!);

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Un solista no está «en una banda»: está al frente de su proyecto (Brian,
 * 2026-10-01). Un vínculo es de proyecto si el artista lo es —solista o
 * proyecto— o si la persona figura como su titular, que es lo que une a la
 * persona con el artista cuando los dos son la misma identidad.
 */
const PROJECT_ARTIST_TYPES = new Set(["solo_artist", "project"]);

export function isProjectMembership(band: { role: string; artistType?: string }): boolean {
  return band.role === TITULAR_ROLE || PROJECT_ARTIST_TYPES.has(band.artistType ?? "");
}

/** Cómo llamar a lo que vincula a una persona con sus artistas, según cuáles sean. */
export function membershipNoun(bands: ReadonlyArray<{ role: string; artistType?: string }>): { singular: string; plural: string } {
  const projects = bands.filter(isProjectMembership).length;
  if (bands.length > 0 && projects === bands.length) return { singular: "Proyecto", plural: "Proyectos" };
  if (projects === 0) return { singular: "Banda", plural: "Bandas" };
  // Bandas y proyectos juntos: «Proyectos musicales» (plan del primo, caso Cheo Pardo).
  return { singular: "Banda o proyecto", plural: "Proyectos musicales" };
}

/** El rol genérico «Miembro» de las fuentes se lee «Integrante» (plan del primo, punto 11). */
const SMALL_WORDS = new Set(["y", "e", "o", "u", "de", "del", "la", "las", "el", "los", "a", "en", "con", "and", "of", "the", "at", "for", "by", "with"]);

/** «mixed & mastered by» → «Mixed & Mastered»; «voz y guitarra» → «Voz y Guitarra» (plan v2, punto 13.1). */
export function roleTitle(role: string): string {
  const clean = role.trim().replace(/\s+(?:by|por)\s*:?\s*$/iu, "").replace(/\s+/gu, " ");
  return clean.split(" ").map((word, index) => {
    const lower = word.toLocaleLowerCase("es");
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    if (/[A-Z].*[A-Z]/u.test(word) || /\d/u.test(word)) return word; // siglas: «A&R», «DJ», «2CD»
    return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
  }).join(" ");
}

export function memberRoleLabel(role: string): string {
  return /^(miembro|member)$/iu.test(role.trim()) ? "Integrante" : roleTitle(role);
}

/**
 * En CRV se asume que todo artista es venezolano (plan v2, puntos 1 y 2): el
 * país solo se muestra cuando rompe la regla.
 */
export function foreignCountry(country: string | null | undefined): string | null {
  const clean = country?.trim();
  if (!clean) return null;
  return /^venezuela$/iu.test(clean.normalize("NFD").replace(/\p{M}/gu, "")) ? null : clean;
}

/** «Unknown»/«Desconocido» no es un formato: no se muestra (plan v2, punto 10). */
export function knownFormat(format: string | null | undefined): string | null {
  const clean = format?.trim();
  return clean && !/^(unknown|desconocido|sin dato|n\/?a)$/iu.test(clean) ? clean : null;
}

export const sharedOptionLabel = (value:string) => Object.values(DICTS).find(dict=>value in dict)?.[value] ?? ({active:"Activo",split_up:"Disuelto",on_hold:"En pausa",changed_name:"Cambió de nombre"} as Record<string,string>)[value] ?? value;
