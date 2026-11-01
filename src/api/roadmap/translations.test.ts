import { describe, expect, it } from "vitest";
import { isTranslationsInput, localizeRow, parseTranslations, serializeTranslations } from "./translations.js";

describe("traducciones del roadmap", () => {
  it("lee y localiza el inglés con caída al español", () => {
    expect(parseTranslations('{"en":"What we have done"}')).toEqual({ en: "What we have done" });
    expect(localizeRow('{"en":"What we have done"}', "Lo que hemos hecho", "en")).toBe("What we have done");
    expect(localizeRow(null, "Lo que hemos hecho", "en")).toBe("Lo que hemos hecho");
    expect(localizeRow('{"en":"What"}', "Lo que hemos hecho", "es")).toBe("Lo que hemos hecho");
  });

  it("ignora JSON corrupto o vacío", () => {
    expect(parseTranslations("no-json")).toEqual({});
    expect(parseTranslations('{"en":"   "}')).toEqual({});
  });

  it("normaliza al guardar y borra con un objeto vacío", () => {
    expect(serializeTranslations({ en: "  Hello <b>  " })).toBe('{"en":"Hello b"}');
    expect(serializeTranslations({ en: "   " })).toBeNull();
    expect(serializeTranslations({})).toBeNull();
    expect(isTranslationsInput({ en: "ok" })).toBe(true);
    expect(isTranslationsInput({ fr: "non" })).toBe(false);
  });
});
