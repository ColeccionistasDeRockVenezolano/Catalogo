import type { CatalogEvidence, CatalogOperation } from "./types.js";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const generic = new Set([
  "unknown",
  "other",
  "primary",
  "secondary",
  "musician",
  "producer",
  "published",
  "unpublished",
  "high",
  "hq",
  "lq",
]);
const synonyms: Record<string, string[]> = {
  bass: ["bajo", "bajista"],
  drums: ["bateria", "baterista"],
  guitars: ["guitarra", "guitarrista"],
  vocals: ["voz", "vocalista"],
  programming: ["programacion"],
  composed: ["compuesto", "compositor", "composicion"],
  produced: ["produccion", "productor", "producido"],
};
function mentioned(value: string | number, text: string): boolean {
  const normalized = normalize(String(value));
  if (!normalized || generic.has(normalized)) return false;
  if (typeof value === "number")
    return new RegExp(`\\b${value}\\b`, "u").test(text);
  if (new RegExp(`\\b${normalized.replace(/ /gu, "\\s+")}\\b`, "u").test(text))
    return true;
  const words = normalized
    .split(" ")
    .filter((w) => w.length >= 3 && !generic.has(w));
  if (!words.length) return false;
  return words.every(
    (word) =>
      text.includes(word) || synonyms[word]?.some((s) => text.includes(s)),
  );
}
/** A citation's existence does not establish relevance. Ambiguous editorial acts need explicit review. */
export function hasRelevantEvidence(
  op: CatalogOperation,
  evidence: CatalogEvidence[],
): boolean {
  const text = normalize(
    evidence
      .filter((e) => op.evidenceIds.includes(e.id))
      .map((e) => e.quote)
      .join("\n"),
  );
  if (!text) return false;
  if (op.op === "create_relation" || op.op === "replace_relation")
    return Object.entries(op.values).some(
      ([key, v]) =>
        ["role", "format", "fromYear", "toYear"].includes(key) &&
        (typeof v === "string" || typeof v === "number") &&
        mentioned(v, text),
    );
  if (op.op === "create_album")
    return (
      typeof op.values["title"] === "string" &&
      mentioned(op.values["title"], text)
    );
  if (op.op === "create_entity")
    return (
      typeof op.values[
        op.kind === "track" || op.kind === "album" ? "title" : "name"
      ] === "string" &&
      mentioned(
        op.values[
          op.kind === "track" || op.kind === "album" ? "title" : "name"
        ] as string,
        text,
      )
    );
  if (op.op === "replace_fields")
    return Object.entries(op.values).every(([key, v]) => {
      if (v === null) return false;
      if (typeof v === "boolean")
        return (
          v === true &&
          (key === "isVenezuelan"
            ? mentioned("venezuelan", text) || mentioned("venezolano", text)
            : key === "isDeceased"
              ? mentioned("fallecido", text) || mentioned("died", text)
              : false)
        );
      if (["biography", "description", "notes", "trivia"].includes(key))
        return normalize(String(v))
          .split(" ")
          .filter((w) => w.length > 4)
          .some((w) => text.includes(w));
      return mentioned(v, text);
    });
  if (op.op === "add_alias") return mentioned(op.alias, text);
  if (op.op === "assign_genre" || op.op === "remove_genre")
    return mentioned(op.genreSlug, text);
  // Identity fusion, removal and ordering cannot be established by a generic artist excerpt.
  return false;
}
