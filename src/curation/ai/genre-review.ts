import type { CatalogEvidence } from "./types.js";

interface GenreTerm { slug: string; name: string; level: string }
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Exact vocabulary matches are lookup hints; the planner still checks who and what the citation describes. */
export function genreReviewCandidates(evidence: CatalogEvidence[], terms: GenreTerm[]) {
  return terms.flatMap(term => {
    const name = fold(term.name), slug = fold(term.slug);
    const evidenceIds = evidence.filter(e => {
      // Infobox extraction can join capitalized descriptors: RockPunkPop punkRock alternativo.
      const segments = e.quote.split(/(?<=[\p{Ll}\d])(?=\p{Lu})/gu).map(s => fold(s).replace(/^generos? s?\s+/u, ""));
      if (!name.includes(" ") && !slug.includes(" ")) return segments.some(s => s === name || s === slug);
      // Match phrases in the original text: splitting descriptors must not manufacture "punk rock" across two items.
      const text = fold(e.quote);
      return text.includes(name) || text.includes(slug);
    }).map(e => e.id);
    return evidenceIds.length ? [{ ...term, evidenceIds }] : [];
  });
}
