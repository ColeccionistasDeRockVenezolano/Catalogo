import messages from "./messages.json" with { type: "json" };
import groups from "./message-groups.json" with { type: "json" };

export type LandingLanguage = "es" | "en";
const dictionary: Record<string, { es: string; en: string }> = messages;

export function translate(lang: LandingLanguage, key: string, vars?: Record<string, string | number>): string {
  return (dictionary[key]?.[lang] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && Object.hasOwn(vars, name) ? String(vars[name]) : match);
}

export function clientMessages(lang: LandingLanguage, group: keyof typeof groups): Record<string, string> {
  return Object.fromEntries(groups[group].map((key) => [key, translate(lang, key)]));
}
