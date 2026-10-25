// CRV · Huella del catálogo core (CONTRACT §2, PHASES F0).
//
// El hash de `crv_simple_v1.sql` prueba que el ARCHIVO no cambió, y el diff
// de `pg_dump` en los tests prueba que las MIGRACIONES no tocan `public`.
// Ninguno de los dos detecta que alguien haya alterado `public` a mano en una
// base viva. Esta huella sí: enumera enums, columnas, vistas, constraints e
// índices reales y los compara contra el snapshot commiteado
// (`core-catalog.json`), generado desde el core aplicado verbatim.
//
// Estabilidad entre versiones: la huella se verificó byte a byte idéntica en
// PostgreSQL 15 y 16 (incluidos los `pg_get_viewdef`/`pg_get_constraintdef`
// deparseados), por eso puede vivir en un snapshot fijo.
import type { Pool } from "pg";
import snapshot from "./core-catalog.json" with { type: "json" };

export interface CoreCatalogSnapshot {
  /** sha256 de crv_simple_v1.sql con el que se generó esta huella. */
  coreSha256: string;
  generatedAt: string;
  /** Entradas normalizadas y ordenadas: "ENUM …", "COL …", "VIEW …", … */
  entries: string[];
}

export const CORE_CATALOG: CoreCatalogSnapshot = snapshot as CoreCatalogSnapshot;

const CATALOG_SQL = `
  SELECT 'ENUM ' || t.typname || '(' || string_agg(e.enumlabel, '|' ORDER BY e.enumsortorder) || ')' AS entry
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE n.nspname = 'public' AND t.typtype = 'e'
   GROUP BY t.typname
  UNION ALL
  SELECT 'COL ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
         || CASE a.attidentity WHEN 'a' THEN ' IDENTITY ALWAYS'
                               WHEN 'd' THEN ' IDENTITY BY DEFAULT' ELSE '' END
         || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'VIEW ' || c.relname || ' :: ' || regexp_replace(pg_get_viewdef(c.oid, true), '\\s+', ' ', 'g')
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
  UNION ALL
  SELECT 'CONSTRAINT ' || rel.relname || '.' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'INDEX ' || indexname || ' ' || indexdef
    FROM pg_indexes
   WHERE schemaname = 'public'
`;

/** Lee la huella real del esquema `public` de una base viva. */
export async function readCoreCatalog(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ entry: string }>(CATALOG_SQL);
  return rows.map((r) => r.entry).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface CatalogDiff {
  /** En el snapshot pero no en la base: alguien borró o alteró algo del core. */
  missing: string[];
  /** En la base pero no en el snapshot: alguien añadió algo a `public`. */
  extra: string[];
}

/**
 * Cambios al core aprobados por el propietario que hace una migración: la
 * forma migrada se lee como la del core. Solo esa forma exacta; cualquier otra
 * alteración de la misma columna sigue saliendo en el diff.
 */
export const APPROVED_CORE_CHANGES: Readonly<Record<string, string>> = {
  // 0029 (2026-09-22): NULL = sin dato.
  "COL persons.is_venezuelan boolean": "COL persons.is_venezuelan boolean NOT NULL DEFAULT false",
};

/**
 * Columnas que una migración aprobada añade al core: no figuran en el
 * snapshot y no cuentan como «extra». Solo esta forma exacta.
 */
