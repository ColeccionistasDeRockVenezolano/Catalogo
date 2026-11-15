import { useEffect, useState } from "react";
import { searchApi, CATALOG_DATA_CHANGED_EVENT } from "./api";
import { entityHref } from "./routes";
import { TYPING_DEBOUNCE_MS } from "./useDebouncedQuery";
import type { CatalogSearchScope } from "./catalogSearchExamples";
import { emotionLabel } from "./labels";
import type { GenreFacets, PlanSearch, SearchResults } from "./types";

export interface CatalogSuggestion {
  key: string;
  label: string;
  category: string;
  context: string | null;
  href: string;
  /** Solo en «¿Quisiste decir…?»: el tipo real de la entidad (la categoría es el grupo). */
  kind?: string;
  /** Grupos con título propio (plan, emoción): sustituye al título fijo de la categoría. */
  groupLabel?: string;
  /** Nota bajo el grupo (qué datos faltan). */
  groupNote?: string;
  /** Total real del grupo, ya formateado: lo mismo que muestra la página al dar Enter, no solo las sugerencias visibles. */
  groupCount?: string;
}

/** Mismo formato que la página de resultados: la API conoce hasta 200 coincidencias por tipo. */
export const formatTotal = (value: number) => value >= 200 ? "200+" : value.toLocaleString("es-VE");

/** Total de lo que se verá al dar Enter: coincidencias por nombre de cada tipo + la emoción. */
export function resultsTotal(results: SearchResults | null, scope: CatalogSearchScope): { total: number; capped: boolean } | null {
  if (!results) return null;
  const types = (["artist", "track", "album", "person", "organization"] as const).filter(type => scope === "catalog" || type === scope);
  const named = types.map(type => results.totals?.[type] ?? results[type].length);
  const emotion = scope === "catalog" && results.emotion
    ? (results.emotion.totals?.artist ?? results.emotion.artists.length) + (results.emotion.totals?.album ?? results.emotion.albums?.length ?? 0) : 0;
  return { total: named.reduce((sum, value) => sum + value, 0) + emotion, capped: named.some(value => value >= 200) };
}
export function formatResultsTotal({ total, capped }: { total: number; capped: boolean }): string {
  return `${total.toLocaleString("es-VE")}${capped ? "+" : ""} ${total === 1 && !capped ? "resultado" : "resultados"}`;
}
export const DID_YOU_MEAN_CATEGORY = "Sugerencia";
export const PLAN_CATEGORY = "Interpretado";
export const EMOTION_CATEGORY = "Emoción";
/** Grupos que no son coincidencias por nombre: no cuentan como «resultados» ni se ofrecen juntos con las erratas. */
export const DERIVED_CATEGORIES = new Set([DID_YOU_MEAN_CATEGORY, PLAN_CATEGORY, EMOTION_CATEGORY]);
const CATEGORIES = { artist: "Artista", person: "Persona", album: "Disco", organization: "Organización", track: "Pista" };
export const SUGGESTION_GROUP_LABELS: Record<string, string> = {
  Artista: "Artistas", Pista: "Canciones", Disco: "Álbumes", Persona: "Personas", Organización: "Organizaciones",
  Género: "Géneros", Subgénero: "Subgéneros", Estilo: "Estilos", [DID_YOU_MEAN_CATEGORY]: "¿Quisiste decir…?",
};
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export function entitySuggestions(results: SearchResults | null, scope: CatalogSearchScope): CatalogSuggestion[] {
  if (!results) return [];
  return (["artist", "track", "album", "person", "organization"] as const)
    .filter(type => scope === "catalog" || type === scope).flatMap(type =>
      results[type].slice(0, scope === "catalog" ? 3 : 8).map(hit => ({
        key: `${type}-${hit.id}`, label: hit.label, category: CATEGORIES[type], context: hit.context,
        href: entityHref(type, hit.id, hit.albumId ?? undefined), groupCount: formatTotal(results.totals?.[type] ?? results[type].length),
      })),
    );
}

/** Erratas: la API solo las envía con 0 resultados, así que no se mezclan con coincidencias reales. */
export function didYouMeanSuggestions(results: SearchResults | null, scope: CatalogSearchScope): CatalogSuggestion[] {
  if (!results?.didYouMean?.length || scope !== "catalog") return [];
  return results.didYouMean.map(hit => ({
    key: `${hit.type}-${hit.id}`, label: hit.label, category: DID_YOU_MEAN_CATEGORY, kind: CATEGORIES[hit.type], context: hit.context,
    href: entityHref(hit.type, hit.id, hit.albumId ?? undefined),
  }));
}

