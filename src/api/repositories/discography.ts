// CRV · Modelo discográfico (plan del primo, etapa 2): versiones, sellos con
// rol, series, sucesión de sellos, lugares y créditos en frase (0068).
import { dateValueText, type DateValue } from "../../catalog/date-value.js";
import { getPool } from "../../db/client.js";
import { LABEL_ROLE_LABEL, type LabelRole } from "../../discography/labels.js";
import { versionHasOwnPage } from "../../discography/versions.js";
import { seriesLine } from "../../discography/series.js";
import { creditTypeForRole } from "../../merge/relations.js";

/** «Recorded, Mixed & Mastered» → recording, mixing, mastering (la frase cuenta en cada rol). */
export function roleKeysOf(roleText: string): string[] {
  const keys = roleText.split(/\s*(?:,|&|\/|\+|\band\b|\by\b)\s*/iu).map((part) => part.trim()).filter(Boolean).map((part) => creditTypeForRole(part));
  return [...new Set(keys.length ? keys : [creditTypeForRole(roleText)])];
}

export interface LabelRef { organizationId: number; name: string; role: LabelRole; roleLabel: string }

export interface AlbumVersion {
  id: number;
  position: number;
  title: string | null;
  editionTypes: string[];
  format: string | null;
  formatDetails: string | null;
  catalogNumber: string | null;
  country: string | null;
  releaseYear: number | null;
  releaseDate: string | null;
  coverUrl: string | null;
  notes: string | null;
  distinctTracks: boolean;
  discNumbers: number[];
  isPrimary: boolean;
  source: string | null;
  sourceUrl: string | null;
  /** Solo con repertorio, portada o notas propias (decisión de Brian). */
  hasOwnPage: boolean;
  labels: LabelRef[];
}

export interface SeriesMembership { id: number; title: string; volumeNumber: number | null; volumeLabel: string | null; line: string;
  previous: { albumId: number; title: string } | null; next: { albumId: number; title: string } | null }

export interface StatementPartRow { start: number; end: number; type: string; roleKey: string | null; personId: number | null;
  artistId: number | null; organizationId: number | null; placeId: number | null; year: number | null }

export interface CreditStatement { id: number; lineNumber: number; sectionKind: string; text: string; trackNumbers: number[]; parts: StatementPartRow[] }

export interface AlbumDiscography { versions: AlbumVersion[]; labels: LabelRef[]; series: SeriesMembership[]; creditStatements: CreditStatement[] }

const labelRef = (row: { organizationId: number; name: string; role: LabelRole }): LabelRef => ({ ...row, roleLabel: LABEL_ROLE_LABEL[row.role] ?? row.role });

const sourceUrlOf = (ref: string | null): string | null => ref?.match(/https?:\/\/\S+?(?=[\s)]|$)/u)?.[0] ?? null;

