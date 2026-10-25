// CRV · Corrida de perfiles por fuente para un artista (sin modelo de IA).
// Carga la ficha, busca al artista en cada API, confirma la identidad con los
// discos ya conocidos y vota cada campo. La usan scripts/source-profiles.ts y
// la petición general de curaduría (planner.ts). No escribe en el catálogo.
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { getEnv } from "../config/env.js";
import { buildSourceProfile, ProfileClient, resolveKnownIds, type KnownId, type SourceAttempt, type VerifiedLink } from "./source-profile-adapters.js";
import { compareArtist, compareWorks, editionless, isGenericTitle, workKey, type CatalogArtist, type ProfileSourceSlug, type SourceProfile, type WorkComparison } from "./source-profiles.js";

export const PROFILE_SOURCES: ProfileSourceSlug[] = ["musicbrainz", "discogs", "deezer", "itunes", "lastfm"];

export interface SourceProfileRun {
  artist: CatalogArtist;
  attempts: Partial<Record<ProfileSourceSlug, SourceAttempt>>;
  knownIds: Partial<Record<ProfileSourceSlug, KnownId[]>>;
  profiles: SourceProfile[];
  works: WorkComparison[];
  artistFields: ReturnType<typeof compareArtist>;
  requests: ProfileClient["requests"];
}

export interface SourceProfileRunOptions {
  cacheDir?: string;
  offline?: boolean;
  sources?: ProfileSourceSlug[];
  log?: (line: string) => void;
}

/** Caché por defecto: una captura, va al staging del SSD y se publica al cerrar. */
export const defaultProfileCache = () => path.join(process.env["CRV_STAGING"] ?? path.join(os.homedir(), "crv-staging"), "data/raw/source-profiles");

export async function loadProfileCatalog(db: Pool, id: number): Promise<{ artist: CatalogArtist; links: VerifiedLink[] }> {
  const artist = (await db.query<{ name: string; origin_country: string | null; formed_year: number | null }>("SELECT name, origin_country, formed_year FROM public.artists WHERE id=$1", [id])).rows[0];
  if (!artist) throw new Error(`no existe el artista ${id}`);
  const aliases = (await db.query<{ alias: string }>("SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1", [id])).rows.map((row) => row.alias);
  const members = (await db.query<{ name: string }>("SELECT p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1", [id])).rows.map((row) => row.name);
  const albums = (await db.query<{ id: number; title: string; release_year: number | null; album_type: string | null; has_cover: boolean; tracks: string[] | null }>(`
    SELECT a.id, a.title, a.release_year, a.album_type, a.cover_url IS NOT NULL AS has_cover,
           (SELECT array_agg(t.title ORDER BY t.disc_number, t.track_number) FROM public.tracks t WHERE t.album_id=a.id) AS tracks
      FROM public.albums a WHERE a.artist_id=$1 ORDER BY a.release_year NULLS LAST, a.id`, [id])).rows;
  // Solista: el nacimiento del titular sirve para comparar el de MusicBrainz.
  const birth = (await db.query<{ year: number | null }>(`
    SELECT min(extract(year FROM p.birth_date))::int AS year FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id
     WHERE m.artist_id=$1 AND p.birth_date IS NOT NULL`, [id])).rows[0]?.year ?? null;
  // Enlaces verificados del artista y de sus discos: llevan directo a su ficha en cada plataforma.
  const links = (await db.query<{ platform: string; external_id: string; album_title: string | null }>(`
    SELECT l.platform, l.external_id, al.title AS album_title
      FROM public.streaming_links l LEFT JOIN public.albums al ON al.id=l.album_id
     WHERE l.verified AND l.external_id IS NOT NULL AND l.platform IN ('deezer','apple_music','spotify')
       AND (l.artist_id=$1 OR al.artist_id=$1)
     ORDER BY l.album_id NULLS FIRST, l.id`, [id])).rows;
  return {
    artist: {
      id, name: artist.name, aliases, country: artist.origin_country, formedYear: artist.formed_year, birthYear: birth, memberNames: members,
      albums: albums.map((row) => ({ id: Number(row.id), title: row.title, year: row.release_year, type: row.album_type, trackTitles: row.tracks ?? [], hasCover: row.has_cover })),
    },
    links: links.map((row) => ({ platform: row.platform, externalId: row.external_id, albumTitle: row.album_title })),
  };
}

