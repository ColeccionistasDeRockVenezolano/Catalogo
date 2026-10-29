import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCatalogCache } from "../../src/api/catalog-cache.js";
import { dailyDate } from "../../src/shared/daily-cycle.js";

const state = vi.hoisted(() => ({ revision: "initial" }));
vi.mock("../../src/storage/catalog-cache-revision.js", () => ({
  readCatalogRevision: async () => state.revision,
  publishCatalogRevision: async () => { state.revision += "!"; return state.revision; },
}));
vi.mock("../../src/api/search-index.js", () => ({ invalidateSearchIndex: vi.fn() }));
vi.mock("../../src/api/repositories/search.js", () => ({ clearSearchResults: vi.fn() }));

describe("caché del catálogo público", () => {
  let app: FastifyInstance;
  beforeEach(() => { state.revision = "initial"; app = Fastify(); registerCatalogCache(app); });
  afterEach(async () => { await app.close(); vi.useRealTimers(); });

  it("comparte peticiones simultáneas, conserva filtros y vence a los 30 minutos", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(0);
    let calls = 0;
    app.get("/albums/facets", async request => ({ calls: ++calls, query: request.query }));
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject("/albums/facets?tipo=ep&tipo=remix")));
    expect(calls).toBe(1);
    expect(responses.every(response => response.statusCode === 200)).toBe(true);
    expect(responses[0]!.json().query.tipo).toEqual(["ep", "remix"]);
    vi.setSystemTime(60_001);
    expect((await app.inject("/albums/facets?tipo=ep&tipo=remix")).json().calls).toBe(1);
    vi.setSystemTime(1_800_001);
    expect((await app.inject("/albums/facets?tipo=ep&tipo=remix")).json().calls).toBe(2);
    expect((await app.inject("/albums/facets?tipo=ep")).json().calls).toBe(3);
  });

  it("invalida con deploy, CLI y escrituras exitosas antes de responder", async () => {
    let calls = 0;
    app.get("/persons/facets", async () => ({ calls: ++calls }));
    app.patch("/persons/1", async () => ({ ok: true }));
    await app.inject("/persons/facets");
    expect((await app.inject("/persons/facets")).headers["x-crv-cache"]).toBe("HIT");
    state.revision = "deploy";
    expect((await app.inject("/persons/facets")).json().calls).toBe(2);
    await app.inject({ method: "PATCH", url: "/persons/1" });
    expect((await app.inject("/persons/facets")).json().calls).toBe(3);
    expect((await app.inject("/catalog/cache-version")).headers["cache-control"]).toBe("no-store");
  });

  it("no guarda errores ni comparte fichas autenticadas", async () => {
    let calls = 0;
    app.get("/persons/:id", async request => {
      calls++;
      if (calls === 1) throw new Error("temporal");
      return { private: !!request.headers.authorization, calls };
    });
    expect((await app.inject("/persons/1")).statusCode).toBe(500);
    expect((await app.inject("/persons/1")).json()).toEqual({ private: false, calls: 2 });
    expect((await app.inject({ url: "/persons/1", headers: { authorization: "Bearer example" } })).json().private).toBe(true);
    expect((await app.inject("/persons/1")).json()).toEqual({ private: false, calls: 2 });
  });

  it.each(['artists', 'albums'])('vuelve a comprobar los videos CRV en cada lectura de %s', async kind => {
    let calls = 0;
    app.get(`/${kind}/:id`, async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
      return { calls: ++calls };
    });
    expect((await app.inject(`/${kind}/1`)).json()).toEqual({ calls: 1 });
    const next = await app.inject(`/${kind}/1`);
    expect(next.json()).toEqual({ calls: 2 });
    expect(next.headers['cache-control']).toBe('private, no-store');
    expect(next.headers['x-crv-cache']).toBeUndefined();
  });

  it("cambia el contenido diario a medianoche de Caracas y separa fechas explícitas", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    app.get("/home", async request => ({ date: (request.query as { date?: string }).date ?? dailyDate() }));
    vi.setSystemTime(new Date("2026-10-22T03:59:59.999Z"));
    expect((await app.inject("/home")).json().date).toBe("2026-10-21");
    vi.setSystemTime(new Date("2026-10-22T04:00:00Z"));
    expect((await app.inject("/home")).json().date).toBe("2026-10-22");
    expect((await app.inject("/home?date=2026-10-20")).json().date).toBe("2026-10-20");
  });

  it("descarta también los fallos de serialización", async () => {
    let calls = 0;
    app.get("/persons/1", { schema: { response: { 200: {
      type: "object", required: ["name"], properties: { name: { type: "string" } },
    } } } }, async () => ++calls === 1 ? {} : { name: "Válida" });
    expect((await app.inject("/persons/1")).statusCode).toBe(500);
    expect((await app.inject("/persons/1")).json()).toEqual({ name: "Válida" });
    expect(calls).toBe(2);
  });

  it("no cachea el reloj editorial ni operaciones administrativas", async () => {
    let calls = 0;
    app.get("/daily-cycle", async () => ({ calls: ++calls }));
    app.get("/curation/findings", async () => ({ calls: ++calls }));
    for (const path of ["/daily-cycle", "/curation/findings"]) {
      const first = (await app.inject(path)).json().calls;
      expect((await app.inject(path)).json().calls).toBe(first + 1);
    }
  });
});