export async function albumDiscography(albumId: number, fallbackLabel: { id: number; name: string } | null): Promise<AlbumDiscography> {
  const pool = getPool();
  const [versions, labels, series, statements] = await Promise.all([
    pool.query<{ id: string; position: number; title: string | null; edition_types: string[]; format: string | null; format_details: string | null; catalog_number: string | null;
      country: string | null; release_year: number | null; release_date: DateValue | null; cover_url: string | null; notes: string | null;
      distinct_tracks: boolean; disc_numbers: number[]; is_primary: boolean; source: string | null; source_ref: string | null }>(`
      SELECT id::text, position, title, edition_types, format, format_details, catalog_number, country, release_year, release_date, cover_url, notes,
             distinct_tracks, disc_numbers, is_primary, source, source_ref
        FROM ingest.album_versions WHERE album_id = $1 ORDER BY is_primary DESC, position, id`, [albumId]),
    pool.query<{ version_id: string | null; organization_id: string; name: string; role: LabelRole }>(`
      SELECT l.version_id::text, l.organization_id::text, o.name, l.role
        FROM ingest.album_labels l JOIN public.organizations o ON o.id = l.organization_id
       WHERE l.album_id = $1 ORDER BY l.version_id NULLS FIRST, CASE l.role WHEN 'label' THEN 0 WHEN 'licensee' THEN 1 ELSE 2 END, l.position`, [albumId]),
    pool.query<{ id: string; title: string; volume_number: string | null; volume_label: string | null; prev_id: string | null; prev_title: string | null;
      next_id: string | null; next_title: string | null }>(`
      WITH mine AS (SELECT sa.series_id, sa.volume_number, sa.volume_label FROM ingest.series_albums sa WHERE sa.album_id = $1),
      ordered AS (
        SELECT sa.series_id, sa.album_id, a.title, sa.volume_number,
               lag(sa.album_id) OVER w AS prev_id, lag(a.title) OVER w AS prev_title,
               lead(sa.album_id) OVER w AS next_id, lead(a.title) OVER w AS next_title
          FROM ingest.series_albums sa JOIN ingest.catalog_albums a ON a.id = sa.album_id
         WHERE sa.series_id IN (SELECT series_id FROM mine)
        WINDOW w AS (PARTITION BY sa.series_id ORDER BY sa.volume_number NULLS LAST, a.release_year NULLS LAST, a.id))
      SELECT s.id::text, s.title, m.volume_number::text, m.volume_label, o.prev_id::text, o.prev_title, o.next_id::text, o.next_title
        FROM mine m JOIN ingest.series s ON s.id = m.series_id
        JOIN ordered o ON o.series_id = m.series_id AND o.album_id = $1
       ORDER BY s.title`, [albumId]),
    pool.query<{ id: string; line_number: number; section_kind: string; text: string; track_numbers: number[]; parts: StatementPartRow[] }>(`
      SELECT s.id::text, s.line_number, s.section_kind, s.text, s.track_numbers,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('start', p.start_offset, 'end', p.end_offset, 'type', p.part_type, 'roleKey', p.role_key,
                        'personId', p.person_id, 'artistId', p.artist_id, 'organizationId', p.organization_id, 'placeId', p.place_id, 'year', p.year)
                        ORDER BY p.start_offset)
                         FROM ingest.credit_statement_parts p WHERE p.statement_id = s.id), '[]'::jsonb) AS parts
        FROM ingest.credit_statements s WHERE s.album_id = $1 ORDER BY s.video_id NULLS LAST, s.line_number`, [albumId]),
  ]);
  const byVersion = new Map<string, LabelRef[]>();
  for (const row of labels.rows) {
    const key = row.version_id ?? "album";
    byVersion.set(key, [...(byVersion.get(key) ?? []), labelRef({ organizationId: Number(row.organization_id), name: row.name, role: row.role })]);
  }
  const versionRows: AlbumVersion[] = versions.rows.map((row) => {
    const version: AlbumVersion = {
      id: Number(row.id), position: row.position, title: row.title, editionTypes: row.edition_types, format: row.format, formatDetails: row.format_details, catalogNumber: row.catalog_number,
      country: row.country, releaseYear: row.release_year, releaseDate: row.release_date ? dateValueText(row.release_date) : null, coverUrl: row.cover_url,
      notes: row.notes, distinctTracks: row.distinct_tracks, discNumbers: row.disc_numbers ?? [], isPrimary: row.is_primary, source: row.source,
      sourceUrl: sourceUrlOf(row.source_ref), hasOwnPage: false, labels: byVersion.get(row.id) ?? [],
    };
    version.hasOwnPage = !version.isPrimary && versionHasOwnPage({ distinctTracks: version.distinctTracks, coverUrl: version.coverUrl, publicNotes: null });
    return version;
  });
  // Sellos de la obra: los de la versión principal y los sin versión; si no hay, el sello del núcleo.
  const primary = versionRows.find((version) => version.isPrimary);
  const albumLabels = [...(byVersion.get("album") ?? []), ...(primary?.labels ?? [])]
    .filter((label, index, all) => all.findIndex((other) => other.organizationId === label.organizationId && other.role === label.role) === index);
  if (!albumLabels.length && fallbackLabel) albumLabels.push(labelRef({ organizationId: fallbackLabel.id, name: fallbackLabel.name, role: "label" }));
  return {
    versions: versionRows,
    labels: albumLabels,
    series: series.rows.map((row) => ({
      id: Number(row.id), title: row.title, volumeNumber: row.volume_number === null ? null : Number(row.volume_number), volumeLabel: row.volume_label,
      line: seriesLine(row.title, row.volume_label),
      previous: row.prev_id ? { albumId: Number(row.prev_id), title: row.prev_title! } : null,
      next: row.next_id ? { albumId: Number(row.next_id), title: row.next_title! } : null,
    })),
    creditStatements: statements.rows.map((row) => ({
      id: Number(row.id), lineNumber: row.line_number, sectionKind: row.section_kind, text: row.text, trackNumbers: row.track_numbers ?? [], parts: row.parts,
    })),
  };
}

