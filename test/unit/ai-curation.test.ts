import { describe, expect, it } from "vitest";
import {
  draftSchema,
  orderedOperations,
  plannerSchema,
} from "../../src/curation/ai/schema.js";
import {
  DeepSeekGateway,
  MemoryDeepSeekRunStore,
  MockDeepSeekTransport,
} from "../../src/ai/gateway.js";
import { sensitiveOperation } from "../../src/curation/ai/executor.js";
import { evidenceFromPage, hashValue } from "../../src/curation/ai/context.js";
import { prioritizeRetrievedDetail, retainDraft } from "../../src/curation/ai/planner.js";
import { hasRelevantEvidence } from "../../src/curation/ai/evidence.js";
const base = {
  label: "Cambio documentado",
  reason: "Fuente contrastada",
  evidenceIds: ["E1"],
  enabled: true,
};
describe("contratos y dependencias de curaduría IA", () => {
  it("conserva propuestas entre consultas y permite corregir o retirar una propuesta anterior", () => {
    const initial = draftSchema.parse({ summary: "Primera investigación", unresolved: ["Contrastar año"], operations: [
      { ...base, key: "alias", op: "add_alias", target: { kind: "artist", id: 1 }, alias: "Nombre anterior" },
      { ...base, key: "city", op: "replace_fields", target: { kind: "artist", id: 1 }, values: { originCity: "Caracas" } },
    ] });
    const next = draftSchema.parse({ summary: "Nuevas fuentes", unresolved: [], operations: [
      { ...base, key: "genre", op: "assign_genre", target: { kind: "artist", id: 1 }, genreSlug: "punk" },
      { ...base, key: "city", op: "replace_fields", target: { kind: "artist", id: 1 }, values: { originCity: "Valencia" } },
    ] });
    const retained = retainDraft(initial, next);
    expect(retained.operations.map(o => o.key)).toEqual(["alias", "city", "genre"]);
    expect(retained.operations[1]).toMatchObject({ values: { originCity: "Valencia" } });
    expect(retained.unresolved).toEqual(["Contrastar año"]);
    expect(retainDraft(retained, next, ["Contrastar año"]).unresolved).toEqual([]);
    expect(retainDraft(retained, { ...next, operations: [{ ...initial.operations[0]!, enabled: false }] }).operations[0]!.enabled).toBe(false);
  });
  it("lee también datos adicionales al final de una fuente y sus imágenes, con citas literales", () => {
    const content = "Banda venezolana con historia documentada. ".repeat(600)
      + "Sello adicional: Archivo Records. Alias histórico: Los Anteriores. "
      + "Recursos visuales de la página: https://fuente.example/original.jpg (1600 x 1600).";
    const citations = evidenceFromPage({ url: "https://fuente.example/banda", title: "Banda", content, fetchedAt: "2026-10-10", contentHash: "fixture", origin: "page" }, ["historia"], 3);
    expect(citations.length).toBeGreaterThan(6);
    expect(citations.some(e => e.quote.includes("Archivo Records"))).toBe(true);
    expect(citations.some(e => e.quote.includes("https://fuente.example/original.jpg"))).toBe(true);
    expect(citations.every(e => content.includes(e.quote))).toBe(true);
    expect(new Set(citations.map(e => e.id)).size).toBe(citations.length);
  });
  it("una cita de nacionalidad no respalda créditos ni formatos del disco", () => {
    const evidence = [
      {
        id: "E1",
        quote: "nationality_or_origin: Venezuelan",
        url: "https://allmusic.example/artista",
        fetchedAt: "",
        origin: "page",
        contentHash: "",
        label: "Artista",
      },
    ];
    const op = draftSchema.parse({
      summary: "",
      unresolved: [],
      operations: [
        {
          ...base,
          key: "credito",
          op: "create_relation",
          kind: "album_credit",
          endpoints: {
            albumId: { kind: "album", id: 139 },
            personId: { kind: "person", id: 547 },
          },
          values: { role: "Drums & Programming", creditType: "musician" },
        },
      ],
    }).operations[0]!;
    expect(hasRelevantEvidence(op, evidence)).toBe(false);
    const negative = draftSchema.parse({
      summary: "",
      unresolved: [],
      operations: [
        {
          ...base,
          key: "negative",
          op: "replace_fields",
          target: { kind: "person", id: 547 },
          values: { isVenezuelan: false },
        },
      ],
    }).operations[0]!;
    expect(hasRelevantEvidence(negative, evidence)).toBe(false);
    expect(
      hasRelevantEvidence(op, [
        {
          ...evidence[0]!,
          quote: "Alfonso tocó batería y programación en el disco En Vivo.",
        },
      ]),
    ).toBe(true);
  });
  it("reserva espacio para el disco consultado conservando la identidad y evidencia de origen", () => {
    const context: Record<string, unknown> = {
      root: { kind: "artist", id: 58 },
      current: {
        row: { id: 58, name: "Banda" },
        relations: {
          albums: Array.from({ length: 80 }, (_, id) => ({
            id,
            description: "x".repeat(1600),
          })),
        },
      },
      relatedEntities: [],
      evidence: [{ id: "E1", quote: "Documento contrastado" }],
      report: { pending: ["Pista incoherente"] },
    };
    const retrieved = {
      id: 139,
      tracks: Array.from({ length: 20 }, (_, id) => ({
        id,
        title: `Tema ${id}`,
        trackNumber: id + 1,
      })),
    };
    expect(JSON.stringify({ ...context, retrieved }).length).toBeGreaterThan(
      40000,
    );
    prioritizeRetrievedDetail(context);
    expect(JSON.stringify({ ...context, retrieved }).length).toBeLessThan(
      40000,
    );
    expect(context["current"]).toMatchObject({
      row: { id: 58, name: "Banda" },
    });
    expect(context["evidence"]).toEqual([
      { id: "E1", quote: "Documento contrastado" },
    ]);
  });
  it("la huella conserva significado al reordenar claves JSONB", () => {
    expect(
      hashValue({
        values: { role: "Bass", fromYear: 1999, toYear: 2004 },
        at: new Date("2026-10-08T00:00:00Z"),
      }),
    ).toBe(
      hashValue({
        at: "2026-10-08T00:00:00.000Z",
        values: { toYear: 2004, role: "Bass", fromYear: 1999 },
      }),
    );
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
  });
  it("rechaza comandos arbitrarios, referencias mixtas y operaciones desconocidas", () => {
    expect(
      plannerSchema.safeParse({
        summary: "",
        operations: [],
        unresolved: [],
        sql: "DELETE FROM artists",
      }).success,
    ).toBe(false);
    for (const operation of [
      { ...base, key: "a", op: "execute_sql", sql: "DELETE" },
      {
        ...base,
        key: "a",
        op: "remove_entity",
        target: { kind: "artist", id: 1, key: "a" },
      },
    ])
      expect(
        draftSchema.safeParse({
          summary: "",
          operations: [operation],
          unresolved: [],
        }).success,
      ).toBe(false);
  });
  it("no recorta el plan por cantidad de propuestas o pendientes", () => {
    const plan = draftSchema.parse({ summary: "Hallazgos documentados", operations: Array.from({ length: 105 }, (_, i) => ({
      ...base, key: `alias_${i}`, op: "add_alias", target: { kind: "artist", id: 1 }, alias: `Alias ${i}`,
    })), unresolved: Array.from({ length: 45 }, (_, i) => `Dato ${i}: comprobar fuente y entidad`) });
    expect(plan.operations).toHaveLength(105);
    expect(plan.unresolved).toHaveLength(45);
  });
  it("resuelve dependencias aunque el modelo las entregue en orden inverso", () => {
    const draft = draftSchema.parse({
      summary: "",
      unresolved: [],
      operations: [
        {
          ...base,
          key: "disco",
          op: "create_album",
          artist: { kind: "artist", key: "banda" },
          values: { title: "Nuevo disco" },
        },
        {
          ...base,
          key: "banda",
          op: "create_entity",
          kind: "artist",
          values: { name: "Nueva banda" },
        },
      ],
    });
    expect(orderedOperations(draft).map((o) => o.key)).toEqual([
      "banda",
      "disco",
    ]);
    draft.operations[1]!.enabled = false;
    expect(() => orderedOperations(draft)).toThrow(
      "referencia nueva no disponible",
    );
  });
  it("rechaza ciclos, claves repetidas y tipo de ficha incorrecto", () => {
    const one = {
      ...base,
      key: "disco",
      op: "create_entity" as const,
      kind: "album" as const,
      values: { title: "X" },
      parent: { kind: "artist" as const, key: "banda" },
    };
    const two = {
      ...base,
      key: "banda",
      op: "create_entity" as const,
      kind: "artist" as const,
      values: { name: "X" },
      parent: { kind: "album" as const, key: "disco" },
    };
    expect(() =>
      orderedOperations({
        summary: "",
        unresolved: [],
        operations: [one, two],
      }),
    ).toThrow("circular");
    expect(() =>
      orderedOperations({
        summary: "",
        unresolved: [],
        operations: [one, one],
      }),
    ).toThrow("repetida");
    expect(() =>
      orderedOperations({
        summary: "",
        unresolved: [],
        operations: [one, { ...two, kind: "person" }],
      }),
    ).toThrow("referencia nueva no disponible");
  });
  it("distingue ordenar, reemplazar, fusionar y retirar", () => {
    const draft = draftSchema.parse({
      summary: "",
      unresolved: [],
      operations: [
        {
          ...base,
          key: "a",
          op: "replace_fields",
          target: { kind: "artist", id: 1 },
          values: { name: "Nombre corregido" },
        },
        {
          ...base,
          key: "b",
          op: "replace_fields",
          target: { kind: "artist", id: 1 },
          values: { biography: null },
        },
        {
          ...base,
          key: "c",
          op: "merge_entities",
          keep: { kind: "artist", id: 1 },
          drop: { kind: "artist", id: 2 },
        },
        {
          ...base,
          key: "d",
          op: "remove_entity",
          target: { kind: "artist", id: 2 },
        },
      ],
    });
    expect(draft.operations.map(sensitiveOperation)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });
  it("usa Flash para propuestas tipadas y reutiliza la respuesta validada", async () => {
    const transport = new MockDeepSeekTransport({
      summary: "Sin cambios",
      operations: [],
      unresolved: ["Falta evidencia"],
      lookups: [],
    });
    const gateway = new DeepSeekGateway(
      {
        baseUrl: "https://mock.invalid",
        models: { fast: "deepseek-flash", reasoning: "pro", vision: "vision" },
        maxTokens: 6000,
        timeoutMs: 5000,
      },
      transport,
      new MemoryDeepSeekRunStore(),
    );
    const request = {
      taskKind: "curation_plan" as const,
      schemaVersion: "curation-plan.v1",
      responseSchema: plannerSchema,
      instructions: "Propuestas de catálogo",
      input: { root: { kind: "artist", id: 1 } },
    };
    expect((await gateway.propose(request)).cached).toBe(false);
    expect((await gateway.propose(request)).cached).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.model).toBe("deepseek-flash");
    expect(transport.requests[0]?.system).toContain("operaciones tipadas");
  });
});
