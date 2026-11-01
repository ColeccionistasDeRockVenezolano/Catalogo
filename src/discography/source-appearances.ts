/** Conservative title matching for a documented performer in a compilation. */
export function sourceTitleKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

/** Strip a performer prefix only when the whole prefix is a documented name/alias. */
export function appearanceTrackTitle(title: string, names: readonly string[]): string {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/u.exec(title);
  return match && names.some(name => sourceTitleKey(name) === sourceTitleKey(match[1]!)) ? match[2]!.trim() : title;
}

export function matchingAppearanceTracks<T extends { title: string }>(rows: readonly T[], title: string, names: readonly string[]): T[] {
  const key = sourceTitleKey(title);
  return rows.filter(row => sourceTitleKey(appearanceTrackTitle(row.title, names)) === key);
}

/** Prefer the catalog track spelling; keep documented songs without inventing positions. */
export function combineAppearanceTitles(tracks: readonly string[], documented: readonly string[], names: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const title of [...tracks, ...documented]) {
    const clean = appearanceTrackTitle(title, names);
    const key = sourceTitleKey(clean);
    if (!seen.has(key)) { seen.add(key); result.push(clean); }
  }
  return result;
}
