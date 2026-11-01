import { describe, expect, it } from "vitest";
import { herraPasswordMatches } from "../herra-accounts.js";
import { hashAccessCode, isStrongAccessCode, slugify } from "./validation.js";

describe("credenciales de comunidad", () => {
  it("genera hashes scrypt compatibles con las cuentas Herra", async () => {
    const hash = hashAccessCode("ClaveSegura2026");
    expect(hash.startsWith("scrypt$16384$8$5$")).toBe(true);
    await expect(herraPasswordMatches("ClaveSegura2026", hash)).resolves.toBe(true);
    await expect(herraPasswordMatches("OtraClave2026", hash)).resolves.toBe(false);
  });

  it("exige claves largas con letra y número", () => {
    expect(isStrongAccessCode("ClaveSegura2026", "persona")).toBe(true);
    expect(isStrongAccessCode("corta1", "persona")).toBe(false);
    expect(isStrongAccessCode("solamenteletras", "persona")).toBe(false);
    expect(isStrongAccessCode("1234567890123", "persona")).toBe(false);
    expect(isStrongAccessCode("ClaveSegura2026", "ClaveSegura2026")).toBe(false);
  });

  it("genera usuarios provisionales estables", () => {
    expect(slugify("José Pérez")).toBe("jose-perez");
    expect(slugify("  Ana  María  ")).toBe("ana-maria");
    expect(slugify("!!!")).toMatch(/^colaborador-[a-z0-9]+$/);
  });
});
