/** Vocabulario común a filtros, fichas y discografías. */
export const ALBUM_CHARACTERISTICS = [
  { key: "acoustic", classification: "Acústico", label: "Acústico" },
  { key: "instrumental", classification: "Instrumental", label: "Instrumental" },
  { key: "remix", classification: "Remix", label: "Remix" },
] as const;

/** Tipos de una versión del disco; compatibles entre sí. */
export const ALBUM_EDITION_TYPES = [
  { key: "deluxe", label: "Deluxe" },
  { key: "remastered", label: "Remasterizado" },
  { key: "reissue", label: "Reedición" },
  { key: "special_edition", label: "Edición especial" },
  { key: "limited_edition", label: "Edición limitada" },
  { key: "other_edition", label: "Otra edición" },
] as const;
export type AlbumEditionType = typeof ALBUM_EDITION_TYPES[number]["key"];

/** Clasificaciones musicales editables; las piezas audiovisuales conservan su evidencia aparte. */
export const ALBUM_EDITABLE_CLASSIFICATIONS = [
  { classification: "B-Sides", label: "B-Sides" },
  { classification: "En vivo", label: "En vivo" },
  ...ALBUM_CHARACTERISTICS,
] as const;
