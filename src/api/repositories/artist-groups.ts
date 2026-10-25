// CRV · Tipos de artista agrupados para el público (plan v2 del primo, etapa 2,
// punto 14). Solo es vista: `artists.artist_type` no se reescribe.
//
//   Bandas    = Banda + Agrupación + Proyecto con 3 o más integrantes
//   Solistas  = Solista + Proyecto con un integrante
//   Dúos      = Dúo + Proyecto con dos integrantes
//
// D5 (recomendación del plan): un proyecto sin integrantes cuenta como banda
// hasta que se sepa; una agrupación es siempre banda. Si un proyecto gana o
// pierde integrantes, cambia de grupo solo.
export const ARTIST_GROUPS = ["band", "solo_artist", "duo"] as const;
export type ArtistGroup = (typeof ARTIST_GROUPS)[number] | "other";

/** Expresión SQL con el grupo del artista; `alias` es la tabla `ingest.catalog_artists` de la consulta. */
export function artistGroupSql(alias: string): string {
  return `(CASE ${alias}.artist_type::text
    WHEN 'band' THEN 'band' WHEN 'group' THEN 'band'
    WHEN 'solo_artist' THEN 'solo_artist' WHEN 'duo' THEN 'duo'
    WHEN 'project' THEN (CASE (SELECT count(DISTINCT gm.person_id) FROM public.artist_members gm WHERE gm.artist_id = ${alias}.id)
      WHEN 1 THEN 'solo_artist' WHEN 2 THEN 'duo' ELSE 'band' END)
    ELSE 'other' END)`;
}
