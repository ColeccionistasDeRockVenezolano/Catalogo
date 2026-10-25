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
  it("la procedencia queda pendiente en su propio fragmento (1.1.0)", () => {
    const seg = segmentQuery("rock alegre hecho en colombia", lexicon, emptyCatalog);
    const origin = seg.spans.filter(s => s.cue === "origin");
    expect(origin.map(s => s.text)).toEqual(["colombia"]);
    const r = interpret("rock alegre hecho en colombia");
    expect(r.canonical.status).toBe("partial");
    expect(r.canonical.req.sort()).toEqual(["emotion:joyful", "genre:rock"]);
  });
  it("lo negado no se descarta como relleno aunque Laya lo llame relleno (1.1.0)", () => {
    const seg = segmentQuery("algo alegre sin coros", lexicon, emptyCatalog);
    const tasks = buildQuestions(seg, lexicon);
    const answers = rulesAnswers(seg, tasks);
    const residual = seg.spans.find(s => s.kind === "residual" && s.mode === "excluded")!;
    answers[`dim:${residual.id}`] = { choice: "filler", probabilities: { filler: 0.99 } };
    const r = compileInterpretation(seg, answers, lexicon);
    expect(r.canonical.pending).toBeGreaterThan(0);
    expect(r.canonical.status).not.toBe("query_valid");
  });
  it("«sin parar» es una expresión hecha, no una negación (1.1.0)", () => {
    const seg = segmentQuery("salsa pa bailar sin parar", lexicon, emptyCatalog);
    expect(seg.spans.some(s => s.mode === "excluded")).toBe(false);
  });
  it("la referencia de parecido se resuelve como artista si el catálogo la tiene (1.1.0)", () => {
    const both: CatalogResolver = { lookup: l => catalogKey(l) === catalogKey("Los Gatos") ? [{ kind: "artist", id: 7, name: "Los Gatos" }, { kind: "track", id: 9, name: "Los Gatos" }] : [] };
    const r = interpret("algo parecido a Los Gatos", both);
    expect(r.canonical.ent[0]).toMatchObject({ role: "reference", kind: "artist" });
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
