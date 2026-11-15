// CRV · Consultas de lectura para organizaciones (PHASES §E7A).
import { getPool } from "../../db/client.js";
import type { PaginationQuery } from "../pagination.js";
import { personDisplayNames, withPublicAliases } from "./person-display.js";
import { organizationDiscography, type OrganizationDiscography } from "./discography.js";
import { albumCardsByIds, byYearThenTitle, type AlbumCard } from "./album-cards.js";
import { personOrganizationLinks, type PersonOrganizationLink } from "./person-organization-links.js";
import { personDeceasedSql } from "./deceased.js";

export interface OrganizationListRow {
  id: number;
  name: string;
  organizationType: string;
  country: string | null;
  pictureUrl: string | null;
}

export async function listOrganizations(
  query: PaginationQuery & { q?: string | undefined; organizationType?: string | undefined },
): Promise<{ rows: OrganizationListRow[]; total: number }> {
  const pattern = query.q ? `%${query.q}%` : null;
  const [rows, count] = await Promise.all([
    getPool().query<{ id: string; name: string; organization_type: string; country: string | null; picture_url: string | null }>(
      `SELECT id, name, organization_type, country, picture_url
         FROM public.organizations
        WHERE ($1::text IS NULL OR name ILIKE $1)
          AND ($2::text IS NULL OR organization_type::text = $2)
        ORDER BY name, id
        LIMIT $3 OFFSET $4`,
      [pattern, query.organizationType ?? null, query.limit, query.offset],
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.organizations
        WHERE ($1::text IS NULL OR name ILIKE $1)
          AND ($2::text IS NULL OR organization_type::text = $2)`,
      [pattern, query.organizationType ?? null],
    ),
  ]);
  return {
    rows: rows.rows.map((row) => ({
      id: Number(row.id), name: row.name, organizationType: row.organization_type, country: row.country, pictureUrl: row.picture_url,
    })),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

/** Conteos del catálogo completo, independientes de la búsqueda y la página. */
export async function getOrganizationFacets(): Promise<{
  total: number;
  types: Array<{ organizationType: string; count: number }>;
}> {
  const { rows } = await getPool().query<{ organization_type: string; count: string }>(
    `SELECT organization_type, count(*)::text AS count
       FROM public.organizations GROUP BY organization_type
       ORDER BY count(*) DESC, organization_type`,
  );
  const types = rows.map((row) => ({ organizationType: row.organization_type, count: Number(row.count) }));
  return { total: types.reduce((sum, type) => sum + type.count, 0), types };
}

export interface OrganizationDetail {
  id: number;
  name: string;
  organizationType: string;
  biography: string | null;
  pictureUrl: string | null;
  websiteUrl: string | null;
  country: string | null;
  notes: string | null;
  labelAlbums: Array<{ albumId: number; title: string; releaseYear: number | null; artistId: number; artistName: string }>;
  creditedArtists: Array<{ artistId: number; artistName: string }>;
  associatedPersons: Array<{ id: number; personId: number; personName: string; personDisplayName: string | null; personIsDeceased: boolean; role: string; fromYear: number | null; toYear: number | null }>;
  aliases: Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean; publicHidden: boolean }>;
  /** Plan del primo, etapa 2 (0068): sucesión con fuente, lugares, discos por rol y como estudio. */
  relations: OrganizationDiscography["relations"];
  places: OrganizationDiscography["places"];
  roleAlbums: OrganizationDiscography["roleAlbums"];
  studioAlbums: OrganizationDiscography["studioAlbums"];
  /** Estandarización 2026-11-14: sello, distribución, licencia y estudio en una sola discografía. */
  albums: Array<AlbumCard & { roles: string[] }>;
  artists: Array<{ artistId: number; name: string; artistType: string; pictureUrl: string | null; albumCount: number; fromYear: number | null; toYear: number | null }>;
  personLinks: Array<Omit<PersonOrganizationLink, "personId" | "organizationId" | "albumIds"> & {
    personId: number; name: string; displayName: string | null; pictureUrl: string | null; isDeceased: boolean; albumCount: number;
  }>;
}

export async function getOrganizationDetail(id: number): Promise<OrganizationDetail | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT o.id, o.name, o.organization_type, o.biography, o.picture_url, o.website_url, o.country, o.notes,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'albumId', al.id, 'title', al.title, 'releaseYear', al.release_year,
           'artistId', ar.id, 'artistName', ar.name
         ) ORDER BY al.release_year NULLS LAST, al.title)
         FROM ingest.catalog_albums al JOIN ingest.catalog_artists ar ON ar.id = al.artist_id
         WHERE al.label_id = o.id
       ), '[]'::jsonb) AS label_albums,
       COALESCE((
         SELECT jsonb_agg(DISTINCT jsonb_build_object('artistId', ar2.id, 'artistName', ar2.name))
         FROM public.album_credits ac
         JOIN ingest.catalog_albums al2 ON al2.id = ac.album_id
         JOIN ingest.catalog_artists ar2 ON ar2.id = al2.artist_id
         WHERE ac.organization_id = o.id
       ), '[]'::jsonb) AS credited_artists,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', po.id, 'personId', p.id, 'personName', p.name, 'personIsDeceased', COALESCE(p.is_deceased, false) OR p.death_date_value IS NOT NULL, 'role', po.role,
           'fromYear', po.from_year, 'toYear', po.to_year
         ) ORDER BY p.name)
         FROM public.person_organizations po JOIN public.persons p ON p.id = po.person_id
         WHERE po.organization_id = o.id
       ), '[]'::jsonb) AS associated_persons,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', x.id, 'alias', x.alias, 'aliasType', x.alias_type, 'isPrimary', x.is_primary))
         FROM ingest.organization_aliases x WHERE x.organization_id = o.id
       ), '[]'::jsonb) AS aliases
     FROM public.organizations o
     WHERE o.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const associatedPersons = row["associated_persons"] as Array<Omit<OrganizationDetail["associatedPersons"][number], "personDisplayName">>;
  const labelAlbums = row["label_albums"] as OrganizationDetail["labelAlbums"];
  const [discography, creditRoles, links] = await Promise.all([
    organizationDiscography(id),
    getPool().query<{ album_id: string; credit_type: string }>(
      "SELECT DISTINCT album_id::text, credit_type::text FROM public.album_credits WHERE organization_id = $1", [id]),
    personOrganizationLinks({ organizationId: id }),
  ]);
  const displayNames = await personDisplayNames([...associatedPersons.map((person) => person.personId), ...links.map((link) => link.personId)]);
  // Un disco, una tarjeta: se suman los roles de cada camino (sello, distribución, estudio, crédito).
  const rolesByAlbum = new Map<number, Set<string>>();
  const addRole = (albumId: number, role: string) => {
    const roles = rolesByAlbum.get(albumId) ?? new Set<string>();
    roles.add(role);
    rolesByAlbum.set(albumId, roles);
  };
  for (const album of labelAlbums) addRole(album.albumId, "label");
  for (const album of discography.roleAlbums) addRole(album.albumId, album.role);
  for (const album of discography.studioAlbums) for (const role of album.roles.length ? album.roles : ["other"]) addRole(album.albumId, role);
  for (const credit of creditRoles.rows) addRole(Number(credit.album_id), credit.credit_type);
  const cards = await albumCardsByIds([...rolesByAlbum.keys()]);
  const albums = [...rolesByAlbum].flatMap(([albumId, roles]) => {
    const card = cards.get(albumId);
    return card ? [{ ...card, roles: [...roles] }] : [];
  }).sort(byYearThenTitle((album) => album.releaseYear, (album) => album.title));
  const [artists, personLinks] = await Promise.all([organizationArtists(albums), personLinkCards(links, displayNames)]);
  return {
    ...discography,
    albums,
    artists,
    personLinks,
    id: Number(row["id"]),
    name: row["name"] as string,
    organizationType: row["organization_type"] as string,
    biography: row["biography"] as string | null,
    pictureUrl: row["picture_url"] as string | null,
    websiteUrl: row["website_url"] as string | null,
    country: row["country"] as string | null,
    notes: row["notes"] as string | null,
    labelAlbums,
    creditedArtists: row["credited_artists"] as OrganizationDetail["creditedArtists"],
    associatedPersons: associatedPersons.map((person) => ({ ...person, personDisplayName: displayNames.get(person.personId) ?? null })),
    aliases: withPublicAliases(String(row["name"]), row["aliases"] as Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean }>),
  };
}

const VARIOUS_ARTISTS = new Set(["various artists", "varios artistas", "various", "v.a.", "va"]);

/** Titulares de la discografía asociada, una tarjeta cada uno, por su primer disco. */
async function organizationArtists(albums: OrganizationDetail["albums"]): Promise<OrganizationDetail["artists"]> {
  const byArtist = new Map<number, { albumIds: Set<number>; years: number[] }>();
  for (const album of albums) {
    const entry = byArtist.get(album.artistId) ?? { albumIds: new Set<number>(), years: [] };
    entry.albumIds.add(album.albumId);
    if (album.releaseYear !== null) entry.years.push(album.releaseYear);
    byArtist.set(album.artistId, entry);
  }
  if (!byArtist.size) return [];
  const { rows } = await getPool().query<{ id: string; name: string; artist_type: string; picture_url: string | null }>(
    `SELECT id::text, name, artist_type::text, coalesce(nullif(picture_url, ''), nullif(logo_url, '')) AS picture_url
       FROM ingest.catalog_artists WHERE id = ANY($1::bigint[])`,
    [[...byArtist.keys()]],
  );
  return rows.filter((row) => !VARIOUS_ARTISTS.has(row.name.trim().toLowerCase())).map((row) => {
    const entry = byArtist.get(Number(row.id))!;
    return { artistId: Number(row.id), name: row.name, artistType: row.artist_type, pictureUrl: row.picture_url, albumCount: entry.albumIds.size,
      fromYear: entry.years.length ? Math.min(...entry.years) : null, toYear: entry.years.length ? Math.max(...entry.years) : null };
  }).sort(byYearThenTitle((artist) => artist.fromYear, (artist) => artist.name));
}

/** Datos de tarjeta de cada persona vinculada; directas primero, luego cronológico. */
async function personLinkCards(links: PersonOrganizationLink[], displayNames: Map<number, string>): Promise<OrganizationDetail["personLinks"]> {
  if (!links.length) return [];
  const { rows } = await getPool().query<{ id: string; name: string; picture_url: string | null; is_deceased: boolean }>(
    `SELECT p.id::text, p.name, nullif(p.picture_url, '') AS picture_url, ${personDeceasedSql("p")} AS is_deceased
       FROM public.persons p WHERE p.id = ANY($1::bigint[])`,
    [links.map((link) => link.personId)],
  );
  const persons = new Map(rows.map((row) => [Number(row.id), row]));
  const chronological = byYearThenTitle<OrganizationDetail["personLinks"][number]>((link) => link.fromYear, (link) => link.displayName ?? link.name);
  return links.flatMap((link) => {
    const person = persons.get(link.personId);
    return person ? [{ personId: link.personId, name: person.name, displayName: displayNames.get(link.personId) ?? null, pictureUrl: person.picture_url,
      isDeceased: Boolean(person.is_deceased), via: link.via, roles: link.roles, albumCount: link.albumIds.length, fromYear: link.fromYear, toYear: link.toYear }] : [];
  }).sort((a, b) => Number(b.via.includes("direct")) - Number(a.via.includes("direct")) || chronological(a, b));
}
