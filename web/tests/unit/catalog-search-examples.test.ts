import { afterEach, describe, expect, it, vi } from "vitest";
import { albumsApi, artistsApi, organizationsApi, personsApi } from "../../src/lib/api";
import { loadSearchExamples } from "../../src/lib/catalogSearchExamples";

vi.mock("../../src/lib/api", () => ({
  albumsApi: { list: vi.fn() },
  artistsApi: { list: vi.fn() },
  organizationsApi: { list: vi.fn() },
  personsApi: { list: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

describe("ejemplos aleatorios de búsqueda", () => {
  it.each([
    ["artist", artistsApi, "Artista"],
    ["person", personsApi, "Persona"],
    ["album", albumsApi, "Disco"],
    ["organization", organizationsApi, "Organización"],
  ] as const)("selecciona %s de todo el catálogo, no de una página alfabética", async (scope, api, category) => {
    const rows = Array.from({ length: 260 }, (_, id) => ({
      id, name: `${String.fromCharCode(65 + Math.floor(id / 10))} nombre ${id}`,
      title: `${String.fromCharCode(65 + Math.floor(id / 10))} disco ${id}`,
    }));
    const list = vi.mocked(api.list);
    list.mockImplementation(async ({ limit = 8, offset = 0 } = {}) => ({
      data: rows.slice(offset, offset + limit), pagination: { total: rows.length, limit, offset },
    }));
    const random = vi.spyOn(Math, "random");
    for (const value of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.999]) random.mockReturnValueOnce(value);
    random.mockReturnValue(0.5);
    const signal = new AbortController().signal;
    const examples = await loadSearchExamples(scope, signal);

    expect(examples).toHaveLength(8);
    expect(new Set(examples.map(example => example.label[0])).size).toBe(8);
    expect(examples.some(example => example.key === `${scope}-259`)).toBe(true);
    expect(examples.every(example => example.category === category)).toBe(true);
    expect(list.mock.calls.every(([, passedSignal]) => passedSignal === signal)).toBe(true);
    list.mockReset();
  });

  it("no repite filas incluso si los sorteos coinciden", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(artistsApi.list).mockImplementation(async ({ limit = 8, offset = 0 } = {}) => ({
      data: Array.from({ length: Math.min(limit, 100 - offset) }, (_, index) => ({ id: offset + index, name: `Artista ${offset + index}` })) as never,
      pagination: { total: 100, limit, offset },
    }));
    const examples = await loadSearchExamples("artist", new AbortController().signal);
    expect(examples).toHaveLength(8);
    expect(new Set(examples.map(example => example.key)).size).toBe(8);
    vi.mocked(artistsApi.list).mockReset();
  });

  it.each([0, 3, 8])("carga un catálogo de %i filas con una sola consulta", async total => {
    const list = vi.mocked(artistsApi.list);
    list.mockResolvedValue({
      data: Array.from({ length: total }, (_, id) => ({ id, name: `Artista ${id}` })) as never,
      pagination: { total, limit: 8, offset: 0 },
    });
    expect(await loadSearchExamples("artist", new AbortController().signal)).toHaveLength(total);
    expect(list).toHaveBeenCalledTimes(1);
    list.mockReset();
  });
});
