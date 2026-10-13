// CRV · Fichas repetidas: la misma ficha escrita de otra forma.
//
// Casos reales del estudio (2026-09-16): «Flanders» / «Los Flanders», «Zeta» /
// «The Zeta», «Victor Gámez» / «Víctor Gámez», dos «Regreso Del Abismo» del
// mismo artista, 60 pistas repetidas dentro de un mismo disco.
//
// Las personas ya tienen su detector y su pestaña (Posibles duplicados): aquí
// solo entran los pares de persona que esa herramienta no propuso ni cerró.
// Un par que alguien ya declaró distinto (`ingest.curation_distinct_pairs`)
// tampoco vuelve, sea de artistas, organizaciones, discos, pistas o personas.
//
// TODO SE EMITE POR PARES (PLAN_CURADURIA E2.3). Un hallazgo por grupo tenía
// en su huella a todos los miembros: bastaba que apareciera un tercero para
// que «no es un problema» se perdiera. Un par tiene huella propia (tipo +
// ids menor y mayor) y sobrevive a renombrados y a miembros nuevos.
import { organizationKey } from "../../review/person-names.js";
import { albumPart, type AlbumPart } from "../../merge/album-parts.js";
import { isGenericTitle, isGenericTokens, titleTokens } from "../../ambiguity/text.js";
import { compactKey, nameKey, type NameValue } from "../lexicon.js";
import type { EntityRef, Finding, Severity } from "../types.js";
import { quote, type AnalysisContext, type Detector } from "./shared.js";

const CATEGORY = "fichas_repetidas";

type OrganizationClass = "label" | "studio" | "production";
const ORGANIZATION_CLASS_WORDS: Readonly<Record<OrganizationClass, ReadonlySet<string>>> = {
  label: new Set(["record", "records", "discos", "label", "sello"]),
  studio: new Set(["studio", "studios", "estudio", "estudios"]),
  production: new Set(["production", "productions", "produccion", "producciones", "productora"]),
};

function organizationClass(value: string): OrganizationClass | null {
  const tokens = new Set(value.toLocaleLowerCase("es").normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const [kind, words] of Object.entries(ORGANIZATION_CLASS_WORDS) as Array<[OrganizationClass, ReadonlySet<string>]>) {
    if ([...words].some((word) => tokens.has(word))) return kind;
  }
  return null;
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value.length < 2) continue;
    const list = groups.get(value);
    if (list) list.push(item); else groups.set(value, [item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function pairsOf<T extends { id: number }>(group: T[]): Array<[T, T]> {
  const sorted = [...group].sort((a, b) => a.id - b.id);
  const out: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) out.push([sorted[i]!, sorted[j]!]);
  return out;
}

/** Clave de un par sin orden: la misma que `ingest.curation_distinct_pairs` y la cola. */
export function pairKey(kind: string, a: number, b: number): string {
  return `${kind}:${Math.min(a, b)}-${Math.max(a, b)}`;
}

function pairFinding(
  detector: Detector,
  a: NameValue,
  b: NameValue,
  input: { signature: string; signatureLabel: string; severity: Severity; title: string; suggestion: string; evidence?: Record<string, unknown>; extra?: EntityRef[] },
): Finding {
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return {
    detector: detector.key, category: detector.category,
    signature: input.signature, signatureLabel: input.signatureLabel, severity: input.severity,
    entity: { kind: first.kind, id: first.id, label: first.label },
    field: first.field, value: first.value,
    title: input.title, suggestion: input.suggestion,
    related: [...first.related, { kind: second.kind, id: second.id, label: second.label }, ...(input.extra ?? [])],
    pair: [first.id, second.id],
    evidence: { values: [first, second].map((member) => ({ id: member.id, value: member.value })), ...(input.evidence ?? {}) },
  };
}

function namesOf(context: AnalysisContext, kind: NameValue["kind"]): NameValue[] {
  return context.names.filter((name) => name.kind === kind);
}

const withoutTrailingGroup = (value: string): string => value.replace(/\s*\([^()]*\)\s*$/u, "");

// Plan del primo, etapa 1 (2026-10-12): «1ra Edición» y «Primera Edición»,
// «La Banda de la Banana Voladora» y «La Banana Voladora», «Atkinson - La
// Banda» y «Atkinson». Cifra o palabra y el envoltorio «la banda de …» /
// «… y su banda» no cambian de artista.
const NUMBER_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(1(ra|era|ro|ero|a|o|er)?|primer[ao]?|uno|una)\b/gu, "1"],
  [/\b(2(da|do|a|o)?|segund[ao]|dos)\b/gu, "2"],
  [/\b(3(ra|ro|era|ero|a|o|er)?|tercer[ao]?|tres)\b/gu, "3"],
  [/\b(4(ta|to|a|o)?|cuart[ao]|cuatro)\b/gu, "4"],
  [/\b(5(ta|to|a|o)?|quint[ao]|cinco)\b/gu, "5"],
  [/\b(seis|sexto|sexta)\b/gu, "6"],
  [/\b(siete|septim[ao]|setim[ao])\b/gu, "7"],
  [/\b(ocho|octav[ao])\b/gu, "8"],
  [/\b(nueve|noven[ao])\b/gu, "9"],
  [/\b(diez|decim[ao])\b/gu, "10"],
];
const BAND_WRAPPERS: readonly RegExp[] = [
  /^(la |el )?(banda|grupo|orquesta|conjunto|combo|ensamble) (de |del )?/u,
  / (y|&) (su|sus) (banda|grupo|orquesta|conjunto|combo)$/u,
  / (la banda|band|banda|y la banda)$/u,
];

