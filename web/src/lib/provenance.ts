import type { Claim } from "./types.js";

/** Solo enlaces web registrados; nunca se construye evidencia a partir de una plataforma de escucha. */
export function evidenceWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function claimReference(claim: Pick<Claim, "evidence" | "pageUrl" | "sourceUrl">) {
  const evidenceUrls = [...new Set([
    ...claim.evidence.map((item) => evidenceWebUrl(item.url)), evidenceWebUrl(claim.pageUrl),
  ].filter((url): url is string => url !== null))];
  return {
    url: evidenceUrls[0] ?? evidenceWebUrl(claim.sourceUrl),
    evidenceUrls,
    isSourceHomepage: evidenceUrls.length === 0 && evidenceWebUrl(claim.sourceUrl) !== null,
  };
}

/** Un enlace por fuente y página, aunque varios campos del crédito repitan la misma evidencia. */
export function creditSourceGroups(claims: Claim[]) {
  const unique = new Map(claims.map((claim) => [claim.id, claim]));
  const groups = new Map<string, { claim: Claim; claims: Claim[]; reference: ReturnType<typeof claimReference> }>();
  for (const claim of unique.values()) {
    const reference = claimReference(claim);
    const key = `${claim.sourceId}:${reference.url ?? ""}`;
    const group = groups.get(key) ?? { claim, claims: [], reference };
    group.claims.push(claim);
    groups.set(key, group);
  }
  return [...groups.values()];
}
