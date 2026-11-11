import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("../../config/env.js", () => ({ getEnv: () => ({ CRV_RADIO_LOG_DIR: state.dir, LOG_LEVEL: "silent", NODE_ENV: "test" }) }));
vi.mock("../auth.js", () => ({ clientCountry: () => null, clientIp: () => "test-network" }));
vi.mock("../community/store.js", () => ({ projectId: async () => 1 }));
vi.mock("../../shared/radio/config.js", () => ({
  loadRadioConfig: async () => ({}),
  radioStationFromConfig: () => ({
    catalogPath: path.join(state.dir, "catalog.json"), owner: true, statePath: path.join(state.dir, "estado.json"),
    epochMs: Date.parse("2026-01-01T00:00:00Z"), stationName: "Prueba", crossfadeSeconds: 2,
  }),
}));
import { registerRadioRoutes } from "./radio.js";
import { setRadioCheckerForTests } from "../../shared/radio/engine.js";

state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "radio-inserts-api-"));
fs.writeFileSync(path.join(state.dir, "catalog.json"), JSON.stringify({
  version: 3, generatedAt: "2026-01-01T00:00:00Z", availabilityCheckedAt: "2026-01-01T00:00:00Z", channelId: "UC0000000000000000000000",
  items: Array.from({ length: 12 }, (_, index) => ({
    videoId: `vid000000${String(index).padStart(2, "0")}`, title: index === 7 ? "Vampiro (Acoustic)" : `Tema ${index}`, artist: index === 7 ? "Claroscuro" : `Artista ${index}`,
    album: "Disco", year: 2000, trackNumber: index + 1, startSeconds: 232, durationSeconds: 200, available: true,
  })),
}));
setRadioCheckerForTests(async () => "available");
afterAll(() => fs.rmSync(state.dir, { recursive: true, force: true }));

async function app() {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler); server.setSerializerCompiler(serializerCompiler);
  await registerRadioRoutes(server);
  return server;
}

describe("rutas de piezas puestas a mano", () => {
  it("busca, pone, enseña la fila y quita", async () => {
    const server = await app();
    try {
      const found = await server.inject({ method: "GET", url: "/community/admin/panel/radio/catalog?q=vampiro acoustic" });
      expect(found.statusCode).toBe(200);
      const items = found.json<{ items: Array<{ videoId: string; startSeconds: number; title: string }> }>().items;
      expect(items.map((item) => item.title)).toEqual(["Vampiro (Acoustic)"]);

      const put = await server.inject({ method: "POST", url: "/community/admin/panel/radio/inserts", payload: { videoId: items[0]!.videoId, startSeconds: 232 } });
      expect(put.statusCode).toBe(201);
      const insert = put.json<{ insert: { id: string; status: string } }>().insert;
      expect(insert.status).toBe("pending");

      const now = await server.inject({ method: "GET", url: "/radio/now" });
      expect(now.json<{ next: { title: string } }>().next.title).toBe("Vampiro (Acoustic)");

      const list = await server.inject({ method: "GET", url: "/community/admin/panel/radio/inserts" });
      expect(list.json<{ owner: boolean; inserts: Array<{ id: string }> }>()).toMatchObject({ owner: true, inserts: [{ id: insert.id }] });

      const gone = await server.inject({ method: "DELETE", url: `/community/admin/panel/radio/inserts/${insert.id}` });
      expect(gone.statusCode).toBe(204);
      const missing = await server.inject({ method: "DELETE", url: `/community/admin/panel/radio/inserts/${insert.id}` });
      expect(missing.statusCode).toBe(404);
      const unknown = await server.inject({ method: "POST", url: "/community/admin/panel/radio/inserts", payload: { videoId: "noexiste000", startSeconds: 0 } });
      expect(unknown.statusCode).toBe(422);
    } finally { await server.close(); }
  });
});
