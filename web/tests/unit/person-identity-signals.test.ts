import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonIdentitySignals } from "../../src/components/PersonIdentitySignals";
import { PersonComparisonDetails } from "../../src/components/PersonComparisonDetails";
import { compareCatalog, comparisonRows } from "../../../src/review/person-comparison";
import type { PersonFacts } from "../../../src/review/person-candidates";

const facts: PersonFacts = { id: 1, name: "Francisco González", aliases: [], birthDate: null, deathDate: null,
  bandIds: [1], artistIds: [1], albumIds: [], creditTypes: [], projects: [{ name: "Banda Norte", album: null, year: null, role: "Bass" }] };
describe("presentación de ambas investigaciones", () => {
  it("muestra aportes parciales y datos ausentes en lugar de un bono completo", () => {
    const comparison = compareCatalog(facts, { ...facts, id: 2, bandIds: [2], artistIds: [2] });
    comparison.documentary = { a: 7.5, b: 15, bridge: 10 };
    const html = renderToStaticMarkup(createElement(PersonIdentitySignals, { signals: comparisonRows(comparison), score: .525 }));
    expect(html).toContain("+7,5");
    expect(html).toContain("Datos faltantes");
    expect(html).toContain("Evidencia de Francisco González · ficha #1");
    expect(html).toContain("Evidencia de Francisco González · ficha #2");
    expect(html).not.toContain("+25");
  });
  it("muestra evidencia de cada ficha y ofrece el detalle completo mediante un botón", () => {
    const comparison = compareCatalog(facts, { ...facts, id: 2 });
    comparison.a.evidence = [{ url: "https://example.com/a", title: "Fuente A", quote: "Crédito de la ficha A", origin: "page" }];
    comparison.b.evidence = [{ url: "https://example.com/b", title: "Fuente B", quote: "Crédito de la ficha B", origin: "search_snippet" }];
    const html = renderToStaticMarkup(createElement(PersonComparisonDetails, { comparison }));
    expect(html).toContain("Fuente A");
    expect(html).toContain("Fuente B");
    expect(html).toContain("Resumen del buscador");
    expect(html).toContain("Ver datos evaluados y todas las evidencias");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden");
    expect(html).toContain("Nacimiento: Sin dato");
    expect(html).toContain("Año sin dato");
    expect(html).toContain("función sin comprobar");
  });
});
