import { describe, expect, it } from "vitest";
import { buildPersonComparison, type PersonContext } from "../../src/ambiguity/person-web-verification.js";
import type { WebPage } from "../../src/ambiguity/web-search.js";
import { compareCatalog } from "../../src/review/person-comparison.js";
import { personIdentityAssessment } from "../../src/review/person-identity-assessment.js";
import type { PersonFacts } from "../../src/review/person-candidates.js";

export function comparisonFixture() {
  const a: PersonContext = { id: 1, name: "Francisco González", birthDate: null, deathDate: null, sourceUrls: [],
    projects: [{ name: "Banda Norte", album: null, year: 2013, role: "Bass" }] };
  const b: PersonContext = { ...a, id: 2, projects: [{ name: "Banda Sur", album: null, year: 2013, role: "Bass" }] };
  const facts = (p: PersonContext, band: number): PersonFacts => ({ id: p.id, name: p.name, aliases: [], birthDate: null, deathDate: null,
    bandIds: [band], artistIds: [band], albumIds: [], creditTypes: [], projects: p.projects.map((x) => ({ ...x, album: x.album ?? null })) });
  const pair: [PersonFacts, PersonFacts] = [facts(a, 10), facts(b, 20)];
  const page = (url: string, content: string): WebPage => ({ url, title: "Biografía", content, contentHash: "hash", fetchedAt: "2026-10-07" });
  const pages = [page("https://bandanorte.example/perfil", "Francisco González Bass integrante de Banda Norte desde 2013. Francisco González Bass integrante de Banda Sur desde 2013."),
    page("https://bandasur.example/perfil", "Francisco González Bass integrante de Banda Sur desde 2013.")];
  const validated = { verdict: "same" as const, rationale: "Una página conecta ambas bandas.", evidence: [{ url: pages[0]!.url, title: "Biografía", quote: "Francisco González Bass", supports: "same" as const }] };
  const report = buildPersonComparison(a, b, pages, validated, pair);
  return { a, b, pair, pages, validated, report };
}

describe("comparación documental de ambas fichas", () => {
  it("comprueba cada lado, conecta los proyectos y reserva 60 puntos a la evidencia", () => {
    const { report, validated } = comparisonFixture();
    expect(report.documentary).toEqual({ a: 20, b: 20, bridge: 20 });
    expect(personIdentityAssessment(0.4, { ...validated, comparison: report })).toMatchObject({ score: 0.8, evidencePoints: 60, recommendation: "consider_merge" });
    expect(report.a.evidence[0]!.quote).toContain("Francisco González Bass");
    expect(report.b.evidence.length).toBeGreaterThan(0);
  });
  it("un perfil individual con identidad explícita puede conectar dos bandas sin exigir dos sitios", async () => {
    const { a, b, pages, validated } = comparisonFixture();
    const { pairPolicyContext, validateWebVerdict } = await import("../../src/ambiguity/person-web-verification.js");
    const profile = { ...pages[0]!, url: "https://www.metal-archives.com/artists/Francisco_Gonzalez/123", content: `Real/full name Francisco González. ${pages[0]!.content}` };
    expect(validateWebVerdict({ ...validated, evidence: [], uncertainties: [], groups: [] }, [profile], pairPolicyContext(a,b,[profile])).verdict).toBe("same");
    const bandPage = { ...profile, url: "https://www.metal-archives.com/bands/Banda_Norte/123" };
    expect(validateWebVerdict({ ...validated, evidence: [], uncertainties: [], groups: [] }, [bandPage], pairPolicyContext(a,b,[bandPage])).verdict).toBe("unknown");
  });
  it("un año ausente y una función sin comprobar no reciben el aporte completo", () => {
    const { a, b, pair, pages, validated, report } = comparisonFixture();
    const sparse = { ...a, projects: a.projects.map((p) => ({ ...p, year: null, role: "Productor" })) };
    const partial = buildPersonComparison(sparse, b, pages, validated, pair);
    expect(partial.documentary.a).toBe(10);
    expect(partial.documentary.a).toBeLessThan(report.documentary.a);
    expect(partial.a.projects[0]!.checks).toMatchObject({ year: false, role: false });
  });
  it("no recomienda fusionar cuando solo una ficha tiene respaldo", () => {
    const { a, b, pair, pages, validated } = comparisonFixture();
    const report = buildPersonComparison(a, b, [pages[1]!], validated, pair);
    expect(report.documentary.a).toBe(0);
    expect(report.bridge).toHaveLength(0);
    expect(personIdentityAssessment(.4, { ...validated, comparison: report }).recommendation).toBe("wait");
  });
  it("no infla el puntaje repitiendo una página y reduce los resúmenes del buscador", () => {
    const { a, b, pair, pages, validated, report } = comparisonFixture();
    expect(buildPersonComparison(a, b, [...pages, ...pages], validated, pair).documentary).toEqual(report.documentary);
    const snippets = buildPersonComparison(a, b, pages.map((p) => ({ ...p, origin: "search_snippet" as const })), validated, pair);
    expect(snippets.documentary.a).toBe(5);
    expect(personIdentityAssessment(.4, { ...validated, comparison: snippets }).recommendation).toBe("wait");
  });
  it("invalida el respaldo anterior si cambian los datos y conserva A/B al invertir el par", () => {
    const { pair, report } = comparisonFixture();
    report.documentary.a = 10;
    expect(compareCatalog(pair[1], pair[0], report).documentary).toMatchObject({ a: 20, b: 10 });
    const changed = compareCatalog({ ...pair[0], birthDate: "1980-01-01" }, pair[1], report);
    expect(changed.stale).toBe(true);
    expect(changed.documentary).toEqual({ a: 0, b: 0, bridge: 0 });
    expect(changed.a.projects[0]!.evidence).toHaveLength(0);
  });
  it("evalúa todos los créditos, sin cortar la trayectoria en 40 registros", () => {
    const { a, b, pair, pages, validated } = comparisonFixture();
    const long = { ...a, projects: Array.from({ length: 80 }, (_, index) => ({ ...a.projects[0]!, album: `Disco ${index}` })) };
    expect(buildPersonComparison(long, b, pages, validated, pair).a.projects).toHaveLength(80);
  });
});
