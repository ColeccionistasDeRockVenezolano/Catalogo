import { artistGallery } from "./artist-gallery.js";
import { artistDocuments } from "./artist-documents.js";
import type { ArtistDocument } from "../../shared/artist-documents.js";
import type { ArtistGalleryPhoto } from "../../shared/artist-gallery.js";
// CRV · Consultas de lectura para artistas (PHASES §E7A). SQL parametrizado
// directo (mismo estilo que src/er/repository.ts): agregaciones jsonb para
// devolver la ficha completa en una sola consulta.
import { getPool } from "../../db/client.js";
import type { PaginationQuery } from "../pagination.js";
import type { CatalogSort } from "../catalog-sort.js";
import { genreFilterSql, genreMissingSql, publicGenresFor, type PublicGenre } from "../../genres/public.js";
import type { GenreStatus } from "../../merge/genre-projection.js";
import { artistDeceasedSql, personDeceasedSql } from "./deceased.js";
import { relatedArtists, similarArtists, type RelatedArtist, type SimilarArtist } from "./artist-neighbors.js";
import { personDisplayNames, withPublicAliases } from "./person-display.js";
import { B_SIDES_SQL, LIVE_SQL } from "./albums.js";
import { ALBUM_EDITION_TYPES_SQL } from "./album-categories.js";
import { artistGroupSql } from "./artist-groups.js";
import { artistChannelVideo, type ArtistChannelVideo } from "./artist-channel-video.js";
import { dailyDate, dailyCycleForDate, type DailyCycle } from "../../shared/daily-cycle.js";
import { artistAudiovisuals, type ArtistAudiovisual } from "./artist-audiovisuals.js";
import { artistPlaybackAlbums, type ArtistPlaybackAlbum } from "./artist-playback-albums.js";

export type { ArtistRelation, ArtistRelationType, RelatedArtist, RelatedRule, SimilarArtist, SimilarRule } from "./artist-neighbors.js";

export interface ArtistListRow {
  id: number;
  name: string;
  artistType: string;
  /** Banda, solista o dúo para el público (artist-groups.ts); `artistType` sigue siendo el dato. */
  artistGroup: string;
  originCity: string | null;
  originCountry: string;
  formedYear: number | null;
  disbandedYear: number | null;
  pictureUrl: string | null;
  /** Su proyecto es de una persona fallecida (titular o único integrante). */
  isDeceased: boolean;
  /** Género propio del artista (su trayectoria): no se hereda a discos ni pistas. */
  primaryGenre: PublicGenre | null;
  genreStatus: GenreStatus;
}

