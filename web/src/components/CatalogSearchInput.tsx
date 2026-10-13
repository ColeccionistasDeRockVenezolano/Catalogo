import { useId, useMemo, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useNavigate } from "react-router-dom";
import { Buildings, Disc, MagnifyingGlass, MicrophoneStage, MusicNote, Tag, User } from "@phosphor-icons/react";
import { genresApi } from "../lib/api";
import { genreSearchExamples, loadSearchExamples, randomSample, type CatalogSearchScope } from "../lib/catalogSearchExamples";
import { DISCOVERY_FALLBACK, useDiscoveryExamples } from "../lib/discovery";
import { useAsync } from "../lib/useAsync";
import { entitySuggestions, genreSuggestions, SUGGESTION_GROUP_LABELS, useCatalogSuggestions, type CatalogSuggestion } from "../lib/catalogSearchSuggestions";
import type { SearchResults } from "../lib/types";
import { SearchExampleHint } from "./SearchExampleHint";
import { RotatingSearchExample, useRotatingSearchExample } from "./RotatingSearchExample";
import { useVisibleDiscoveryMetric } from "../lib/discoveryMetrics";
import { useOperator } from "../lib/OperatorContext";

interface CatalogSearchInputProps {
  scope: CatalogSearchScope;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  results?: SearchResults | null;
  resultsQuery?: string;
  resultsLoading?: boolean;
  resultsError?: string | undefined;
  onRetryResults?: () => void;
  examplePlacement?: "field" | "below";
  onShowAllResults?: () => void;
  onSuggestionsOpenChange?: (open: boolean) => void;
}

const SUGGESTION_ICONS: Record<string, typeof Disc> = {
  Artista: MicrophoneStage, Pista: MusicNote, Disco: Disc, Persona: User, Organización: Buildings,
};
const SUGGESTION_TYPE_LABELS: Record<string, string> = { Pista: "Canción", Disco: "Álbum" };

function HighlightedName({ name, query }: { name: string; query: string }) {
  const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const needle = fold(query);
  if (!needle) return <>{name}</>;
  // Conserva los índices originales incluso con tildes y caracteres compuestos.
  const offsets: number[] = [];
  let originalOffset = 0;
  let normalized = "";
  for (const character of name) {
    const folded = fold(character);
    normalized += folded;
    for (let index = 0; index < folded.length; index++) offsets.push(originalOffset);
    originalOffset += character.length;
  }
  offsets.push(name.length);
  const parts = [];
  let cursor = 0;
  let match = normalized.indexOf(needle);
  while (match !== -1) {
    const start = offsets[match];
    const end = offsets[match + needle.length];
    parts.push(name.slice(cursor, start), <mark key={start}>{name.slice(start, end)}</mark>);
    cursor = end;
    match = normalized.indexOf(needle, match + needle.length);
  }
  parts.push(name.slice(cursor));
  return <>{parts}</>;
}

