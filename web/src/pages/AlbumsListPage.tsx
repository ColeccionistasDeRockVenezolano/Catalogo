import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DecadeFilter } from "../components/DecadeFilter";
import { useDecadeFilter, decadeLabel } from "../lib/useDecadeFilter";
import { CatalogFilters } from "../components/CatalogFilters";
import { CatalogSort } from "../components/CatalogSort";
import { useCatalogSort } from "../lib/useCatalogSort";
import { TypeFilter } from "../components/TypeFilter";
import { discographyApi, albumsApi, albumWrites, genresApi } from "../lib/api";
import { useEntityList } from "../lib/useEntityList";
import { useAsync } from "../lib/useAsync";
import { useGenreFilter } from "../lib/useGenreFilter";
import { GenreFilter, ListSummary, genreSelectionLabel } from "../components/GenreFilter";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { ErrorState, EmptyState } from "../components/StateViews";
import { CardGridSkeleton } from "../components/Skeletons";
import { EntityCard, initialOf } from "../components/EntityCard";
import { Pagination } from "../components/Pagination";
import { EntityFormModal } from "../components/EntityFormModal";
import { EntityPicker } from "../components/EntityPicker";
import { ALBUM_FIELDS } from "../lib/entityFields";
import { ALBUM_FILTER_TYPES, albumClassificationBadges, albumFilterTypeLabel, albumTypeLabel } from "../lib/labels";
import { CatalogSearchInput } from "../components/CatalogSearchInput";
import { parseCategorySelection, toggleCategorySelection } from "../../../src/shared/category-selection";

import { SeriesCard, useSeriesRotation } from "../components/SeriesCard";
import { HiddenSeriesPanel, SeriesFormModal } from "../components/SeriesEditor";
import type { AlbumListItem, SeriesListItem, Page } from "../lib/types";

export function AlbumsListPage({ seriesOnly = false }: { seriesOnly?: boolean }) {
  const [params] = useSearchParams();
  const showSeries = seriesOnly || params.get("vista") === "series";
  return <AlbumsCatalog key={showSeries ? "series" : "albums"} seriesOnly={seriesOnly} />;
}

