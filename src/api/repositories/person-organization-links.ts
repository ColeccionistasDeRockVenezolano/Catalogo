// CRV · Vínculos persona ↔ organización, directos y derivados de los créditos.
//
// Decisión de Brian (2026-11-14): en la base casi no hay vínculos directos
// (`person_organizations`), así que la ficha de persona y la de organización
// los DERIVAN de los créditos, pero solo cuando la persona trabajó con la
// organización:
//   · frase de crédito: la persona y la organización aparecen en la misma línea
//     («Grabado por X en Estudio Y»); el rol es el más cercano anterior a la persona;
//   · estudio: el mismo trabajo que la organización hizo en el disco (mezcla con
//     mezcla, grabación con grabación…); quien produjo, solo con la grabación;
//   · sello: producción ejecutiva, A&R, diseño, dirección artística o
//     coordinación de producción en un disco del sello (también como
//     distribuidor o licenciatario).
// Un músico que solo toca en un disco del sello NO queda vinculado al sello.
// Los vínculos directos se muestran primero. Solo lectura: nada se escribe.
import { getPool } from "../../db/client.js";

/** Rol de una persona que trabaja para el sello (no para el artista). */
export const LABEL_WORK_ROLE_SQL = (credit: string): string => `CASE
  WHEN ${credit}.role ~* '(execut|ejecutiv)' THEN 'executive_producer'
  WHEN ${credit}.role ~* '(^|[^a-z])a ?& ?r([^a-z]|$)' THEN 'ar'
  WHEN ${credit}.role ~* '(art(istic)? direct|direcci[oó]n (art[ií]stica|de arte)|director(a)? (art[ií]stic|de arte))' THEN 'art_direction'
  WHEN ${credit}.role ~* '(production (coordinat|manag|direct)|coordinaci[oó]n( de producci[oó]n)?|direcci[oó]n de producci|coordinat)' THEN 'production_coordination'
  WHEN ${credit}.credit_type::text = 'artwork' OR ${credit}.role ~* '(design|dise[nñ]|artwork|layout)' THEN 'design'
END`;

const STUDIO_WORK = ["recording", "mixing", "mastering", "producer"];

export type LinkVia = "direct" | "statement" | "studio" | "label";

export interface PersonOrganizationLink {
  personId: number;
  organizationId: number;
  /** Todos los caminos que unen a la pareja; «direct» si hay vínculo registrado. */
  via: LinkVia[];
  /** Claves de rol (tipos de crédito o roles de sello) y textos de los vínculos directos. */
  roles: string[];
  albumIds: number[];
  fromYear: number | null;
  toYear: number | null;
}

interface LinkRow {
  person_id: string; organization_id: string; via: LinkVia; role: string | null;
  album_id: string | null; from_year: number | null; to_year: number | null; release_year: number | null;
}

/** Une las filas por pareja persona–organización, con roles, discos y años. */
function aggregate(rows: LinkRow[]): PersonOrganizationLink[] {
  const byPair = new Map<string, PersonOrganizationLink & { years: number[] }>();
  for (const row of rows) {
    const key = `${row.person_id}:${row.organization_id}`;
    let link = byPair.get(key);
    if (!link) {
      link = { personId: Number(row.person_id), organizationId: Number(row.organization_id), via: [], roles: [], albumIds: [], fromYear: null, toYear: null, years: [] };
      byPair.set(key, link);
    }
    if (!link.via.includes(row.via)) link.via.push(row.via);
    if (row.role && !link.roles.includes(row.role)) link.roles.push(row.role);
    if (row.album_id !== null && !link.albumIds.includes(Number(row.album_id))) link.albumIds.push(Number(row.album_id));
    for (const year of [row.from_year, row.to_year, row.release_year]) if (year !== null) link.years.push(year);
  }
  return [...byPair.values()].map(({ years, ...link }) => ({
    ...link,
    via: link.via.sort((a, b) => (a === "direct" ? -1 : b === "direct" ? 1 : a.localeCompare(b))),
    fromYear: years.length ? Math.min(...years) : null,
    toYear: years.length ? Math.max(...years) : null,
  }));
}

