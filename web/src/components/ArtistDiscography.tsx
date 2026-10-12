import { useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { DiscographyItem } from "../lib/types";
import { albumTypeLabel } from "../lib/labels";
import { EntityCard, initialOf } from "./EntityCard";
import { DecadeFilter } from "./DecadeFilter";
import { useDecadeFilter, decadeLabel } from "../lib/useDecadeFilter";
import { ListSummary } from "./ListFilters";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 24;

export function ArtistDiscography({ albums, artistName, artistId }: { albums: DiscographyItem[]; artistName: string; artistId: number }) {
  const [params, setParams] = useSearchParams();
  const decade = useDecadeFilter("discographyDecade", "discographyPage");
  const filteredAlbums = albums.filter(album => decade.selection === null || (decade.selection === "without-year" ?
    album.releaseYear === null : decade.selection === "before-1950" ? album.releaseYear !== null && album.releaseYear < 1950 :
      album.releaseYear !== null && album.releaseYear >= decade.selection && album.releaseYear < decade.selection + 10));
  const facets = useMemo(() => {
    const counts = new Map<number, number>();
    let withoutYear = 0;
    for (const album of albums) {
      if (album.releaseYear === null) { withoutYear++; continue; }
      const start = Math.floor(album.releaseYear / 10) * 10;
      counts.set(start, (counts.get(start) ?? 0) + 1);
    }
    return { total: albums.length, withoutYear, decades: [...counts].sort(([a], [b]) => a - b).map(([decade, count]) => ({ decade, count })) };
  }, [albums]);
  const gridRef = useRef<HTMLDivElement>(null);
  const requestedPage = Number(params.get("discographyPage") ?? "1");
  const pageCount = Math.max(1, Math.ceil(filteredAlbums.length / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  function changePage(nextOffset: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (nextOffset === 0) next.delete("discographyPage");
      else next.set("discographyPage", String(Math.floor(nextOffset / PAGE_SIZE) + 1));
      return next;
    });
  }

  return (
    <>
      <DecadeFilter facets={facets} selection={decade.selection} onSelect={decade.select} basis="release" countsLabel="Conteos de esta discografía" />
      {decade.selection !== null ? <ListSummary total={filteredAlbums.length} noun={{ one: "disco", many: "discos" }} query=""
        onClearQuery={() => {}} loading={false}
        filters={[{ key: "decade", label: decadeLabel(decade.selection), onClear: () => decade.select(null) }]} /> : null}
      {filteredAlbums.length === 0 ? <p className="etabs__empty">No hay discos para esta década. Prueba otra década o selecciona «Todas».</p> : null}
      <div ref={gridRef} className="grid-cards discography-grid pagination-start">
        {filteredAlbums.slice(offset, offset + PAGE_SIZE).map((album) => (
          <EntityCard key={album.albumId} to={`/discos/${album.albumId}`} title={album.title}
            albumMetadata={{ artist: artistName, artistId, year: album.releaseYear, type: albumTypeLabel(album.albumType), typeValue: album.albumType }}
            genres={album.genres} imageUrl={album.coverUrl} imageFit="contain" placeholder={initialOf(album.title)} />
        ))}
      </div>
      <Pagination scrollTargetRef={gridRef} limit={PAGE_SIZE} offset={offset} total={filteredAlbums.length} onOffsetChange={changePage} />
    </>
  );
}
