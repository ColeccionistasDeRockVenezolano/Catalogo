import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTransientFailure } from "../../src/lib/transientFailure";

function stubBrowser() {
  const target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, { location: { origin: "http://127.0.0.1:5173", hostname: "127.0.0.1" } }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: true }));
  return target;
}
const respond = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "application/json" } });
const group = { kind: "album", entityId: 7, name: "Disco", candidates: [] } as never;

describe("isTransientFailure", () => {
  it("separa los cortes de las respuestas del servidor", () => {
    expect(isTransientFailure(new TypeError("Failed to fetch"))).toBe(true);
    for (const status of [408, 429, 500, 502]) expect(isTransientFailure({ status })).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 422]) expect(isTransientFailure({ status })).toBe(false);
  });
});

describe("cola de imágenes ante fallos de conexión", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function load(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
    const target = stubBrowser();
    vi.stubGlobal("fetch", vi.fn(fetcher));
    const changed = vi.fn();
    target.addEventListener("crv-data-changed", changed);
    const operator = await import("../../src/lib/operator");
    operator.setSessionCsrf("csrf");
    const api = await import("../../src/lib/api");
    const queue = await import("../../src/lib/imageCurationQueue");
    return { api, queue, changed };
  }
  const posts = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");

  it("reenvía la misma solicitud tras un corte y no recarga el catálogo al encolar", async () => {
    const accepted = (init?: RequestInit) => {
      const tasks = (JSON.parse(String(init?.body)) as { tasks: Array<{ requestId: string; kind: string; entityId: number; type: string; candidateId: number | null }> }).tasks;
      const task = tasks[0]!;
      return { id: 1, requestId: task.requestId, type: task.type, groups: [{ kind: task.kind, entityId: task.entityId, name: "Disco" }], candidateId: task.candidateId, status: "queued", error: null, conflict: false, result: null, runId: null, attempts: 0, createdAt: "", updatedAt: "" };
    };
    let failures = 2;
    const { queue, changed } = await load(async (url, init) => {
      if (init?.method !== "POST") return respond(200, url.includes("cache-version") ? '{"revision":"r"}' : '[]');
      if (failures-- > 0) throw new TypeError("Failed to fetch");
      return respond(202, JSON.stringify([accepted(init)]));
    });
    queue.queueImageDecision(group, null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(posts()).toHaveLength(3);
    const ids = posts().map(([, init]) => (JSON.parse(String(init?.body)) as { tasks: Array<{ requestId: string }> }).tasks[0]!.requestId);
    expect(new Set(ids).size).toBe(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it("la decisión viaja con la imagen que se estaba viendo; dejar la actual no la necesita", async () => {
    const { queue } = await load(async (url, init) => {
      if (init?.method !== "POST") return respond(200, url.includes("cache-version") ? '{"revision":"r"}' : "[]");
      return respond(409, '{"error":{"code":"not_open","message":"Ya no."}}');
    });
    const seen = { kind: "album", entityId: 9, name: "Disco", currentUrl: "/crv/media/album/9.jpg", candidates: [] } as never;
    queue.queueImageDecision(seen, 33);
    queue.queueImageDecision({ ...(seen as object), entityId: 10 } as never, null);
    await vi.advanceTimersByTimeAsync(100);
    const sent = posts().map(([, init]) => (JSON.parse(String(init?.body)) as { tasks: Array<Record<string, unknown>> }).tasks[0]!);
    expect(sent[0]).toMatchObject({ candidateId: 33, expectedCurrentUrl: "/crv/media/album/9.jpg" });
    expect(sent[1]).not.toHaveProperty("expectedCurrentUrl");
  });

  it("un 409 no se reintenta y queda como conflicto", async () => {
    const { queue } = await load(async (url, init) => {
      if (init?.method === "POST") return respond(409, '{"error":{"code":"not_open","message":"Ya no tiene candidatas."}}');
      return respond(200, url.includes("cache-version") ? '{"revision":"r"}' : '[]');
    });
    queue.queueImageDecision(group, null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(posts()).toHaveLength(1);
  });

  it("muchas decisiones terminadas recargan las vistas una sola vez", async () => {
    const job = (id: number, status: string) => ({ id, requestId: `00000000-0000-4000-8000-00000000000${id}`, type: "decision", groups: [{ kind: "album", entityId: id, name: "Disco" }], candidateId: null, status, error: null, conflict: false, result: null, runId: null, attempts: 1, createdAt: "", updatedAt: "" });
    let server = [job(1, "running"), job(2, "running"), job(3, "running")];
    const { queue, changed } = await load(async url => respond(200, url.includes("cache-version") ? '{"revision":"r"}' : JSON.stringify(server)));
    queue.startImageQueue();
    await vi.advanceTimersByTimeAsync(0);
    server = [job(1, "done"), job(2, "running"), job(3, "running")];
    await vi.advanceTimersByTimeAsync(1100);
    server = [job(1, "done"), job(2, "done"), job(3, "running")];
    await vi.advanceTimersByTimeAsync(1100);
    server = [job(1, "done"), job(2, "done"), job(3, "done")];
    await vi.advanceTimersByTimeAsync(1100);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("mientras la cola trabaja, las vistas se recargan como mucho cada 15 s", async () => {
    const job = (id: number, status: string) => ({ id, requestId: `00000000-0000-4000-8000-00000000001${id}`, type: "decision", groups: [{ kind: "album", entityId: id, name: "Disco" }], candidateId: null, status, error: null, conflict: false, result: null, runId: null, attempts: 1, createdAt: "", updatedAt: "" });
    let server = [job(1, "running"), job(2, "queued"), job(3, "queued")];
    const { queue, changed } = await load(async url => respond(200, url.includes("cache-version") ? '{"revision":"r"}' : JSON.stringify(server)));
    queue.startImageQueue();
    await vi.advanceTimersByTimeAsync(0);
    server = [job(1, "done"), job(2, "running"), job(3, "queued")];
    await vi.advanceTimersByTimeAsync(1100);
    server = [job(1, "done"), job(2, "done"), job(3, "running")];
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("una respuesta en texto del gateway llega como ApiError con su mensaje", async () => {
    const { api } = await load(async () => new Response("Demasiadas solicitudes desde esta conexión.", { status: 429 }));
    await expect(api.imageCandidatesApi.jobs()).rejects.toMatchObject({ status: 429, message: "Demasiadas solicitudes desde esta conexión." });
  });
});
