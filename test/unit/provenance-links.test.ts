import { describe, expect, it } from "vitest";
import { claimReference, creditSourceGroups, evidenceWebUrl } from "../../web/src/lib/provenance.js";
import type { Claim } from "../../web/src/lib/types.js";

describe("enlaces de origen", () => {
  it("agrupa la fuente repetida entre campos y pistas sin ocultar otras fuentes ni estados", () => {
    const claim: Claim = { id: 1, entityKind: "album_credit", field: "credited_name", rawValue: "Músico", normalizedValue: "Músico", confidence: "high", status: "accepted", sourceId: 1, sourceName: "Sincopa", sourceUrl: null, pageUrl: null, evidence: [{ url: "https://sincopa.com/credit", excerpt: "Guitar" }], seedRowNumber: null, createdBy: "system", createdAt: "2026-10-09T00:00:00Z" };
    const groups = creditSourceGroups([claim, { ...claim, id: 2, field: "credit_role", rawValue: "Guitar" }, claim,
      { ...claim, id: 3, sourceId: 2, sourceName: "Otro sitio", status: "rejected" }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.claims.map((row) => row.id)).toEqual([1, 2]);
    expect(groups[1]!.claims[0]!.status).toBe("rejected");
  });
  it("enlaza la evidencia exacta antes que la página o la portada del sitio", () => {
    const url = "https://open.spotify.com/album/example";
    expect(claimReference({
      evidence: [{ url, excerpt: null }, { url, excerpt: "otra cita" }],
      pageUrl: "https://example.org/page", sourceUrl: "https://example.org/",
    })).toEqual({ url, evidenceUrls: [url, "https://example.org/page"], isSourceHomepage: false });
  });
  it("distingue el enlace general y deja explícita la ausencia de enlaces", () => {
    expect(claimReference({ evidence: [], pageUrl: null, sourceUrl: "https://example.org/" })).toMatchObject({ url: "https://example.org/", isSourceHomepage: true });
    expect(claimReference({ evidence: [{ url: "crv-api://operator-runs/1", excerpt: "Edición" }], pageUrl: null, sourceUrl: null })).toEqual({ url: null, evidenceUrls: [], isSourceHomepage: false });
  });
  it.each(["javascript:alert(1)", "data:text/html,<script/>", "file:///tmp/private", "//example.org", "https://user:secret@example.org/"])("no convierte %s en hipervínculo", (url) => {
    expect(evidenceWebUrl(url)).toBeNull();
  });
});