// ── Organización: sucesión, lugares, discos por rol y estudio ───────────────
export interface OrganizationRelation { direction: "outgoing" | "incoming"; relationType: string; other: { id: number; name: string };
  startYear: number | null; endYear: number | null; evidenceNote: string; sourceUrls: string[] }

export interface OrganizationDiscography {
  relations: OrganizationRelation[];
  places: Array<{ id: number; name: string }>;
  /** Discos donde figura como distribuidor o licenciatario (los de sello ya van en `labelAlbums`). */
  roleAlbums: Array<{ albumId: number; title: string; releaseYear: number | null; artistId: number; artistName: string; role: LabelRole; roleLabel: string }>;
  /** Discos que la nombran en sus créditos en frase («Mastered at …»), con los roles. */
  studioAlbums: Array<{ albumId: number; title: string; releaseYear: number | null; artistId: number; artistName: string; roles: string[] }>;
}

export async function organizationDiscography(organizationId: number): Promise<OrganizationDiscography> {
  const pool = getPool();
  const [relations, places, roleAlbums, studioAlbums] = await Promise.all([
    pool.query<{ direction: "outgoing" | "incoming"; relation_type: string; other_id: string; other_name: string; start_year: number | null; end_year: number | null;
      evidence_note: string; source_urls: string[] }>(`
      SELECT 'outgoing' AS direction, r.relation_type, o.id::text AS other_id, o.name AS other_name, r.start_year, r.end_year, r.evidence_note, r.source_urls
        FROM ingest.organization_relations r JOIN public.organizations o ON o.id = r.to_organization_id WHERE r.from_organization_id = $1
      UNION ALL
      SELECT 'incoming', r.relation_type, o.id::text, o.name, r.start_year, r.end_year, r.evidence_note, r.source_urls
        FROM ingest.organization_relations r JOIN public.organizations o ON o.id = r.from_organization_id WHERE r.to_organization_id = $1
      ORDER BY start_year NULLS FIRST, other_name`, [organizationId]),
    pool.query<{ id: string; name: string }>(`
      SELECT p.id::text, p.name FROM ingest.organization_places op JOIN ingest.places p ON p.id = op.place_id WHERE op.organization_id = $1 ORDER BY p.name`, [organizationId]),
    pool.query<{ album_id: string; title: string; release_year: number | null; artist_id: string; artist_name: string; role: LabelRole }>(`
      SELECT DISTINCT a.id::text AS album_id, a.title, a.release_year, ar.id::text AS artist_id, ar.name AS artist_name, l.role
        FROM ingest.album_labels l JOIN ingest.catalog_albums a ON a.id = l.album_id JOIN ingest.catalog_artists ar ON ar.id = a.artist_id
       WHERE l.organization_id = $1 AND l.role <> 'label'
       ORDER BY a.release_year NULLS LAST, a.title`, [organizationId]),
    pool.query<{ album_id: string; title: string; release_year: number | null; artist_id: string; artist_name: string; roles: Array<[string, number, number]> | null }>(`
      SELECT a.id::text AS album_id, a.title, a.release_year, ar.id::text AS artist_id, ar.name AS artist_name,
             jsonb_agg(DISTINCT jsonb_build_array(s.text, r.start_offset, r.end_offset)) FILTER (WHERE r.id IS NOT NULL) AS roles
        FROM ingest.credit_statement_parts p
        JOIN ingest.credit_statements s ON s.id = p.statement_id
        JOIN ingest.catalog_albums a ON a.id = s.album_id JOIN ingest.catalog_artists ar ON ar.id = a.artist_id
        LEFT JOIN ingest.credit_statement_parts r ON r.statement_id = s.id AND r.part_type = 'role'
       WHERE p.organization_id = $1
       GROUP BY a.id, a.title, a.release_year, ar.id, ar.name
       ORDER BY a.release_year NULLS LAST, a.title`, [organizationId]),
  ]);
  return {
    relations: relations.rows.map((row) => ({ direction: row.direction, relationType: row.relation_type, other: { id: Number(row.other_id), name: row.other_name },
      startYear: row.start_year, endYear: row.end_year, evidenceNote: row.evidence_note, sourceUrls: row.source_urls ?? [] })),
    places: places.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    roleAlbums: roleAlbums.rows.map((row) => ({ albumId: Number(row.album_id), title: row.title, releaseYear: row.release_year, artistId: Number(row.artist_id),
      artistName: row.artist_name, role: row.role, roleLabel: LABEL_ROLE_LABEL[row.role] ?? row.role })),
    studioAlbums: studioAlbums.rows.map((row) => ({ albumId: Number(row.album_id), title: row.title, releaseYear: row.release_year, artistId: Number(row.artist_id),
      artistName: row.artist_name, roles: [...new Set((row.roles ?? []).flatMap(([line, start, end]) => roleKeysOf(Array.from(line).slice(start, end).join(""))))] })),
  };
}

