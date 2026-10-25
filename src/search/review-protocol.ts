import { createHash } from "node:crypto";
import { load } from "cheerio";

export const REVIEW_EXTRACTOR_VERSION = "rym-review-html-v2";
export const hashText = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const normalizedText = (s: string) => s.replace(/\s+/gu, " ").trim();
export interface ReviewCapture { source: string; html: string; capturedAt: string; release: string; page: number }
export interface ExtractedReview {
  id: string; account: string | null; visibleDate: string | null; url: string | null;
  text: string; textHash: string; rating: number | null; page: number; release: string;
  captureHash: string; capturedAt: string; source: string; locator: string;
  extractorVersion: string; flags: string[]; trackRatings: Array<{title:string;position:string|null;value:number}>;
}
/** Recover inline text across nested spans; track scores stay outside the review body.
 * Retains full private text for annotation; the administration endpoint exposes no text. */
export function extractReviews(capture: ReviewCapture): ExtractedReview[] {
  const $ = load(capture.html), rows: ExtractedReview[] = [];
  $('[id^="review_shell_"]').each((_, shell) => {
    const node = $(shell), id = node.attr("id")?.match(/^review_shell_(?:std_)?(\d+)$/u)?.[1];
    if (!id) return;
    let body = node.find('.review_body [itemprop="description"]').first();
    if (!body.length) body = node.find(".review_body .rendered_text").filter((_, el) => !$(el).parents('[id^="review_track_rating_"]').length).first();
    const copy = body.clone(); copy.find("br").replaceWith("\n"); copy.find("p,div,li").append("\n");
    const text = normalizedText(copy.text()), account = node.find(".review_user a.user").first().text().trim() || null;
    const date = node.find(".review_date").first(), link = date.find("a").first().attr("href");
    const rawRating = node.find(".review_rating").first();
    const score = rawRating.attr("content") ?? rawRating.find("img").first().attr("alt")?.replace(/ stars?/u, "");
    const rating = score != null && score.trim() !== "" && Number.isFinite(Number(score)) ? Number(score) : null;
    const flags = [];
    const canonical=$('meta[property="og:url"]').attr("content") ?? $('link[rel="canonical"]').attr("href");
    if (canonical && new URL(canonical,"https://rateyourmusic.com").pathname.replace(/\/$/u,"") !== new URL(capture.release,"https://rateyourmusic.com").pathname.replace(/\/$/u,"")) flags.push("release_identity_mismatch");
    if (!account) flags.push("missing_author"); if (!text) flags.push("empty_text");
    if (body.find(".show_more, .read_more, [data-truncated]").length) flags.push("possible_truncation");
    const visibleDate = date.attr("content") ?? date.find("a").first().text().trim();
    if (!visibleDate) flags.push("missing_date");
    const trackRatings: ExtractedReview["trackRatings"] = [];
    node.find(`#review_track_rating_${id} li.track`).each((_, track) => {
      const item=$(track), title=item.find(".tracklist_title").text().trim();
      const raw=item.find(".track_rating_disp img").attr("alt")?.replace(/ stars?/u, "");
      if (title && raw && Number.isFinite(Number(raw))) trackRatings.push({title,position:item.find(".tracklist_num").text().trim() || null,value:Number(raw)});
    });
    rows.push({ id, account, visibleDate: visibleDate || null, url: link ? new URL(link, "https://rateyourmusic.com").href : null,
      text, textHash: hashText(text), rating, page: capture.page, release: capture.release, source: capture.source,
      captureHash: hashText(capture.html), capturedAt: capture.capturedAt, locator: `#${node.attr("id")} .review_body`,
      extractorVersion: REVIEW_EXTRACTOR_VERSION, flags, trackRatings });
  });
  return rows;
}

export function selectReviews(input: ExtractedReview[]) {
  if (new Set(input.map(r => r.release)).size > 1) throw new Error("Muestrear una publicación por vez");
  const ids = new Map<string, ExtractedReview>(), revisions: Array<{ id: string; hashes: string[] }> = [];
  for (const row of [...input].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.captureHash.localeCompare(b.captureHash))) {
    const prior = ids.get(row.id);
    if (prior && prior.textHash !== row.textHash) revisions.push({ id: row.id, hashes: [prior.textHash, row.textHash] });
    ids.set(row.id, row);
  }
  const rows = [...ids.values()].filter(r => r.text && r.account && !r.flags.includes("possible_truncation") && !r.flags.includes("release_identity_mismatch"));
  const pages = [...new Set(rows.map(r => r.page))].sort((a, b) => a - b);
  const selected = new Map<string, ExtractedReview>();
  const tie = (a: ExtractedReview, b: ExtractedReview) => b.text.length - a.text.length || a.id.localeCompare(b.id, "en", { numeric: true });
  if (rows.length <= 20) for (const row of rows) selected.set(row.id, row);
  else for (const page of pages) {
    const perPage = rows.filter(r => r.page === page), rated = perPage.filter(r => r.rating !== null);
    const low = [...rated].sort((a, b) => a.rating! - b.rating! || tie(a, b))[0];
    const high = [...rated].sort((a, b) => b.rating! - a.rating! || tie(a, b))[0];
    for (const row of [low, high, ...perPage.filter(r => r.rating === null)]) if (row) selected.set(row.id, row);
  }
  const byHash = new Map<string, string[]>();
  for (const row of rows) byHash.set(row.textHash, [...(byHash.get(row.textHash) ?? []), row.id]);
  return { selected: [...selected.values()].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id, "en", { numeric: true })),
    captured: input.length, uniqueReviewIds: ids.size, validReviews: rows.length, usefulPages: pages.length,
    multiPageEligible: pages.length >= 2, distinctAccounts: new Set(rows.map(r => r.account)).size,
    excluded: [...ids.values()].filter(r => !rows.includes(r)).map(r => ({ id: r.id, flags: r.flags })), revisions,
    duplicates: [...byHash.values()].filter(group => group.length > 1),
    sampling: rows.length <= 20 ? "census_of_valid_captures" : "per_page_rating_extremes_plus_unrated",
    populationPrevalenceAllowed: false,
  };
}
