// CRV · Adaptadores de perfiles por fuente (Deezer, iTunes, MusicBrainz,
// Discogs, Last.fm). Solo APIs documentadas, sin modelo de IA.
//
// Cada adaptador hace dos cosas: buscar candidatos con su discografía (para
// que `identity.ts` decida si es el mismo artista comparando discos ya
// conocidos) y, del candidato confirmado, armar su perfil: discos con año,
// pistas, sello y portada. Las pistas se piden solo para los discos que ya
// están en la ficha o que se quieren comparar (`wanted`): cada petición cuenta
// contra el límite de la fuente.
//
// Toda respuesta queda guardada en la caché de archivos con su URL y su fecha;
// repetir una corrida no vuelve a pedir lo mismo.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeIdentitySecondary } from "../normalization/claims.js";
import { createRateLimitedFetcher, type JsonFetcher } from "../genres/external/http.js";
import { decideMatch, scoreArtistCandidate, type ArtistIdentityInput, type ExternalCandidate, type MatchOutcome } from "../genres/external/identity.js";
import { editionless, isGenericTitle, singleTitleCheck, workKey, type ProfileRelease, type ProfileSourceSlug, type SourceProfile } from "./source-profiles.js";

export interface ProfileFetchOptions {
  cacheDir: string;
  userAgent: string;
  discogsToken?: string;
  lastfmKey?: string;
  /** Solo caché: si falta una respuesta, no se sale a la red. */
  offline?: boolean;
}

/** Peticiones por minuto, por debajo del límite publicado de cada fuente. */
const RATE: Record<ProfileSourceSlug, number> = { deezer: 120, itunes: 18, musicbrainz: 50, discogs: 50, lastfm: 120 };
/** Candidatos de la búsqueda que se completan con su discografía. */
const HYDRATE = 4;

export class ProfileClient {
  private readonly fetchers = new Map<ProfileSourceSlug, JsonFetcher>();
  readonly requests: Record<ProfileSourceSlug, number> = { deezer: 0, itunes: 0, musicbrainz: 0, discogs: 0, lastfm: 0 };
  constructor(private readonly options: ProfileFetchOptions) {}