function AlbumsCatalog({ seriesOnly }: { seriesOnly: boolean }) {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { isAdmin, user } = useOperator();
  const [params, setParams] = useSearchParams();
  const showSeries = seriesOnly || params.get("vista") === "series";
  const { rotating, toggleRotation } = useSeriesRotation();
  const [creatingSeries, setCreatingSeries] = useState(false);
  const navigate = useNavigate();
  const noun = showSeries ? { one: "serie", many: "series" } : { one: "disco", many: "discos" };
  const selectedTypes = parseCategorySelection(params.getAll("tipo")).filter(value=>ALBUM_FILTER_TYPES.includes(value)||value.startsWith("classification:"));
  const decade = useDecadeFilter();
  const { sort, selectSort } = useCatalogSort();
  const typeFacets = useAsync(albumsApi.facets, []);
  const genre = useGenreFilter({ allowRelated: true });
  const facets = useAsync(() => genresApi.facets("album"), []);
  const { data, loading, error, reload, q, offset, limit, setQuery, setOffset } = useEntityList<AlbumListItem | SeriesListItem>((query): Promise<Page<AlbumListItem | SeriesListItem>> => showSeries ? discographyApi.listSeries(query) : albumsApi.list(query), [user?.name, showSeries], { sort, ...genre.apiParams, ...decade.apiParams, ...(selectedTypes.length ? { albumType: selectedTypes.join(",") } : {}) });
  const genreLabel = genreSelectionLabel(facets.data, genre.selection);
  const filtered = Boolean(q.trim()) || genreLabel !== null || selectedTypes.length > 0 || decade.selection !== null;
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);
  const [artistId, setArtistId] = useState<number | null>(null);
  const [artistLabel, setArtistLabel] = useState<string | null>(null);
  const [labelId, setLabelId] = useState<number | null>(null);
  const [labelLabel, setLabelLabel] = useState<string | null>(null);

  function selectType(value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      const selected = value === null ? [] : toggleCategorySelection(parseCategorySelection(current.getAll("tipo")).filter(value=>ALBUM_FILTER_TYPES.includes(value)||value.startsWith("classification:")), value);
      if (selected.length) next.set("tipo", selected.join(",")); else next.delete("tipo");
      next.delete("offset");
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["q", "tipo", "genero", "subgenero", "estilo", "ampliar", "decada", "offset"]) next.delete(key);
      return next;
    });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{seriesOnly ? "Series de compilados" : "Discos"}</h1>
        </div>
        {isAdmin && !showSeries ? <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ Nuevo disco</button> : null}
        {isAdmin && showSeries ? <button type="button" className="btn btn--primary" onClick={() => setCreatingSeries(true)}>+ Nueva serie</button> : null}
      </div>

      <div className="catalog-series-tools">
        <div className="catalog-view-switch" aria-label="Ver catálogo">
          <Link className={`btn btn--sm${!showSeries ? " btn--primary" : ""}`} aria-current={!showSeries ? "page" : undefined}
            to={{ pathname: "/discos", search: (() => { const next = new URLSearchParams(params); next.delete("vista"); next.delete("offset"); return next.toString(); })() }}>Discos</Link>
          <Link className={`btn btn--sm${showSeries ? " btn--primary" : ""}`} aria-current={showSeries ? "page" : undefined}
            to={{ pathname: seriesOnly ? "/series" : "/discos", search: (() => { const next = new URLSearchParams(params); if (!seriesOnly) next.set("vista", "series"); next.delete("offset"); return next.toString(); })() }}>Series</Link>
        </div>
        {showSeries ? <button className="btn btn--sm" type="button" aria-pressed={rotating} onClick={toggleRotation}>
          {rotating ? "Pausar carátulas" : "Activar carátulas"}</button> : <Link to="/series">Explorar todas las series</Link>}
      </div>
      {showSeries ? <p className="catalog-series-description">Compilados agrupados por colección. Abre una serie para recorrer sus entregas.</p> : null}
      {isAdmin && showSeries ? <HiddenSeriesPanel /> : null}

      <CatalogFilters
        mobile={{ query: q, onClearQuery: () => setQuery(""), total: data?.pagination.total, noun, onClearAll: clearFilters }}
        typeLabel="Tipo de disco"
        sort={<CatalogSort kind="album" value={sort} onChange={selectSort} />}
        decadeActive={decade.selection !== null}
        decadeFilter={<DecadeFilter facets={typeFacets.data} error={typeFacets.error} onRetry={typeFacets.reload}
          selection={decade.selection} onSelect={decade.select} basis="release" />}
        values={{ type: selectedTypes.length ? selectedTypes.map(albumFilterTypeLabel).join(" + ") : null, genre: genreLabel, decade: decade.selection !== null ? decadeLabel(decade.selection) : null }}
        typeActive={selectedTypes.length > 0} genreActive={genre.selection.family !== null}
        search={
          showSeries ? <input type="search" className="filter-input" value={q} onChange={event => setQuery(event.target.value)}
            placeholder="Filtrar por serie o compilado…" aria-label="Filtrar series por nombre o compilado" /> :
          <CatalogSearchInput scope="album" value={q} onChange={setQuery} placeholder="Filtrar por título…" label="Filtrar discos por título" />
        }
        typeFilter={
          <TypeFilter kind="album" typeLabel={albumFilterTypeLabel} facets={typeFacets.data}
            error={typeFacets.error} onRetry={typeFacets.reload} selectedTypes={selectedTypes} onSelect={selectType} />
        }
        genreFilter={
          <GenreFilter kind="album" facets={facets.data} facetsError={facets.error} onRetryFacets={facets.reload}
            selection={genre.selection} onFamily={genre.selectFamily} onSub={genre.selectSub} onStyle={genre.selectStyle} onRelated={genre.setRelated}
            onFamilyRelated={genre.selectFamilyRelated} />
        } />

      <ListSummary total={data?.pagination.total} noun={noun} loading={loading}
        query={q} onClearQuery={() => setQuery("")} onClearAll={clearFilters}
        filters={[
          ...(decade.selection !== null ? [{ key: "decade", label: decadeLabel(decade.selection), onClear: () => decade.select(null) }] : []),
          ...selectedTypes.map(type => ({ key: `type:${type}`, label: albumFilterTypeLabel(type), onClear: () => selectType(type) })),
          ...(genreLabel ? [{ key: "genre", label: genreLabel, onClear: genre.clear }] : []),
        ]} />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <CardGridSkeleton count={12} label={showSeries ? "Cargando series…" : "Cargando discos…"} /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState title={showSeries ? (filtered ? "Ninguna serie coincide con estos filtros" : "No hay series para mostrar") : (filtered ? "Ningún disco coincide con estos filtros" : "No hay discos para mostrar")}
          hint={filtered ? "Prueba con otro título, década, género o tipo, o quita alguno de los filtros." : undefined}
          action={filtered ? <button type="button" className="btn btn--sm" onClick={clearFilters}>Quitar filtros</button> : null} />
      ) : (
        <>
          <div className={`grid-cards${loading ? " is-refreshing" : ""}`}>
            {data.data.map((album) => "albumCount" in album ? <SeriesCard key={album.id} series={album} rotating={rotating} /> : (
              <EntityCard
                key={album.id}
                to={`/discos/${album.id}`}
                title={album.title}
                albumMetadata={{ artist: album.artistName, artistId: album.artistId, year: album.releaseYear, type: albumTypeLabel(album.albumType), typeValue: album.albumType, categories: albumClassificationBadges(album) }}
                imageUrl={album.coverUrl}
                imageFit="contain"
                placeholder={initialOf(album.title)}
                genres={album.primaryGenre ? [album.primaryGenre] : []}
                note={genre.selection.related && album.hasOwnGenre === false ? "Por su artista" : null}
                noteTitle="Este disco aún no tiene género propio: aparece por el género de su artista."
                tag={album.genreByLaya ? "Género por Laya" : null}
                tagTitle="Género principal elegido por Laya (último recurso). Solo visible con sesión iniciada."
              />
            ))}
          </div>
          <Pagination scrollTargetRef={paginationStartRef} limit={limit} offset={offset} total={data.pagination.total} onOffsetChange={setOffset} />
        </>
      )}

      {creatingSeries ? <SeriesFormModal onClose={() => setCreatingSeries(false)} onSaved={(id) => navigate(`/series/${id}`)} /> : null}
      {creating ? (
        <EntityFormModal
          title="Nuevo disco"
          fields={ALBUM_FIELDS}
          initialValues={{ albumType: "studio_album", youtubeStatus: "unknown", instagramStatus: "unknown", wordpressStatus: "unknown" }}
          extraFields={
            <>
              <EntityPicker kind="artist" label="Artista *" value={artistId} valueLabel={artistLabel}
                onSelect={(id, label) => { setArtistId(id); setArtistLabel(label); }} />
              <EntityPicker kind="organization" label="Sello discográfico" value={labelId} valueLabel={labelLabel}
                onClear={() => { setLabelId(null); setLabelLabel(null); }}
                onSelect={(id, label) => { setLabelId(id); setLabelLabel(label); }} />
            </>
          }
          onSubmit={(values, note) => {
            if (artistId === null) return Promise.reject(new Error("Selecciona un artista."));
            return albumWrites.create({ ...values, artistId, labelId, note });
          }}
          onSuccess={() => { setCreating(false); setArtistId(null); setArtistLabel(null); setLabelId(null); setLabelLabel(null); reload(); typeFacets.reload(); notify("success", "Disco creado."); }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
