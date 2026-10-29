/** Compilado por tipo o por la característica documentada; conserva las categorías combinadas. */
export function compilationAlbumSql(alias: string): string {
  return `(${alias}.album_type = 'compilation' OR EXISTS (
    SELECT 1 FROM ingest.effective_album_classifications sc
    WHERE sc.album_id = ${alias}.id AND sc.classification = 'Compilation Album'))`;
}

/** Titular Various Artists, por nombre como en «Aparece en» (artist-appearances.ts). */
export function variousArtistsAlbumSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM public.artists va
    WHERE va.id = ${alias}.artist_id AND lower(va.name) IN ('various artists', 'varios artistas'))`;
}

/** Brian (2026-10-27): una serie pública reúne solo discos de Various Artists, sean compilados,
 *  festivales en directo u obras colectivas. Las colecciones de sello o de blog en las que cada
 *  volumen es de un solo artista, y los «Vol. 1, Vol. 2» de un artista, quedan registradas fuera de /series.
 *  Una serie con una sola entrega catalogada no agrupa nada: tampoco se publica.
 *  Excepción (0104): una serie de sesiones —ciclo de un medio con una banda por entrega,
 *  como «Sonó Así» de Urbe— se publica aunque sus entregas no sean de Various Artists. */
export function compilationSeriesSql(alias: string): string {
  return `((SELECT count(*) FROM ingest.series_albums cs JOIN ingest.catalog_albums ca ON ca.id=cs.album_id
      WHERE cs.series_id=${alias}.id) >= 2
    AND (${alias}.kind = 'sessions' OR NOT EXISTS (SELECT 1 FROM ingest.series_albums cs JOIN ingest.catalog_albums ca ON ca.id=cs.album_id
      WHERE cs.series_id=${alias}.id AND NOT ${variousArtistsAlbumSql("ca")})))`;
}
