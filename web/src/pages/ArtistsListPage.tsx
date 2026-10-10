import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DecadeFilter } from "../components/DecadeFilter";
import { useDecadeFilter, decadeLabel } from "../lib/useDecadeFilter";
import { CatalogFilters } from "../components/CatalogFilters";
import { TypeFilter } from "../components/TypeFilter";
import { artistsApi, artistWrites, genresApi } from "../lib/api";
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
import { ARTIST_FIELDS } from "../lib/entityFields";
import { ARTIST_TYPES, artistTypeLabel } from "../lib/labels";
import { CatalogSearchInput } from "../components/CatalogSearchInput";

export function ArtistsListPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { isAdmin, user } = useOperator();
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("tipo");
  const selectedType = typeParam && ARTIST_TYPES.includes(typeParam) ? typeParam : null;
  const decade = useDecadeFilter();
  const typeFacets = useAsync(artistsApi.facets, []);
  const genre = useGenreFilter({ allowRelated: false });
  const facets = useAsync(() => genresApi.facets("artist"), []);
  const { data, loading, error, reload, q, offset, limit, setQuery, setOffset } = useEntityList(artistsApi.list, [user?.name], { ...genre.apiParams, ...decade.apiParams, ...(selectedType ? { artistType: selectedType } : {}) });
  const genreLabel = genreSelectionLabel(facets.data, genre.selection);
  const filtered = Boolean(q.trim()) || genreLabel !== null || selectedType !== null || decade.selection !== null;
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);

  function selectType(value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set("tipo", value); else next.delete("tipo");
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
          <p className="page-kicker">Catálogo</p>
          <h1>Artistas y bandas</h1>
        </div>
        {isAdmin ? <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ Nuevo artista</button> : null}
      </div>

      <CatalogFilters typeLabel="Tipo de artista"
        decadeActive={decade.selection !== null}
        decadeFilter={<DecadeFilter facets={typeFacets.data} error={typeFacets.error} onRetry={typeFacets.reload}
          selection={decade.selection} onSelect={decade.select} basis="formation" />}
        typeActive={selectedType !== null} genreActive={genre.selection.family !== null}
        search={
          <CatalogSearchInput scope="artist" value={q} onChange={setQuery}
            placeholder="Filtrar por nombre…" label="Filtrar artistas por nombre" />
        }
        typeFilter={
          <TypeFilter kind="artist" typeLabel={artistTypeLabel} facets={typeFacets.data}
            error={typeFacets.error} onRetry={typeFacets.reload} selectedType={selectedType} onSelect={selectType} />
        }
        genreFilter={
          <GenreFilter kind="artist" facets={facets.data} facetsError={facets.error} onRetryFacets={facets.reload}
            selection={genre.selection} onFamily={genre.selectFamily} onSub={genre.selectSub} onStyle={genre.selectStyle} onRelated={genre.setRelated}
            onFamilyRelated={genre.selectFamilyRelated} />
        } />

      <ListSummary total={data?.pagination.total} noun={{ one: "artista", many: "artistas" }} loading={loading}
        query={q} onClearQuery={() => setQuery("")} onClearAll={clearFilters}
        filters={[
          ...(decade.selection !== null ? [{ key: "decade", label: decadeLabel(decade.selection), onClear: () => decade.select(null) }] : []),
          ...(selectedType ? [{ key: "type", label: artistTypeLabel(selectedType), onClear: () => selectType(null) }] : []),
          ...(genreLabel ? [{ key: "genre", label: genreLabel, onClear: genre.clear }] : []),
        ]} />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <CardGridSkeleton count={12} label="Cargando artistas…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState title={filtered ? "Ningún artista coincide con estos filtros" : "No hay artistas para mostrar"}
          hint={filtered ? "Prueba con otro nombre, década, género o tipo, o quita alguno de los filtros." : undefined}
          action={filtered ? <button type="button" className="btn btn--sm" onClick={clearFilters}>Quitar filtros</button> : null} />
      ) : (
        <>
          <div className={`grid-cards${loading ? " is-refreshing" : ""}`}>
            {data.data.map((artist) => (
              <EntityCard
                key={artist.id}
                to={`/artistas/${artist.id}`}
                title={artist.name}
                deceased={artist.isDeceased}
                subtitle={[artistTypeLabel(artist.artistType), artist.originCity].filter(Boolean).join(" · ")}
                imageUrl={artist.pictureUrl}
                placeholder={initialOf(artist.name)}
                genre={artist.primaryGenre?.name}
                tag={artist.genreByLaya ? "Género por Laya" : null}
                tagTitle="Género principal elegido por Laya (último recurso), directo o por sus discos. Solo visible con sesión iniciada."
              />
            ))}
          </div>
          <Pagination scrollTargetRef={paginationStartRef} limit={limit} offset={offset} total={data.pagination.total} onOffsetChange={setOffset} />
        </>
      )}

      {creating ? (
        <EntityFormModal
          title="Nuevo artista"
          fields={ARTIST_FIELDS}
          initialValues={{ artistType: "band", originCountry: "Venezuela" }}
          onSubmit={(values, note) => artistWrites.create({ ...values, note })}
          onSuccess={() => { setCreating(false); reload(); typeFacets.reload(); notify("success", "Artista creado."); }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