/** Clave de variante: números en cifra y sin el envoltorio de «banda». Vacía si no cambia nada. */
export function bandVariantKey(value: string): string {
  const base = nameKey(value.replace(/\s+[-–—]\s+/gu, " "));
  let key = base;
  for (const [pattern, digit] of NUMBER_WORDS) key = key.replace(pattern, digit);
  for (const wrapper of BAND_WRAPPERS) key = key.replace(wrapper, "").trim();
  if (!key || key === base) return compactKey(value);
  return compactKey(key);
}

export const equivalentArtists: Detector = {
  key: "artistas_equivalentes",
  category: CATEGORY,
  label: "Artistas escritos de otra forma",
  description: "Artistas que coinciden al quitar tildes, artículos («Los», «The»), espacios, una aclaración final entre paréntesis, al escribir un número en cifra o en letra («1ra»/«Primera») o al quitar «La Banda de…»/«… - La Banda».",
  actions: { "*": ["fusionar"] },
  run(context) {
    const artists = namesOf(context, "artist");
    const seen = new Set<string>();
    const out: Finding[] = [];
    const rules: Array<[string, string, (name: NameValue) => string]> = [
      ["misma_clave", "Solo cambian tildes, mayúsculas o signos", (name) => nameKey(name.value)],
      ["sin_articulo_o_espacios", "Solo cambian el artículo o los espacios", (name) => compactKey(name.value)],
      ["con_aclaracion", "Uno lleva una aclaración entre paréntesis", (name) => compactKey(withoutTrailingGroup(name.value))],
      ["variante_de_nombre", "Cambia un número escrito en cifra o en letra, o el envoltorio «La Banda de…»", (name) => bandVariantKey(withoutTrailingGroup(name.value))],
    ];
    for (const [signature, signatureLabel, key] of rules) {
      for (const group of groupBy(artists, key)) {
        // Un par se emite una vez, con la regla más estricta que lo junta.
        for (const [a, b] of pairsOf(group)) {
          const pair = pairKey("artist", a.id, b.id);
          if (seen.has(pair) || context.snapshot.handledPairs.has(pair)) continue;
          seen.add(pair);
          out.push(pairFinding(this, a, b, {
            signature, signatureLabel, severity: "medium",
            title: `${quote(a.value)} y ${quote(b.value)} parecen el mismo artista${group.length > 2 ? ` (${group.length} con la misma forma)` : ""}`,
            suggestion: "Comparar las fichas y fusionarlas si son el mismo artista",
            evidence: { groupSize: group.length },
          }));
        }
      }
    }
    return out;
  },
};

