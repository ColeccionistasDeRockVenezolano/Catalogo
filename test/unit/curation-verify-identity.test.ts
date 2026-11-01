import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  latest: vi.fn(),
  record: vi.fn(),
  gateway: { propose: vi.fn() },
}));

vi.mock("../../src/ai/gateway.js", () => ({ createDeepSeekGateway: () => mocks.gateway }));
vi.mock("../../src/review/artist-merge.js", () => ({
  ARTIST_MERGE_SCHEMA_VERSION: "artist-merge-verdict.v2",
  ARTIST_MERGE_INSTRUCTIONS: "prueba",
  buildDossier: () => ({ facts: [{ id: "a.nombre", text: "A" }], a: { id: 1 }, b: { id: 2 } }),
  classifyArtistPair: mocks.classify,
  loadArtistProfiles: async () => new Map([[1, { id: 1, name: "A" }], [2, { id: 2, name: "B" }]]),
}));
vi.mock("../../src/curation/ai-verdicts.js", () => ({
  AI_VERDICT_PROMPT_VERSION: "artist-merge-verdict.v2:test",
  latestVerdict: mocks.latest,
  recordVerdict: mocks.record,
}));
vi.mock("../../src/curation/feedback.js", () => ({
  loadFeedbackForPairs: async () => new Map(),
}));
vi.mock("../../src/research/local-evidence.js", () => ({
  searchLocalEvidence: async () => [],
}));

import { verifyIdentityAction } from "../../src/curation/actions/verify-identity.js";
import { resetEnvCache } from "../../src/config/env.js";

const finding = {
  id: 1, detector: "artistas_duplicados_evidencia", signature: "evidencia_determinista", status: "open" as const,
  entity: { kind: "artist" as const, id: 1, label: "A" },
  field: "name", value: "A", suggestedValue: null,
  related: [{ kind: "artist" as const, id: 2, label: "B" }],
  title: "A y B",
  evidence: { pair: [1, 2] as [number, number], score: 0.9, signals: 2, deterministic: true, features: [{ key: "tracklist_equal", value: 0.45, evidence: "misma lista" }] },
};

const context = {
  client: { query: vi.fn() } as never, runId: 5, sourceId: 1, operator: "prueba", note: "",
};
const params = { kind: "artist" as const, aId: 1, bId: 2 };
const verdict = {
  decision: "same_identity" as const, confidence: 0.93,
  evidence: [{ fact_id: "a.nombre", supports: "match" as const }, { fact_id: "tracklist_equal", supports: "match" as const }],
  reasoning: "Misma lista y nombre.", data_gaps: [], identity_doubts: [],
};

describe("verificar identidad con IA (unidad)", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test";
    resetEnvCache();
    mocks.classify.mockReset(); mocks.latest.mockReset(); mocks.record.mockReset();
  });

  it("llama a la IA, guarda el veredicto y devuelve el resumen", async () => {
    mocks.latest.mockResolvedValue(null);
    mocks.classify.mockResolvedValue({ verdict, model: "deepseek-test" });
    mocks.record.mockResolvedValue(42);
    const result = await verifyIdentityAction.apply(context, finding, params, { touched: [], before: {}, after: {}, blocked: null, collisions: [], warnings: [], proposal: null });
    expect(mocks.classify).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(context, "artist", 1, 2, verdict, "deepseek-test");
    expect(result.after).toMatchObject({ ai: { decision: "same_identity", confidence: 0.93, evidenceCount: 2 }, cached: false, verdictId: 42 });
  });

  it("reutiliza el veredicto vigente sin volver a llamar a la IA", async () => {
    mocks.latest.mockResolvedValue({
      id: 7, decision: "distinct", confidence: 0.9, evidence: [], reasoning: "x", dataGaps: [], identityDoubts: [],
      model: "deepseek-test", promptVersion: "v2:test", policyVersion: "2", createdAt: "2026-10-29T00:00:00.000Z",
    });
    const result = await verifyIdentityAction.apply(context, finding, params, { touched: [], before: {}, after: {}, blocked: null, collisions: [], warnings: [], proposal: null });
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(result.after).toMatchObject({ ai: { decision: "distinct" }, cached: true, verdictId: 7 });
  });
});
