import { useId, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { DiscographyItem } from "../lib/types";
import { albumClassificationBadges, albumTypeLabel, albumFilterTypeLabel, DISCOGRAPHY_CHIPS, discographyChipKeys } from "../lib/labels";
import { EntityCard, initialOf } from "./EntityCard";
import { FilterChip, ListSummary } from "./ListFilters";
import { Pagination } from "./Pagination";
import { CatalogSort } from "./CatalogSort";
import type { CatalogSortValue } from "../lib/useCatalogSort";
import { matchesCategorySelection, parseCategorySelection, toggleCategorySelection } from "../../../src/shared/category-selection";
import { EmptyState } from "./StateViews";

const PAGE_SIZE = 24;
const TYPE_PARAM = "discographyType";
const PAGE_PARAM = "discographyPage";
const SORT_PARAM = "discographySort";

/**
 * Discografía del artista con orden por título/año y chips de tipo: Estudio ·
 * EP · Single · Demo · Remix · En Vivo · Compilado · B-Sides, solo los que tienen
 * discos y cada uno con su número.
 */
export function ArtistDiscography({ albums, artistName, artistId }: { albums: DiscographyItem[]; artistName: string; artistId: number }) {
  const [params, setParams] = useSearchParams();
  const labelId = useId();
  const selectedTypes = useMemo(() => parseCategorySelection(params.getAll(TYPE_PARAM)).filter(value=>DISCOGRAPHY_CHIPS.some(chip=>chip.key===value)||value.startsWith("classification:")), [params]);
  const keysById = useMemo(() => new Map(albums.map((album) => [album.albumId, discographyChipKeys(album)])), [albums]);
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const keys of keysById.values()) for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const all=[...DISCOGRAPHY_CHIPS,...[...new Set([...counts.keys(),...selectedTypes])].filter(key=>!DISCOGRAPHY_CHIPS.some(chip=>chip.key===key)).map(key=>({key,label:albumFilterTypeLabel(key)}))];
    return all.filter((chip) => (counts.get(chip.key) ?? 0) > 0 || selectedTypes.includes(chip.key))
      .map((chip) => ({ ...chip, count: counts.get(chip.key) ?? 0 }));
  }, [keysById, selectedTypes]);
  const requestedSort = params.get(SORT_PARAM);
  const sort: CatalogSortValue = requestedSort === "name" || requestedSort === "name_desc" || requestedSort === "year_desc" ? requestedSort : "year_asc";
  const filteredAlbums = useMemo(() => {
    const filtered = albums.filter(album => matchesCategorySelection(keysById.get(album.albumId) ?? [], selectedTypes));
    return filtered.sort((a, b) => {
      const titleOrder = a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });
      if (sort === "name" || sort === "name_desc") return (sort === "name_desc" ? -titleOrder : titleOrder) || a.albumId - b.albumId;
      if (a.releaseYear === null && b.releaseYear !== null) return 1;
      if (b.releaseYear === null && a.releaseYear !== null) return -1;
      const yearOrder = (a.releaseYear ?? 0) - (b.releaseYear ?? 0);
      return (sort === "year_desc" ? -yearOrder : yearOrder) || titleOrder || a.albumId - b.albumId;
    });
  }, [albums, keysById, selectedTypes, sort]);
  const gridRef = useRef<HTMLDivElement>(null);
  const requestedPage = Number(params.get(PAGE_PARAM) ?? "1");
  const pageCount = Math.max(1, Math.ceil(filteredAlbums.length / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  function update(change: (next: URLSearchParams) => void) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      change(next);
      return next;
    }, { replace: true, preventScrollReset: true });
  }

  function selectType(key: string | null) {
    update((next) => {
      const selected = key === null ? [] : toggleCategorySelection(parseCategorySelection(next.getAll(TYPE_PARAM)).filter(value=>DISCOGRAPHY_CHIPS.some(chip=>chip.key===value)||value.startsWith("classification:")), key);
      if (selected.length) next.set(TYPE_PARAM, selected.join(",")); else next.delete(TYPE_PARAM);
      next.delete(PAGE_PARAM);
    });
  }

  function changePage(nextOffset: number) {
    update((next) => {
      if (nextOffset === 0) next.delete(PAGE_PARAM);
      else next.set(PAGE_PARAM, String(Math.floor(nextOffset / PAGE_SIZE) + 1));
    });
  }

  function selectSort(value: CatalogSortValue) {
    update((next) => {
      if (value === "year_asc") next.delete(SORT_PARAM); else next.set(SORT_PARAM, value);
      next.delete(PAGE_PARAM);
    });
  }

  return (
    <>
      <section className="gfilter" aria-labelledby={labelId}>
        <div className="gfilter__head">
          <h2 id={labelId} className="gfilter__label">{chips.length > 1 || selectedTypes.length ? "Filtrar por tipo" : "Discos"}</h2>
          <CatalogSort kind="album" value={sort} onChange={selectSort} />
        </div>
        {chips.length > 1 || selectedTypes.length ? (
          <>
            <p className="gfilter__hint" id={`${labelId}-hint`}>Puedes elegir varias categorías. Los discos deben cumplir todas.</p>
            <div className="gfilter__rail" role="group" aria-label="Tipos de disco de esta discografía" aria-describedby={`${labelId}-hint`}>
              <FilterChip label="Todos" count={albums.length} pressed={!selectedTypes.length} onClick={() => selectType(null)} />
              {chips.map((chip) => (
                <FilterChip key={chip.key} label={chip.label} count={chip.count} pressed={selectedTypes.includes(chip.key)}
                  onClick={() => selectType(chip.key)} />
              ))}
            </div>
          </>
        ) : null}
      </section>
      {selectedTypes.length ? <ListSummary total={filteredAlbums.length} noun={{ one: "disco", many: "discos" }} query=""
        onClearQuery={() => {}} loading={false} onClearAll={() => selectType(null)}
        filters={selectedTypes.map(key => ({ key, label: DISCOGRAPHY_CHIPS.find(chip => chip.key === key)!.label, onClear: () => selectType(key) }))} /> : null}
      {!filteredAlbums.length && selectedTypes.length ? <EmptyState title="Ningún disco coincide con estas categorías"
        hint="Quita alguna categoría para ampliar los resultados."
        action={<button type="button" className="btn btn--sm" onClick={() => selectType(null)}>Quitar categorías</button>} /> : null}
      <div ref={gridRef} className="grid-cards discography-grid pagination-start">
        {filteredAlbums.slice(offset, offset + PAGE_SIZE).map((album) => (
          <EntityCard key={album.albumId} to={`/discos/${album.albumId}`} title={album.title}
            albumMetadata={{ artist: artistName, artistId, year: album.releaseYear, type: albumTypeLabel(album.albumType), typeValue: album.albumType, categories: albumClassificationBadges(album) }}
            genres={album.genres} imageUrl={album.coverUrl} imageFit="contain" placeholder={initialOf(album.title)} />
        ))}
      </div>
      <Pagination scrollTargetRef={gridRef} limit={PAGE_SIZE} offset={offset} total={filteredAlbums.length} onOffsetChange={changePage} />
    </>
  );
}
