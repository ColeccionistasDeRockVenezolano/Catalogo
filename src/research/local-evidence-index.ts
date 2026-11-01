// CRV · Extracción de fragmentos citables del almacén local (etapa 6).
//
// No guarda la captura entera: convierte JSON/JSONL/CSV/HTML en registros con
// artista, fuente, URL y un cuerpo corto. El clasificador recibe esos fragmentos
// como hechos, nunca el árbol de archivos.
import { createHash } from "node:crypto";
import { nameKey } from "../curation/lexicon.js";

export interface EvidenceRecord {
  source: string;
  sourcePath: string;
  artistName: string | null;
  artistKey: string;
  title: string | null;
  url: string | null;
  body: string;
  capturedAt: string | null;
}

const NAME_KEYS = ["name", "artist", "artista", "banda", "artist_name", "artistName", "titulo", "title"];
const BODY_KEYS = [
  "bio", "biography", "profile", "realname", "notes", "notas", "text", "content", "summary",
  "description", "annotation", "review", "comment", "credits", "members", "integrantes",
  "pistas", "temas", "tracks", "extract", "trivia",
];
const URL_KEYS = ["url", "uri", "link", "href", "u", "rymHref", "resource_url", "ficha", "source_url"];
const TITLE_KEYS = ["titulo", "title", "name", "album", "disc"];

const SOURCE_RULES: Array<[RegExp, string]> = [
  [/hippito/iu, "hippito"],
  [/rockhecho|rock-hecho|deep-rhv|rhv-blogspot/iu, "rhv"],
  [/rateyourmusic|rym/iu, "rym"],
  [/discogs/iu, "discogs"],
  [/lastfm/iu, "lastfm"],
  [/musicbrainz/iu, "musicbrainz"],
  [/wikipedia|venciclopedia/iu, "wikipedia"],
  [/theaudiodb/iu, "theaudiodb"],
  [/aoty/iu, "aoty"],
  [/bandcamp/iu, "bandcamp"],
  [/sincopa/iu, "sincopa"],
  [/metal-archives/iu, "metal_archives"],
  [/venezuelademo/iu, "venezuelademo"],
  [/instagram/iu, "instagram"],
  [/spotify/iu, "spotify"],
];

export function sourceOfPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  for (const [pattern, source] of SOURCE_RULES) if (pattern.test(normalized)) return source;
  return "otros";
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["#text", "name", "title", "summary", "content"]) {
      const found = firstString((value as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  return null;
}

function collectBody(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectBody(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of BODY_KEYS) {
    if (record[key] === undefined || record[key] === null) continue;
    const text = collectBody(record[key], depth + 1);
    if (text.length) parts.push(`${key}: ${text.slice(0, 12).join(" · ")}`);
  }
  return parts;
}

function collectUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of URL_KEYS) {
    const found = firstString(record[key]);
    if (found && /^https?:\/\//iu.test(found)) return found;
  }
  return null;
}

function recordsFromObject(value: unknown, path: string, source: string, out: EvidenceRecord[], depth = 0): void {
  if (depth > 6 || out.length > 4000) return;
  if (Array.isArray(value)) {
    for (const item of value) recordsFromObject(item, path, source, out, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const name = NAME_KEYS.map((key) => firstString(record[key])).find((item) => item !== null) ?? null;
  const title = TITLE_KEYS.map((key) => firstString(record[key])).find((item) => item !== null) ?? null;
  const bodyParts = collectBody(record);
  if (name && bodyParts.length) {
    const body = [...new Set(bodyParts)].join("\n").slice(0, 2500);
    const artistKey = nameKey(name);
    if (artistKey.length > 1) {
      out.push({
        source, sourcePath: path, artistName: name, artistKey, title,
        url: collectUrl(record), body, capturedAt: null,
      });
    }
  }
  // Wikipedia y AudioDB envuelven los registros en arrays/objetos anidados.
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") recordsFromObject(child, path, source, out, depth + 1);
  }
}

function stripHtml(html: string): { title: string | null; body: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.replaceAll(/\s+/gu, " ").trim() ?? null;
  const body = html
    .replaceAll(/<script[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/giu, " ")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&nbsp;/gu, " ")
    .replaceAll(/&amp;/gu, "&")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 2500);
  return { title, body };
}

export function extractRecords(content: string, path: string, extension: string, capturedAt: string | null = null): EvidenceRecord[] {
  const source = sourceOfPath(path);
  const out: EvidenceRecord[] = [];
  if (extension === ".jsonl" || extension === ".ndjson") {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { recordsFromObject(JSON.parse(trimmed), path, source, out); } catch { /* línea rota: se ignora */ }
    }
  } else if (extension === ".json") {
    try { recordsFromObject(JSON.parse(content), path, source, out); } catch { return []; }
  } else if (extension === ".html" || extension === ".htm") {
    const { title, body } = stripHtml(content);
    const artistName = title?.split(/[|\-–]/u)[0]?.trim() ?? null;
    const key = artistName ? nameKey(artistName) : "";
    if (key.length > 1 && body.length > 80) {
      out.push({ source, sourcePath: path, artistName, artistKey: key, title, url: null, body, capturedAt });
    }
  }
  const seen = new Set<string>();
  return out.filter((record) => {
    const hash = createHash("sha1").update(`${record.artistKey}|${record.url ?? ""}|${record.body.slice(0, 500)}`).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  }).map((record) => ({ ...record, capturedAt }));
}
