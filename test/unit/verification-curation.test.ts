import { describe, expect, it } from "vitest";
import { curationFindings, findingInstruction } from "../../src/verification/curation.js";
import type { VerificationFinding } from "../../src/verification/types.js";

const finding = (key: string, status: VerificationFinding["status"], observed: string | null = null): VerificationFinding => ({
  key, status, observed, area: "genres", label: "Género", value: null, expected: [], context: [], issue: null,
  explanation: "Consultar la fuente", coverage: 0, evidence: [],
});
describe("pendientes para propuestas editoriales", () => {
  it("incluye todas las recomendaciones, faltantes sin valor e incoherencias, sin confundir datos confirmados o sin verificar", () => {
    const suggestions = Array.from({length: 65}, (_, i) => finding(`suggested.${i}`, "unverified", `Valor ${i}`));
    const queue = curationFindings({ suggestions, findings: [finding("suggested.0", "missing"), finding("empty", "missing"), finding("wrong", "contradicted", "1991"), finding("ok", "confirmed"), finding("unknown", "unverified")] });
    expect(queue).toHaveLength(67);
    expect(queue.map(f => f.key)).toContain("suggested.64");
    expect(queue.map(f => f.key)).toContain("empty");
    expect(queue.map(f => f.key)).not.toContain("unknown");
  });
  it("pide investigar los valores ausentes sin inventarlos y permite seleccionar el hallazgo exacto", () => {
    const instruction = findingInstruction(finding("member.505.from", "missing"));
    expect(instruction).toContain("hallazgo member.505.from (");
    expect(instruction).toContain("investiga las fuentes");
    expect(instruction).toContain("sin inventarlo");
  });
});
