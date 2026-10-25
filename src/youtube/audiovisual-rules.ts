/** Reglas editoriales compartidas por hoja, canal y altas de discos. */
export const AUDIOVISUAL_KINDS = ["documentary", "live_concert", "music_video", "interview", "short", "other"] as const;
export type AudiovisualKind = typeof AUDIOVISUAL_KINDS[number];

export function audiovisualKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Excepción expresa de Brian (2026-10-15), acotada a esta obra. */
export function audiovisualAlbumException(artist: string, title: string, videoId?: string | null): boolean {
  return videoId === "bePwD424LvA" || (audiovisualKey(artist) === "gasolina" && audiovisualKey(title) === "bluescriollo");
}

/** Un tipo compuesto que incluye audiovisual sigue siendo audiovisual. */
export function audiovisualKind(rawType: string | null | undefined, videoTitle = ""): AudiovisualKind | null {
  const tokens = (rawType ?? "").split(/[,;+]/u).map(part => audiovisualKey(part));
  const title = videoTitle.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  if (tokens.some(t => ["documentary", "documental"].includes(t)) || /\|\s*(?:full\s+)?documentary\s*\|/u.test(title)) return "documentary";
  if (tokens.some(t => ["interview", "entrevista"].includes(t)) || /\bentrevista\b/u.test(title)) return "interview";
  if (tokens.some(t => ["musicvideo", "videoclip", "videomusical"].includes(t)) || /\|\s*(?:official\s+)?(?:music video|videoclip)\s*\|/u.test(title)
    || /\((?:official|oficial)[^)]*video\)|\bofficial music video\b/u.test(title)) return "music_video";
  if (tokens.some(t => ["liveconcert", "concert", "livesession", "session", "sesion"].includes(t)) || /\|\s*(?:full\s+)?(?:concert|live concert|live session|unplugged)\s*\|/u.test(title)) return "live_concert";
  if (tokens.some(t => ["short", "shorts"].includes(t)) || /#shorts\b/u.test(title)) return "short";
  if (tokens.some(t => ["other", "others", "review"].includes(t))) return "other";
  return null;
}

/** Conserva el nombre de la obra; quita solo adornos de publicación del canal. */
export function audiovisualTitle(raw: string): string {
  return raw.replace(/\s*\|.*$/u, "").replace(/\s*\((?:19|20)\d{2}\)\s*/gu, " ")
    .replace(/\s+4K\s?\d*(?:\s+Remastered)?\s*$/iu, "").trim();
}
