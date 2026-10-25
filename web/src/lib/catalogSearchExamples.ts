import { albumsApi, artistsApi, organizationsApi, personsApi } from "./api";
import type { GenreFacet, GenreFacets, Page } from "./types";
import { dailyRandom } from "../../../src/shared/daily-cycle";

export type CatalogSearchScope = "catalog" | "artist" | "person" | "album" | "organization";
export interface CatalogSearchExample {
  key: string;
  metricTicket?: string;
  label: string;
  category: "Artista" | "Persona" | "Disco" | "Organización" | "Género" | "Subgénero" | "Estilo";
}

/** Fisher–Yates: mezcla sin sesgar la selección ni repetir filas en una vuelta. */
export function randomSample<T>(items: T[], limit = items.length, random = Math.random): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.slice(0, limit);
}

async function randomRows<T>(fetch: (params: { limit: number; offset?: number }, signal: AbortSignal) => Promise<Page<T>>, signal: AbortSignal, random: () => number): Promise<T[]> {
  const limit = 8;
  const first = await fetch({ limit }, signal);
  const total = first.pagination.total;
  if (total <= limit) return first.data;

  // Seleccionar posiciones independientes de TODO el catálogo, sin reemplazo.
  // Una página contigua concentra nombres con la misma inicial aunque se mezcle.
  const offsets = new Set<number>();
  for (let index = total - limit; index < total; index++) {
    const candidate = Math.floor(random() * (index + 1));
    offsets.add(offsets.has(candidate) ? index : candidate);
  }
  const rows = await Promise.all([...offsets].map(async offset => {
    if (offset < first.data.length) return [first.data[offset]];
    return (await fetch({ limit: 1, offset }, signal)).data;
  }));
  return rows.flat();
}

/** Una muestra pequeña del catálogo; los ejemplos nunca ejecutan una búsqueda. */
export async function loadSearchExamples(scope: CatalogSearchScope, signal: AbortSignal, date: string, random = dailyRandom(date, `search:${scope}`)): Promise<CatalogSearchExample[]> {
  if (scope === "catalog") return []; // El principal usa exclusivamente /discovery/search-suggestions.
  const types = (["artist", "person", "album", "organization"] as const).filter(type => type === scope);
  const groups = await Promise.all(types.map(async (type): Promise<CatalogSearchExample[]> => {
    if (type === "artist") return (await randomRows(artistsApi.list, signal, random)).map(row => ({ key: `artist-${row.id}`, label: row.name, category: "Artista" }));
    if (type === "person") return (await randomRows(personsApi.list, signal, random)).map(row => ({ key: `person-${row.id}`, label: row.name, category: "Persona" }));
    if (type === "organization") return (await randomRows(organizationsApi.list, signal, random)).map(row => ({ key: `organization-${row.id}`, label: row.name, category: "Organización" }));
    return (await randomRows(albumsApi.list, signal, random)).map(row => ({ key: `album-${row.id}`, label: row.title, category: "Disco" }));
  }));
  // Evita ejemplos de un solo signo sin inventar nombres ni alterar el catálogo.
  return groups.flatMap(group => {
    const names = new Set<string>();
    return randomSample(group.filter(example => {
      const name = example.label.trim().toLocaleLowerCase("es");
      if (name.length < 3 || !/\p{L}/u.test(name) || names.has(name)) return false;
      names.add(name);
      return true;
    }), 8, random);
  });
}

export function genreSearchExamples(facets: GenreFacets | null | undefined, related = true, random = Math.random): CatalogSearchExample[] {
  if (!facets) return [];
  const count = (genre: GenreFacet) => genre.count + (related ? genre.relatedCount : 0);
  const sample = (genres: GenreFacet[], category: CatalogSearchExample["category"]) => randomSample(genres.filter(genre => count(genre) > 0), 8, random)
    .map(genre => ({ key: `genre-${genre.slug}`, label: genre.name, category }));
  const groups = [
    sample(facets.families, "Género"),
    sample(facets.families.flatMap(family => family.genres), "Subgénero"),
    sample(facets.families.flatMap(family => family.genres.flatMap(genre => genre.subgenres ?? [])), "Estilo"),
  ];
  // Cada nivel tiene su turno: los conteos altos de las familias no ocultan los estilos.
  const examples: CatalogSearchExample[] = [];
  for (let index = 0; groups.some(group => index < group.length); index++) {
    for (const group of groups) if (group[index]) examples.push(group[index]);
  }
  return examples;
}
