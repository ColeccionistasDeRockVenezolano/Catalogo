import type { EntityKind, PublicGenre, SearchEntityType } from "./types";

const ENTITY_ROUTE: Record<EntityKind, string> = {
  artist: "artistas", person: "personas", organization: "organizaciones", album: "discos", track: "discos",
};

/** Ruta de la ficha de una entidad. `track` no tiene página propia: se abre su disco en esa pista. */
export function entityHref(kind: SearchEntityType, id: number, albumId?: number): string {
  if (kind === "track") return albumId !== undefined ? `/discos/${albumId}#pista-${id}` : "#";
  return `/${ENTITY_ROUTE[kind]}/${id}`;
}

export function decadeHref(year: number, kind: "album" | "artist" = "album"): string {
  const decade = Math.floor(year / 10) * 10;
  return `/${kind === "artist" ? "artistas" : "discos"}?decada=${kind === "album" && year < 1950 ? "antes-1950" : decade}`;
}

export function genreHref(genre: PublicGenre, kind: "album" | "artist" = "album"): string {
  const params = new URLSearchParams({ genero: genre.family });
  if (genre.parentGenre) { params.set("subgenero", genre.parentGenre); params.set("estilo", genre.slug); }
  else if (genre.slug !== genre.family) params.set("subgenero", genre.slug);
  return `/${kind === "artist" ? "artistas" : "discos"}?${params}`;
}