export const APPROVED_CORE_ADDITIONS: ReadonlySet<string> = new Set([
  // 0062: exact deferred parent guards for support/edition consistency.
  "CONSTRAINT albums.crv_catalog_model_parent_check TRIGGER DEFERRABLE INITIALLY DEFERRED",
  "CONSTRAINT album_formats.crv_catalog_model_parent_check TRIGGER DEFERRABLE INITIALLY DEFERRED",
  "CONSTRAINT tracks.crv_catalog_model_parent_check TRIGGER DEFERRABLE INITIALLY DEFERRED",
  // 0061: user-authorized stage 1; legacy DATE remains an exact projection.
  "COL persons.birth_date_value text",
  "COL persons.death_date_value text",
  // 0032 (2026-09-30): NULL = sin dato, true = fallecido/a.
  "COL persons.is_deceased boolean",
  // 0033 (2026-10-01): campos de la captura de Metal Archives (VE).
  "COL artists.status character varying(20)",
  "COL artists.themes text",
  "COL artists.years_active text",
  "COL artists.logo_url text",
  // 0083 (2026-10-16): la ubicación actual del artista (campo «Currently» de
  // RYM) — undécima excepción aprobada al core. Brian: «Quiero tener este dato
  // en un campo separado asi como RYM, no me gustaria perderlos».
  "COL artists.current_city character varying(120)",
  "COL artists.current_country character varying(120)",
  "COL artists.email character varying(200)",
  "COL persons.real_name character varying(200)",
  "COL persons.birth_city character varying(120)",
  "COL persons.death_cause text",
  "COL persons.trivia text",
  "COL persons.gender character varying(10)",
  "COL albums.release_date_text character varying(40)",
  "COL albums.catalog_id character varying(80)",
  "COL albums.media_format character varying(50)",
  // 0095 (2026-10-20): la puntuación agregada de RYM en la ficha del disco — media sobre 5 y
  // nº de puntuaciones. RYM no publica los votos uno a uno; esto es todo lo scrapeable.
  "COL albums.rym_rating numeric(3,2)",
  "COL albums.rym_ratings_count integer",
  // 0073 (2026-10-13): la letra de la canción en `tracks.lyrics` (novena
  // excepción aprobada al core — campaña musicavenezuela; aprobación literal:
  // «Implementa las letras para los tracks correspondientes»).
  "COL tracks.lyrics text",
  // 0039 (2026-10-04): la tabla `public.streaming_links` (enlaces a
  // plataformas de streaming por artista/álbum; sexta excepción aprobada al
  // core — «implementa todas las etapas» del plan de enlaces).
  "COL streaming_links.id bigint NOT NULL IDENTITY ALWAYS",
  "COL streaming_links.artist_id bigint",
  "COL streaming_links.album_id bigint",
  "COL streaming_links.platform character varying(24) NOT NULL",
  "COL streaming_links.url text NOT NULL",
  "COL streaming_links.external_id character varying(120)",
  "COL streaming_links.method character varying(16) NOT NULL",
  "COL streaming_links.source character varying(40) NOT NULL",
  "COL streaming_links.verified boolean NOT NULL DEFAULT false",
  "COL streaming_links.notes text",
  "COL streaming_links.created_at timestamp with time zone NOT NULL DEFAULT now()",
  "CONSTRAINT streaming_links.streaming_links_entity_ck CHECK ((num_nonnulls(artist_id, album_id) = 1))",
  "CONSTRAINT streaming_links.streaming_links_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT streaming_links.streaming_links_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT streaming_links.streaming_links_pkey PRIMARY KEY (id)",
  "INDEX streaming_links_artist_uk CREATE UNIQUE INDEX streaming_links_artist_uk ON public.streaming_links USING btree (artist_id, platform) WHERE (artist_id IS NOT NULL)",
  "INDEX streaming_links_album_uk CREATE UNIQUE INDEX streaming_links_album_uk ON public.streaming_links USING btree (album_id, platform) WHERE (album_id IS NOT NULL)",
  "INDEX streaming_links_album_idx CREATE INDEX streaming_links_album_idx ON public.streaming_links USING btree (album_id) WHERE (album_id IS NOT NULL)",
  "INDEX streaming_links_pkey CREATE UNIQUE INDEX streaming_links_pkey ON public.streaming_links USING btree (id)",
  // 0040 (2026-10-05): la tabla `public.social_links` (redes sociales del
  // artista en su propio campo; séptima excepción aprobada al core — Brian:
  // «las redes sociales deben tener su campo en la base de datos»).
  "COL social_links.id bigint NOT NULL IDENTITY ALWAYS",
  "COL social_links.artist_id bigint NOT NULL",
  "COL social_links.platform character varying(24) NOT NULL",
  "COL social_links.url text NOT NULL",
  "COL social_links.handle character varying(120)",
  "COL social_links.method character varying(16) NOT NULL",
  "COL social_links.source character varying(40) NOT NULL",
  "COL social_links.verified boolean NOT NULL DEFAULT false",
  "COL social_links.notes text",
  "COL social_links.created_at timestamp with time zone NOT NULL DEFAULT now()",
  "CONSTRAINT social_links.social_links_platform_ck CHECK (((platform)::text = ANY ((ARRAY['instagram'::character varying, 'facebook'::character varying, 'x'::character varying, 'tiktok'::character varying, 'threads'::character varying, 'bluesky'::character varying, 'website'::character varying, 'store'::character varying, 'linktree'::character varying])::text[])))",
  "CONSTRAINT social_links.social_links_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT social_links.social_links_pkey PRIMARY KEY (id)",
  "INDEX social_links_artist_uk CREATE UNIQUE INDEX social_links_artist_uk ON public.social_links USING btree (artist_id, platform)",
  "INDEX social_links_pkey CREATE UNIQUE INDEX social_links_pkey ON public.social_links USING btree (id)",
  // 0063 (2026-10-11): la tabla `public.album_discs` (nombre de cada disco
  // de un álbum; octava excepción aprobada al core — Brian: los discos
  // partidos van en una página con una lista por disco).
  "COL album_discs.id bigint NOT NULL IDENTITY ALWAYS",
  "COL album_discs.album_id bigint NOT NULL",
  "COL album_discs.disc_number smallint NOT NULL",
  "COL album_discs.title character varying(120) NOT NULL",
  "COL album_discs.notes text",
  "CONSTRAINT album_discs.album_discs_disc_number_ck CHECK (((disc_number >= 1) AND (disc_number <= 99)))",
  "CONSTRAINT album_discs.album_discs_title_ck CHECK ((length(btrim((title)::text)) > 0))",
  "CONSTRAINT album_discs.album_discs_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT album_discs.album_discs_pkey PRIMARY KEY (id)",
  "INDEX album_discs_album_disc_uk CREATE UNIQUE INDEX album_discs_album_disc_uk ON public.album_discs USING btree (album_id, disc_number)",
  "INDEX album_discs_pkey CREATE UNIQUE INDEX album_discs_pkey ON public.album_discs USING btree (id)",
  // 0063: y `public.album_disc_links` (enlace de escucha de un disco).
  "COL album_disc_links.id bigint NOT NULL IDENTITY ALWAYS",
  "COL album_disc_links.album_id bigint NOT NULL",
  "COL album_disc_links.disc_number smallint NOT NULL",
  "COL album_disc_links.platform character varying(24) NOT NULL",
  "COL album_disc_links.url text NOT NULL",
  "COL album_disc_links.external_id character varying(120)",
  "COL album_disc_links.method character varying(16) NOT NULL",
  "COL album_disc_links.source character varying(40) NOT NULL",
  "COL album_disc_links.verified boolean NOT NULL DEFAULT false",
  "COL album_disc_links.notes text",
  "COL album_disc_links.created_at timestamp with time zone NOT NULL DEFAULT now()",
  "CONSTRAINT album_disc_links.album_disc_links_disc_number_ck CHECK (((disc_number >= 1) AND (disc_number <= 99)))",
  "CONSTRAINT album_disc_links.album_disc_links_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT album_disc_links.album_disc_links_pkey PRIMARY KEY (id)",
  "INDEX album_disc_links_album_disc_platform_uk CREATE UNIQUE INDEX album_disc_links_album_disc_platform_uk ON public.album_disc_links USING btree (album_id, disc_number, platform)",
  "INDEX album_disc_links_pkey CREATE UNIQUE INDEX album_disc_links_pkey ON public.album_disc_links USING btree (id)",
  // 0081 (2026-10-16): las tablas `public.entity_metrics` (métricas de escucha
  // con fecha de captura), `public.entity_user_tags` (folksonomía cruda de
  // Last.fm), `public.entity_shouts` (comentarios de usuarios) y
  // `public.entity_emotions` (clasificación emocional por entidad) — décima
  // excepción aprobada al core, pedido de Brian: «vincules estas métricas con
  // artistas/albums/pistas y que se actualicen semanalmente… quiero las
  // opiniones de la gente… clasificación de emociones por música con laya».
  "COL entity_emotions.album_id bigint",
  "COL entity_emotions.artist_id bigint",
  "COL entity_emotions.basis character varying(16) NOT NULL",
  "COL entity_emotions.computed_at timestamp with time zone NOT NULL DEFAULT now()",
  "COL entity_emotions.detail jsonb",
  "COL entity_emotions.emotion character varying(24) NOT NULL",
  "COL entity_emotions.evidence integer NOT NULL DEFAULT 0",
  "COL entity_emotions.id bigint NOT NULL IDENTITY ALWAYS",
  "COL entity_emotions.model_version character varying(40)",
  "COL entity_emotions.score real NOT NULL DEFAULT 0",
  "COL entity_emotions.track_id bigint",
  "COL entity_metrics.album_id bigint",
  "COL entity_metrics.artist_id bigint",
  "COL entity_metrics.captured_at timestamp with time zone NOT NULL DEFAULT now()",
  "COL entity_metrics.id bigint NOT NULL IDENTITY ALWAYS",
  "COL entity_metrics.listeners bigint",
  "COL entity_metrics.playcount bigint",
  "COL entity_metrics.source character varying(24) NOT NULL",
  "COL entity_metrics.track_id bigint",
  "COL entity_shouts.album_id bigint",
  "COL entity_shouts.artist_id bigint",
  "COL entity_shouts.author character varying(120) NOT NULL",
  "COL entity_shouts.captured_at timestamp with time zone NOT NULL DEFAULT now()",
  "COL entity_shouts.emotions jsonb",
  "COL entity_shouts.fingerprint character varying(64) NOT NULL",
  "COL entity_shouts.id bigint NOT NULL IDENTITY ALWAYS",
  "COL entity_shouts.posted_at timestamp with time zone",
  "COL entity_shouts.posted_text character varying(80)",
  "COL entity_shouts.source character varying(24) NOT NULL",
  "COL entity_shouts.text text NOT NULL",
  "COL entity_shouts.track_id bigint",
  "COL entity_shouts.url text NOT NULL",
  "COL entity_user_tags.album_id bigint",
  "COL entity_user_tags.artist_id bigint",
  "COL entity_user_tags.captured_at timestamp with time zone NOT NULL DEFAULT now()",
  "COL entity_user_tags.emotions jsonb",
  "COL entity_user_tags.id bigint NOT NULL IDENTITY ALWAYS",
  "COL entity_user_tags.source character varying(24) NOT NULL",
  "COL entity_user_tags.tag character varying(250) NOT NULL",
  "COL entity_user_tags.track_id bigint",
  "COL entity_user_tags.updated_at timestamp with time zone NOT NULL DEFAULT now()",
  "COL entity_user_tags.weight integer NOT NULL DEFAULT 0",
  "CONSTRAINT entity_emotions.entity_emotions_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT entity_emotions.entity_emotions_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT entity_emotions.entity_emotions_entity_ck CHECK ((num_nonnulls(artist_id, album_id, track_id) = 1))",
  "CONSTRAINT entity_emotions.entity_emotions_pkey PRIMARY KEY (id)",
  "CONSTRAINT entity_emotions.entity_emotions_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE",
  "CONSTRAINT entity_metrics.entity_metrics_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT entity_metrics.entity_metrics_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT entity_metrics.entity_metrics_entity_ck CHECK ((num_nonnulls(artist_id, album_id, track_id) = 1))",
  "CONSTRAINT entity_metrics.entity_metrics_pkey PRIMARY KEY (id)",
  "CONSTRAINT entity_metrics.entity_metrics_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE",
  "CONSTRAINT entity_shouts.entity_shouts_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT entity_shouts.entity_shouts_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT entity_shouts.entity_shouts_entity_ck CHECK ((num_nonnulls(artist_id, album_id, track_id) = 1))",
  "CONSTRAINT entity_shouts.entity_shouts_pkey PRIMARY KEY (id)",
  "CONSTRAINT entity_shouts.entity_shouts_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE",
  "CONSTRAINT entity_user_tags.entity_user_tags_album_id_fkey FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE",
  "CONSTRAINT entity_user_tags.entity_user_tags_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE",
  "CONSTRAINT entity_user_tags.entity_user_tags_entity_ck CHECK ((num_nonnulls(artist_id, album_id, track_id) = 1))",
  "CONSTRAINT entity_user_tags.entity_user_tags_pkey PRIMARY KEY (id)",
  "CONSTRAINT entity_user_tags.entity_user_tags_tag_ck CHECK ((length(btrim((tag)::text)) > 0))",
  "CONSTRAINT entity_user_tags.entity_user_tags_track_id_fkey FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE",
  "INDEX entity_emotions_album_uk CREATE UNIQUE INDEX entity_emotions_album_uk ON public.entity_emotions USING btree (album_id, emotion, basis) WHERE (album_id IS NOT NULL)",
  "INDEX entity_emotions_artist_uk CREATE UNIQUE INDEX entity_emotions_artist_uk ON public.entity_emotions USING btree (artist_id, emotion, basis) WHERE (artist_id IS NOT NULL)",
  "INDEX entity_emotions_pkey CREATE UNIQUE INDEX entity_emotions_pkey ON public.entity_emotions USING btree (id)",
  "INDEX entity_emotions_track_uk CREATE UNIQUE INDEX entity_emotions_track_uk ON public.entity_emotions USING btree (track_id, emotion, basis) WHERE (track_id IS NOT NULL)",
  "INDEX entity_metrics_album_uk CREATE UNIQUE INDEX entity_metrics_album_uk ON public.entity_metrics USING btree (album_id, source, captured_at) WHERE (album_id IS NOT NULL)",
  "INDEX entity_metrics_artist_uk CREATE UNIQUE INDEX entity_metrics_artist_uk ON public.entity_metrics USING btree (artist_id, source, captured_at) WHERE (artist_id IS NOT NULL)",
  "INDEX entity_metrics_pkey CREATE UNIQUE INDEX entity_metrics_pkey ON public.entity_metrics USING btree (id)",
  "INDEX entity_metrics_track_uk CREATE UNIQUE INDEX entity_metrics_track_uk ON public.entity_metrics USING btree (track_id, source, captured_at) WHERE (track_id IS NOT NULL)",
  "INDEX entity_shouts_album_uk CREATE UNIQUE INDEX entity_shouts_album_uk ON public.entity_shouts USING btree (album_id, fingerprint) WHERE (album_id IS NOT NULL)",
  "INDEX entity_shouts_artist_uk CREATE UNIQUE INDEX entity_shouts_artist_uk ON public.entity_shouts USING btree (artist_id, fingerprint) WHERE (artist_id IS NOT NULL)",
  "INDEX entity_shouts_pkey CREATE UNIQUE INDEX entity_shouts_pkey ON public.entity_shouts USING btree (id)",
  "INDEX entity_shouts_track_uk CREATE UNIQUE INDEX entity_shouts_track_uk ON public.entity_shouts USING btree (track_id, fingerprint) WHERE (track_id IS NOT NULL)",
  "INDEX entity_user_tags_album_uk CREATE UNIQUE INDEX entity_user_tags_album_uk ON public.entity_user_tags USING btree (album_id, source, tag) WHERE (album_id IS NOT NULL)",
  "INDEX entity_user_tags_artist_uk CREATE UNIQUE INDEX entity_user_tags_artist_uk ON public.entity_user_tags USING btree (artist_id, source, tag) WHERE (artist_id IS NOT NULL)",
  "INDEX entity_user_tags_pkey CREATE UNIQUE INDEX entity_user_tags_pkey ON public.entity_user_tags USING btree (id)",
  "INDEX entity_user_tags_track_uk CREATE UNIQUE INDEX entity_user_tags_track_uk ON public.entity_user_tags USING btree (track_id, source, tag) WHERE (track_id IS NOT NULL)",
]);

