import { useEffect, useState } from "react";
import { searchApi, CATALOG_DATA_CHANGED_EVENT } from "./api";
import { entityHref } from "./routes";
import { TYPING_DEBOUNCE_MS } from "./useDebouncedQuery";
import type { CatalogSearchScope } from "./catalogSearchExamples";
import type { GenreFacets, SearchResults } from "./types";

export interface CatalogSuggestion {
  key: string;
  label: string;
  category: string;
  context: string | null;
  href: string;
}
const CATEGORIES = { artist: "Artista", person: "Persona", album: "Disco", organization: "Organización", track: "Pista" };
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export function entitySuggestions(results: SearchResults | null, scope: CatalogSearchScope): CatalogSuggestion[] {
  if (!results) return [];
  return (["artist", "person", "album", "organization", "track"] as const)
    .filter(type => scope === "catalog" || type === scope).flatMap(type =>
      results[type].slice(0, scope === "catalog" ? 3 : 8).map(hit => ({
        key: `${type}-${hit.id}`, label: hit.label, category: CATEGORIES[type], context: hit.context,
        href: entityHref(type, hit.id, hit.albumId ?? undefined),
      })),
    );
}

export function genreSuggestions(facets: GenreFacets | null | undefined, query: string, scope: CatalogSearchScope): CatalogSuggestion[] {
  if (!facets || scope !== "catalog" || !query.trim()) return [];
  const matches: Array<CatalogSuggestion & { count: number }> = [];
  const needle = normalize(query.trim());
  const route = "/artistas";
  for (const family of facets.families) {
    const add = (genre: { slug: string; name: string; count: number; relatedCount: number }, sub?: string, style?: string) => {
      const count = genre.count + genre.relatedCount;
      if (!count || !normalize(genre.name).includes(needle)) return;
      const params = new URLSearchParams({ genero: family.slug });
      if (sub) params.set("subgenero", sub);
      if (style) params.set("estilo", style);
      matches.push({ key: `genre-${genre.slug}`, label: genre.name, category: style ? "Estilo" : sub ? "Subgénero" : "Género",
        context: `${count} artistas${sub ? ` · ${family.name}` : ""}`,
        href: `${route}?${params}`, count });
    };
    add(family);
    for (const genre of family.genres) {
      add(genre, genre.slug);
      for (const style of genre.subgenres ?? []) add(style, genre.slug, style.slug);
    }
  }
  return matches.sort((a, b) => Number(normalize(b.label) === needle) - Number(normalize(a.label) === needle) || b.count - a.count)
    .slice(0, 5);
}

/** El principal comparte su respuesta; las listas consultan solo su tipo y cancelan al seguir escribiendo. */
export function useCatalogSuggestions(scope: CatalogSearchScope, value: string) {
  const query = value.trim();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ query: string; data: SearchResults | null; loading: boolean; error: string | null }>({ query: "", data: null, loading: false, error: null });
  useEffect(() => {
    if (scope === "catalog" || query.length < 2) return;
    const controller = new AbortController();
    setState({ query, data: null, loading: true, error: null });
    const timer = window.setTimeout(() => {
      void searchApi.search(query, [scope], 8, controller.signal).then(
        data => { if (!controller.signal.aborted) setState({ query, data, loading: false, error: null }); },
        () => { if (!controller.signal.aborted) setState({ query, data: null, loading: false, error: "No se pudieron cargar las sugerencias." }); },
      );
    }, TYPING_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [scope, query, revision]);
  useEffect(() => {
    const refresh = () => setRevision(previous => previous + 1);
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, refresh);
  }, []);
  return {
    data: state.query === query ? state.data : null,
    loading: query.length >= 2 && (state.query !== query || state.loading),
    error: state.query === query ? state.error : null,
    retry: () => setRevision(previous => previous + 1),
  };
}
