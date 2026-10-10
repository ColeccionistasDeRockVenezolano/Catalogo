// Casos confirmados manualmente en las runs 18011, 18110 y 18116.
// Solo lee el catálogo y la web; guarda el informe, nunca modifica fichas.
import { writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { investigateKnownPersonPair, investigatePersonContexts, type PersonContext } from "../src/ambiguity/person-web-verification.js";

const cases = [
  { a: 1294, b: 40353, expected: "different", name: "Valerio: músico / ingeniero" },
  { a: 4531, b: 40360, expected: "different", name: "James Brown: cantante / ingeniero" },
  { a: 376, b: 40375, expected: "different", name: "Alfredo Gil: salsa / metal" },
  { a: 6215, b: 40377, expected: "different", name: "Kenny: Las Cuatro Monedas / metal" },
  { a: 1460, b: 40386, expected: "different", name: "Antonio Casas: hijo / padre" },
  { a: 40356, b: 40357, expected: "unknown", name: "Francisco González: Oblivion / Sacrilegio" },
] as const;

// La run 13285 fusionó estas parejas. La ficha descartada ya no existe en
// public.persons; estos expedientes mínimos preservan los nombres y proyectos
// conocidos en ese momento para medir si el buscador puede recuperar el vínculo.
const historicalSame: Array<{ name: string; a: PersonContext; b: PersonContext }> = [
  {
    name: "Giordano Di Marzo / Yordano Di Marzo (run 13285)",
    a: { id: 1856, name: "Giordano Di Marzo", birthDate: null, deathDate: null, projects: [{ name: "Sietecuero", year: 1978, role: "voz" }], sourceUrls: [] },
    b: { id: 20303, name: "Yordano Di Marzo", birthDate: null, deathDate: null, projects: [{ name: "Sietecuero", year: 1978, role: "guitarra" }], sourceUrls: [] },
  },
  {
    name: "Luis María «Billo» Frómeta / Billo Frometa (run 13285)",
    a: { id: 7779, name: "Luis María Billo Frómeta", birthDate: null, deathDate: null, projects: [{ name: "Billo's Caracas Boys", year: 1965, role: "director" }], sourceUrls: [] },
    b: { id: 20300, name: "Billo Frometa", birthDate: null, deathDate: null, projects: [{ name: "Billo's Caracas Boys", year: 1965, role: "director" }], sourceUrls: [] },
  },
];

const rows: Array<{ name: string; expected: string; verdict: string; correct: boolean; citations: number; sources: number;
  rationale?: string; sourceUrls?: string[]; error?: string }> = [];
try {
  for (const item of cases) {
    try {
      const result = await investigateKnownPersonPair(item.a, item.b);
      rows.push({ name: item.name, expected: item.expected, verdict: result.validated.verdict,
        correct: result.validated.verdict === item.expected, citations: result.validated.evidence.length, sources: result.pages.length,
        rationale: result.validated.rationale, sourceUrls: result.pages.map((page) => page.url) });
    } catch (error) {
      rows.push({ name: item.name, expected: item.expected, verdict: "error", correct: false,
        citations: 0, sources: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const item of historicalSame) {
    try {
      const result = await investigatePersonContexts(item.a, item.b);
      rows.push({ name: item.name, expected: "same", verdict: result.validated.verdict,
        correct: result.validated.verdict === "same", citations: result.validated.evidence.length, sources: result.pages.length,
        rationale: result.validated.rationale, sourceUrls: result.pages.map((page) => page.url) });
    } catch (error) {
      rows.push({ name: item.name, expected: "same", verdict: "error", correct: false,
        citations: 0, sources: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const report = { date: new Date().toISOString(), cases: rows,
    counts: { total: rows.length, correct: rows.filter((row) => row.correct).length,
      knownSameCases: rows.filter((row) => row.expected === "same").length,
      abstained: rows.filter((row) => row.verdict === "unknown").length,
      falseMerges: rows.filter((row) => row.expected !== "same" && row.verdict === "same").length,
      falseSeparations: rows.filter((row) => row.expected === "same" && row.verdict === "different").length,
      errors: rows.filter((row) => row.verdict === "error").length },
    readyForAutomaticDecisions: false };
  const output = `reports/person-web-verification-benchmark-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(output);
  console.log(report.counts);
} finally { await closeDb(); }