/** Ejemplos reales rotativos que se aceptan con Tab y coincidencias al escribir. */
export function CatalogSearchInput({ scope, value, onChange, label, placeholder, className = "filter-input", id, autoFocus, results = null, resultsQuery = "", resultsLoading = false, resultsError, onRetryResults, examplePlacement = "field", onShowAllResults, onSuggestionsOpenChange }: CatalogSearchInputProps) {
  const generatedId = useId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  function updateOpen(next: boolean) {
    setOpen(next);
    onSuggestionsOpenChange?.(next);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isChecking } = useOperator();
  const metricAccept = useRef<() => void>(() => {});

  const examples = useAsync(signal => scope === "catalog" ? Promise.resolve([]) : loadSearchExamples(scope, signal), [scope]);
  const catalogGenres = useAsync(signal => scope === "catalog" ? genresApi.facets("artist", signal) : Promise.resolve(null), [scope]);
  const discovery = useDiscoveryExamples(scope === "catalog");
  const sampledOptions = useMemo(() => {
    if (!examples.data) return [];
    return randomSample([...examples.data, ...genreSearchExamples(catalogGenres.data)]);
  }, [examples.data, catalogGenres.data]);
  const options = scope === "catalog" ? discovery.options : sampledOptions;
  const example = useRotatingSearchExample(options, value, next => { metricAccept.current(); onChange(next); updateOpen(true); inputRef.current?.focus(); }, scope === "catalog" ? discovery.cycle : examples.reload, scope === "catalog" ? discovery.intervalMs : 3500);
  const metric = useVisibleDiscoveryMetric(example.current, scope === "catalog" && discovery.metricsEnabled && !isAdmin && !isChecking);
  metricAccept.current = metric.accept;
  const showExample = Boolean(example.current);
  const query = value.trim();
  const minimum = scope === "catalog" ? 1 : 2;
  const hasQuery = query.length >= minimum;
  const search = useCatalogSuggestions(scope, value);
  const loading = hasQuery && (scope === "catalog" ? resultsLoading || resultsQuery !== query : search.loading);
  const searchError = scope === "catalog" ? resultsError : search.error;
  const suggestions = useMemo(() => !hasQuery ? [] : [
    ...entitySuggestions(scope === "catalog" ? (resultsQuery === query && !resultsLoading ? results : null) : search.data, scope),
    ...genreSuggestions(catalogGenres.data, query, scope),
  ], [hasQuery, scope, resultsQuery, query, resultsLoading, results, search.data, catalogGenres.data]);
  const groups = useMemo(() => {
    const categories = [...new Set(suggestions.map(option => option.category))];
    return categories.map(category => ({ category, label: SUGGESTION_GROUP_LABELS[category] ?? category,
      items: suggestions.filter(option => option.category === category) }));
  }, [suggestions]);
  const status = !hasQuery ? `Escribe al menos ${minimum} caracteres para ver sugerencias.`
    : loading ? "Buscando sugerencias…" : searchError ? "No se pudieron cargar las sugerencias. Prueba de nuevo."
      : !suggestions.length ? scope === "catalog" ? "Sin coincidencias. Prueba otro nombre, alias o género."
        : scope === "album" ? "Sin coincidencias. Prueba otro título o artista."
          : "Sin coincidencias. Prueba otro nombre o alias." : null;

  return (
    <Autocomplete.Root items={groups} value={value} onValueChange={(next, details) => {
      // Seleccionar navega; no aplicar un filtro tardío a la ficha de destino.
      if (details.reason !== "item-press") onChange(next);
    }} filter={null} itemToStringValue={option => option.label}
      open={open && (examplePlacement === "below" ? hasQuery : Boolean(query))} onOpenChange={next => updateOpen(next)} openOnInputClick>
    <div className={`catalog-search-field${className === "search-input" ? " catalog-search-field--main" : ""}`}>
      <div className="catalog-search-control">
      <Autocomplete.Input ref={inputRef} id={id ?? generatedId} className={className} type="search"
        aria-label={label} placeholder={showExample && examplePlacement === "field" ? "" : scope === "catalog" && examplePlacement === "field" ? DISCOVERY_FALLBACK : placeholder} autoFocus={autoFocus}
        onFocus={() => { example.resetOnFocus(); if (query) updateOpen(true); }} onKeyDown={event => {
          if (examplePlacement === "field") example.acceptOnTab(event);
          if (event.key === "Enter" && !event.nativeEvent.isComposing && onShowAllResults && hasQuery && !inputRef.current?.getAttribute("aria-activedescendant")) {
            event.preventDefault();
            updateOpen(false);
            onShowAllResults();
          }
        }}
        aria-describedby={showExample && examplePlacement === "field" ? `${id ?? generatedId}-example-hint` : undefined} />
      {examplePlacement === "field" ? <RotatingSearchExample {...example} metricRef={metric.ref} /> : null}
      </div>
      {examplePlacement === "below" && example.current && !query ? <div className="home-search-recommendation" ref={metric.ref}>
        <span>Prueba con</span><button type="button" onClick={example.accept}>{example.current.label}</button>
        <button type="button" className="home-search-recommendation__pause" aria-pressed={example.paused} onClick={example.togglePause}>
          {example.paused ? "Reanudar" : "Pausar"}
        </button>
      </div> : null}
      {scope === "catalog" && example.current && examplePlacement === "field" ? <div className="discovery-controls" aria-label="Controles de sugerencias">
        <button type="button" className="btn btn--sm" aria-pressed={example.paused} onClick={example.togglePause}>
          {example.paused ? "Reanudar sugerencias" : "Pausar sugerencias"}
        </button>
        <button type="button" className="btn btn--sm" onClick={example.skip}>Omitir sugerencia</button>
      </div> : null}
      {examplePlacement === "field" ? <SearchExampleHint id={`${id ?? generatedId}-example-hint`} available={showExample} /> : null}
    </div>
    <Autocomplete.Portal>
      <Autocomplete.Positioner className="catalog-suggestions-positioner" sideOffset={6} align="start" collisionAvoidance={{ side: "none", align: "shift" }}>
        <Autocomplete.Popup className="catalog-suggestions">
          {hasQuery ? <div className="catalog-suggestions__header">
            <MagnifyingGlass size={14} aria-hidden="true" />
            <span>Sugerencias para <strong>«{query}»</strong></span>
            {!loading && !searchError && suggestions.length ? <span className="catalog-suggestions__count">{suggestions.length} {suggestions.length === 1 ? "resultado" : "resultados"}</span> : null}
          </div> : null}
          {status ? <Autocomplete.Status className="catalog-suggestions__status">{status}</Autocomplete.Status> : null}
          {searchError && !loading ? <button type="button" className="btn btn--sm" onClick={scope === "catalog" ? onRetryResults : search.retry}>Reintentar sugerencias</button> : null}
          <Autocomplete.List className="catalog-suggestions__list" aria-label="Coincidencias del catálogo">
            {(group: typeof groups[number]) => <Autocomplete.Group key={group.category} items={group.items} className="catalog-suggestions__group">
              <Autocomplete.GroupLabel className="catalog-suggestions__group-label">{group.label}</Autocomplete.GroupLabel>
              <Autocomplete.Collection>
                {(option: CatalogSuggestion) => {
                  const Icon = SUGGESTION_ICONS[option.category] ?? Tag;
                  return <Autocomplete.Item key={option.key} value={option}
                    className="catalog-suggestions__option" data-category={option.category} onClick={() => { updateOpen(false); navigate(option.href); }}>
                    <span className="catalog-suggestions__icon" aria-hidden="true"><Icon size={19} /></span>
                    <span className="catalog-suggestions__text">
                      <span className="catalog-suggestions__name"><HighlightedName name={option.label} query={query} /></span>
                      {option.context ? <span className="catalog-suggestions__context">{option.context}</span> : null}
                    </span>
                    <span className="catalog-suggestions__category">{SUGGESTION_TYPE_LABELS[option.category] ?? option.category}</span>
                  </Autocomplete.Item>;
                }}
              </Autocomplete.Collection>
            </Autocomplete.Group>}
          </Autocomplete.List>
          {hasQuery && onShowAllResults ? <button type="button" className="catalog-suggestions__all" onClick={() => {
            updateOpen(false);
            onShowAllResults();
          }}><MagnifyingGlass size={14} aria-hidden="true" /><span>Ver todos los resultados para «{query}»</span></button> : null}
        </Autocomplete.Popup>
      </Autocomplete.Positioner>
    </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
