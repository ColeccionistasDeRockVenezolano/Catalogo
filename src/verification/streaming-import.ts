/** Incremental imports cannot replace an approved or human-edited link. */
export interface StoredImportLink { url: string; verified: boolean; source: string }
export type ImportDisposition = "insert" | "promote" | "replace_candidate" | "unchanged" | "protected";
export function streamingImportDisposition(existing: StoredImportLink | undefined, incoming: Pick<StoredImportLink, "url" | "verified">, insertOnly = false): ImportDisposition {
  if (!existing) return "insert";
  if (existing.url === incoming.url && (existing.verified || !incoming.verified)) return "unchanged";
  if (insertOnly || existing.source === "crv-operador" || existing.verified) return "protected";
  if (existing.url === incoming.url && incoming.verified) return "promote";
  return incoming.verified ? "replace_candidate" : "protected";
}

export function exactPlatformAlbum(title: string | null | undefined, canonical: string, sourceYear: number | null | undefined, year: number | null): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  return !!title && normalize(title) === normalize(canonical) && !(sourceYear && year && sourceYear !== year);
}
