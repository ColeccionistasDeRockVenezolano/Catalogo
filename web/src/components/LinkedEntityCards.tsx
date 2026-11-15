// CRV · Tarjetas de las fichas de persona y organización.
//
// Estandarización (Brian, 2026-11-14): personas y organizaciones muestran sus
// bandas, discos, organizaciones, artistas y personas con la misma tarjeta de
// imagen que artistas y discos. Reglas:
//   · una tarjeta por ficha (roles y períodos juntos);
//   · el mismo archivo de imagen no se repite en una rejilla: la segunda ficha
//     que lo usa muestra el marcador;
//   · sin imagen, marcador con ícono; nunca la foto de otra ficha;
//   · orden cronológico, sin año al final.
import { useId, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { AlbumCardData, OrganizationArtist, OrganizationLinkFields, PersonBand, PersonCreditAlbum } from "../lib/types";
import { albumClassificationBadges, albumTypeLabel, artistTypeLabel, creditTypeLabel, memberRoleLabel, roleTitle } from "../lib/labels";
import { EntityCard, initialOf } from "./EntityCard";
import { FilterChip, ListSummary } from "./ListFilters";
import { Pagination } from "./Pagination";
import { CatalogSort } from "./CatalogSort";
import type { CatalogSortValue } from "../lib/useCatalogSort";
import { EmptyState } from "./StateViews";
import { matchesCategorySelection, parseCategorySelection, toggleCategorySelection } from "../../../src/shared/category-selection";

const PAGE_SIZE = 24;

/** Misma imagen = misma ruta, sin consulta (`?w=`) ni mayúsculas. */
function imageKey(url: string): string {
  return url.split(/[?#]/u)[0]!.trim().toLowerCase();
}

/** Cada archivo de imagen solo en la primera ficha que lo usa; las demás, marcador. */
export function uniqueImages<T>(items: readonly T[], url: (item: T) => string | null | undefined): Map<T, string | null> {
  const seen = new Set<string>();
  const result = new Map<T, string | null>();
  for (const item of items) {
    const value = url(item);
    if (!value) { result.set(item, null); continue; }
    const key = imageKey(value);
    result.set(item, seen.has(key) ? null : value);
    seen.add(key);
  }
  return result;
}

/** «1978–1991», «1990», «1985–presente» o null. */
export function yearsText(from: number | null, to: number | null, current = false): string | null {
  if (from === null && to === null) return current ? "presente" : null;
  if (from !== null && to !== null && from !== to) return `${from}–${to}`;
  if (current) return `${from ?? to}–presente`;
  return String(from ?? to);
}

/** Roles de sello y de trabajo para una organización; el resto, tipo de crédito. */
const ORG_ROLE: Record<string, string> = {
  label: "Sello", distributor: "Distribución", licensee: "Licencia",
  executive_producer: "Producción ejecutiva", ar: "A&R", art_direction: "Dirección artística",
  production_coordination: "Coordinación de producción", design: "Diseño",
};
export function organizationRoleLabel(role: string): string {
  return ORG_ROLE[role] ?? (/^[a-z_]+$/u.test(role) ? creditTypeLabel(role) : roleTitle(role));
}

function joinUnique(labels: string[]): string {
  return [...new Set(labels.filter(Boolean))].join(" · ");
}

/** Rejilla paginada con la página en la URL (`param`), como la discografía del artista. */
function PagedGrid<T>({ items, pageParam, className = "grid-cards", render }: {
  items: readonly T[]; pageParam: string; className?: string; render: (item: T) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const gridRef = useRef<HTMLDivElement>(null);
  const requested = Number(params.get(pageParam) ?? "1");
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Number.isSafeInteger(requested) ? Math.min(pageCount, Math.max(1, requested)) : 1;
  const offset = (page - 1) * PAGE_SIZE;
  return (
    <>
      <div ref={gridRef} className={`${className} pagination-start`}>{items.slice(offset, offset + PAGE_SIZE).map(render)}</div>
      <Pagination scrollTargetRef={gridRef} limit={PAGE_SIZE} offset={offset} total={items.length} onOffsetChange={(nextOffset) => {
        setParams((current) => {
          const next = new URLSearchParams(current);
          if (nextOffset === 0) next.delete(pageParam); else next.set(pageParam, String(Math.floor(nextOffset / PAGE_SIZE) + 1));
          return next;
        }, { replace: true, preventScrollReset: true });
      }} />
    </>
  );
}

function albumMetadata(album: AlbumCardData) {
  return { artist: album.artistName, artistId: album.artistId, year: album.releaseYear, type: albumTypeLabel(album.albumType),
    typeValue: album.albumType, categories: albumClassificationBadges(album) };
}

// ── Persona ────────────────────────────────────────────────────────────────

/** Bandas y proyectos: una tarjeta por artista con todos sus roles y etapas. */
export function PersonBandCards({ bands }: { bands: PersonBand[] }) {
  const grouped = useMemo(() => {
    const byArtist = new Map<number, { band: PersonBand; roles: string[]; periods: string[]; firstYear: number | null }>();
    for (const band of bands) {
      const entry = byArtist.get(band.artistId) ?? { band, roles: [], periods: [], firstYear: band.fromYear };
      entry.roles.push(memberRoleLabel(band.role));
      const period = yearsText(band.fromYear, band.toYear, band.isCurrent);
      if (period) entry.periods.push(period);
      if (band.fromYear !== null && (entry.firstYear === null || band.fromYear < entry.firstYear)) entry.firstYear = band.fromYear;
      byArtist.set(band.artistId, entry);
    }
    return [...byArtist.values()].sort((a, b) => (a.firstYear ?? Infinity) - (b.firstYear ?? Infinity) || a.band.artistName.localeCompare(b.band.artistName, "es"));
  }, [bands]);
  const images = useMemo(() => uniqueImages(grouped, (entry) => entry.band.pictureUrl), [grouped]);
  return (
    <PagedGrid items={grouped} pageParam="bandasPage" render={(entry) => (
      <EntityCard key={entry.band.artistId} to={`/artistas/${entry.band.artistId}`} title={entry.band.artistName}
        imageUrl={images.get(entry) ?? null} placeholder={initialOf(entry.band.artistName)}
        subtitle={joinUnique([joinUnique(entry.roles), entry.periods.join(", ")])} />
    )} />
  );
}

/** Créditos: una tarjeta por disco; los roles de disco y de pista van en la etiqueta. */
export function PersonCreditCards({ albums }: { albums: PersonCreditAlbum[] }) {
  const images = useMemo(() => uniqueImages(albums, (album) => album.coverUrl), [albums]);
  return (
    <PagedGrid items={albums} pageParam="discosPage" className="grid-cards discography-grid" render={(album) => {
      const albumRoles = album.albumRoles.map((r) => (r.role ? roleTitle(r.role) : creditTypeLabel(r.creditType)));
      const trackRoles = album.trackRoles.map((r) => `${r.role ? roleTitle(r.role) : creditTypeLabel(r.creditType)} (${r.tracks.length} ${r.tracks.length === 1 ? "pista" : "pistas"})`);
      const detail = [...albumRoles, ...album.trackRoles.map((r) => `${r.role ? roleTitle(r.role) : creditTypeLabel(r.creditType)}: ${r.tracks.join(", ")}`)];
      return (
        <EntityCard key={album.albumId} to={`/discos/${album.albumId}`} title={album.title} albumMetadata={albumMetadata(album)}
          imageUrl={images.get(album) ?? null} imageFit="contain" placeholder={initialOf(album.title)}
          notes={[...new Set([...albumRoles, ...trackRoles])]} notesDetail={[...new Set(detail)]} />
      );
    }} />
  );
}

// ── Vínculos persona ↔ organización ────────────────────────────────────────

function viaNote(link: OrganizationLinkFields): { tag: string | null; title: string | undefined } {
  if (link.via.includes("direct")) return { tag: null, title: undefined };
  const discs = `${link.albumCount} ${link.albumCount === 1 ? "disco" : "discos"}`;
  return { tag: `Por créditos · ${discs}`, title: "Vínculo deducido de los créditos: la persona trabajó con la organización en esos discos." };
}

/** Organizaciones de una persona, o personas de una organización. */
export function OrganizationLinkCards<T extends OrganizationLinkFields & { pictureUrl: string | null }>({ links, pageParam, to, title, deceased }: {
  links: T[]; pageParam: string; to: (link: T) => string; title: (link: T) => string; deceased?: (link: T) => boolean;
}) {
  const images = useMemo(() => uniqueImages(links, (link) => link.pictureUrl), [links]);
  return (
    <PagedGrid items={links} pageParam={pageParam} render={(link) => {
      const note = viaNote(link);
      return (
        <EntityCard key={to(link)} to={to(link)} title={title(link)} imageUrl={images.get(link) ?? null}
          placeholder={initialOf(title(link))} deceased={deceased?.(link)}
          subtitle={joinUnique([joinUnique(link.roles.map(organizationRoleLabel)), yearsText(link.fromYear, link.toYear) ?? ""])}
          tag={note.tag} tagTitle={note.title} />
      );
    }} />
  );
}

// ── Organización ───────────────────────────────────────────────────────────

const ROLE_PARAM = "discographyRole";
const ROLE_PAGE_PARAM = "discographyPage";
const ROLE_SORT_PARAM = "discographySort";

/** Grupo del filtro por rol: sello, distribución, licencia, estudio, producción u otros créditos. */
const ROLE_GROUPS: Array<{ key: string; label: string; roles: string[] | null }> = [
  { key: "label", label: "Sello", roles: ["label"] },
  { key: "distributor", label: "Distribución", roles: ["distributor"] },
  { key: "licensee", label: "Licencia", roles: ["licensee"] },
  { key: "studio", label: "Estudio", roles: ["recording", "mixing", "mastering"] },
  { key: "producer", label: "Producción", roles: ["producer"] },
  { key: "other", label: "Otros créditos", roles: null },
];
const GROUPED_ROLES = new Set(ROLE_GROUPS.flatMap((group) => group.roles ?? []));

function roleGroupsOf(roles: string[]): string[] {
  return ROLE_GROUPS.filter((group) => group.roles ? roles.some((role) => group.roles!.includes(role)) : roles.some((role) => !GROUPED_ROLES.has(role)))
    .map((group) => group.key);
}

/**
 * Discografía asociada de una organización: sello, distribución, licencia y
 * estudio en una sola rejilla, un disco por tarjeta, con filtro por rol (Y)
 * y orden en la URL, como la discografía del artista.
 */
export function OrganizationDiscographyCards({ albums }: { albums: Array<AlbumCardData & { roles: string[] }> }) {
  const [params, setParams] = useSearchParams();
  const labelId = useId();
  const groupsById = useMemo(() => new Map(albums.map((album) => [album.albumId, roleGroupsOf(album.roles)])), [albums]);
  const selected = useMemo(() => parseCategorySelection(params.getAll(ROLE_PARAM)).filter((key) => ROLE_GROUPS.some((group) => group.key === key)), [params]);
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const keys of groupsById.values()) for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return ROLE_GROUPS.filter((group) => (counts.get(group.key) ?? 0) > 0 || selected.includes(group.key))
      .map((group) => ({ ...group, count: counts.get(group.key) ?? 0 }));
  }, [groupsById, selected]);
  const requestedSort = params.get(ROLE_SORT_PARAM);
  const sort: CatalogSortValue = requestedSort === "name" || requestedSort === "name_desc" || requestedSort === "year_desc" ? requestedSort : "year_asc";
  const filtered = useMemo(() => albums.filter((album) => matchesCategorySelection(groupsById.get(album.albumId) ?? [], selected)).sort((a, b) => {
    const titleOrder = a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });
    if (sort === "name" || sort === "name_desc") return (sort === "name_desc" ? -titleOrder : titleOrder) || a.albumId - b.albumId;
    if (a.releaseYear === null && b.releaseYear !== null) return 1;
    if (b.releaseYear === null && a.releaseYear !== null) return -1;
    const yearOrder = (a.releaseYear ?? 0) - (b.releaseYear ?? 0);
    return (sort === "year_desc" ? -yearOrder : yearOrder) || titleOrder || a.albumId - b.albumId;
  }), [albums, groupsById, selected, sort]);
  // Repetición de imagen sobre la lista completa en orden cronológico: no cambia al filtrar.
  const images = useMemo(() => uniqueImages(albums, (album) => album.coverUrl), [albums]);

  function update(change: (next: URLSearchParams) => void) {
    setParams((current) => { const next = new URLSearchParams(current); change(next); return next; }, { replace: true, preventScrollReset: true });
  }
  function toggle(key: string | null) {
    update((next) => {
      const keys = key === null ? [] : toggleCategorySelection(parseCategorySelection(next.getAll(ROLE_PARAM)), key);
      if (keys.length) next.set(ROLE_PARAM, keys.join(",")); else next.delete(ROLE_PARAM);
      next.delete(ROLE_PAGE_PARAM);
    });
  }

  return (
    <>
      <section className="gfilter" aria-labelledby={labelId}>
        <div className="gfilter__head">
          <h2 id={labelId} className="gfilter__label">{chips.length > 1 || selected.length ? "Filtrar por rol" : "Discos"}</h2>
          <CatalogSort kind="album" value={sort} onChange={(value) => update((next) => {
            if (value === "year_asc") next.delete(ROLE_SORT_PARAM); else next.set(ROLE_SORT_PARAM, value);
            next.delete(ROLE_PAGE_PARAM);
          })} />
        </div>
        {chips.length > 1 || selected.length ? <>
          <p className="gfilter__hint" id={`${labelId}-hint`}>Puedes elegir varios roles. Los discos deben cumplirlos todos.</p>
          <div className="gfilter__rail" role="group" aria-label="Rol de la organización en el disco" aria-describedby={`${labelId}-hint`}>
            <FilterChip label="Todos" count={albums.length} pressed={!selected.length} onClick={() => toggle(null)} />
            {chips.map((chip) => <FilterChip key={chip.key} label={chip.label} count={chip.count} pressed={selected.includes(chip.key)} onClick={() => toggle(chip.key)} />)}
          </div>
        </> : null}
      </section>
      {selected.length ? <ListSummary total={filtered.length} noun={{ one: "disco", many: "discos" }} query="" onClearQuery={() => {}} loading={false}
        onClearAll={() => toggle(null)}
        filters={selected.map((key) => ({ key, label: ROLE_GROUPS.find((group) => group.key === key)!.label, onClear: () => toggle(key) }))} /> : null}
      {!filtered.length && selected.length ? <EmptyState title="Ningún disco cumple estos roles" hint="Quita algún rol para ampliar los resultados."
        action={<button type="button" className="btn btn--sm" onClick={() => toggle(null)}>Quitar roles</button>} /> : null}
      <PagedGrid items={filtered} pageParam={ROLE_PAGE_PARAM} className="grid-cards discography-grid" render={(album) => (
        <EntityCard key={album.albumId} to={`/discos/${album.albumId}`} title={album.title} albumMetadata={albumMetadata(album)}
          imageUrl={images.get(album) ?? null} imageFit="contain" placeholder={initialOf(album.title)}
          notes={[...new Set(album.roles.map(organizationRoleLabel))]} />
      )} />
    </>
  );
}

/** Titulares de la discografía asociada: una tarjeta por artista, por su primer disco. */
export function OrganizationArtistCards({ artists }: { artists: OrganizationArtist[] }) {
  const images = useMemo(() => uniqueImages(artists, (artist) => artist.pictureUrl), [artists]);
  return (
    <PagedGrid items={artists} pageParam="artistasPage" render={(artist) => (
      <EntityCard key={artist.artistId} to={`/artistas/${artist.artistId}`} title={artist.name} imageUrl={images.get(artist) ?? null}
        placeholder={initialOf(artist.name)} typeValue={artist.artistType}
        subtitle={joinUnique([artistTypeLabel(artist.artistType), yearsText(artist.fromYear, artist.toYear) ?? ""])}
        note={`${artist.albumCount} ${artist.albumCount === 1 ? "disco" : "discos"}`} />
    )} />
  );
}