  async json(source: ProfileSourceSlug, url: string): Promise<unknown> {
    const file = path.join(this.options.cacheDir, source, `${createHash("sha1").update(url).digest("hex")}.json`);
    try {
      return (JSON.parse(await readFile(file, "utf8")) as { payload: unknown }).payload;
    } catch { /* sin caché */ }
    if (this.options.offline) throw new Error(`sin caché para ${url}`);
    let fetcher = this.fetchers.get(source);
    if (!fetcher) { fetcher = createRateLimitedFetcher(RATE[source], { timeoutMs: 30_000 }); this.fetchers.set(source, fetcher); }
    const headers: Record<string, string> = { "user-agent": this.options.userAgent, accept: "application/json" };
    // El token viaja en la cabecera, nunca en la URL: la caché guarda la URL.
    if (source === "discogs") {
      if (!this.options.discogsToken) throw new Error("falta DISCOGS_TOKEN");
      headers["authorization"] = `Discogs token=${this.options.discogsToken}`;
    }
    const response = await fetcher(source === "lastfm" ? `${url}&api_key=${this.options.lastfmKey ?? ""}` : url, headers);
    this.requests[source] += 1;
    if (response.status >= 400) throw new Error(`HTTP ${response.status} en ${url}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ url, status: response.status, fetchedAt: new Date().toISOString(), payload: response.payload }));
    return response.payload;
  }
}

type Json = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const id = (value: unknown): string | null => (typeof value === "number" ? String(value) : text(value));
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((item): item is Json => !!item && typeof item === "object") : []);
const yearOf = (value: unknown): number | null => {
  const match = /^(\d{4})/u.exec(typeof value === "number" ? String(value) : (text(value) ?? ""));
  const year = match ? Number(match[1]) : null;
  return year && year >= 1900 && year <= 2100 ? year : null;
};
const COUNTRY: Record<string, string> = { VE: "Venezuela", CO: "Colombia", ES: "España", US: "Estados Unidos", MX: "México", AR: "Argentina" };
const venezuelan = (value: string | null) => (value && /venezuel/iu.test(value) ? "Venezuela" : null);

/** Candidato con el año de cada obra, para comprobar un único disco en común. */
export type ProfileCandidate = ExternalCandidate & { releaseYears?: Record<string, number | null> };
function yearsOf<T>(items: T[], titleOf: (item: T) => string | null, yearOfItem: (item: T) => number | null): Record<string, number | null> {
  const years: Record<string, number | null> = {};
  for (const item of items) {
    const title = titleOf(item);
    if (!title) continue;
    const key = workKey(title), year = yearOfItem(item);
    // La obra se fecha por su edición más antigua.
    if (!(key in years) || (year !== null && (years[key] === null || year < years[key]!))) years[key] = year;
  }
  return years;
}

/** Discogs distingue homónimos con «(5)»: no es parte del nombre. */
const bareName = (value: string | null) => value?.replace(/\s\(\d+\)$/u, "") ?? null;

/** Primero los candidatos que se llaman igual que la ficha (todos ellos, hasta el doble del cupo). */
function exactFirst<T>(name: string, items: T[], nameOf: (item: T) => string | null): T[] {
  const wanted = normalizeIdentitySecondary(name);
  const exact = items.filter((item) => normalizeIdentitySecondary(bareName(nameOf(item)) ?? "") === wanted).slice(0, HYDRATE * 2);
  return [...exact, ...items.filter((item) => !exact.includes(item))].slice(0, Math.max(HYDRATE, exact.length));
}

interface Adapter {
  search(client: ProfileClient, name: string): Promise<ProfileCandidate[]>;
  /** Candidato por identificador ya verificado en la ficha. */
  byId?(client: ProfileClient, externalId: string): Promise<ProfileCandidate | null>;
  /**
   * Búsqueda por disco conocido: con un nombre común el artista puede no salir
   * entre los primeros resultados, pero «Jeremías – Un día más en el gran
   * circo» lleva directo a su ficha. Devuelve los candidatos de esos resultados.
   */
  searchByTitles?(client: ProfileClient, name: string, titles: string[]): Promise<ProfileCandidate[]>;
  profile(client: ProfileClient, candidate: ExternalCandidate, wanted: Set<string>): Promise<Omit<SourceProfile, "identity" | "requests">>;
}

// --- Deezer ----------------------------------------------------------------

async function deezerCandidate(client: ProfileClient, artistId: string, name: string | null): Promise<ProfileCandidate> {
  const albums = list(((await client.json("deezer", `https://api.deezer.com/artist/${artistId}/albums?limit=100`)) as Json)["data"]);
  return {
    externalId: artistId, name: name ?? artistId, url: `https://www.deezer.com/artist/${artistId}`, releaseTitles: albums.flatMap((album) => text(album["title"]) ?? []),
    releaseYears: yearsOf(albums, (album) => text(album["title"]), (album) => yearOf(album["release_date"])),
  };
}

const deezer: Adapter = {
  async byId(client, artistId) {
    const artist = (await client.json("deezer", `https://api.deezer.com/artist/${artistId}`)) as Json;
    return artist["error"] ? null : deezerCandidate(client, artistId, text(artist["name"]));
  },
  async search(client, name) {
    const found = list(((await client.json("deezer", `https://api.deezer.com/search/artist?limit=10&q=${encodeURIComponent(name)}`)) as Json)["data"]);
    const candidates: ProfileCandidate[] = [];
    for (const artist of exactFirst(name, found, (item) => text(item["name"]))) {
      const artistId = id(artist["id"]);
      if (artistId) candidates.push(await deezerCandidate(client, artistId, text(artist["name"])));
    }
    return candidates;
  },
  async searchByTitles(client, name, titles) {
    const ids = new Map<string, string | null>();
    for (const title of titles) {
      const query = `artist:"${name}" album:"${title}"`;
      for (const album of list(((await client.json("deezer", `https://api.deezer.com/search/album?limit=10&q=${encodeURIComponent(query)}`)) as Json)["data"])) {
        const artist = (album["artist"] ?? {}) as Json;
        const artistId = id(artist["id"]);
        if (artistId && workKey(text(album["title"]) ?? "") === workKey(title)) ids.set(artistId, text(artist["name"]));
      }
    }
    return Promise.all([...ids].map(([artistId, artistName]) => deezerCandidate(client, artistId, artistName)));
  },
  async profile(client, candidate, wanted) {
    const albums = list(((await client.json("deezer", `https://api.deezer.com/artist/${candidate.externalId}/albums?limit=100`)) as Json)["data"]);
    const releases: ProfileRelease[] = [];
    for (const album of albums) {
      const albumId = id(album["id"]);
      const title = text(album["title"]);
      if (!albumId || !title) continue;
      // La ficha del disco (pistas, sello) solo para lo que se compara.
      const full = wanted.has(workKey(title)) ? (await client.json("deezer", `https://api.deezer.com/album/${albumId}`)) as Json : null;
      releases.push({
        externalId: albumId, title, year: yearOf(full?.["release_date"] ?? album["release_date"]),
        type: text(album["record_type"]), trackCount: typeof full?.["nb_tracks"] === "number" ? full["nb_tracks"] : null,
        tracks: list((full?.["tracks"] as Json | undefined)?.["data"]).flatMap((track) => text(track["title"]) ?? []),
        label: text(full?.["label"]), coverUrl: text(album["cover_xl"]), url: `https://www.deezer.com/album/${albumId}`,
      });
    }
    return { source: "deezer", externalId: candidate.externalId, name: candidate.name, url: candidate.url ?? null, country: null, beginYear: null, tags: [], releases };
  },
};

// --- iTunes ----------------------------------------------------------------

const ITUNES = "https://itunes.apple.com";
const itunesLabel = (copyright: string | null) => copyright?.replace(/^(℗|©|\(p\)|\(c\))\s*/iu, "").replace(/^\d{4}\s+/u, "").trim() || null;

async function itunesCandidate(client: ProfileClient, artistId: string): Promise<ProfileCandidate | null> {
  const rows = list(((await client.json("itunes", `${ITUNES}/lookup?entity=album&limit=200&id=${artistId}`)) as Json)["results"]);
  const artist = rows.find((row) => row["wrapperType"] === "artist");
  if (!artist) return null;
  const albums = rows.filter((row) => row["wrapperType"] === "collection");
  return {
    externalId: artistId, name: text(artist["artistName"]) ?? artistId, url: text(artist["artistLinkUrl"]),
    releaseTitles: albums.flatMap((row) => text(row["collectionName"]) ?? []),
    releaseYears: yearsOf(albums, (row) => text(row["collectionName"]), (row) => yearOf(row["releaseDate"])),
  };
}

const itunes: Adapter = {
  byId: itunesCandidate,
  async searchByTitles(client, name, titles) {
    const ids = new Set<string>();
    for (const title of titles) {
      const found = list(((await client.json("itunes", `${ITUNES}/search?entity=album&limit=10&term=${encodeURIComponent(`${name} ${title}`)}`)) as Json)["results"]);
      for (const album of found) {
        const artistId = id(album["artistId"]);
        if (artistId && workKey(text(album["collectionName"]) ?? "") === workKey(title) && normalizeIdentitySecondary(text(album["artistName"]) ?? "") === normalizeIdentitySecondary(name)) ids.add(artistId);
      }
    }
    const candidates: ProfileCandidate[] = [];
    for (const artistId of ids) { const candidate = await itunesCandidate(client, artistId); if (candidate) candidates.push(candidate); }
    return candidates;
  },
  async search(client, name) {
    const found = list(((await client.json("itunes", `${ITUNES}/search?entity=musicArtist&limit=10&term=${encodeURIComponent(name)}`)) as Json)["results"]);
    const candidates: ProfileCandidate[] = [];
    for (const artist of exactFirst(name, found, (item) => text(item["artistName"]))) {
      const artistId = id(artist["artistId"]);
      const candidate = artistId ? await itunesCandidate(client, artistId) : null;
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  },
  async profile(client, candidate, wanted) {
    const rows = list(((await client.json("itunes", `${ITUNES}/lookup?entity=album&limit=200&id=${candidate.externalId}`)) as Json)["results"]);
    const artist = rows.find((row) => row["wrapperType"] === "artist");
    const releases: ProfileRelease[] = [];
    for (const row of rows.filter((item) => item["wrapperType"] === "collection")) {
      const collectionId = id(row["collectionId"]);
      const title = text(row["collectionName"]);
      if (!collectionId || !title) continue;
      const songs = wanted.has(workKey(title))
        ? list(((await client.json("itunes", `${ITUNES}/lookup?entity=song&limit=200&id=${collectionId}`)) as Json)["results"]).filter((item) => item["wrapperType"] === "track")
        : [];
      songs.sort((a, b) => Number(a["discNumber"] ?? 1) - Number(b["discNumber"] ?? 1) || Number(a["trackNumber"] ?? 0) - Number(b["trackNumber"] ?? 0));
      releases.push({
        externalId: collectionId, title, year: yearOf(row["releaseDate"]),
        type: /\s-\s(single|ep)$/iu.exec(title)?.[1]?.toLowerCase() ?? text(row["collectionType"])?.toLowerCase() ?? null,
        trackCount: typeof row["trackCount"] === "number" ? row["trackCount"] : null,
        tracks: songs.flatMap((song) => text(song["trackName"]) ?? []),
        label: itunesLabel(text(row["copyright"])),
        coverUrl: text(row["artworkUrl100"])?.replace(/100x100bb/u, "1000x1000bb") ?? null,
        url: text(row["collectionViewUrl"]),
      });
    }
    return { source: "itunes", externalId: candidate.externalId, name: candidate.name, url: candidate.url ?? null, country: null, beginYear: null, tags: text(artist?.["primaryGenreName"]) ? [text(artist?.["primaryGenreName"])!] : [], releases };
  },
};

// --- MusicBrainz -----------------------------------------------------------

const MB = "https://musicbrainz.org/ws/2";
const escapeLucene = (value: string) => value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/gu, "\\$1");
const mbArtist = async (client: ProfileClient, artistId: string) =>
  (await client.json("musicbrainz", `${MB}/artist/${artistId}?inc=genres+tags+release-groups&fmt=json`)) as Json;

async function mbCandidate(client: ProfileClient, artistId: string): Promise<ProfileCandidate> {
  const full = await mbArtist(client, artistId);
  return {
    externalId: artistId, name: text(full["name"]) ?? artistId, url: `https://musicbrainz.org/artist/${artistId}`,
    disambiguation: text(full["disambiguation"]), country: text(full["country"]), areaName: text((full["area"] as Json | null)?.["name"]),
    beginYear: yearOf((full["life-span"] as Json | null)?.["begin"]),
    releaseTitles: list(full["release-groups"]).flatMap((group) => text(group["title"]) ?? []),
    releaseYears: yearsOf(list(full["release-groups"]), (group) => text(group["title"]), (group) => yearOf(group["first-release-date"])),
  };
}

const musicbrainz: Adapter = {
  async searchByTitles(client, name, titles) {
    const ids = new Set<string>();
    for (const title of titles) {
      const query = `releasegroup:"${escapeLucene(title)}" AND artist:"${escapeLucene(name)}"`;
      for (const group of list(((await client.json("musicbrainz", `${MB}/release-group?fmt=json&limit=10&query=${encodeURIComponent(query)}`)) as Json)["release-groups"])) {
        if (workKey(text(group["title"]) ?? "") !== workKey(title)) continue;
        for (const credit of list(group["artist-credit"])) {
          const artist = (credit["artist"] ?? {}) as Json;
          if (text(artist["id"]) && normalizeIdentitySecondary(text(artist["name"]) ?? "") === normalizeIdentitySecondary(name)) ids.add(text(artist["id"])!);
        }
      }
    }
    return Promise.all([...ids].map((artistId) => mbCandidate(client, artistId)));
  },
  async search(client, name) {
    const found = list(((await client.json("musicbrainz", `${MB}/artist?fmt=json&limit=8&query=${encodeURIComponent(`artist:"${escapeLucene(name)}"`)}`)) as Json)["artists"]);
    const candidates: ProfileCandidate[] = [];
    for (const artist of exactFirst(name, found, (item) => text(item["name"]))) {
      const artistId = text(artist["id"]);
      if (artistId) candidates.push(await mbCandidate(client, artistId));
    }
    return candidates;
  },
  async profile(client, candidate, wanted) {
    const full = await mbArtist(client, candidate.externalId);
    const releases: ProfileRelease[] = [];
    for (const group of list(full["release-groups"])) {
      const groupId = text(group["id"]);
      const title = text(group["title"]);
      if (!groupId || !title) continue;
      let tracks: string[] = [];
      let label: string | null = null;
      let trackCount: number | null = null;
      if (wanted.has(workKey(title))) {
        // La edición más antigua del grupo representa al disco.
        const editions = list(((await client.json("musicbrainz", `${MB}/release?release-group=${groupId}&inc=recordings+labels&limit=10&fmt=json`)) as Json)["releases"])
          .sort((a, b) => (text(a["date"]) ?? "9999").localeCompare(text(b["date"]) ?? "9999"));
        const first = editions[0];
        if (first) {
          tracks = list(first["media"]).flatMap((medium) => list(medium["tracks"]).flatMap((track) => text(track["title"]) ?? []));
          trackCount = tracks.length || null;
          label = text((list(first["label-info"])[0]?.["label"] as Json | undefined)?.["name"]);
        }
      }
      const secondary = Array.isArray(group["secondary-types"]) ? (group["secondary-types"] as unknown[]).filter((value): value is string => typeof value === "string").join("+") || null : null;
      releases.push({
        externalId: groupId, title, year: yearOf(group["first-release-date"]),
        type: [text(group["primary-type"]), secondary].filter(Boolean).join("+").toLowerCase() || null,
        trackCount, tracks, label, coverUrl: `https://coverartarchive.org/release-group/${groupId}/front-500`, url: `https://musicbrainz.org/release-group/${groupId}`,
      });
    }
    const tags = [...list(full["genres"]), ...list(full["tags"])].flatMap((tag) => text(tag["name"]) ?? []);
    const area = text((full["area"] as Json | null)?.["name"]);
    return {
      source: "musicbrainz", externalId: candidate.externalId, name: candidate.name, url: candidate.url ?? null,
      country: COUNTRY[text(full["country"]) ?? ""] ?? area, beginYear: yearOf((full["life-span"] as Json | null)?.["begin"]),
      // En una persona, el inicio de su «vida» en MusicBrainz es su nacimiento.
      beginKind: text(full["type"]) === "Person" ? "born" : "formed", tags: [...new Set(tags)], releases,
    };
  },
};

// --- Discogs ---------------------------------------------------------------

const DISCOGS = "https://api.discogs.com";
const discogsReleases = async (client: ProfileClient, artistId: string) =>
  list(((await client.json("discogs", `${DISCOGS}/artists/${artistId}/releases?per_page=100&sort=year&sort_order=asc`)) as Json)["releases"])
    // Solo lo que el artista firma: las apariciones en compilados ajenos no son su discografía.
    .filter((release) => release["role"] === "Main" || release["role"] === undefined);
const discogsTracks = (payload: Json) => list(payload["tracklist"]).filter((track) => (text(track["type_"]) ?? "track") === "track").flatMap((track) => text(track["title"]) ?? []);

async function discogsCandidate(client: ProfileClient, artistId: string): Promise<ProfileCandidate> {
  const artist = (await client.json("discogs", `${DISCOGS}/artists/${artistId}`)) as Json;
  const releases = await discogsReleases(client, artistId);
  return {
    externalId: artistId, name: bareName(text(artist["name"])) ?? artistId, url: `https://www.discogs.com/artist/${artistId}`,
    disambiguation: text(artist["profile"])?.slice(0, 200) ?? null,
    releaseTitles: releases.flatMap((release) => text(release["title"]) ?? []),
    releaseYears: yearsOf(releases, (release) => text(release["title"]), (release) => yearOf(release["year"])),
    memberNames: list(artist["members"]).flatMap((member) => text(member["name"]) ?? []),
  };
}

const discogs: Adapter = {
  async search(client, name) {
    const found = list(((await client.json("discogs", `${DISCOGS}/database/search?type=artist&per_page=10&q=${encodeURIComponent(name)}`)) as Json)["results"]);
    const candidates: ProfileCandidate[] = [];
    for (const result of exactFirst(name, found, (item) => text(item["title"]))) {
      const artistId = id(result["id"]);
      if (artistId) candidates.push(await discogsCandidate(client, artistId));
    }
    return candidates;
  },
  async searchByTitles(client, name, titles) {
    const ids = new Set<string>();
    for (const title of titles) {
      const found = list(((await client.json("discogs", `${DISCOGS}/database/search?per_page=10&artist=${encodeURIComponent(name)}&release_title=${encodeURIComponent(title)}`)) as Json)["results"]);
      // El resultado dice «Artista - Título»; el artista se lee de la ficha del disco.
      const hit = found.find((result) => workKey(text(result["title"])?.split(" - ").slice(1).join(" - ") ?? "") === workKey(title));
      const hitId = id(hit?.["id"]);
      if (!hit || !hitId) continue;
      const detail = (await client.json("discogs", `${DISCOGS}/${hit["type"] === "master" ? "masters" : "releases"}/${hitId}`)) as Json;
      for (const artist of list(detail["artists"])) {
        const artistId = id(artist["id"]);
        if (artistId && normalizeIdentitySecondary(bareName(text(artist["name"])) ?? "") === normalizeIdentitySecondary(name)) ids.add(artistId);
      }
    }
    return Promise.all([...ids].map((artistId) => discogsCandidate(client, artistId)));
  },
  async profile(client, candidate, wanted) {
    const artist = (await client.json("discogs", `${DISCOGS}/artists/${candidate.externalId}`)) as Json;
    const releases: ProfileRelease[] = [];
    for (const release of await discogsReleases(client, candidate.externalId)) {
      const releaseId = id(release["id"]);
      const title = text(release["title"]);
      if (!releaseId || !title) continue;
      const master = release["type"] === "master";
      let detail: Json | null = null;
      let label = text(release["label"]);
      if (wanted.has(workKey(title))) {
        detail = (await client.json("discogs", `${DISCOGS}/${master ? "masters" : "releases"}/${releaseId}`)) as Json;
        if (master && id(detail["main_release"])) {
          const main = (await client.json("discogs", `${DISCOGS}/releases/${id(detail["main_release"])}`)) as Json;
          label = text(list(main["labels"])[0]?.["name"]);
        } else if (!master) label = text(list(detail["labels"])[0]?.["name"]) ?? label;
      }
      const tracks = detail ? discogsTracks(detail) : [];
      releases.push({
        externalId: `${master ? "master" : "release"}:${releaseId}`, title, year: yearOf(release["year"]),
        type: text(release["format"])?.toLowerCase() ?? (master ? "master" : null),
        trackCount: tracks.length || null, tracks, label: label?.replace(/\s\(\d+\)$/u, "") ?? null,
        coverUrl: text(list(detail?.["images"])[0]?.["uri"]) ?? text(release["thumb"]),
        url: `https://www.discogs.com/${master ? "master" : "release"}/${releaseId}`,
      });
    }
    return { source: "discogs", externalId: candidate.externalId, name: candidate.name, url: candidate.url ?? null, country: venezuelan(text(artist["profile"])), beginYear: null, tags: [], releases };
  },
};

// --- Last.fm ---------------------------------------------------------------
//
// Last.fm junta en una sola página a todos los que se llaman igual: su
// discografía es la de cualquier «Jeremías». Por eso solo se acepta si los
// discos coinciden, y sus títulos nuevos valen poco.

const LASTFM = "https://ws.audioscrobbler.com/2.0/?format=json";

const lastfm: Adapter = {
  async search(client, name) {
    const info = (((await client.json("lastfm", `${LASTFM}&method=artist.getinfo&autocorrect=0&artist=${encodeURIComponent(name)}`)) as Json)["artist"] ?? null) as Json | null;
    if (!info || !text(info["name"])) return [];
    const albums = list(((((await client.json("lastfm", `${LASTFM}&method=artist.gettopalbums&limit=50&artist=${encodeURIComponent(name)}`)) as Json)["topalbums"] ?? {}) as Json)["album"]);
    return [{ externalId: text(info["name"])!, name: text(info["name"])!, url: text(info["url"]), releaseTitles: albums.flatMap((album) => text(album["name"]) ?? []) }];
  },
  async profile(client, candidate, wanted) {
    const info = (((await client.json("lastfm", `${LASTFM}&method=artist.getinfo&autocorrect=0&artist=${encodeURIComponent(candidate.externalId)}`)) as Json)["artist"] ?? {}) as Json;
    const albums = list(((((await client.json("lastfm", `${LASTFM}&method=artist.gettopalbums&limit=50&artist=${encodeURIComponent(candidate.externalId)}`)) as Json)["topalbums"] ?? {}) as Json)["album"]);
    const releases: ProfileRelease[] = [];
    for (const album of albums) {
      const title = text(album["name"]);
      if (!title || title === "(null)") continue;
      let tracks: string[] = [];
      if (wanted.has(workKey(title))) {
        const detail = (((await client.json("lastfm", `${LASTFM}&method=album.getinfo&autocorrect=0&artist=${encodeURIComponent(candidate.externalId)}&album=${encodeURIComponent(title)}`)) as Json)["album"] ?? {}) as Json;
        const raw = (detail["tracks"] as Json | undefined)?.["track"];
        tracks = (Array.isArray(raw) ? list(raw) : list([raw])).flatMap((track) => text(track["name"]) ?? []);
      }
      const images = list(album["image"]);
      releases.push({ externalId: title, title, year: null, type: null, trackCount: tracks.length || null, tracks, label: null, coverUrl: text(images[images.length - 1]?.["#text"]), url: text(album["url"]) });
    }
    const tags = list(((info["tags"] ?? {}) as Json)["tag"]).flatMap((tag) => text(tag["name"]) ?? []);
    return { source: "lastfm", externalId: candidate.externalId, name: candidate.name, url: candidate.url ?? null, country: venezuelan(tags.join(" ")), beginYear: null, tags, releases };
  },
};

export const PROFILE_ADAPTERS: Record<ProfileSourceSlug, Adapter> = { deezer, itunes, musicbrainz, discogs, lastfm };

export interface SourceAttempt {
  profile: SourceProfile | null;
  outcome: MatchOutcome;
  candidates: Array<{ externalId: string; name: string; score: number; blocked: string | null; signals: string[] }>;
  error?: string;
}

/** Ficha para la identidad: discos con su año, para el control de un solo disco en común. */
export type ProfileIdentityInput = ArtistIdentityInput & { albumYears?: Record<string, number | null> };

/** Identificador ya verificado en la ficha y de dónde salió. */
export interface KnownId { externalId: string; via: string }

/** Enlace verificado de la ficha (del artista o de uno de sus discos). */
export interface VerifiedLink { platform: string; externalId: string; albumTitle: string | null }

/**
 * Traduce los enlaces verificados a identificadores de artista en Deezer e
 * iTunes. Un enlace del artista vale directo; uno de un disco lleva al artista
 * que lo firma (si se llama igual o como un alias: un compilado de varios
 * artistas no sirve). Spotify no se consulta: su cuota es del trabajo diario.
 */
export async function resolveKnownIds(client: ProfileClient, crv: ArtistIdentityInput, links: VerifiedLink[]): Promise<Partial<Record<ProfileSourceSlug, KnownId[]>>> {
  const names = new Set([crv.name, ...(crv.aliases ?? [])].map(normalizeIdentitySecondary));
  const known: Partial<Record<ProfileSourceSlug, KnownId[]>> = {};
  const add = (source: ProfileSourceSlug, externalId: string, via: string) => {
    const list = known[source] ??= [];
    if (!list.some((item) => item.externalId === externalId)) list.push({ externalId, via });
  };
  const deezerAlbum = async (albumId: string, via: string) => {
    const album = (await client.json("deezer", `https://api.deezer.com/album/${albumId}`)) as Json;
    for (const artist of [album["artist"], ...list(album["contributors"])] as Json[]) {
      if (artist && id(artist["id"]) && names.has(normalizeIdentitySecondary(text(artist["name"]) ?? ""))) add("deezer", id(artist["id"])!, via);
    }
  };
  const itunesAlbum = async (collectionId: string, via: string) => {
    const row = list(((await client.json("itunes", `${ITUNES}/lookup?id=${collectionId}`)) as Json)["results"])[0];
    if (row && id(row["artistId"]) && names.has(normalizeIdentitySecondary(text(row["artistName"]) ?? ""))) add("itunes", id(row["artistId"])!, via);
  };
  for (const link of links) {
    const via = link.albumTitle ? `enlace verificado del disco «${link.albumTitle}» (${link.platform})` : `enlace verificado del artista (${link.platform})`;
    try {
      if (link.platform === "deezer") {
        if (link.albumTitle) await deezerAlbum(link.externalId, via); else add("deezer", link.externalId, via);
      } else if (link.platform === "apple_music") {
        if (link.albumTitle) await itunesAlbum(link.externalId, via); else add("itunes", link.externalId, via);
      }
    } catch { /* un enlace roto no impide buscar */ }
  }
  return known;
}

/**
 * Busca al artista en una fuente, decide si alguno de los candidatos es él
 * (discos coincidentes, país, miembros) y arma el perfil del confirmado.
 * Un identificador ya verificado en la ficha se usa directamente si el nombre
 * (o un alias) coincide.
 */
export async function buildSourceProfile(
  client: ProfileClient, source: ProfileSourceSlug, input: ProfileIdentityInput, wanted: Set<string>, knownIds: KnownId[] = [],
): Promise<SourceAttempt> {
  const adapter = PROFILE_ADAPTERS[source];
  const before = client.requests[source];
  // Los títulos genéricos («Demo», «En vivo», «Vol. 2») no prueban identidad.
  const crv: ProfileIdentityInput = { ...input, albumTitles: (input.albumTitles ?? []).filter((title) => !isGenericTitle(title)) };
  try {
    // La identidad compara obras: «Acuérdate - Single» cuenta como «Acuérdate».
    const clean = (items: ProfileCandidate[]) => items.map((candidate) => ({ ...candidate, releaseTitles: (candidate.releaseTitles ?? []).map(editionless) }));
    const candidates = clean(await adapter.search(client, crv.name));
    let scored = candidates.map((candidate) => scoreArtistCandidate(crv, candidate));
    let outcome = decideMatch(scored);
    if (outcome.status !== "matched" && adapter.searchByTitles) {
      // El disco homónimo no sirve para buscar: lo tiene cualquier homónimo.
      const own = normalizeIdentitySecondary(crv.name);
      const titles = (crv.albumTitles ?? []).filter((title) => workKey(title) !== own).slice(0, 3);
      const extra = clean(await adapter.searchByTitles(client, crv.name, titles)).filter((candidate) => !candidates.some((item) => item.externalId === candidate.externalId));
      if (extra.length) {
        candidates.push(...extra);
        scored = [...scored, ...extra.map((candidate) => scoreArtistCandidate(crv, candidate))];
        outcome = decideMatch(scored);
      }
    }
    // Dos candidatos con el mismo puntaje no empatan si uno comparte muchísimos
    // más discos: el puntaje tiene techo y 98 títulos pesan igual que 3. El
    // otro suele ser un perfil que mezcla homónimos y colaboraciones.
    if (outcome.status === "ambiguous" && outcome.best && outcome.runnerUp && !outcome.best.blocked) {
      const own = new Set((crv.albumTitles ?? []).map(workKey));
      own.delete(normalizeIdentitySecondary(crv.name));
      const shared = (candidate: ExternalCandidate) => new Set((candidate.releaseTitles ?? []).map(workKey).filter((key) => own.has(key))).size;
      const ranked = scored.filter((item) => !item.blocked).map((item) => ({ item, shared: shared(item.candidate) })).sort((a, b) => b.shared - a.shared);
      const [first, second] = ranked;
      if (first && second && first.shared >= 3 * second.shared && first.shared - second.shared >= 10) {
        outcome = { status: "matched", best: first.item, runnerUp: second.item, reason: `${outcome.best.signals.map((signal) => signal.name).join(" + ")}; desempate: ${first.shared} discos en común frente a ${second.shared} del otro perfil (${second.item.candidate.externalId})` };
      }
    }
    // Con un solo disco en común y nada más (ni país ni miembros), el año
    // tiene que acompañar.
    if (outcome.status === "matched" && outcome.best) {
      const independent = outcome.best.signals.filter((signal) => !signal.name.startsWith("name_"));
      if (independent.length === 1 && independent[0]!.name === "discography_partial") {
        const own = normalizeIdentitySecondary(crv.name);
        const candidate = outcome.best.candidate as ProfileCandidate;
        const key = (candidate.releaseTitles ?? []).map(workKey).find((item) => item !== own && (crv.albumTitles ?? []).some((title) => workKey(title) === item));
        const title = (crv.albumTitles ?? []).find((item) => workKey(item) === key) ?? key ?? "";
        const check = singleTitleCheck(title, key ? input.albumYears?.[key] : null, key ? candidate.releaseYears?.[key] : null);
        outcome = check.ok
          ? { ...outcome, reason: `${outcome.reason}; ${check.reason}` }
          : { ...outcome, status: "ambiguous", reason: check.reason };
      }
    }
    // Identificador ya verificado en la ficha: manda, si el nombre coincide.
    for (const known of knownIds) {
      let item = scored.find((entry) => entry.candidate.externalId === known.externalId);
      if (!item && adapter.byId) {
        const fetched = await adapter.byId(client, known.externalId);
        if (fetched) { item = scoreArtistCandidate(crv, clean([fetched])[0]!); scored = [...scored, item]; }
      }
      if (item && item.blocked !== "el nombre no coincide") {
        outcome = { status: "matched", best: item, runnerUp: null, reason: `identificador ya verificado: ${known.via}` };
        break;
      }
    }
    const summary = scored.map((item) => ({ externalId: item.candidate.externalId, name: item.candidate.name, score: item.score, blocked: item.blocked, signals: item.signals.map((signal) => `${signal.name}${signal.detail ? `: ${signal.detail}` : ""}`) }));
    if (outcome.status !== "matched" || !outcome.best) return { profile: null, outcome, candidates: summary };
    const base = await adapter.profile(client, outcome.best.candidate, wanted);
    return {
      profile: { ...base, identity: { status: outcome.status, score: outcome.best.score, reason: outcome.reason, signals: summary.find((item) => item.externalId === outcome.best!.candidate.externalId)?.signals ?? [] }, requests: client.requests[source] - before },
      outcome, candidates: summary,
    };
  } catch (error) {
    return { profile: null, outcome: { status: "none", best: null, runnerUp: null, reason: "error de la fuente" }, candidates: [], error: error instanceof Error ? error.message : String(error) };
  }
}