// ── Lugar ──────────────────────────────────────────────────────────────────
export interface PlaceDetail {
  id: number;
  name: string;
  placeType: string;
  city: string | null;
  region: string | null;
  country: string | null;
  parent: { id: number; name: string } | null;
  children: Array<{ id: number; name: string }>;
  aliases: string[];
  studios: Array<{ id: number; name: string; albumCount: number }>;
  /** Discos grabados, mezclados, masterizados… ahí, agrupados por rol. */
  albumsByRole: Array<{ roleKey: string; albums: Array<{ albumId: number; title: string; releaseYear: number | null; artistId: number; artistName: string;
    coverUrl: string | null; studios: Array<{ id: number; name: string }> }> }>;
}

export async function getPlaceDetail(id: number): Promise<PlaceDetail | null> {
  const pool = getPool();
  const place = (await pool.query<{ id: string; name: string; place_type: string; city: string | null; region: string | null; country: string | null;
    parent_id: string | null; parent_name: string | null }>(`
    SELECT p.id::text, p.name, p.place_type, p.city, p.region, p.country, pp.id::text AS parent_id, pp.name AS parent_name
      FROM ingest.places p LEFT JOIN ingest.places pp ON pp.id = p.parent_id WHERE p.id = $1`, [id])).rows[0];
  if (!place) return null;
  const [children, aliases, studios, albums] = await Promise.all([
    pool.query<{ id: string; name: string }>("SELECT id::text, name FROM ingest.places WHERE parent_id = $1 ORDER BY name", [id]),
    pool.query<{ alias: string }>("SELECT alias FROM ingest.place_aliases WHERE place_id = $1 AND NOT needs_review ORDER BY alias", [id]),
    // El lugar y los que cuelgan de él (un país incluye sus ciudades).
    pool.query<{ id: string; name: string; album_count: string }>(`
      WITH here AS (SELECT $1::bigint AS id UNION SELECT id FROM ingest.places WHERE parent_id = $1)
      SELECT o.id::text, o.name,
             (SELECT count(DISTINCT s.album_id) FROM ingest.credit_statement_parts p JOIN ingest.credit_statements s ON s.id = p.statement_id
               WHERE p.organization_id = o.id)::text AS album_count
        FROM ingest.organization_places op JOIN public.organizations o ON o.id = op.organization_id
       WHERE op.place_id IN (SELECT id FROM here)
       GROUP BY o.id ORDER BY 3 DESC, o.name`, [id]),
    pool.query<{ line: string; start_offset: number | null; end_offset: number | null; album_id: string; title: string; release_year: number | null; artist_id: string; artist_name: string; cover_url: string | null;
      studios: Array<{ id: number; name: string }> | null }>(`
      WITH here AS (SELECT $1::bigint AS id UNION SELECT id FROM ingest.places WHERE parent_id = $1),
      lines AS (SELECT DISTINCT p.statement_id FROM ingest.credit_statement_parts p WHERE p.place_id IN (SELECT id FROM here))
      SELECT s.text AS line, r.start_offset, r.end_offset,
             a.id::text AS album_id, a.title, a.release_year, ar.id::text AS artist_id, ar.name AS artist_name, a.cover_url,
             jsonb_agg(DISTINCT jsonb_build_object('id', o.id, 'name', o.name)) FILTER (WHERE o.id IS NOT NULL) AS studios
        FROM lines l
        JOIN ingest.credit_statements s ON s.id = l.statement_id
        JOIN ingest.catalog_albums a ON a.id = s.album_id JOIN ingest.catalog_artists ar ON ar.id = a.artist_id
        LEFT JOIN ingest.credit_statement_parts r ON r.statement_id = s.id AND r.part_type = 'role'
        LEFT JOIN ingest.credit_statement_parts op ON op.statement_id = s.id AND op.organization_id IS NOT NULL
        LEFT JOIN public.organizations o ON o.id = op.organization_id
       GROUP BY s.id, r.id, a.id, ar.id
       ORDER BY a.release_year NULLS LAST, a.title`, [id]),
  ]);
  const ROLE_ORDER = ["recording", "mixing", "mastering", "producer"];
  const groups = new Map<string, PlaceDetail["albumsByRole"][number]["albums"]>();
  for (const row of albums.rows) {
    const roleText = row.start_offset === null ? null : Array.from(row.line).slice(row.start_offset, row.end_offset!).join("");
    for (const key of roleText ? roleKeysOf(roleText) : ["other"]) {
      const list = groups.get(key) ?? [];
      const existing = list.find((album) => album.albumId === Number(row.album_id));
      if (existing) {
        for (const studio of row.studios ?? []) if (!existing.studios.some((item) => item.id === studio.id)) existing.studios.push(studio);
        continue;
      }
      list.push({ albumId: Number(row.album_id), title: row.title, releaseYear: row.release_year, artistId: Number(row.artist_id),
        artistName: row.artist_name, coverUrl: row.cover_url, studios: [...(row.studios ?? [])] });
      groups.set(key, list);
    }
  }
  const rank = (key: string) => { const index = ROLE_ORDER.indexOf(key); return index < 0 ? ROLE_ORDER.length : index; };
  return {
    id: Number(place.id), name: place.name, placeType: place.place_type, city: place.city, region: place.region, country: place.country,
    parent: place.parent_id ? { id: Number(place.parent_id), name: place.parent_name! } : null,
    children: children.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    aliases: aliases.rows.map((row) => row.alias).filter((alias) => alias !== place.name),
    studios: studios.rows.map((row) => ({ id: Number(row.id), name: row.name, albumCount: Number(row.album_count) })),
    albumsByRole: [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([roleKey, list]) => ({ roleKey, albums: list })),
  };
}

