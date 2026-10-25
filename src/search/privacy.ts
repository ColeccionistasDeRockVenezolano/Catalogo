import { createHash } from "node:crypto";

/** Applied before sampling, hashing, grouping or any future embedding. Keep negations and musical numbers. */
export function sanitizeSearchText(input: string): string {
  return input.normalize("NFKC")
    .replace(/https?:\/\/\S+|www\.\S+/giu, "[enlace]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[correo]")
    .replace(/\b(?:bearer\s+\S+|(?:token|password|contraseña|api[_-]?key)\s*[:=]\s*\S+)/giu, "[secreto]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[dirección]")
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/gu, value => /^(?:19|20)\d{2}\s*[- ]\s*(?:19|20)\d{2}$/u.test(value) ? value : "[teléfono]")
    .replace(/@[\p{L}\p{N}_]+/gu, "[cuenta]")
    // eslint-disable-next-line no-control-regex -- Remove untrusted control characters before storage.
    .replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 1000);
}
export function searchSample(input: string) {
  const sample = sanitizeSearchText(input);
  // No accent folding or token reordering: do not merge distinctions without review.
  const normalized = sample.toLocaleLowerCase("es").replace(/\s+/gu, " ");
  return { sample, normalized, fingerprint: createHash("sha256").update(normalized).digest("hex"), length: input.length };
}