export const equivalentOrganizations: Detector = {
  key: "organizaciones_equivalentes",
  category: CATEGORY,
  label: "Organizaciones escritas de otra forma",
  description: "Organizaciones que coinciden al quitar tildes, artículos, espacios o las palabras genéricas de sello y estudio.",
  actions: { "*": ["fusionar"] },
  run(context) {
    const orgs = namesOf(context, "organization");
    const seen = new Set<string>();
    const out: Finding[] = [];
    const rules: Array<[string, string, Severity, (name: NameValue) => string]> = [
      ["sin_articulo_o_espacios", "Solo cambian tildes, artículo o espacios", "medium", (name) => compactKey(name.value)],
      ["sin_palabras_de_sello", "Coinciden sin «Records», «Estudios»…", "low", (name) => {
        const key = organizationKey(name.value).replace(/\s+/gu, "");
        return key.length >= 4 ? key : "";
      }],
    ];
    for (const [signature, signatureLabel, severity, key] of rules) {
      for (const group of groupBy(orgs, key)) {
        for (const [a, b] of pairsOf(group)) {
          const pair = pairKey("organization", a.id, b.id);
          if (seen.has(pair) || context.snapshot.handledPairs.has(pair)) continue;
          const classA = organizationClass(a.value);
          const classB = organizationClass(b.value);
          // La raíz no basta: «Capitol Records» y «Capitol Studios» son
          // organizaciones distintas aunque organizationKey las acerque.
          if (signature === "sin_palabras_de_sello" && classA && classB && classA !== classB) continue;
          seen.add(pair);
          out.push(pairFinding(this, a, b, {
            signature, signatureLabel, severity,
            title: `${quote(a.value)} y ${quote(b.value)} parecen la misma organización${group.length > 2 ? ` (${group.length} con la misma forma)` : ""}`,
            suggestion: "Comparar las fichas y fusionarlas si son la misma organización",
            evidence: { groupSize: group.length },
          }));
        }
      }
    }
    return out;
  },
};

export const repeatedAlbums: Detector = {
  key: "discos_repetidos",
  category: CATEGORY,
  label: "Discos repetidos del mismo artista",
  description: "Dos discos del mismo artista con el mismo título normalizado (números, volúmenes y tildes incluidos). Un par ya declarado distinto no vuelve.",
  actions: { "*": ["fusionar_discos"] },
  run(context) {
    const out: Finding[] = [];
    const albums = namesOf(context, "album");
    const byArtist = new Map<number, NameValue[]>();
    for (const name of albums) {
      const album = context.albums.get(name.id)!;
      const list = byArtist.get(album.artistId);
      if (list) list.push(name); else byArtist.set(album.artistId, [name]);
    }
    for (const [artistId, list] of byArtist) {
      const artistName = context.artists.get(artistId)?.name ?? "";
      for (const group of groupBy(list, (name) => titleTokens(name.value).join(" "))) {
        for (const [a, b] of pairsOf(group)) {
          if (context.snapshot.handledPairs.has(pairKey("album", a.id, b.id))) continue;
          const yearA = context.albums.get(a.id)!.releaseYear;
          const yearB = context.albums.get(b.id)!.releaseYear;
          const generic = isGenericTitle(a.value, artistName);
          const differentYears = yearA !== null && yearB !== null && yearA !== yearB;
          if (generic && differentYears) continue;
          out.push(pairFinding(this, a, b, {
            signature: generic ? "titulo_generico" : "mismo_titulo",
            signatureLabel: generic ? "Mismo título genérico («Demo», «EP»)" : "Mismo título",
            severity: generic || differentYears ? "low" : "medium",
            title: `Dos discos de ${quote(artistName)} con el mismo título ${quote(a.value)}${differentYears ? ` (${yearA} y ${yearB})` : ""}`,
            suggestion: differentYears ? "Confirmar si es una reedición o el mismo disco con otro año" : "Comparar las pistas y fusionar si es el mismo disco",
            evidence: { years: [yearA, yearB] },
          }));
        }
      }
    }
    return out;
  },
};

