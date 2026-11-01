/**
 * JSON text for a `jsonb` parameter. PostgreSQL rejects NUL and lone surrogates — a quote cut in
 * the middle of an emoji («🇪🇸» → «🇪\ud83c») — and one such character would fail the whole write;
 * NUL is dropped and half characters become «�». Well-formed text is serialized unchanged.
 */
export function jsonb(value: unknown): string {
  // eslint-disable-next-line no-control-regex -- PostgreSQL rejects NUL
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "string" && /[\u0000\uD800-\uDFFF]/u.test(item)
    // eslint-disable-next-line no-control-regex -- PostgreSQL rejects NUL
    ? item.replace(/\u0000/gu, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, "�")
    : item);
}
