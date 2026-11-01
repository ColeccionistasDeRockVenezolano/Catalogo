import { describe, expect, it } from "vitest";
import { isBot, localDay, normalizeCountry } from "./visits.js";

describe("visitas", () => {
  it("normaliza países y manda lo desconocido a zz", () => {
    expect(normalizeCountry("VE")).toBe("ve");
    expect(normalizeCountry("br")).toBe("br");
    expect(normalizeCountry("XX")).toBe("zz");
    expect(normalizeCountry("T1")).toBe("zz");
    expect(normalizeCountry("USA")).toBe("zz");
    expect(normalizeCountry(null)).toBe("zz");
  });

  it("distingue personas de rastreadores", () => {
    expect(isBot("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0")).toBe(false);
    expect(isBot("Mozilla/5.0 HeadlessChrome/120.0.0.0")).toBe(true);
    expect(isBot("curl/8.5.0")).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });

  it("usa el día de America/Caracas, no UTC", () => {
    expect(localDay(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(localDay(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
  });
});
