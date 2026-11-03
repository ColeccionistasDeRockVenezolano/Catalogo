// Continuidad del catálogo de radio entre exportaciones.
//
// El motor deriva el barajado de cada ciclo de la huella de
// [videoId, startSeconds, durationSeconds] en el ORDEN del archivo: reordenar
// piezas o moverlas un segundo cambia toda la programación aunque el contenido
// sea el mismo. Por eso lo que ya estaba conserva su sitio y lo nuevo va al final.

export interface MergeableItem { videoId: string; startSeconds: number; durationSeconds: number }

export interface CatalogMergeStats {
  kept: number;
  added: number;
  removed: number;
  /** Piezas cuya duración calculada difería por redondeo y conservan la anterior. */
  timingPreserved: number;
}

/** Duración de un video según la API o el reproductor: difieren hasta un segundo. */
export const DURATION_ROUNDING_SECONDS = 1;

const pieceKey = (item: MergeableItem): string => `${item.videoId}:${item.startSeconds}`;

export function mergeWithPrevious<T extends MergeableItem>(
  previous: readonly MergeableItem[], next: readonly T[],
): { items: T[]; stats: CatalogMergeStats } {
  const fresh = new Map(next.map((item) => [pieceKey(item), item]));
  const seen = new Set<string>();
  const items: T[] = [];
  const stats: CatalogMergeStats = { kept: 0, added: 0, removed: 0, timingPreserved: 0 };
  for (const old of previous) {
    const key = pieceKey(old);
    if (seen.has(key)) continue;
    seen.add(key);
    const item = fresh.get(key);
    if (!item) { stats.removed += 1; continue; }
    stats.kept += 1;
    const rounding = item.durationSeconds !== old.durationSeconds
      && Math.abs(item.durationSeconds - old.durationSeconds) <= DURATION_ROUNDING_SECONDS;
    if (rounding) stats.timingPreserved += 1;
    items.push(rounding ? { ...item, durationSeconds: old.durationSeconds } : item);
  }
  const added = next
    .filter((item) => !seen.has(pieceKey(item)))
    .sort((a, b) => a.videoId.localeCompare(b.videoId) || a.startSeconds - b.startSeconds);
  stats.added = added.length;
  return { items: [...items, ...added], stats };
}

/** Parte de las piezas anteriores que desaparecería, de 0 a 1. */
export function removedShare(stats: CatalogMergeStats): number {
  const before = stats.kept + stats.removed;
  return before === 0 ? 0 : stats.removed / before;
}
