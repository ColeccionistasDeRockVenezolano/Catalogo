import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { TYPING_DEBOUNCE_MS } from "../lib/useDebouncedQuery";
import { entityHref } from "../lib/routes";
import { searchTypeLabel } from "../lib/labels";
import { ErrorState, EmptyState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { CatalogSearchInput } from "../components/CatalogSearchInput";
import type { SearchEntityType } from "../lib/types";
import { useOperator } from "../lib/OperatorContext";
import { useDiscoverySearchMetric } from "../lib/discoveryMetrics";
import { HomeBackdrop, HomeSections, HomeStats, useHomeData } from "../components/HomeSections";

const GROUP_ORDER: SearchEntityType[] = ["artist", "album", "person", "organization", "track"];
// Una letra basta: con consultas cortas la API solo busca comienzos de nombre o palabra, y las guarda en caché.
const MIN_QUERY_LENGTH = 1;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const [q, setQuery] = useState(urlQuery.trim());
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  useEffect(() => { setInput(urlQuery); }, [urlQuery]);
  const inputQuery = input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(inputQuery), TYPING_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputQuery]);
  const hasMinimumQuery = q.length >= MIN_QUERY_LENGTH;
  const needsMoreCharacters = inputQuery.length > 0 && inputQuery.length < MIN_QUERY_LENGTH;
  const isSearchPending = inputQuery.length >= MIN_QUERY_LENGTH && inputQuery !== q;
  const showFullResults = urlQuery.trim().length >= MIN_QUERY_LENGTH && inputQuery === urlQuery.trim() && !suggestionsOpen;

  const { data: response, loading, error, reload } = useAsync(
    (signal) => (hasMinimumQuery ? searchApi.search(q, undefined, 20, signal).then(results => ({ query: q, results })) : Promise.resolve(null)),
    [q, hasMinimumQuery],
  );
  const data = response?.query === q ? response.results : null;
  const awaitingCurrentResults = hasMinimumQuery && response?.query !== q && !error;
  const { isAdmin, isChecking } = useOperator();
  useDiscoverySearchMetric(inputQuery, Boolean(data) && inputQuery === q && !loading && !error, !isAdmin && !isChecking);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    showAllResults();
  }

  function showAllResults() {
    if (inputQuery.length < MIN_QUERY_LENGTH) return;
    setQuery(inputQuery);
    setSuggestionsOpen(false);
    setParams({ q: inputQuery });
  }

  function changeInput(next: string) {
    setInput(next);
    if (!next.trim() && urlQuery) setParams({}, { replace: true });
  }

  const home = useHomeData();
  const hasAnyResult = data ? GROUP_ORDER.some((type) => data[type].length > 0) : false;

  return (
    <>
      <div className={`home-hero${showFullResults ? " home-hero--searching" : ""}`}>
      <HomeBackdrop home={home} hidden={showFullResults} />
      <div className="search-shell">
        <p className="home-hero__kicker"><span className="home-kicker__dot" aria-hidden="true" />Recomendaciones diarias</p>
        <h1>Coleccionistas De <span className="home-hero__accent">Rock Venezolano</span></h1>
        <p>Descubre el rock y la música venezolana. Cada día, nuevos artistas, discos y caminos para explorar.</p>
        <form className="search-input-wrap" onSubmit={handleSubmit}>
          <label className="home-search-label" htmlFor="catalog-search">Buscar en el catálogo</label>
          <CatalogSearchInput
            scope="catalog"
            id="catalog-search"
            className="search-input"
            label="Buscar en el catálogo"
            value={input}
            onChange={changeInput}
            results={data} resultsQuery={q} resultsLoading={loading || isSearchPending || awaitingCurrentResults} resultsError={error} onRetryResults={reload}
            placeholder="Busca artistas, bandas, álbumes o canciones"
            examplePlacement="below"
            onShowAllResults={showAllResults}
            onSuggestionsOpenChange={setSuggestionsOpen}
          />
        </form>
        {!showFullResults ? <HomeStats stats={home.data?.stats} home={home} /> : null}

        {needsMoreCharacters ? (
          <p className="search-status" role="status">Escribe al menos {MIN_QUERY_LENGTH} caracteres para buscar.</p>
        ) : !showFullResults ? null : isSearchPending || !hasMinimumQuery || loading || awaitingCurrentResults ? (
          <RowsSkeleton rows={6} label="Buscando…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasAnyResult ? (
          <EmptyState title={`Sin resultados para «${q}»`} hint="Prueba con otro nombre o revisa la ortografía." />
        ) : (
          <div className="search-groups">
            {GROUP_ORDER.filter((type) => (data?.[type].length ?? 0) > 0).map((type) => (
              <div className="search-group" key={type}>
                <h2>{searchTypeLabel(type)} <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({data![type].length})</span></h2>
                {data![type].map((hit) => (
                  <Link key={`${hit.type}-${hit.id}`} className="search-hit" to={entityHref(hit.type, hit.id, hit.albumId ?? undefined)}>
                    <span className="label">{hit.label}</span>
                    {hit.context ? <span className="context">{hit.context}</span> : null}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      {!showFullResults ? <HomeSections home={home} /> : null}
    </>
  );
}
