import { describe, expect, it } from "vitest";
import { loadQueryLexicon } from "../../src/search/query-interpretation/lexicon.js";
import { segmentQuery, catalogKey, emptyCatalog, type CatalogResolver } from "../../src/search/query-interpretation/segmenter.js";
import { buildQuestions } from "../../src/search/query-interpretation/questions.js";
import { compileInterpretation } from "../../src/search/query-interpretation/compiler.js";
import { rulesAnswers } from "../../src/search/query-interpretation/baselines.js";
import { compareCase, aggregate, noInvention, type QueryGold } from "../../src/search/query-interpretation/evaluation.js";

const lexicon = loadQueryLexicon();
const catalog: CatalogResolver = {
  lookup: literal => catalogKey(literal) === catalogKey("Amor") ? [{ kind: "track", id: 1, name: "Amor" }] : [],
};
const interpret = (text: string, resolver: CatalogResolver = emptyCatalog) => {
  const seg = segmentQuery(text, lexicon, resolver);
  return compileInterpretation(seg, rulesAnswers(seg, buildQuestions(seg, lexicon)), lexicon);
};
const gold = (g: Partial<QueryGold>): QueryGold => ({ status: "query_valid", req: [], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facet: null, ...g });

describe("interpretación de consultas (etapa 3)", () => {
  it("el estado del oyente es contexto y no filtro", () => {
    const r = interpret("Estoy triste, quiero algo alegre");
    expect(r.canonical.req).toEqual(["emotion:joyful"]);
    expect(r.canonical.ctx).toBe(1);
    expect(r.canonical.req).not.toContain("emotion:sad");
  });
  it("un título del catálogo pedido como canción es búsqueda de entidad, no concepto", () => {
    const r = interpret("Busca la canción Amor", catalog);
    expect(r.canonical.status).toBe("entity_lookup");
    expect(r.canonical.req).toEqual([]);
    expect(r.canonical.ent[0]).toMatchObject({ role: "target", literal: "amor" });
  });
  it("la negación excluye solo su alcance", () => {
    const r = interpret("algo alegre sin tristeza");
    expect(r.canonical.req).toContain("emotion:joyful");
    expect(r.canonical.exc).toContain("emotion:sad");
  });
  it("una preferencia no se vuelve requisito", () => {
    const r = interpret("música para estudiar, preferiblemente rock");
    expect(r.canonical.req).toEqual(["activity:concentration"]);
    expect(r.canonical.pref).toEqual(["genre:rock"]);
  });
  it("lo no representable queda pendiente y no se declara identificado", () => {
    const r = interpret("Música sin voces");
    expect(r.canonical.status).toBe("unsupported");
    expect(r.canonical.pending).toBeGreaterThan(0);
  });
  it("una contradicción no se ejecuta", () => {
    expect(interpret("algo alegre pero sin alegría").canonical.status).toBe("contradiction");
  });
  it("la intención compilada valida el contrato sin ids inventados", () => {
    const r = interpret("música nocturna para estudiar");
    expect(r.canonical.req.sort()).toEqual(["activity:concentration", "atmosphere:nocturnal"]);
    expect(r.intention.engine).toBe("laya");
  });
});

describe("evaluación de la etapa 3", () => {
  it("marca la polaridad invertida y la restricción descartada como errores críticos", () => {
    const base = { status: "query_valid" as const, req: ["emotion:sad"], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [] };
    const c = { id: "x", category: "negation", text: "sin tristeza", gold: gold({ exc: ["emotion:sad"] }) };
    expect(compareCase(c, base).critical).toContain("polarity_inverted");
    const u = { id: "y", category: "unsupported", text: "rock sin voces", gold: gold({ status: "partial", req: ["genre:rock"], pending: 1 }) };
    expect(compareCase(u, { ...base, req: ["genre:rock"] }).critical).toContain("restriction_dropped");
  });
  it("cuenta la sobreconfianza como respuesta errónea sin abstención", () => {
    const c = { id: "z", category: "emotion", text: "algo alegre", gold: gold({ req: ["emotion:joyful"] }) };
    const wrong = { status: "query_valid" as const, req: ["emotion:sad"], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [] };
    expect(aggregate([c], [wrong]).overconfidence).toBe(1);
    expect(aggregate([c], [{ ...wrong, status: "clarify", req: [] }]).overconfidence).toBe(0);
  });
  it("no invención en tráfico real", () => {
    const p = { status: "query_valid" as const, req: ["activity:intimacy"], exc: [], any: [], pref: [], ctx: 0, ent: [], pending: 0, alts: [], facets: [] };
    expect(noInvention(["activity:intimacy"], p)).toBe(true);
    expect(noInvention([], p)).toBe(false);
  });
});
