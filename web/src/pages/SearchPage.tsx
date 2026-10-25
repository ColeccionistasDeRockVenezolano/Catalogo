import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Disc, MusicNote, Buildings, User, UsersThree } from "@phosphor-icons/react";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { TYPING_DEBOUNCE_MS } from "../lib/useDebouncedQuery";
import { entityHref } from "../lib/routes";
import { emotionLabel } from "../lib/labels";
import { ErrorState, EmptyState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { CatalogSearchInput } from "../components/CatalogSearchInput";
import type { SearchEntityType, SearchHit } from "../lib/types";
import { mediaImage } from "../lib/media";
import "../styles/search-results.css";
import { useOperator } from "../lib/OperatorContext";
import { useDiscoverySearchMetric } from "../lib/discoveryMetrics";
import { HomeBackdrop, HomeSections, HomeStats, useHomeData } from "../components/HomeSections";

const GROUP_ORDER: SearchEntityType[] = ["artist", "album", "person", "organization", "track"];
// Una letra basta: con consultas cortas la API solo busca comienzos de nombre o palabra, y las guarda en caché.
const MIN_QUERY_LENGTH = 1;
/** Mismo tope que pide searchApi.observed: con 20 puede haber más. */
const RESULTS_PER_TYPE = 20;
/** En «Todos», cada grupo muestra unos pocos y deja ver el resto con su filtro. */
const PREVIEW_PER_TYPE = 5;
const TYPE_PARAM: Record<SearchEntityType, string> = { artist: "artistas", album: "discos", person: "personas", organization: "organizaciones", track: "pistas" };
const TYPE_PLURAL: Record<SearchEntityType, string> = { artist: "Artistas", album: "Discos", person: "Personas", organization: "Organizaciones", track: "Pistas" };
const TYPE_ICON: Record<SearchEntityType, typeof Disc> = { artist: UsersThree, album: Disc, person: User, organization: Buildings, track: MusicNote };

function typeFromParam(value: string | null): SearchEntityType | null {
  return GROUP_ORDER.find((type) => TYPE_PARAM[type] === value) ?? null;
}

function countLabel(count: number): string {
  return count >= RESULTS_PER_TYPE ? `${RESULTS_PER_TYPE}+` : String(count);
}

function HitThumb({ hit }: { hit: SearchHit }) {
  const Icon = TYPE_ICON[hit.type];
  const round = hit.type === "person";
  return (
    <span className={`search-hit__thumb${round ? " search-hit__thumb--round" : ""}`} aria-hidden="true">
      {hit.imageUrl ? <img {...mediaImage(hit.imageUrl, 44)} alt="" loading="lazy" decoding="async" width="44" height="44" /> : <Icon size={18} weight="duotone" />}
    </span>
  );
}

/** Una consulta de varias palabras sin resultados suele encontrar algo con una sola. */
function narrowerQueries(q: string): string[] {
  const words = q.split(/\s+/u).filter((word) => word.length >= 2);
  return words.length > 1 ? [...new Set(words)].slice(0, 4) : [];
}

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
  const activeType = typeFromParam(params.get("tipo"));
  const isSearchPending = inputQuery.length >= MIN_QUERY_LENGTH && inputQuery !== q;
  const showFullResults = urlQuery.trim().length >= MIN_QUERY_LENGTH && inputQuery === urlQuery.trim() && !suggestionsOpen;

  const { isAdmin, isChecking } = useOperator();
  const [operation, setOperation] = useState<{ id: string; attempt: string; query: string; kind: "enter" | "all_results"; started: number } | null>(null);
  const lastConfirmation = useRef<string | null>(null);
  const { data: response, loading, error: loadError, reload } = useAsync(
    async signal => hasMinimumQuery ? { query: q, attempt: operation?.query === q ? operation.attempt : null, ...await searchApi.observed(q, signal) } : null,
    [q, hasMinimumQuery, operation?.attempt],
  );
  const data = response?.query === q ? response.results : null;
  const error = (response?.query === q ? response.error : undefined) ?? loadError;
  const awaitingCurrentResults = hasMinimumQuery && response?.query !== q && !error;
  useDiscoverySearchMetric(inputQuery, Boolean(data) && inputQuery === q && !loading && !error, !isAdmin && !isChecking);
  useEffect(() => {
    if (!operation || !response?.receipt || response.attempt !== operation.attempt || response.query !== inputQuery || loading || isAdmin || isChecking) return;
    const receipt = response.receipt;
    // Send after the rendered response; cancelled/obsolete attempts cannot complete the operation.
    const frame = requestAnimationFrame(() => {
      if (lastConfirmation.current === receipt) return;
      lastConfirmation.current = receipt;
      void searchApi.confirm({ searchId: operation.id, receipt, confirmation: operation.kind,
        ...(response.clientIncident ? { clientIncident: response.clientIncident } : {}),
        perceivedMs: performance.now() - operation.started }).catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [operation, response, inputQuery, loading, isAdmin, isChecking]);

  function handleSubmit(event: React.FormEvent) { event.preventDefault(); showAllResults("enter"); }
  function showAllResults(kind: "enter" | "all_results" = "all_results", retry = false) {
    if (inputQuery.length < MIN_QUERY_LENGTH || inputQuery.length > 1000) return;
    if (!isAdmin && !isChecking) setOperation({ id: retry && operation?.query === inputQuery ? operation.id : crypto.randomUUID(), attempt: crypto.randomUUID(), query: inputQuery, kind, started: performance.now() });
    setQuery(inputQuery); setSuggestionsOpen(false); setParams(activeType ? { q: inputQuery, tipo: TYPE_PARAM[activeType] } : { q: inputQuery });
  }
  function chooseType(type: SearchEntityType | null) {
    setParams(type ? { q: urlQuery, tipo: TYPE_PARAM[type] } : { q: urlQuery });
  }
  function searchFor(next: string) {
    setOperation(null); setInput(next); setQuery(next); setParams({ q: next });
  }
  function selectEntity(type: SearchEntityType, id: number) {
    if (isAdmin || isChecking) return;
    const searchId = crypto.randomUUID();
    // Navigation remains immediate; the server validates that the explicitly selected ID belongs to this retrieval.
    void searchApi.observe(inputQuery, receipt => {
      void searchApi.confirm({ searchId, receipt, confirmation: "entity", selected: { type, id } }).catch(() => {});
    }).catch(() => {});
  }
  function changeInput(next: string) {
    setOperation(null); setInput(next);
    if (!next.trim() && urlQuery) setParams({}, { replace: true });
  }

  const home = useHomeData();
  // «música para tener sexo» no es un nombre: la API detecta la emoción pedida
  // y devuelve artistas del catálogo que la expresan (tags y opiniones).
  const emotionMatch = data?.emotion && data.emotion.artists.length > 0 ? data.emotion : null;
  const hasAnyResult = data
    ? GROUP_ORDER.some((type) => data[type].length > 0) || Boolean(emotionMatch)
    : false;
  const presentTypes = data ? GROUP_ORDER.filter((type) => data[type].length > 0) : [];
  // Un filtro que ya no tiene resultados (otra consulta) vuelve a «Todos».
  const shownType = activeType && presentTypes.includes(activeType) ? activeType : null;
  const visibleTypes = shownType ? [shownType] : presentTypes;
  const total = presentTypes.reduce((sum, type) => sum + data![type].length, 0);
  const narrower = narrowerQueries(q);

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
            onShowAllResults={kind => showAllResults(kind)}
            onEntitySelection={(type, id) => selectEntity(type as SearchEntityType, id)}
            onSuggestionsOpenChange={setSuggestionsOpen}
          />
        </form>
        {!showFullResults ? <HomeStats stats={home.data?.stats} home={home} /> : null}

        {!showFullResults ? null : isSearchPending || !hasMinimumQuery || loading || awaitingCurrentResults ? (
          <RowsSkeleton rows={6} label="Buscando…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => showAllResults("enter", true)} />
        ) : !hasAnyResult ? (
          <EmptyState title={`Sin resultados para «${q}»`}
            hint="Prueba con otro nombre, revisa la ortografía o explora el catálogo. Las búsquedas sin resultados se revisan para añadir nombres que falten."
            action={(
              <div className="search-empty__actions">
                {narrower.length ? (
                  <p className="search-empty__line"><span>Buscar solo</span>
                    {narrower.map((word) => <button key={word} type="button" className="search-chip" onClick={() => searchFor(word)}>{word}</button>)}
                  </p>
                ) : null}
                <p className="search-empty__line"><span>Explorar</span>
                  <Link className="search-chip" to="/artistas">Artistas</Link>
                  <Link className="search-chip" to="/discos">Discos</Link>
                  <Link className="search-chip" to="/personas">Personas</Link>
                </p>
              </div>
            )} />
        ) : (
          <div className="search-groups">
            {presentTypes.length > 1 ? (
              <div className="search-type-filter" role="group" aria-label="Filtrar resultados por tipo">
                <button type="button" className="search-chip" aria-pressed={!shownType} onClick={() => chooseType(null)}>
                  Todos <span className="search-chip__count">{total >= RESULTS_PER_TYPE * presentTypes.length ? `${total}+` : total}</span>
                </button>
                {presentTypes.map((type) => (
                  <button key={type} type="button" className="search-chip" aria-pressed={shownType === type} onClick={() => chooseType(type)}>
                    {TYPE_PLURAL[type]} <span className="search-chip__count">{countLabel(data![type].length)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {emotionMatch && !shownType ? (
              <div className="search-group search-group--emotion">
                <h2>Por emoción: {emotionLabel(emotionMatch.emotion)} <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({emotionMatch.artists.length})</span></h2>
                <p className="search-emotion-note">Estos artistas expresan esa emoción según las etiquetas y opiniones de sus oyentes.</p>
                {emotionMatch.artists.map((artist) => (
                  <Link key={`emotion-artist-${artist.id}`} className="search-hit" to={entityHref("artist", artist.id)}>
                    <span className="label">{artist.name}</span>
                    <span className="context">
                      {artist.tags.length > 0 ? <span>{artist.tags.map((tag) => tag.tag).join(" · ")}</span> : null}
                      {artist.shouts.length > 0 ? <span className="search-hit__shout">«{artist.shouts[0]!.slice(0, 90)}»</span> : null}
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
            {visibleTypes.map((type) => {
              const hits = data![type];
              const shown = shownType || presentTypes.length === 1 ? hits : hits.slice(0, PREVIEW_PER_TYPE);
              return (
                <div className="search-group" key={type}>
                  <h2>{TYPE_PLURAL[type]} <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({countLabel(hits.length)})</span></h2>
                  {shown.map((hit) => (
                    <Link key={`${hit.type}-${hit.id}`} className="search-hit search-hit--media" to={entityHref(hit.type, hit.id, hit.albumId ?? undefined)}>
                      <HitThumb hit={hit} />
                      <span className="search-hit__text">
                        <span className="label">{hit.label}</span>
                        {hit.context ? <span className="context">{hit.context}</span> : null}
                      </span>
                    </Link>
                  ))}
                  {shown.length < hits.length ? (
                    <button type="button" className="search-group__more" onClick={() => chooseType(type)}>
                      Ver {hits.length >= RESULTS_PER_TYPE ? "más" : `los ${hits.length}`} {TYPE_PLURAL[type].toLowerCase()}
                    </button>
                  ) : null}
                  {shownType && hits.length >= RESULTS_PER_TYPE ? (
                    <p className="search-group__cap">Se muestran los {RESULTS_PER_TYPE} más cercanos; afina la búsqueda para ver otros.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      {!showFullResults ? <HomeSections home={home} /> : null}
    </>
  );
}
