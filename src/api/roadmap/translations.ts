// CRV · Traducciones por fila del roadmap (Fase 2).
//
// Formato compatible con Herra: `{"en":"English text"}` en `i18n_json`. El
// español es el original y no se guarda; una traducción vacía se descarta y la
// fila cae al español.
export type RowTranslations = { en?: string };

const MAX_TRANSLATION = 300;

export function parseTranslations(raw: string | null): RowTranslations {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const en = (parsed as Record<string, unknown>)["en"];
    return typeof en === "string" && en.trim() !== "" ? { en: en.trim() } : {};
  } catch {
    return {};
  }
}

export function localizeRow(raw: string | null, original: string, lang: "es" | "en"): string {
  if (lang !== "en") return original;
  return parseTranslations(raw).en ?? original;
}

export function serializeTranslations(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)["en"];
  if (typeof value !== "string") return null;
  const text = value.replace(/[<>]/g, "").trim().slice(0, MAX_TRANSLATION);
  return text ? JSON.stringify({ en: text }) : null;
}

export function isTranslationsInput(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([lang, text]) => (
    lang === "en" && typeof text === "string" && text.length <= MAX_TRANSLATION * 2
  ));
}
