import { load } from "cheerio";
import { z } from "zod";
import { extractReleaseCommunity, releaseCommunitySchema } from "./rym-release-community.js";

const text = z.string().trim().min(1);
// Deliberately bounded to the literals verified in this development cut.
const languageCodes = new Map<string, "en" | "es">([["English", "en"], ["Spanish", "es"]]);
export const releaseLanguageSchema = z.object({
  version: z.literal("rym-release-language-v1"), resourceId: z.literal("R06"),
  source: z.string().url(), captureHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.null(), capturedAtOriginal: text, captureTimeZone: z.null(),
  object: releaseCommunitySchema.shape.object,
  scope: z.literal("source_release_metadata"), edition: z.null(), segment: z.null(),
  field: z.object({ label: z.enum(["Language", "Languages"]), literal: z.string(), locator: text }).strict().nullable(),
  status: z.enum(["documented", "unknown", "unresolved"]),
  languages: z.array(z.object({ literal: text, code: z.enum(["en", "es"]).nullable() }).strict()),
  reason: text,
  policy: z.literal("no_track_or_edition_inheritance_no_translation_or_vocal_absence_inference"),
}).strict();
export type ReleaseLanguage = z.infer<typeof releaseLanguageSchema>;
export const releaseLanguageStudySchema = z.object({
  version: z.literal("crv-release-language-study-0.1.0"), resourceId: z.literal("R06"),
  inputs: z.array(z.object({ path: text, sha256: text }).strict()).min(1),
  manifest: z.array(z.object({ albumId: z.number().int().positive(), html: text, htmlHash: text, metadata: text, metadataHash: text }).strict()),
  records: z.array(releaseLanguageSchema),
  coverage: z.object({ releases: z.number().int(), documented: z.number().int(), unknown: z.number().int(), unresolved: z.number().int(), multilingual: z.number().int() }).strict(),
  limits: z.array(text), operationalDatabaseWrites: z.literal(0), entityAssignmentsAuthorized: z.literal(false), publicationAuthorized: z.literal(false),
}).strict();

/** Metadata attribution only: a review's language and community descriptors are not this field. */
export function extractReleaseLanguage(input: Parameters<typeof extractReleaseCommunity>[0]): ReleaseLanguage {
  // Reuse the immutable capture and documented release identity checks without changing review annotations.
  const context = extractReleaseCommunity(input), $ = load(input.html);
  const fields: Array<{label: "Language" | "Languages"; literal: string; locator: string}> = [];
  $("table.album_info th.info_hdr").each((_, el) => {
    if ($(el).closest(".review_body, .review").length) return;
    const label = $(el).text().replace(/\s+/gu, " ").trim();
    if (label !== "Language" && label !== "Languages") return;
    const cells = $(el).parent("tr").children("td");
    if (cells.length !== 1) throw new Error("Estructura del campo de idioma ambigua");
    fields.push({ label, literal: cells.text().replace(/\s+/gu, " ").trim(),
      locator: `table.album_info th.info_hdr [literal=${JSON.stringify(label)}] + td` });
  });
  if (fields.length > 1) throw new Error("Campos de idioma múltiples: requiere revisión");
  const field = fields[0] ?? null;
  const tokens = field?.literal ? field.literal.split(",").map(t => t.trim()) : [];
  const languages = tokens.filter(Boolean).map(literal => ({ literal, code: languageCodes.get(literal) ?? null }));
  const status = !field?.literal ? "unknown" : tokens.some(t => !t) || languages.some(t => !t.code) ? "unresolved" : "documented";
  return releaseLanguageSchema.parse({ version: "rym-release-language-v1", resourceId: "R06",
    source: context.source, captureHash: context.captureHash, capturedAt: null,
    capturedAtOriginal: context.capturedAtOriginal, captureTimeZone: null, object: context.object,
    scope: "source_release_metadata", edition: null, segment: null, field, languages, status,
    reason: status === "unknown" ? "Campo ausente o vacío; no acredita ausencia de voz ni de idioma"
      : status === "unresolved" ? "Literal conservado; valor o separador fuera del corte validado English/Spanish"
        : "Idiomas atribuidos por la ficha de publicación; cobertura por pista y edición desconocidas",
    policy: "no_track_or_edition_inheritance_no_translation_or_vocal_absence_inference" });
}
