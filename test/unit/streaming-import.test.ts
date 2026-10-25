import { describe, expect, it } from "vitest";
import { exactPlatformAlbum, streamingImportDisposition as disposition } from "../../src/verification/streaming-import.js";
describe("incremental streaming imports", () => {
  it("preserves verified and human-edited URLs, including intentional unverified links", () => {
    const incoming = { url: "https://new", verified: true };
    expect(disposition({ url: "https://old", verified: true, source: "rym" }, incoming)).toBe("protected");
    expect(disposition({ url: "https://old", verified: false, source: "crv-operador" }, incoming)).toBe("protected");
  });
  it("promotes an existing candidate once without downgrading or repeating it", () => {
    const incoming = { url: "https://same", verified: true };
    expect(disposition({ ...incoming, verified: false, source: "deezer" }, incoming)).toBe("promote");
    expect(disposition({ ...incoming, source: "deezer" }, incoming)).toBe("unchanged");
    expect(disposition({ ...incoming, source: "deezer" }, { ...incoming, verified: false })).toBe("unchanged");
  });
  it("does not replace one uncertain candidate with another", () => {
    expect(disposition({ url: "old", verified: false, source: "deezer" }, { url: "new", verified: false })).toBe("protected");
    expect(disposition(undefined, { url: "new", verified: true })).toBe("insert");
  });
  it("keeps edition words and requires matching known years", () => {
    expect(exactPlatformAlbum("Sobredósis", "Sobredosis", 2023, 2023)).toBe(true);
    expect(exactPlatformAlbum("Sobredosis (Remix)", "Sobredosis", 2023, 2023)).toBe(false);
    expect(exactPlatformAlbum("Sobredosis", "Sobredosis", 2024, 2023)).toBe(false);
    expect(exactPlatformAlbum(undefined, "Sobredosis", 2023, 2023)).toBe(false);
  });
});