/** «ska · década 1980 · sin punk»: la interpretación del plan de género/década (etapa 4), en lenguaje llano. */
export function planSummary(it: NonNullable<PlanSearch["interpretation"]>): string {
  return [
    it.require.length ? it.require.join(" + ") : null,
    it.anyOf.length ? it.anyOf.map(group => group.join(" o ")).join(" + ") : null,
    it.decade ? `década ${it.decade}` : null,
    it.exclude.length ? `sin ${it.exclude.join(", ")}` : null,
    it.prefer.length ? `mejor si es ${it.prefer.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
}

/** Aviso de las fichas que el plan no pudo evaluar: que falten datos no significa que no cumplan. */
export function planNote(plan: PlanSearch): string {
  const gaps = [
    plan.withoutData.genre ? `${plan.withoutData.genre.artist} artistas y ${plan.withoutData.genre.album} discos sin género registrado` : null,
    plan.withoutData.year ? `${plan.withoutData.year.artist} artistas y ${plan.withoutData.year.album} discos sin año` : null,
  ].filter(Boolean);
  return `Según los datos registrados en el catálogo.${gaps.length ? ` No aparecen ${gaps.join(" ni ")}: que falten no significa que no cumplan.` : ""}`;
}

const PLAN_DROPDOWN_PER_TYPE = 3;
const PLAN_TOTAL = (value: number) => value >= 200 ? "200+" : String(value);

/** Etapa 4: los primeros artistas y discos del plan (género/década). Ver todos y el resto, con Enter. */
export function planSuggestions(plan: PlanSearch | null, scope: CatalogSearchScope): CatalogSuggestion[] {
  if (!plan?.applied || !plan.interpretation || scope !== "catalog") return [];
  const hits = [...plan.artist.slice(0, PLAN_DROPDOWN_PER_TYPE), ...plan.album.slice(0, PLAN_DROPDOWN_PER_TYPE)];
  if (!hits.length) return [];
  const groupLabel = `Interpretado como: ${planSummary(plan.interpretation)}`;
  const groupNote = `${PLAN_TOTAL(plan.totals.artist)} artistas y ${PLAN_TOTAL(plan.totals.album)} discos. ${planNote(plan)}`;
  return hits.map(hit => ({
    // Prefijo propio: el plan no es una selección de la recuperación principal (no se confirma como tal).
    key: `plan-${hit.type}-${hit.id}`, label: hit.label, category: PLAN_CATEGORY, kind: CATEGORIES[hit.type], context: hit.context,
    href: entityHref(hit.type, hit.id, hit.albumId ?? undefined), groupLabel, groupNote,
  }));
}

/** «Por emoción»: artistas cuya emoción coincide con lo pedido (etiquetas y opiniones de oyentes). */
export function emotionSuggestions(results: SearchResults | null, scope: CatalogSearchScope): CatalogSuggestion[] {
  const match = results?.emotion;
  const albums = match?.albums ?? [];
  if (!match || (!match.artists.length && !albums.length) || scope !== "catalog") return [];
  const groupLabel = `Por emoción: ${emotionLabel(match.emotion)}`;
  // La emoción no tiene el tope de 200: la API cuenta todos.
  const groupCount = ((match.totals?.artist ?? match.artists.length) + (match.totals?.album ?? albums.length)).toLocaleString("es-VE");
  const groupNote = albums.length
    ? "Primero lo que dice la gente; «típico del género» cuando el disco aún no tiene comentarios propios."
    : "Estos artistas expresan esa emoción según las etiquetas y opiniones de sus oyentes.";
  return [
    ...match.artists.slice(0, 3).map(artist => ({
      key: `emotion-artist-${artist.id}`, label: artist.name, category: EMOTION_CATEGORY, kind: CATEGORIES.artist,
      context: artist.tags.slice(0, 3).map(tag => tag.tag).join(" · ") || null,
      href: entityHref("artist", artist.id), groupLabel, groupNote, groupCount,
    })),
    // Respaldo por capas (CRV_EMOTION_FALLBACK=on): la API ya los manda en la misma respuesta de la búsqueda.
    ...albums.slice(0, 3).map(album => ({
      key: `emotion-album-${album.id}`, label: album.title, category: EMOTION_CATEGORY, kind: CATEGORIES.album,
      context: album.typicalOfGenre ? `${album.artistName} · típico del género` : album.artistName,
      href: entityHref("album", album.id), groupLabel, groupNote, groupCount,
    })),
  ];
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

/** Etapa 4 · segundo tiempo: el plan se pide aparte (no retrasa la búsqueda) y solo con la consulta ya estable. Un fallo no se ve. */
export function useQueryPlan(query: string, enabled: boolean) {
  const active = enabled && query.length >= 3;
  const [state, setState] = useState<{ query: string; plan: PlanSearch | null }>({ query: "", plan: null });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchApi.plan(query, controller.signal).then(
        plan => { if (!controller.signal.aborted) setState({ query, plan: plan?.applied ? plan : null }); },
        () => { /* cancelada por una consulta nueva */ },
      );
    }, TYPING_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, query]);
  const settled = state.query === query;
  return { plan: active && settled ? state.plan : null, loading: active && !settled };
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
