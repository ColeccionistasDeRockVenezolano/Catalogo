import { describe, expect, it } from "vitest";
import { sourceProvenance } from "../../src/evidence/provenance.js";

describe("procedencia temporal de fuentes", () => {
  it.each([
    "2001-05-06T00:00:00.123456Z",
    "2001-05-05T21:00:00.123456-03:00",
    "2001-05-06 00:00:00.123456+00",
    "2000-02-29T00:00:00Z",
  ])("conserva el instante completo sin perder precisión: %s", instant => {
    expect(sourceProvenance({ capturedAt: instant, readAt: instant, acquisitionMethod: "raw_archive" })).toEqual({ capturedAt: instant, readAt: instant, acquisitionMethod: "raw_archive" });
  });
  it.each([
    "2001", "2001-05", "2001-05-06", "2001-05-06T00:00:00",
    "2001-02-29T00:00:00Z", "2001-05-06T24:00:00Z", "fecha ilegible", null, 978307200,
  ])("no convierte un valor parcial, inválido o sin huso en captura: %s", value => {
    expect(sourceProvenance({ capturedAt: value, readAt: value, acquisitionMethod: "http" })).toEqual({ capturedAt: null, readAt: null, acquisitionMethod: "http" });
  });
  it("una fecha legible no acredita un método de captura desconocido", () => {
    const instant = "2001-05-06T00:00:00Z";
    expect(sourceProvenance({ capturedAt: instant, readAt: instant, acquisitionMethod: "inventado" })).toEqual({ capturedAt: null, readAt: instant, acquisitionMethod: "unknown" });
    expect(sourceProvenance({})).toEqual({ capturedAt: null, readAt: null, acquisitionMethod: "unknown" });
  });
});
