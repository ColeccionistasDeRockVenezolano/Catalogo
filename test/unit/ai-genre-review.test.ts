import { describe, expect, it } from "vitest";
import { genreReviewCandidates } from "../../src/curation/ai/genre-review.js";
import { findingInstruction } from "../../src/verification/curation.js";
import type { CatalogEvidence } from "../../src/curation/ai/types.js";
import type { VerificationFinding } from "../../src/verification/types.js";

const citation: CatalogEvidence = { id: "E1", quote: "Género(s) RockPunkPop punkRock alternativoSoft rockPop Rock", url: "https://fuente.example/banda", fetchedAt: "", origin: "page", contentHash: "", label: "Géneros" };
const terms = ["Rock", "Punk", "Pop punk", "Rock alternativo", "Soft rock", "Pop rock", "Hard rock", "Pop", "Punk rock"].map(name => ({ name, slug: name.toLowerCase().replaceAll(" ", "-"), level: "genre" }));
describe("revisión completa de géneros documentados", () => {
  it("recupera slugs exactos de descriptores unidos por la extracción sin inventar un término ausente", () => {
    const matches = genreReviewCandidates([citation], terms);
    expect(matches.map(m => m.slug)).toEqual(["rock", "punk", "pop-punk", "rock-alternativo", "soft-rock", "pop-rock"]);
    expect(matches.every(m => m.evidenceIds.join() === "E1")).toBe(true);
  });
  it("un hallazgo de Punk permite revisar los demás géneros citados y propone secundarios sin cambiar el principal", () => {
    const finding: VerificationFinding = { key: "suggested.8", area: "genres", label: "Géneros", value: null, observed: "Punk", expected: [], context: [], issue: null, status: "unverified", explanation: "Fuente", coverage: 0, evidence: [] };
    const instruction = findingInstruction(finding);
    expect(instruction).toContain("todos los géneros documentados");
    expect(instruction).toContain("criterio editorial");
    expect(instruction).toContain("sin cambiar el principal");
    expect(instruction).toContain("hallazgo suggested.8 (");
    expect(instruction).toContain("información adicional documentada");
    expect(instruction).not.toContain("No amplíes");
    expect(findingInstruction({ ...finding, area: "tracks" })).toContain("la corrección");
    expect(findingInstruction({ ...finding, area: "tracks" })).not.toContain("todos los géneros");
  });
});
