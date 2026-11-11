import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ logDir: "" }));
vi.mock("../../config/env.js", () => ({ getEnv: () => ({ CRV_RADIO_LOG_DIR: state.logDir, LOG_LEVEL: "silent", NODE_ENV: "test" }) }));
vi.mock("../auth.js", () => ({ clientCountry: () => "BR", clientIp: () => "test-network" }));
vi.mock("../community/store.js", () => ({ projectId: async () => 1 }));
vi.mock("../../shared/radio/config.js", () => ({ loadRadioConfig: async () => ({}), radioStationFromConfig: () => ({}) }));
vi.mock("../../shared/radio/engine.js", () => ({
  radioSnapshot: () => ({ phase: "music", current: { videoId: "abcdefghijk", title: "Ahora", artist: "Prueba" }, next: { videoId: "lmnopqrstuv" } }),
  inspectCatalog: () => ({}), reportRadioUnavailable: () => null, resetRadioEngineForTests() {},
}));
import { registerRadioRoutes } from "./radio.js";
import { recentRadioDiagnostics } from "../radio/diagnostics.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
async function app() {
  state.logDir = fs.mkdtempSync(path.join(os.tmpdir(), "radio-quality-api-")); dirs.push(state.logDir);
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler); server.setSerializerCompiler(serializerCompiler);
  await registerRadioRoutes(server);
  return server;
}
const body = (sessionId = "sesionpruebaipad001") => ({
  kind: "playback_quality", sessionId, reportId: `${sessionId}:1000:1`, appleTouch: true,
  device: { type: "tablet", decks: 1 }, measurement: { schema: 1, pieces: [{
    id: "identifier:1000", kind: "identifier", firstObservedAt: 1000, sampleCount: 12,
    observedMs: 3000, interruptedMs: 750, issues: ["interruption"], outcome: "ended",
  }] },
});

describe("telemetría de reproducción de radio", () => {
  it("recibe, conserva y evalúa una viñeta del iPad con agente de escritorio", async () => {
    const server = await app();
    try {
      const response = await server.inject({ method: "POST", url: "/radio/diagnostic", payload: body(),
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15" } });
      expect(response.statusCode).toBe(204);
      const data = recentRadioDiagnostics(state.logDir);
      expect(data.recent[0]).toMatchObject({ os: "iPadOS", device: { type: "tablet", decks: 1 } });
      expect(data.quality[0]).toMatchObject({ pieces: 1, identifiers: 1, interruptedMs: 750, issues: { interruption: 1 } });
    } finally { await server.close(); }
  });

  it("separa el cupo de medición del de fallos y de otros dispositivos en la misma red", async () => {
    const server = await app();
    try {
      for (let i = 0; i < 40; i += 1) {
        expect((await server.inject({ method: "POST", url: "/radio/diagnostic", payload: body() })).statusCode).toBe(204);
      }
      expect((await server.inject({ method: "POST", url: "/radio/diagnostic", payload: body() })).statusCode).toBe(429);
      expect((await server.inject({ method: "POST", url: "/radio/diagnostic", payload: body("sesionpruebapc00002") })).statusCode).toBe(204);
      expect((await server.inject({ method: "POST", url: "/radio/diagnostic", payload: { kind: "stall", sessionId: "sesionpruebapc00002" } })).statusCode).toBe(204);
      expect((await server.inject({ method: "POST", url: "/radio/diagnostic", payload: { kind: "inventado", sessionId: "sesionpruebapc00002" } })).statusCode).toBe(400);
    } finally { await server.close(); }
  });
});
