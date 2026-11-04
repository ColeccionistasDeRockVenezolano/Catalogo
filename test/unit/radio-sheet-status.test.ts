import { describe, expect, it } from "vitest";
import { sheetStatusOf } from "../../src/radio/sheet-status.js";

const blocked = (count: number) => ({ contentDetails: { regionRestriction: { blocked: Array.from({ length: count }, (_, index) => `R${index}`) } } });

describe("estado de un video en la hoja YT Master", () => {
  it("público con veto parcial sigue Listed; con veto casi mundial, Blocked", () => {
    expect(sheetStatusOf("published", {})).toBe("Listed");
    expect(sheetStatusOf("published", blocked(8))).toBe("Listed");
    expect(sheetStatusOf("published", blocked(249))).toBe("Blocked");
    expect(sheetStatusOf("copyright_blocked", {})).toBe("Blocked");
  });

  it("distingue oculto o privado de lo que ya no existe", () => {
    expect(sheetStatusOf("unlisted", {})).toBe("Unlisted");
    expect(sheetStatusOf("unpublished", { status: { privacyStatus: "private" } })).toBe("Unlisted");
    expect(sheetStatusOf("unpublished", { status: { privacyStatus: "public" } })).toBe("Removed");
    expect(sheetStatusOf("unpublished", null)).toBe("Removed");
  });
});
