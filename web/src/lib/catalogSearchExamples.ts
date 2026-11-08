import { discoveryApi } from "./api";
import type { GenreFacet, GenreFacets } from "./types";
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

/** Una muestra pequeña del catálogo; los ejemplos nunca ejecutan una búsqueda. */
export async function loadSearchExamples(scope: CatalogSearchScope, signal: AbortSignal, date: string, random = dailyRandom(date, `search:${scope}`)): Promise<CatalogSearchExample[]> {
  if (scope === "catalog") return []; // El principal usa exclusivamente /discovery/search-suggestions.
  // Una sola petición: el servidor elige la muestra del día y la comparte entre visitas.
  // Antes se pedían 9 listados con offsets profundos por carga (incidente 2026-11-08).
  const category = ({ artist: "Artista", person: "Persona", album: "Disco", organization: "Organización" } as const)[scope];
  const { examples } = await discoveryApi.searchExamples(scope, signal, date);
  const groups = [examples.map((row): CatalogSearchExample => ({ key: `${scope}-${row.id}`, label: row.label, category }))];
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
