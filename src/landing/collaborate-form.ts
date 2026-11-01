import defaults from "./collaborate-defaults.json" with { type: "json" };
import { sanitizeHeroHtml } from "../api/project/config.js";
import type { LandingLanguage } from "./i18n.js";

type Form = typeof defaults.es;
function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Resuelve valores de fábrica, ajustes del proyecto y traducción de sus textos. */
export function resolveCollaborateForm(raw: unknown, lang: LandingLanguage, translation: unknown = {}): Form {
  const form: Form = structuredClone(defaults[lang]);
  const target = form as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(object(raw))) {
    if (!(key in target)) continue;
    if (["steps", "labels", "helps", "placeholders", "fields"].includes(key)) {
      const section = target[key] as Record<string, string>;
      for (const [field, item] of Object.entries(object(value))) {
        if (!(field in section) || typeof item !== "string" || item.length > 1000) continue;
        if (key === "fields" && !["off", "optional", "required"].includes(item)) continue;
        section[field] = item;
      }
    } else if ((key === "pillars" || key === "nextSteps") && Array.isArray(value)) {
      target[key] = value.filter((item): item is string => typeof item === "string" && item.length <= 1000).slice(0, 10);
    } else if (key === "maxLinks" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10) {
      target[key] = value;
    } else if (typeof target[key] === "string" && typeof value === "string" && value.length <= 1000) {
      target[key] = key === "heroTitleHtml" ? sanitizeHeroHtml(value) ?? "" : value;
    }
  }
  for (const [key, value] of Object.entries(object(translation))) {
    if (!key.startsWith("collab.") || typeof value !== "string" || !value || value.length > 1000) continue;
    const [section, field] = key.slice(7).split(".");
    if (!section) continue;
    if (field && ["steps", "labels", "helps", "placeholders"].includes(section)) {
      const dict = target[section] as Record<string, string>;
      if (field in dict) dict[field] = value;
    } else if (!field && (section === "pillars" || section === "nextSteps")) {
      target[section] = value.split(section === "pillars" ? "," : "\n").map((part) => part.trim()).filter(Boolean);
    } else if (!field && typeof target[section] === "string") {
      target[section] = section === "heroTitleHtml" ? sanitizeHeroHtml(value) ?? "" : value;
    }
  }
  return form;
}

export function visibleSteps(form: Form) {
  const fields: Record<string, string[]> = {
    skills: ["skills", "experience", "links"], contribution: ["areas", "contributionText", "availability"], ideas: ["ideas"],
  };
  const modes = form.fields as Record<string, string>;
  return (["about", "skills", "contribution", "ideas", "review"] as const)
    .filter((key) => !fields[key] || fields[key]!.some((field) => modes[field] !== "off"))
    .map((key) => ({ key, label: form.steps[key], legend: form.steps[key] }));
}
