import { describe, expect, it } from "vitest";
import { closeCaseSchema, DIAGNOSES, followUp, missKey, openCaseSchema, opensReviewTask } from "../../src/search/improvement.js";

describe("bandeja de mejora del buscador", () => {
  it("solo «falta conocimiento» abre una tarea de curaduría", () => {
    const opening = (Object.keys(DIAGNOSES) as Array<keyof typeof DIAGNOSES>).filter(opensReviewTask);
    expect(opening).toEqual(["missing_knowledge"]);
  });
  it("el seguimiento cuenta lo ocurrido desde el cierre y nunca es negativo", () => {
    expect(followUp(10, 14)).toBe(4);
    expect(followUp(10, 10)).toBe(0);
    expect(followUp(10, 3)).toBe(0); // el registro histórico se poda: no inventar cifras negativas
    expect(followUp(null, 14)).toBeNull();
  });
  it("valida el diagnóstico y rechaza campos desconocidos", () => {
    expect(openCaseSchema.safeParse({ query: "rock triste", diagnosis: "missing_knowledge" }).success).toBe(true);
    expect(openCaseSchema.safeParse({ query: "rock triste", diagnosis: "inventado" }).success).toBe(false);
    expect(openCaseSchema.safeParse({ query: "", diagnosis: "other" }).success).toBe(false);
    expect(openCaseSchema.safeParse({ query: "x", diagnosis: "other", extra: 1 }).success).toBe(false);
    expect(closeCaseSchema.safeParse({ status: "open" }).success).toBe(false);
    expect(closeCaseSchema.parse({ status: "resolved" }).note).toBe("");
  });
  it("la clave sale del texto sanitizado, igual que el registro de consultas sin resultados", () => {
    expect(missKey("  Rock   TRISTE ")).toBe(missKey("rock triste"));
    expect(missKey("escríbeme a juan@example.com")).not.toContain("example.com");
  });
});
