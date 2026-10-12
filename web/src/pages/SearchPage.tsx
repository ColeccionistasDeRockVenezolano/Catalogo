import { useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useDebouncedQuery } from "../lib/useDebouncedQuery";
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
const MIN_QUERY_LENGTH = 3;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const applyQuery = useCallback((next: string) => {
    const query = next.trim();
    setParams(query.length >= MIN_QUERY_LENGTH ? { q: query } : {}, { replace: true });
  }, [setParams]);
  const [input, setInput] = useDebouncedQuery(urlQuery, applyQuery);
  const q = urlQuery.trim();
  const inputQuery = input.trim();
  const hasMinimumQuery = q.length >= MIN_QUERY_LENGTH;
  const needsMoreCharacters = inputQuery.length > 0 && inputQuery.length < MIN_QUERY_LENGTH;
  const isSearchPending = inputQuery.length >= MIN_QUERY_LENGTH && inputQuery !== q;

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
    applyQuery(input);
  }

  const home = useHomeData();
  const hasAnyResult = data ? GROUP_ORDER.some((type) => data[type].length > 0) : false;

  return (
    <>
      <div className={`home-hero${inputQuery ? " home-hero--searching" : ""}`}>
      <HomeBackdrop home={home} hidden={Boolean(inputQuery)} />
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
            onChange={setInput}
            results={data} resultsQuery={q} resultsLoading={loading || isSearchPending || awaitingCurrentResults} resultsError={error} onRetryResults={reload}
            placeholder="Busca artistas, bandas, álbumes o canciones"
            examplePlacement="below"
          />
        </form>
        {!inputQuery ? <HomeStats stats={home.data?.stats} home={home} /> : null}

        {needsMoreCharacters ? (
          <p className="search-status" role="status">Escribe al menos {MIN_QUERY_LENGTH} caracteres para buscar.</p>
        ) : !inputQuery ? null : isSearchPending || !hasMinimumQuery || loading || awaitingCurrentResults ? (
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
      {/* Sin búsqueda, la portada: aniversarios, artista del día, disco para hoy, canal, géneros, décadas y sellos. */}
      {!inputQuery ? <HomeSections home={home} /> : null}
    </>
  );
}
