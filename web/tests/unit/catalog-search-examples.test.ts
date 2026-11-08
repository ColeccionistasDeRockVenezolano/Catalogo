import { afterEach, describe, expect, it, vi } from "vitest";
import { discoveryApi } from "../../src/lib/api";
import { loadSearchExamples } from "../../src/lib/catalogSearchExamples";

vi.mock("../../src/lib/api", () => ({ discoveryApi: { searchExamples: vi.fn() } }));

afterEach(() => vi.mocked(discoveryApi.searchExamples).mockReset());

const cycle = { date: "2026-10-14", day: 0, timeZone: "America/Caracas", startsAt: "", changesAt: "" };
const serve = (labels: string[]) => vi.mocked(discoveryApi.searchExamples).mockResolvedValue({
  dailyCycle: cycle, examples: labels.map((label, id) => ({ id, label })),
});

describe("ejemplos del buscador por tipo", () => {
  it.each([
    ["artist", "Artista"], ["person", "Persona"], ["album", "Disco"], ["organization", "Organización"],
  ] as const)("%s: una sola petición al servidor, con la fecha del ciclo y la señal", async (scope, category) => {
    serve(Array.from({ length: 24 }, (_, id) => `Nombre ${id}`));
    const signal = new AbortController().signal;
    const examples = await loadSearchExamples(scope, signal, "2026-10-14");
    expect(examples).toHaveLength(8);
    expect(examples.every(example => example.category === category && example.key.startsWith(`${scope}-`))).toBe(true);
    expect(discoveryApi.searchExamples).toHaveBeenCalledTimes(1);
    expect(discoveryApi.searchExamples).toHaveBeenCalledWith(scope, signal, "2026-10-14");
  });

  it("descarta signos sueltos y nombres repetidos", async () => {
    serve(["?", "12", "--", "Ana", "ana ", "Bruno", "Ca"]);
    const examples = await loadSearchExamples("person", new AbortController().signal, "2026-10-14");
    expect(examples.map(example => example.label).sort()).toEqual(["Ana", "Bruno"]);
  });

  it("el buscador general no pide ejemplos por tipo", async () => {
    expect(await loadSearchExamples("catalog", new AbortController().signal, "2026-10-14")).toEqual([]);
    expect(discoveryApi.searchExamples).not.toHaveBeenCalled();
  });

  it("conserva el orden al recargar el mismo día y lo cambia con el día común", async () => {
    serve(Array.from({ length: 24 }, (_, id) => `Nombre ${id}`));
    const load = (date: string) => loadSearchExamples("artist", new AbortController().signal, date);
    const today = await load("2026-10-14");
    expect(await load("2026-10-14")).toEqual(today);
    expect(await load("2026-10-15")).not.toEqual(today);
  });
});
