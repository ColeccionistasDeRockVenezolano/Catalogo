import { describe, expect, it } from "vitest";
import { groupBySubject, planEnded, proposalSection, proposalState, summarizeRecord } from "../../src/lib/recordReview";
import type { CatalogOperation, CatalogPlan } from "../../../src/curation/ai/types";

const base = { label: "", reason: "", evidenceIds: ["E1"], enabled: true };
const artist = { kind: "artist" as const, id: 6912 };
const ops: CatalogOperation[] = [
  { ...base, key: "ig", op: "add_social_link", target: artist, platform: "instagram", url: "https://www.instagram.com/x", handle: "x" },
  { ...base, key: "genero", op: "assign_genre", target: artist, genreSlug: "salsa", role: "secondary" },
  { ...base, key: "sello", op: "create_entity", kind: "organization", values: { name: "Avila Records" } },
  { ...base, key: "fundador", op: "create_relation", kind: "person_organization", endpoints: { personId: { kind: "person", id: 15368 }, organizationId: { kind: "organization", key: "sello" } }, values: { role: "fundador" } },
  { ...base, key: "pistas", op: "replace_fields", target: { kind: "album", id: 27694 }, values: { releaseYear: 2009 } },
  { ...base, key: "credito", op: "create_relation", kind: "track_credit", endpoints: { trackId: { kind: "track", id: 1 }, personId: { kind: "person", id: 815 } }, values: { role: "Producción" } },
  { ...base, key: "origen", op: "replace_fields", target: artist, values: { originCity: "Caracas" } },
];
const plan = (patch: Partial<CatalogPlan> = {}): CatalogPlan => ({
  id: 84, entityKind: "artist", entityId: 6912, instruction: "", status: "ready", phase: "ready", revision: 1,
  draft: { summary: "", operations: ops, unresolved: ["Facebook sin cita", "Fecha del primer disco"] }, evidence: [],
  preview: { hash: "", ready: true, sensitive: false, affected: [], items: [
    { key: "origen", op: "replace_fields", label: "", before: null, after: null, error: "Respaldo insuficiente: ciudad de origen «Caracas».", warnings: [], evidenceGaps: ["ciudad de origen «Caracas»"] },
    { key: "credito", op: "create_relation", label: "", before: null, after: null, error: "la pista ya no existe", warnings: [] },
  ] },
  reviewedKeys: [], decisions: { ig: { decision: "accepted", decidedBy: "Brian", decidedAt: "", runId: 1 } }, result: { runId: 1, created: {} },
  usage: { calls: 0, cachedCalls: 0, tokensIn: 0, tokensOut: 0 }, requestedBy: "", editedBy: null, appliedBy: null, error: null, runId: null, createdAt: "", updatedAt: "",
  ...patch,
});

describe("recorrido «Investigar y completar» en la ficha", () => {
  it("reparte las propuestas: discos, pistas y créditos a Discografía; el resto a Datos", () => {
    expect(Object.fromEntries(ops.map((op) => [op.key, proposalSection(op)]))).toEqual({
      ig: "datos", genero: "datos", sello: "datos", fundador: "datos", pistas: "discografia", credito: "discografia", origen: "datos",
    });
  });
  it("distingue lo documentado, lo que requiere criterio, lo que espera otra ficha y lo bloqueado", () => {
    const current = plan();
    expect(Object.fromEntries(ops.map((op) => [op.key, proposalState(current, op)]))).toEqual({
      ig: "accepted", genero: "ready", sello: "ready", fundador: "waiting", pistas: "ready", credito: "blocked", origen: "judgement",
    });
    // Once the label is accepted, its founder can be decided.
    const created = plan({ result: { runId: 2, created: { sello: { kind: "organization", id: 7719 } } }, decisions: { sello: { decision: "accepted", decidedBy: "Brian", decidedAt: "", runId: 2 } } });
    expect(proposalState(created, ops[3]!)).toBe("ready");
  });
  it("agrupa por la ficha que cambia y mantiene el orden del plan", () => {
    expect(groupBySubject(ops).map((group) => [group.key, group.operations.map((op) => op.key)])).toEqual([
      ["artist:6912", ["ig", "genero", "origen"]], ["organization:nuevo:sello", ["sello"]], ["person:15368", ["fundador"]],
      ["album:27694", ["pistas"]], ["track:1", ["credito"]],
    ]);
  });
  it("resume pendientes y siguientes pasos sin mezclar respaldado con pendiente", () => {
    const summary = summarizeRecord(plan(), 2);
    expect(summary.counts).toMatchObject({ accepted: 1, ready: 3, judgement: 1, waiting: 1, blocked: 1 });
    expect(summary.bySection).toEqual({ datos: { open: 4, ready: 2 }, discografia: { open: 2, ready: 1 } });
    expect(summary.next).toEqual([
      "Decide 2 cambios documentados en Datos.",
      "Decide 1 cambio documentado en Discografía.",
      "Elige imagen en 2 fichas (Imágenes).",
      "Revisa 1 cambio que requiere tu criterio: falta respaldo o se parece a otra ficha.",
      "1 cambio espera a que aceptes la ficha que crean otros cambios.",
      "Consulta 2 dudas sin resolver con lo que falta para resolverlas.",
    ]);
  });
  it("explica por qué terminó la investigación aunque queden dudas", () => {
    expect(planEnded(plan())).toMatch(/propone lo que está documentado y deja como dudas/u);
    expect(planEnded(plan({ phase: "partial" }))).toMatch(/incompleta/u);
    expect(planEnded(plan({ draft: { summary: "", operations: [], unresolved: [] } }))).toMatch(/sin encontrar datos nuevos/u);
    expect(planEnded(plan({ status: "running" }))).toBeNull();
  });
});