export async function runSourceProfiles(db: Pool, artistId: number, options: SourceProfileRunOptions = {}): Promise<SourceProfileRun> {
  const env = getEnv();
  const contact = env.GENRES_EXTERNAL_CONTACT?.trim();
  if (!contact) throw new Error("GENRES_EXTERNAL_CONTACT está vacío: las fuentes exigen un User-Agent con contacto");
  const log = options.log ?? (() => undefined);
  const sources = options.sources ?? PROFILE_SOURCES;
  const { artist, links } = await loadProfileCatalog(db, artistId);
  const client = new ProfileClient({
    cacheDir: options.cacheDir ?? defaultProfileCache(), userAgent: `CRV-perfiles/1.0 ( ${contact} )`, offline: options.offline ?? false,
    ...(env.DISCOGS_TOKEN ? { discogsToken: env.DISCOGS_TOKEN.trim() } : {}),
    ...(process.env["LASTFM_API_KEY"] ? { lastfmKey: process.env["LASTFM_API_KEY"].trim() } : {}),
  });
  const identityInput = {
    name: artist.name, aliases: artist.aliases, albumTitles: artist.albums.map((album) => album.title), memberNames: artist.memberNames,
    albumYears: Object.fromEntries(artist.albums.map((album) => [workKey(album.title), album.year])),
  };
  const knownIds = await resolveKnownIds(client, identityInput, links);
  // Se comparan a fondo (pistas, sello) los discos de la ficha.
  const wanted = new Set(artist.albums.map((album) => workKey(album.title)));
  const attempts: Partial<Record<ProfileSourceSlug, SourceAttempt>> = {};
  for (const source of sources) {
    const started = Date.now();
    const attempt = attempts[source] = await buildSourceProfile(client, source, identityInput, wanted, knownIds[source]);
    log(`${source}: ${attempt.outcome.status} (${attempt.outcome.reason})${attempt.error ? ` · ${attempt.error}` : ""} · ${client.requests[source]} peticiones · ${Math.round((Date.now() - started) / 1000)} s`);
  }
  // Segunda pasada: lo que ya confirmaron otras fuentes amplía la discografía
  // conocida, solo para reconocer al artista (no para votar datos): pistas de los
  // discos de la ficha y discos de los perfiles confirmados, salvo Last.fm, que
  // mezcla homónimos. Los títulos cortos («Tú») no identifican, y la identidad
  // sigue exigiendo dos títulos distintos para pasar sin el país.
  // Un disco nuevo entra solo si lo publican dos familias: un perfil de
  // plataforma puede mezclar homónimos (Salomón: 88 títulos de un Deezer
  // mezclado «confirmaban» a un Salomon finlandés en Discogs).
  const firstPass = Object.values(attempts).flatMap((attempt) => (attempt?.profile && attempt.profile.source !== "lastfm" ? [attempt.profile] : []));
  const confirmedTitles = [...new Set(compareWorks(artist, firstPass).flatMap((work) =>
    work.catalogAlbumId !== null ? work.tracks.proposed : work.families.length >= 2 ? [editionless(work.title)] : [],
  ).filter((title) => workKey(title).replace(/\s/gu, "").length >= 8 && !isGenericTitle(title)))];
  const pending = sources.filter((source) => attempts[source]?.outcome.status !== "matched");
  if (confirmedTitles.length && pending.length) {
    const expanded = { ...identityInput, albumTitles: [...identityInput.albumTitles, ...confirmedTitles] };
    for (const source of pending) {
      const retry = await buildSourceProfile(client, source, expanded, wanted, knownIds[source]);
      if (retry.outcome.status === "matched" && retry.profile) {
        retry.profile.identity.reason = `segunda pasada (títulos confirmados por otras fuentes): ${retry.profile.identity.reason}`;
        attempts[source] = retry;
      }
      log(`${source} (segunda pasada, ${confirmedTitles.length} títulos confirmados): ${retry.outcome.status} (${retry.outcome.reason})`);
    }
  }
  const profiles = Object.values(attempts).flatMap((attempt) => (attempt?.profile ? [attempt.profile] : []));
  return { artist, attempts, knownIds, profiles, works: compareWorks(artist, profiles), artistFields: compareArtist(artist, profiles), requests: client.requests };
}