// ── Serie ──────────────────────────────────────────────────────────────────
export interface SeriesDetail {
  id: number;
  title: string;
  description: string | null;
  artist: { id: number; name: string } | null;
  organization: { id: number; name: string } | null;
  volumes: Array<{ albumId: number; title: string; releaseYear: number | null; coverUrl: string | null; volumeNumber: number | null; volumeLabel: string | null }>;
}

export async function getSeriesDetail(id: number): Promise<SeriesDetail | null> {
  const pool = getPool();
  const series = (await pool.query<{ id: string; title: string; description: string | null; artist_id: string | null; artist_name: string | null;
    organization_id: string | null; organization_name: string | null }>(`
    SELECT s.id::text, s.title, s.description, ar.id::text AS artist_id, ar.name AS artist_name, o.id::text AS organization_id, o.name AS organization_name
      FROM ingest.series s LEFT JOIN ingest.catalog_artists ar ON ar.id = s.artist_id LEFT JOIN public.organizations o ON o.id = s.organization_id
     WHERE s.id = $1`, [id])).rows[0];
  if (!series) return null;
  const volumes = await pool.query<{ album_id: string; title: string; release_year: number | null; cover_url: string | null; volume_number: string | null; volume_label: string | null }>(`
    SELECT a.id::text AS album_id, a.title, a.release_year, a.cover_url, sa.volume_number::text, sa.volume_label
      FROM ingest.series_albums sa JOIN ingest.catalog_albums a ON a.id = sa.album_id
     WHERE sa.series_id = $1 ORDER BY sa.volume_number NULLS LAST, a.release_year NULLS LAST, a.id`, [id]);
  return {
    id: Number(series.id), title: series.title, description: series.description,
    artist: series.artist_id ? { id: Number(series.artist_id), name: series.artist_name! } : null,
    organization: series.organization_id ? { id: Number(series.organization_id), name: series.organization_name! } : null,
    volumes: volumes.rows.map((row) => ({ albumId: Number(row.album_id), title: row.title, releaseYear: row.release_year, coverUrl: row.cover_url,
      volumeNumber: row.volume_number === null ? null : Number(row.volume_number), volumeLabel: row.volume_label })),
  };
}