const PART_SIGNATURE: Readonly<Record<AlbumPart["kind"], string>> = {
  lado: "Lado A / Lado B", disco: "CD 1 / CD 2", parte: "Parte I / Parte II", volumen: "Volúmenes del mismo año", formato: "CD / DVD",
  edicion: "Reedición", extra: "B-Sides / demos",
};

/** Orden en la serie: sin parte primero (la original), luego por número; «DVD», «CD Reissue» al final. */
const partOrder = (part: AlbumPart | null): number => (part ? part.order ?? 99 : 0);

/**
 * Un disco partido en varias fichas (Brian, 2026-10-11): «Live in Paris - Lado
 * A» y «… - Lado B», «Goma (Disco A)» y «(Disco B)», un DVD y su CD, «Diez
 * Años Vol. 1» y «Vol. 2» del mismo año, «Internacional» y su «(CD Reissue)».
 * Van en UNA página con una lista por disco, cada una con el nombre de la
 * fuente (acción `juntar_discos`; si la lista es la misma, se funden).
 *
 * Se emite un par por cada ficha de la serie contra la primera (la de menor
 * parte o sin parte): al juntar una, el resto de pares sigue siendo válido.
 * No entran: un «Vol. N» de otro año o sin año, un título que sea solo
 * «Vol. N» o «Artista Vol. N» (LPs que quedan aparte), dos fichas con la misma
 * parte (eso es `discos_repetidos`) ni dos años distintos en lados o discos.
 */
export const splitAlbums: Detector = {
  key: "discos_partidos",
  category: CATEGORY,
  label: "Disco partido en varias fichas",
  description: "Lado A/B, CD 1/2, partes, CD y DVD, volúmenes del mismo año o reediciones de un mismo disco en fichas separadas: van en una página con una lista por disco. Un «Vol. N» de otro año, o un título que sea solo «Vol. N» o «Artista Vol. N», no entra.",
  actions: { "*": ["juntar_discos"] },
  run(context) {
    const out: Finding[] = [];
    const byKey = new Map<string, Array<{ name: NameValue; part: AlbumPart | null }>>();
    // Sin ninguna ficha con parte, un artista no puede tener grupo: solo se
    // tokenizan los discos de los que sí (tokenizar todo el catálogo es lo caro).
    const parted = namesOf(context, "album").map((name) => ({ name, part: albumPart(name.value) }));
    const withParts = new Set(parted.filter((entry) => entry.part).map((entry) => context.albums.get(entry.name.id)!.artistId));
    const artistTokens = new Map<number, string[]>();
    for (const { name, part } of parted) {
      const album = context.albums.get(name.id)!;
      if (!withParts.has(album.artistId)) continue;
      const base = part?.base ?? name.value;
      let artist = artistTokens.get(album.artistId);
      if (!artist) artistTokens.set(album.artistId, artist = titleTokens(context.artists.get(album.artistId)?.name ?? ""));
      const tokens = titleTokens(base);
      if (isGenericTokens(tokens, artist)) continue;
      const key = `${album.artistId}|${tokens.join(" ")}`;
      const list = byKey.get(key);
      if (list) list.push({ name, part }); else byKey.set(key, [{ name, part }]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2 || !group.some((member) => member.part)) continue;
      // La primera: sin parte, o la de menor orden; a igualdad, la ficha más antigua.
      const sorted = [...group].sort((a, b) => partOrder(a.part) - partOrder(b.part) || a.name.id - b.name.id);
      const first = sorted[0]!;
      const firstAlbum = context.albums.get(first.name.id)!;
      for (const other of sorted.slice(1)) {
        const [a, b] = [first, other];
        if (context.snapshot.handledPairs.has(pairKey("album", a.name.id, b.name.id))) continue;
        if (!a.part && !b.part) continue;
        if (a.part && b.part && a.part.label.toLocaleLowerCase("es") === b.part.label.toLocaleLowerCase("es")) continue;
        const otherAlbum = context.albums.get(other.name.id)!;
        const years = [firstAlbum.releaseYear, otherAlbum.releaseYear];
        const sameYear = years[0] !== null && years[0] === years[1];
        // Volúmenes: solo del mismo año. Reediciones: de cualquier año. Lados,
        // discos, partes y formatos: no de dos años distintos.
        const volume = a.part?.kind === "volumen" || b.part?.kind === "volumen";
        const reissue = a.part?.kind === "edicion" || b.part?.kind === "edicion";
        if (volume ? !sameYear : !reissue && years[0] !== null && years[1] !== null && years[0] !== years[1]) continue;
        const kind = (b.part ?? a.part)!.kind;
        const artistName = context.artists.get(firstAlbum.artistId)?.name ?? "";
        out.push(pairFinding(this, a.name, b.name, {
          signature: `partido_${kind}`, signatureLabel: PART_SIGNATURE[kind], severity: "medium",
          title: `${quote(a.name.value)} y ${quote(b.name.value)} de ${quote(artistName)} son partes de un mismo disco`,
          suggestion: "Juntar en una página: cada ficha queda como un disco con su nombre («Lado A», «CD 2», «DVD»)",
          evidence: {
            base: (a.part ?? b.part)!.base,
            parts: { [a.name.id]: a.part?.label ?? null, [b.name.id]: b.part?.label ?? null },
            first: a.name.id, years,
          },
        }));
      }
    }
    return out;
  },
};