export async function listArtists(
  query: PaginationQuery & {
    sort?: CatalogSort | undefined;
    q?: string | undefined;
    artistType?: string | undefined;
    decade?: number | undefined;
    withoutYear?: boolean | undefined;
    genre?: string | undefined;
    /** Solo artistas sin ningún género confirmado (ni propio ni de sus discos). */
    withoutGenre?: boolean | undefined;
  },
): Promise<{ rows: ArtistListRow[]; total: number }> {
  const orders: Record<CatalogSort, string> = {
    name: "name ASC, id ASC",
    name_desc: "name DESC, id ASC",
    year_asc: "formed_year ASC NULLS LAST, name ASC, id ASC",
    year_desc: "formed_year DESC NULLS LAST, name ASC, id ASC",
  };
  const order = orders[query.sort ?? "name"];
  const pattern = query.q ? `%${query.q}%` : null;
  // $1 nombre · $2 género (propio o de sus discos, 0036) · $3 solo sin género
  // $4 tipo de artista: un grupo (band, solo_artist, duo: artist-groups.ts) o, por
  // los enlaces viejos, el `artist_type` tal cual (project, group)
  const filters = `($1::text IS NULL OR name ILIKE $1)
          AND ($2::text IS NULL OR ${genreFilterSql("artist", "ingest.catalog_artists.id", "$2")})
          AND (NOT $3::boolean OR ${genreMissingSql("artist", "ingest.catalog_artists.id")})
          AND ($4::text IS NULL OR artist_type::text = $4 OR ${artistGroupSql("ingest.catalog_artists")} = $4)
          AND ($5::int IS NULL OR (formed_year >= $5 AND formed_year < $5 + 10))
          AND (NOT $6::boolean OR formed_year IS NULL)`;
  const params = [pattern, query.genre ?? null, query.withoutGenre ?? false, query.artistType ?? null, query.decade ?? null, query.withoutYear ?? false];
  const [rows, count] = await Promise.all([
    getPool().query<{
      id: string; name: string; artist_type: string; artist_group: string; origin_city: string | null;
      origin_country: string; formed_year: number | null; disbanded_year: number | null;
      picture_url: string | null; is_deceased: boolean;
    }>(
      `SELECT id, name, artist_type, ${artistGroupSql("ingest.catalog_artists")} AS artist_group, origin_city, origin_country, formed_year, disbanded_year, picture_url,
              ${artistDeceasedSql("ingest.catalog_artists.id")} AS is_deceased
         FROM ingest.catalog_artists
        WHERE ${filters}
        ORDER BY ${order}
        LIMIT $7 OFFSET $8`,
      [...params, query.limit, query.offset],
    ),
    getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ingest.catalog_artists WHERE ${filters}`,
      params,
    ),
  ]);
  const genres = await publicGenresFor("artist", rows.rows.map((row) => Number(row.id)));
  return {
    rows: rows.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      artistType: row.artist_type,
      artistGroup: row.artist_group,
      originCity: row.origin_city,
      originCountry: row.origin_country,
      formedYear: row.formed_year,
      disbandedYear: row.disbanded_year,
      pictureUrl: row.picture_url,
      isDeceased: row.is_deceased,
      primaryGenre: genres.get(Number(row.id))?.primaryGenre ?? null,
      genreStatus: genres.get(Number(row.id))?.genreStatus ?? "unclassified",
    })),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export interface ArtistDetail {
  documents: ArtistDocument[];
  gallery: ArtistGalleryPhoto[];
  audiovisuals: ArtistAudiovisual[];
  dailyCycle: DailyCycle;
  channelVideo: ArtistChannelVideo | null;
  id: number;
  name: string;
  artistType: string;
  /** Banda, solista o dúo para el público (artist-groups.ts). */
  artistGroup: string;
  biography: string | null;
  pictureUrl: string | null;
  /** Logo de la banda (Metal Archives); null si no hay. */
  logoUrl: string | null;
  status: string | null;
  themes: string | null;
  yearsActive: string | null;
  originCity: string | null;
  originCountry: string;
  /** Ubicación actual (campo «Currently» de RYM; 0083). */
  currentCity: string | null;
  currentCountry: string | null;
  /** Correo de contacto del artista (0094). */
  email: string | null;
  formedYear: number | null;
  disbandedYear: number | null;
  notes: string | null;
  /** Su proyecto es de una persona fallecida (titular o único integrante). */
  isDeceased: boolean;
  /** `personDisplayName`: «Nombre "Apodo" Apellido» si la persona tiene apodo (solo pantalla). */
  members: Array<{ id: number; personId: number; personName: string; personDisplayName: string | null; personRealName: string | null; personIsDeceased: boolean; role: string; personBirthDate: string | null; personBirthCity: string | null; personDeathDate: string | null; fromYear: number | null; toYear: number | null; isCurrent: boolean;
    /** Plan del primo, etapa 2: fundador con su cita y claves de la lista fija de instrumentos. */
    isFounder: boolean | null; founderEvidence: string | null; instruments: string[] }>;
  /** `isLive`: álbum en vivo o clasificación «En vivo» (LIVE_SQL); `isBSides`: B_SIDES_SQL. */
  discography: Array<{ albumId: number; title: string; releaseYear: number | null; albumType: string; coverUrl: string | null; isLive: boolean; isBSides: boolean; classifications: Array<{ classification: string }>; editionTypes: string[]; genres: PublicGenre[] }>;
  aliases: Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean; publicHidden: boolean }>;
  /** Géneros confirmados del ARTISTA; los discos tienen los suyos. */
  primaryGenre: PublicGenre | null;
  genres: PublicGenre[];
  genreStatus: GenreStatus;
  /** Enlaces públicos de sus discos (YouTube, Instagram, WordPress), uno por disco y plataforma. */
  links: Array<{ platform: "youtube" | "instagram" | "wordpress"; url: string; albumId: number; albumTitle: string }>;
  /** Perfiles de escucha del artista (streaming_links, 0039); solo los de identidad verificada. */
  platforms: Array<{ platform: string; url: string; externalId: string | null }>;
  playbackAlbums: ArtistPlaybackAlbum[];
  /** Redes sociales del artista (social_links, 0040); solo las de identidad verificada. */
  socials: Array<{ platform: string; url: string; handle: string | null }>;
  /**
   * Bandas relacionadas por reglas en orden (artist-neighbors.ts): linaje
   * documentado, integrantes en común, proyecto solista, colaboración,
   * integrante invitado y composición cruzada.
   */
  related: RelatedArtist[];
  /** Década en que arrancó (formación o, si falta, su primer disco); null si no hay año. */
  similarDecade: number | null;
  /** Similares por reglas en orden (estilo, género y década, recopilación, productor, escena, década vecina, sello, género). */
  similar: SimilarArtist[];
}

export async function getArtistDetail(id: number, date = dailyDate()): Promise<ArtistDetail | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT a.id, a.name, a.artist_type, ${artistGroupSql("a")} AS artist_group, a.biography, a.picture_url, a.logo_url, a.origin_city,
            a.origin_country, a.current_city, a.current_country, a.email, a.formed_year, a.disbanded_year, a.notes, a.status, a.themes, a.years_active,
            ${artistDeceasedSql("a.id")} AS is_deceased,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', am.id, 'personId', p.id, 'personName', p.name, 'personRealName', p.real_name, 'personIsDeceased', ${personDeceasedSql("p")}, 'role', am.role,
           'personBirthDate', p.birth_date_value, 'personBirthCity', p.birth_city, 'personDeathDate', p.death_date_value,
           'fromYear', am.from_year, 'toYear', am.to_year, 'isCurrent', am.is_current,
           'isFounder', md.is_founder, 'founderEvidence', md.founder_evidence, 'instruments', COALESCE(to_jsonb(md.instruments), '[]'::jsonb)
         ) ORDER BY am.from_year NULLS LAST, p.name)
         FROM public.artist_members am JOIN public.persons p ON p.id = am.person_id
         LEFT JOIN ingest.membership_details md ON md.artist_member_id = am.id
         WHERE am.artist_id = a.id
       ), '[]'::jsonb) AS members,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'albumId', al.id, 'title', al.title, 'releaseYear', al.release_year,
           'albumType', al.album_type, 'coverUrl', al.cover_url, 'isLive', ${LIVE_SQL}, 'isBSides', ${B_SIDES_SQL}, 'editionTypes', ${ALBUM_EDITION_TYPES_SQL},
           'classifications', (SELECT coalesce(jsonb_agg(jsonb_build_object('classification', c.classification) ORDER BY c.position, c.id), '[]'::jsonb)
                                FROM ingest.effective_album_classifications c WHERE c.album_id=al.id)
         ) ORDER BY al.release_year NULLS LAST, al.title)
         FROM ingest.catalog_albums al WHERE al.artist_id = a.id
       ), '[]'::jsonb) AS discography,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', x.id, 'alias', x.alias, 'aliasType', x.alias_type, 'isPrimary', x.is_primary))
         FROM ingest.artist_aliases x WHERE x.artist_id = a.id
       ), '[]'::jsonb) AS aliases,
       COALESCE((
         SELECT jsonb_agg(l.link ORDER BY l.year DESC NULLS LAST, l.title, l.platform)
           FROM (
             SELECT al.release_year AS year, al.title, x.platform,
                    jsonb_build_object('platform', x.platform, 'url', x.url, 'albumId', al.id, 'albumTitle', al.title) AS link
               FROM ingest.catalog_albums al
               CROSS JOIN LATERAL (VALUES ('youtube', al.youtube_url), ('instagram', al.instagram_url), ('wordpress', al.wordpress_url)) AS x(platform, url)
              WHERE al.artist_id = a.id AND x.url IS NOT NULL AND x.url <> ''
                AND NOT (x.platform = 'youtube' AND al.youtube_status IN ('unpublished', 'copyright_blocked'))
           ) l
       ), '[]'::jsonb) AS links,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('platform', sl.platform, 'url', sl.url, 'externalId', sl.external_id) ORDER BY sl.platform)
           FROM public.streaming_links sl WHERE sl.artist_id = a.id AND sl.verified
       ), '[]'::jsonb) AS platforms,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('platform', so.platform, 'url', so.url, 'handle', so.handle) ORDER BY so.platform)
           FROM public.social_links so WHERE so.artist_id = a.id AND so.verified
       ), '[]'::jsonb) AS socials
     FROM ingest.catalog_artists a
     WHERE a.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const discography = row["discography"] as ArtistDetail["discography"];
  const members = row["members"] as Array<Omit<ArtistDetail["members"][number], "personDisplayName">>;
  const [genres, related, albumGenres, displayNames, channelVideo, audiovisuals, playbackAlbums, gallery, documents] = await Promise.all([
    publicGenresFor("artist", [id]).then((byId) => byId.get(id)!),
    relatedArtists(id),
    publicGenresFor("album", discography.map(album => album.albumId)),
    personDisplayNames(members.map((member) => member.personId)),
    artistChannelVideo(id, date),
    artistAudiovisuals(id),
    artistPlaybackAlbums(id, row["platforms"] as ArtistDetail["platforms"]),
    artistGallery(id),
    artistDocuments(id),
  ]);
  return {
    dailyCycle: dailyCycleForDate(date),
    channelVideo,
    audiovisuals,
    gallery,
    documents,
    playbackAlbums,
    ...genres,
    id: Number(row["id"]),
    name: row["name"] as string,
    artistType: row["artist_type"] as string,
    artistGroup: row["artist_group"] as string,
    biography: row["biography"] as string | null,
    pictureUrl: row["picture_url"] as string | null,
    logoUrl: row["logo_url"] as string | null,
    status: row["status"] as string | null,
    themes: row["themes"] as string | null,
    yearsActive: row["years_active"] as string | null,
    originCity: row["origin_city"] as string | null,
    originCountry: row["origin_country"] as string,
    currentCity: row["current_city"] as string | null,
    currentCountry: row["current_country"] as string | null,
    email: row["email"] as string | null,
    formedYear: row["formed_year"] as number | null,
    disbandedYear: row["disbanded_year"] as number | null,
    notes: row["notes"] as string | null,
    isDeceased: row["is_deceased"] as boolean,
    members: members.map((member) => ({ ...member, personDisplayName: displayNames.get(member.personId) ?? null })),
    discography: discography.map(album => ({ ...album, genres: albumGenres.get(album.albumId)?.genres ?? [] })),
    aliases: withPublicAliases(String(row["name"]), row["aliases"] as Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean }>),
    links: row["links"] as ArtistDetail["links"],
    platforms: row["platforms"] as ArtistDetail["platforms"],
    socials: row["socials"] as ArtistDetail["socials"],
    related,
    // Lo que ya es relacionado no se repite en similares.
    ...await similarArtists(id, genres.primaryGenre, related.map((item) => item.id)),
  };
}
