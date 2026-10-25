import { describe, expect, it } from "vitest";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { coherentSummary, consolidateDraft, finalizeDoubts } from "../../src/curation/ai/plan-coherence.js";
import { triageDoubts } from "../../src/curation/ai/doubt-triage.js";
import type { CatalogDraft, CatalogOperation } from "../../src/curation/ai/types.js";

const base = { reason: "Documentado", enabled: true };
const band = { kind: "artist" as const, id: 58 };
const person = (key: string, name: string, evidence = ["E1"]): CatalogOperation => ({ ...base, key, label: `Crear persona: ${name}`, evidenceIds: evidence, op: "create_entity", kind: "person", values: { name } });
const member = (key: string, personRef: { kind: "person"; key: string } | { kind: "person"; id: number }, values: Record<string, string | number | boolean | null>, evidence = ["E1"]): CatalogOperation =>
  ({ ...base, key, label: `Añadir integrante ${key}`, evidenceIds: evidence, op: "create_relation", kind: "artist_membership", endpoints: { artistId: band, personId: personRef }, values });
const gateway = (transport: MockDeepSeekTransport) => new DeepSeekGateway({ baseUrl: "https://example.com", models: { fast: "mock", reasoning: "mock", vision: "mock" }, maxTokens: 4096, timeoutMs: 1000 }, transport, new MemoryDeepSeekRunStore());

describe("coherencia de un plan preparado por lotes", () => {
  it("une la misma persona nueva y su membresía aunque un lote omita una palabra del nombre", () => {
    const draft: CatalogDraft = { summary: "", unresolved: [], operations: [
      person("a", "Miguel Ángel «El Enano» González"), member("ma", { kind: "person", key: "a" }, { role: "guitarra", fromYear: null, toYear: null, isCurrent: false }),
      person("b", "Miguel González «El Enano»", ["E2"]), member("mb", { kind: "person", key: "b" }, { role: "guitarra", fromYear: 1991, toYear: 2019, isCurrent: false }, ["E2"]),
    ] };
    const { draft: joined, stats } = consolidateDraft(draft);
    expect(joined.operations.map(op => op.key)).toEqual(["a", "ma"]);
    const membership = joined.operations[1]!;
    expect(membership.op === "create_relation" && membership.values).toEqual({ role: "guitarra", fromYear: 1991, toYear: 2019, isCurrent: false });
    expect(membership.evidenceIds).toEqual(["E1", "E2"]);
    expect(stats.repeated).toBe(2);
  });
  it("conserva una discrepancia como duda y no mezcla etapas que no se solapan", () => {
    const pinto = { kind: "person" as const, id: 4161 };
    const { draft } = consolidateDraft({ summary: "", unresolved: [], operations: [
      member("x", pinto, { role: "batería", fromYear: 1998, toYear: 2007 }), member("y", pinto, { role: "bajo", fromYear: 1998, toYear: 2007 }, ["E2"]),
      member("z", pinto, { role: "batería", fromYear: 2010, toYear: 2012 }, ["E3"]),
    ] });
    expect(draft.operations.map(op => op.key)).toEqual(["x", "z"]);
    expect(draft.unresolved).toEqual([expect.stringContaining("role: «batería» / «bajo» (E2)")]);
  });
  it("deja como duda una propuesta sin cita y una segunda versión del mismo campo", () => {
    const bio = (key: string, text: string, evidence: string[]): CatalogOperation => ({ ...base, key, label: `Biografía ${key}`, evidenceIds: evidence, op: "replace_fields", target: band, values: { biography: text } });
    const { draft } = consolidateDraft({ summary: "", unresolved: [], operations: [
      bio("corta", "Banda caraqueña.", ["E1"]), bio("larga", "Banda caraqueña fundada en 1991 por cuatro amigos.", ["E2"]),
      member("catalogo", { kind: "person", id: 4161 }, { role: "Drums, Guitar" }, []),
    ] });
    expect(draft.operations.map(op => op.key)).toEqual(["larga"]);
    expect(draft.unresolved).toEqual(["Otra propuesta para el mismo dato que «Biografía larga»: Biografía corta (E1).", "Añadir integrante catalogo: sin cita que la respalde. Documentado"]);
  });
  it("retira las ausencias de un lote cuando el plan propone ese dato y el resumen cuenta lo que contiene", () => {
    const stats = { repeated: 0, registered: 0, completed: 0, doubts: 0 };
    const draft = finalizeDoubts({ summary: "", operations: [
      member("pinto", { kind: "person", id: 4161 }, { role: "integrante" }),
      { ...base, key: "ska", label: "Añadir género: Ska", evidenceIds: ["E2"], op: "assign_genre", target: band, genreSlug: "ska", role: "secondary" },
    ].map(op => op.key === "pinto" ? { ...op, label: "Añadir a Antonio Pinto como exintegrante" } : op) as CatalogOperation[], unresolved: [
      "Antonio Pinto: las citas E7–E9 no mencionan su nombre ni su rol.",
      "Género Ska: no existe en la taxonomía suministrada.",
      "Luis Golding: ninguna cita documenta su período.",
      "Luis Golding: las citas de esta tarea no lo mencionan.",
      "Flor de fuego: la fuente dice 2007 y la ficha 2006.",
    ] }, stats);
    expect(draft.unresolved).toEqual(["Luis Golding: las citas de esta tarea no lo mencionan.", "Flor de fuego: la fuente dice 2007 y la ficha 2006."]);
    expect(stats.doubts).toBe(3);
    expect(coherentSummary(draft, stats, 4)).toBe("2 propuestas: añadir relación 1, añadir género 1. 2 dudas quedan para revisión (preparado en 4 lotes). Se agruparon o retiraron 3 dudas repetidas o ya resueltas.");
  });
  it("la clasificación de dudas nunca borra lo que el modelo omite ni lo que atribuye a una operación inexistente", async () => {
    const draft: CatalogDraft = { summary: "", operations: [member("pinto", { kind: "person", id: 4161 }, { role: "integrante" })], unresolved: ["uno", "dos", "tres", "cuatro", "cinco"] };
    const transport = new MockDeepSeekTransport({ groups: [{ keep: 0, same: [1] }], drop: [{ index: 2, reason: "absence_in_lot" }, { index: 3, reason: "resolved_by_operation", operation: "inventada" }] });
    const { draft: triaged, triage } = await triageDoubts(gateway(transport), draft);
    expect(triaged.unresolved).toEqual(["uno (+1 lote coincide)", "cuatro", "cinco"]);
    expect(triage).toMatchObject({ merged: 1, dropped: { absence_in_lot: 1 }, fallback: 2 });
  });
});