/** Vínculos de una persona o de una organización (uno de los dos ids). */
export async function personOrganizationLinks(filter: { personId: number } | { organizationId: number }): Promise<PersonOrganizationLink[]> {
  const byPerson = "personId" in filter;
  const id = byPerson ? filter.personId : filter.organizationId;
  // Persona: primero sus créditos y luego solo los discos de esos créditos.
  // Organización: primero sus discos y luego solo los créditos de esos discos.
  const creditAlbums = "(SELECT album_id FROM person_credits)";
  const orgOf = (alias: string) => byPerson ? `AND ${alias}.album_id IN ${creditAlbums}` : `AND ${alias}.organization_id = $1`;
  const studioScope = byPerson ? creditAlbums : `(SELECT album_id FROM public.album_credits WHERE organization_id = $1
       UNION SELECT s.album_id FROM ingest.credit_statement_parts x JOIN ingest.credit_statements s ON s.id = x.statement_id WHERE x.organization_id = $1)`;
  // Los créditos a un artista que representa a la persona (ficha editorial)
  // cuentan como suyos, igual que en las vistas del catálogo. Se leen de las
  // tablas: las vistas recorren todo el catálogo antes de filtrar.
  const personCredits = byPerson ? `ref_artists AS MATERIALIZED (
       SELECT r.id FROM ingest.catalog_credit_artists r
        WHERE r.id IN (SELECT e.artist_id FROM ingest.artist_editorial_persons e WHERE e.person_id = $1) AND r.reference_person_id = $1
     ), person_credits AS MATERIALIZED (
       SELECT $1::bigint AS person_id, x.album_id, x.credit_type, x.role FROM (
         SELECT c.id, c.album_id, c.credit_type::text AS credit_type, c.role FROM public.album_credits c WHERE c.person_id = $1
         UNION SELECT c.id, c.album_id, c.credit_type::text, c.role FROM public.album_credits c WHERE c.person_id IS NULL AND c.artist_id IN (SELECT id FROM ref_artists)
       ) x
       UNION ALL
       SELECT $1::bigint, t.album_id, x.credit_type, x.role FROM (
         SELECT c.id, c.track_id, c.credit_type::text AS credit_type, c.role FROM public.track_credits c WHERE c.person_id = $1
         UNION SELECT c.id, c.track_id, c.credit_type::text, c.role FROM public.track_credits c WHERE c.person_id IS NULL AND c.artist_id IN (SELECT id FROM ref_artists)
       ) x JOIN public.tracks t ON t.id = x.track_id
     )` : `person_credits AS MATERIALIZED (
       SELECT x.person_id, x.album_id, x.credit_type, x.role FROM (
         SELECT coalesce(c.person_id, r.reference_person_id) AS person_id, c.album_id, c.credit_type::text AS credit_type, c.role
           FROM public.album_credits c LEFT JOIN ingest.catalog_credit_artists r ON r.id = c.artist_id
          WHERE c.album_id IN (SELECT album_id FROM label_albums UNION SELECT album_id FROM studio_albums)
         UNION ALL
         SELECT coalesce(c.person_id, r.reference_person_id), t.album_id, c.credit_type::text, c.role
           FROM public.tracks t JOIN public.track_credits c ON c.track_id = t.id
           LEFT JOIN ingest.catalog_credit_artists r ON r.id = c.artist_id
          WHERE t.album_id IN (SELECT album_id FROM label_albums UNION SELECT album_id FROM studio_albums)) x
        WHERE x.person_id IS NOT NULL
     )`;
  const orgAlbumsCtes = `label_albums AS MATERIALIZED (
       SELECT x.id AS album_id, x.label_id AS organization_id FROM ingest.catalog_albums x
        WHERE x.label_id IS NOT NULL ${byPerson ? `AND x.id IN ${creditAlbums}` : "AND x.label_id = $1"}
       UNION
       SELECT x.album_id, x.organization_id FROM ingest.album_labels x WHERE TRUE ${orgOf("x")}
     ), studio_all AS MATERIALIZED (
       -- Quién grabó, mezcló o masterizó cada disco del alcance (crédito o frase de crédito).
       SELECT x.album_id, x.organization_id, x.credit_type::text AS work FROM public.album_credits x
        WHERE x.organization_id IS NOT NULL AND x.credit_type::text IN ('recording','mixing','mastering') AND x.album_id IN ${studioScope}
       UNION
       SELECT s.album_id, x.organization_id, r.role_key FROM ingest.credit_statement_parts x
         JOIN ingest.credit_statements s ON s.id = x.statement_id
         JOIN ingest.credit_statement_parts r ON r.statement_id = s.id AND r.part_type = 'role' AND r.role_key IN ('recording','mixing','mastering')
        WHERE x.organization_id IS NOT NULL AND s.album_id IN ${studioScope}
     ), studio_albums AS MATERIALIZED (
       -- Solo si esa organización es la ÚNICA con ese trabajo en el disco: con dos
       -- estudios de masterización no se sabe en cuál trabajó la persona.
       SELECT sa.album_id, sa.organization_id, sa.work FROM studio_all sa
        WHERE (SELECT count(DISTINCT b.organization_id) FROM studio_all b WHERE b.album_id = sa.album_id AND b.work = sa.work) = 1
          ${byPerson ? "" : "AND sa.organization_id = $1"}
     )`;
  const { rows } = await getPool().query<LinkRow>(
    `WITH ${byPerson ? `${personCredits}, ${orgAlbumsCtes}` : `${orgAlbumsCtes}, ${personCredits}`}, links AS (
       SELECT po.person_id, po.organization_id, 'direct' AS via, nullif(po.role, '') AS role, NULL::bigint AS album_id, po.from_year, po.to_year
         FROM public.person_organizations po
        WHERE ${byPerson ? "po.person_id = $1" : "po.organization_id = $1"}
       UNION ALL
       SELECT pp.person_id, po.organization_id, 'statement', coalesce((
                SELECT r.role_key FROM ingest.credit_statement_parts r
                 WHERE r.statement_id = pp.statement_id AND r.part_type = 'role'
                 ORDER BY (r.start_offset > pp.start_offset), abs(pp.start_offset - r.start_offset) LIMIT 1), 'other'),
              s.album_id, NULL::int, NULL::int
         FROM ingest.credit_statement_parts pp
         JOIN ingest.credit_statements s ON s.id = pp.statement_id
         JOIN ingest.catalog_albums al ON al.id = s.album_id
         JOIN ingest.credit_statement_parts po ON po.statement_id = pp.statement_id AND po.organization_id IS NOT NULL
        WHERE ${byPerson ? "pp.person_id = $1" : "po.organization_id = $1 AND pp.person_id IS NOT NULL"}
       UNION ALL
       -- Mismo trabajo que el estudio; quien produjo, solo con la grabación.
       SELECT DISTINCT c.person_id, sa.organization_id, 'studio', c.credit_type, c.album_id, NULL::int, NULL::int
         FROM person_credits c JOIN studio_albums sa ON sa.album_id = c.album_id
        WHERE c.credit_type = ANY($2::text[]) AND (c.credit_type = sa.work OR (c.credit_type = 'producer' AND sa.work = 'recording'))
       UNION ALL
       SELECT w.person_id, w.organization_id, 'label', w.work, w.album_id, NULL::int, NULL::int FROM (
         SELECT c.person_id, la.organization_id, c.album_id, ${LABEL_WORK_ROLE_SQL("c")} AS work
           FROM person_credits c JOIN label_albums la ON la.album_id = c.album_id
          -- Tocar o cantar nunca es trabajar para el sello: el filtro ahorra las expresiones.
          WHERE c.credit_type NOT IN ('musician','guest','composer','writer')
       ) w WHERE w.work IS NOT NULL
     )
     SELECT l.person_id::text, l.organization_id::text, l.via, l.role, l.album_id::text, l.from_year, l.to_year, al.release_year
       FROM links l
       JOIN public.persons p ON p.id = l.person_id
       JOIN public.organizations o ON o.id = l.organization_id
       LEFT JOIN ingest.catalog_albums al ON al.id = l.album_id
      WHERE ${byPerson ? "l.person_id = $1" : "l.organization_id = $1"}
        AND (l.album_id IS NULL OR al.id IS NOT NULL)`,
    [id, STUDIO_WORK],
  );
  return aggregate(rows);
}
