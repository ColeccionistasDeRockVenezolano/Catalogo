import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DecadeFilter } from "../components/DecadeFilter";
import { useDecadeFilter, decadeLabel } from "../lib/useDecadeFilter";
import { CatalogFilters } from "../components/CatalogFilters";
import { TypeFilter } from "../components/TypeFilter";
import { albumsApi, albumWrites, genresApi } from "../lib/api";
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
import { ALBUM_TYPES, albumTypeLabel } from "../lib/labels";
import { CatalogSearchInput } from "../components/CatalogSearchInput";

export function AlbumsListPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { isAdmin, user } = useOperator();
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("tipo");
  const selectedType = typeParam && ALBUM_TYPES.includes(typeParam) ? typeParam : null;
  const decade = useDecadeFilter();
  const typeFacets = useAsync(albumsApi.facets, []);
  const genre = useGenreFilter({ allowRelated: true });
  const facets = useAsync(() => genresApi.facets("album"), []);
  const { data, loading, error, reload, q, offset, limit, setQuery, setOffset } = useEntityList(albumsApi.list, [user?.name], { ...genre.apiParams, ...decade.apiParams, ...(selectedType ? { albumType: selectedType } : {}) });
  const genreLabel = genreSelectionLabel(facets.data, genre.selection);
  const filtered = Boolean(q.trim()) || genreLabel !== null || selectedType !== null || decade.selection !== null;
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);
  const [artistId, setArtistId] = useState<number | null>(null);
  const [artistLabel, setArtistLabel] = useState<string | null>(null);
  const [labelId, setLabelId] = useState<number | null>(null);
  const [labelLabel, setLabelLabel] = useState<string | null>(null);

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
          <h1>Discos</h1>
        </div>
        {isAdmin ? <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ Nuevo disco</button> : null}
      </div>

      <CatalogFilters typeLabel="Tipo de disco"
        decadeActive={decade.selection !== null}
        decadeFilter={<DecadeFilter facets={typeFacets.data} error={typeFacets.error} onRetry={typeFacets.reload}
          selection={decade.selection} onSelect={decade.select} basis="release" />}
        typeActive={selectedType !== null} genreActive={genre.selection.family !== null}
        search={
          <CatalogSearchInput scope="album" value={q} onChange={setQuery}
            placeholder="Filtrar por título…" label="Filtrar discos por título" />
        }
        typeFilter={
          <TypeFilter kind="album" typeLabel={albumTypeLabel} facets={typeFacets.data}
            error={typeFacets.error} onRetry={typeFacets.reload} selectedType={selectedType} onSelect={selectType} />
        }
        genreFilter={
          <GenreFilter kind="album" facets={facets.data} facetsError={facets.error} onRetryFacets={facets.reload}
            selection={genre.selection} onFamily={genre.selectFamily} onSub={genre.selectSub} onStyle={genre.selectStyle} onRelated={genre.setRelated}
            onFamilyRelated={genre.selectFamilyRelated} />
        } />

      <ListSummary total={data?.pagination.total} noun={{ one: "disco", many: "discos" }} loading={loading}
        query={q} onClearQuery={() => setQuery("")} onClearAll={clearFilters}
        filters={[
          ...(decade.selection !== null ? [{ key: "decade", label: decadeLabel(decade.selection), onClear: () => decade.select(null) }] : []),
          ...(selectedType ? [{ key: "type", label: albumTypeLabel(selectedType), onClear: () => selectType(null) }] : []),
          ...(genreLabel ? [{ key: "genre", label: genreLabel, onClear: genre.clear }] : []),
        ]} />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <CardGridSkeleton count={12} label="Cargando discos…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState title={filtered ? "Ningún disco coincide con estos filtros" : "No hay discos para mostrar"}
          hint={filtered ? "Prueba con otro título, década, género o tipo, o quita alguno de los filtros." : undefined}
          action={filtered ? <button type="button" className="btn btn--sm" onClick={clearFilters}>Quitar filtros</button> : null} />
      ) : (
        <>
          <div className={`grid-cards${loading ? " is-refreshing" : ""}`}>
            {data.data.map((album) => (
              <EntityCard
                key={album.id}
                to={`/discos/${album.id}`}
                title={album.title}
                albumMetadata={{ artist: album.artistName, year: album.releaseYear, type: albumTypeLabel(album.albumType) }}
                imageUrl={album.coverUrl}
                imageFit="contain"
                placeholder={initialOf(album.title)}
                genre={album.primaryGenre?.name}
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
