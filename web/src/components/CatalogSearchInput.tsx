import { useId, useMemo, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useNavigate } from "react-router-dom";
import { genresApi } from "../lib/api";
import { genreSearchExamples, loadSearchExamples, randomSample, type CatalogSearchScope } from "../lib/catalogSearchExamples";
import { DISCOVERY_FALLBACK, useDiscoveryExamples } from "../lib/discovery";
import { useAsync } from "../lib/useAsync";
import { entitySuggestions, genreSuggestions, useCatalogSuggestions, type CatalogSuggestion } from "../lib/catalogSearchSuggestions";
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
}

/** Ejemplos reales rotativos que se aceptan con Tab y coincidencias al escribir. */
export function CatalogSearchInput({ scope, value, onChange, label, placeholder, className = "filter-input", id, autoFocus, results = null, resultsQuery = "", resultsLoading = false, resultsError, onRetryResults, examplePlacement = "field" }: CatalogSearchInputProps) {
  const generatedId = useId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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
  const example = useRotatingSearchExample(options, value, next => { metricAccept.current(); onChange(next); setOpen(true); inputRef.current?.focus(); }, scope === "catalog" ? discovery.cycle : examples.reload, scope === "catalog" ? discovery.intervalMs : 3500);
  const metric = useVisibleDiscoveryMetric(example.current, scope === "catalog" && discovery.metricsEnabled && !isAdmin && !isChecking);
  metricAccept.current = metric.accept;
  const showExample = Boolean(example.current);
  const query = value.trim();
  const minimum = scope === "catalog" ? 3 : 2;
  const hasQuery = query.length >= minimum;
  const search = useCatalogSuggestions(scope, value);
  const loading = hasQuery && (scope === "catalog" ? resultsLoading || resultsQuery !== query : search.loading);
  const searchError = scope === "catalog" ? resultsError : search.error;
  const suggestions = useMemo(() => !hasQuery ? [] : [
    ...entitySuggestions(scope === "catalog" ? (resultsQuery === query && !resultsLoading ? results : null) : search.data, scope),
    ...genreSuggestions(catalogGenres.data, query, scope),
  ], [hasQuery, scope, resultsQuery, query, resultsLoading, results, search.data, catalogGenres.data]);
  const status = !hasQuery ? `Escribe al menos ${minimum} caracteres para ver sugerencias.`
    : loading ? "Buscando sugerencias…" : searchError ? "No se pudieron cargar las sugerencias. Prueba de nuevo."
      : !suggestions.length ? scope === "catalog" ? "Sin coincidencias. Prueba otro nombre, alias o género."
        : scope === "album" ? "Sin coincidencias. Prueba otro título o artista."
          : "Sin coincidencias. Prueba otro nombre o alias." : null;

  return (
    <Autocomplete.Root items={suggestions} value={value} onValueChange={(next, details) => {
      // Seleccionar navega; no aplicar un filtro tardío a la ficha de destino.
      if (details.reason !== "item-press") onChange(next);
    }} filter={null} itemToStringValue={option => option.label}
      open={open && (examplePlacement === "below" ? hasQuery : Boolean(query))} onOpenChange={next => setOpen(next)} openOnInputClick>
    <div className={`catalog-search-field${className === "search-input" ? " catalog-search-field--main" : ""}`}>
      <div className="catalog-search-control">
      <Autocomplete.Input ref={inputRef} id={id ?? generatedId} className={className} type="search"
        aria-label={label} placeholder={showExample && examplePlacement === "field" ? "" : scope === "catalog" && examplePlacement === "field" ? DISCOVERY_FALLBACK : placeholder} autoFocus={autoFocus}
        onFocus={() => { example.resetOnFocus(); if (query) setOpen(true); }} onKeyDown={examplePlacement === "field" ? example.acceptOnTab : undefined}
        aria-describedby={showExample && examplePlacement === "field" ? `${id ?? generatedId}-example-hint` : undefined} />
      {examplePlacement === "field" ? <RotatingSearchExample {...example} metricRef={metric.ref} /> : null}
      </div>
      {examplePlacement === "below" && example.current ? <div className="home-search-recommendation" ref={metric.ref}>
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
      <Autocomplete.Positioner className="catalog-suggestions-positioner" sideOffset={6} align="start">
        <Autocomplete.Popup className="catalog-suggestions">
          {status ? <Autocomplete.Status className="catalog-suggestions__status">{status}</Autocomplete.Status> : null}
          {searchError && !loading ? <button type="button" className="btn btn--sm" onClick={scope === "catalog" ? onRetryResults : search.retry}>Reintentar sugerencias</button> : null}
          <Autocomplete.List className="catalog-suggestions__list" aria-label="Coincidencias del catálogo">
            {(option: CatalogSuggestion) => <Autocomplete.Item key={option.key} value={option}
              className="catalog-suggestions__option" onClick={() => { setOpen(false); navigate(option.href); }}>
              <span className="catalog-suggestions__name">{option.label}</span>
              <span className="catalog-suggestions__category">{option.category}</span>
              {option.context ? <span className="catalog-suggestions__context">{option.context}</span> : null}
            </Autocomplete.Item>}
          </Autocomplete.List>
        </Autocomplete.Popup>
      </Autocomplete.Positioner>
    </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