export const repeatedTracks: Detector = {
  key: "pistas_repetidas",
  category: CATEGORY,
  label: "Pistas repetidas en un disco",
  description: "El mismo título dos o más veces en el mismo disco y la misma cara: pista duplicada por la extracción o versión sin marcar.",
  actions: { "*": ["retirar_pista_duplicada"] },
  run(context) {
    const out: Finding[] = [];
    const tracks = new Map(namesOf(context, "track").map((name) => [name.id, name]));
    for (const list of context.tracksByAlbum.values()) {
      const byDisc = new Map<number, NameValue[]>();
      for (const track of list) {
        const discTracks = byDisc.get(track.disc);
        if (discTracks) discTracks.push(tracks.get(track.id)!); else byDisc.set(track.disc, [tracks.get(track.id)!]);
      }
      for (const discTracks of byDisc.values()) {
        for (const group of groupBy(discTracks, (name) => nameKey(name.value).replace(/\s+/gu, ""))) {
          const position = new Map(group.map((name) => [name.id, context.tracks.get(name.id)!.number]));
          for (const [a, b] of pairsOf(group)) {
            if (context.snapshot.handledPairs.has(pairKey("track", a.id, b.id))) continue;
            const positions = [position.get(a.id)!, position.get(b.id)!].sort((x, y) => x - y);
            out.push(pairFinding(this, a, b, {
              signature: this.key, signatureLabel: this.label, severity: "low",
              title: `${quote(a.value)} está repetida: pistas ${positions.join(" y ")}${group.length > 2 ? ` (aparece ${group.length} veces)` : ""}`,
              suggestion: "Retirar la pista duplicada o marcar la versión distinta en el título",
              evidence: { positions, groupPositions: [...position.values()].sort((x, y) => x - y) },
            }));
          }
        }
      }
    }
    return out;
  },
};

export const equivalentPersons: Detector = {
  key: "personas_equivalentes",
  category: CATEGORY,
  label: "Personas escritas de otra forma",
  description: "Personas cuyo nombre solo cambia en tildes, mayúsculas o signos y que el detector de Posibles duplicados no propuso ni cerró.",
  actions: { "*": ["fusionar"] },
  run(context) {
    const out: Finding[] = [];
    for (const group of groupBy(namesOf(context, "person"), (name) => nameKey(name.value))) {
      for (const [a, b] of pairsOf(group)) {
        if (context.snapshot.handledPairs.has(pairKey("person", a.id, b.id))) continue;
        out.push(pairFinding(this, a, b, {
          signature: this.key, signatureLabel: this.label, severity: "medium",
          title: `${quote(a.value)} y ${quote(b.value)} solo cambian en tildes, mayúsculas o signos`,
          suggestion: "Comparar las fichas y fusionarlas si son la misma persona",
        }));
      }
    }
    return out;
  },
};

export const DUPLICATE_DETECTORS: Detector[] = [equivalentArtists, equivalentOrganizations, repeatedAlbums, splitAlbums, repeatedTracks, equivalentPersons];