/**
 * pg_dump volca los CHECK desde su texto deparseado y pg_restore los recrea
 * desde ese texto: una restauración fiel puede mostrar la MISMA restricción
 * con otra grafía equivalente (un `IN` de lista se depara como `ANY(ARRAY[…])`,
 * y al recrearlo los casts se reparten por elemento:
 *   `((ARRAY['a'::character varying, …])::text[])`  ← en la base viva
 *   `(ARRAY[('a'::character varying)::text, …])`    ← en la copia restaurada
 * — comprobado el 2026-10-10 con postgres:16 (dump custom + restore).
 * Se normalizan ambas grafías en los DOS lados de la comparación para que una
 * restauración fiel no figure como drift. La lista de valores, el operador y
 * el resto de la entrada siguen comparándose literalmente: un cambio real
 * (valor añadido, operador distinto) se sigue delatando.
 */
function canonicalConstraintSpelling(entry: string): string {
  return entry
    .replace(/\(('(?:[^']|'')*'::character varying)\)::text/g, "$1")
    .replace(/\(ARRAY\[([^\]]*)\]\)::text\[\]/g, "ARRAY[$1]");
}

export function diffCoreCatalog(actual: string[], expected: string[] = CORE_CATALOG.entries): CatalogDiff {
  // La membresía en las listas aprobadas se prueba ya normalizada: una copia
  // restaurada con otra grafía equivalente no debe escapar del filtro.
  const approvedAdditions = new Set([...APPROVED_CORE_ADDITIONS].map(canonicalConstraintSpelling));
  const approvedChanges = new Map(
    Object.entries(APPROVED_CORE_CHANGES).map(([from, to]) => [canonicalConstraintSpelling(from), canonicalConstraintSpelling(to)]),
  );
  actual = actual
    .map(canonicalConstraintSpelling)
    .filter((entry) => !approvedAdditions.has(entry))
    .map((entry) => approvedChanges.get(entry) ?? entry);
  expected = expected.map(canonicalConstraintSpelling);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((e) => !actualSet.has(e)),
    extra: actual.filter((e) => !expectedSet.has(e)),
  };
}
