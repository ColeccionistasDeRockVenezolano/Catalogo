import { describe, expect, it } from "vitest";
import { sourceDates } from "../../src/lib/sourceDates";

describe("fechas de fuentes", () => {
  it("muestra la captura antigua separada de su relectura actual", () => {
    const label = sourceDates({ capturedAt: "2001-05-06T00:00:00Z", readAt: "2026-10-10T12:00:00Z", acquisitionMethod: "raw_archive" });
    expect(label).toMatch(/Capturada.*2001/); expect(label).toMatch(/Leída.*2026/); expect(label).toContain("Archivo conservado");
  });
  it("una fecha del contrato histórico no se presenta como captura verificada", () => {
    const label = sourceDates({ fetchedAt: "2015-01-01T00:00:00Z" });
    expect(label).toContain("Captura original sin fecha verificada"); expect(label).toMatch(/Fecha histórica sin verificar:.*2015/);
    expect(label).not.toContain("Capturada");
  });
  it("fechas desconocidas o inválidas no generan una fecha inventada ni Invalid Date", () => {
    const label = sourceDates({ capturedAt: null, readAt: "inválida", fetchedAt: "2026-10-10" });
    expect(label).toBe("Captura original sin fecha verificada · Método no registrado");
  });
});
