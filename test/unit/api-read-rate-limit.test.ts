// CRV · Lecturas públicas anónimas con techo por IP (endurecimiento
// anti-scraping 2026-10-13). El catálogo es abierto, pero una sola conexión no
// puede vaciarlo a velocidad de script; el tráfico local (scripts, campañas,
// tests) y quien tiene sesión quedan exentos.
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { resetEnvCache } from "../../src/config/env.js";

describe("límite de lecturas públicas por IP", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    delete process.env["CRV_COLLABORATORS_JSON"];
    delete process.env["CRV_OPERATOR_TOKEN"];
    process.env["CRV_READ_RATE_LIMIT"] = "5";
    resetEnvCache();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    await registerOperatorAuth(app);
    app.get("/artists", async () => ({ public: true }));
  });

  afterEach(async () => {
    await app.close();
    delete process.env["CRV_READ_RATE_LIMIT"];
    resetEnvCache();
    resetAuthStateForTests();
  });

  it("corta la ráfaga anónima de una misma IP llegada por el proxy", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: "GET", url: "/artists", headers })).statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: "GET", url: "/artists", headers });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(blocked.headers["retry-after"]).toBe("60");
  });

  it("da cupo propio a cada IP y no toca el tráfico local sin proxy", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 5; i += 1) {
      await app.inject({ method: "GET", url: "/artists", headers });
    }
    expect((await app.inject({ method: "GET", url: "/artists", headers })).statusCode).toBe(429);
    // Otra IP: cupo intacto.
    expect((await app.inject({ method: "GET", url: "/artists", headers: { "x-forwarded-for": "198.51.100.4" } })).statusCode).toBe(200);
    // Local sin X-Forwarded-For (scripts, campañas, tests): sin límite.
    for (let i = 0; i < 20; i += 1) {
      expect((await app.inject({ method: "GET", url: "/artists" })).statusCode).toBe(200);
    }
  });

  it("solo cuenta la última entrada del X-Forwarded-For (la que añade el hop de confianza)", async () => {
    // El cliente inventa una entrada previa: la clave es la última.
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: "GET", url: "/artists", headers: { "x-forwarded-for": "1.2.3.4, 192.0.2.9" } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/artists", headers: { "x-forwarded-for": "9.9.9.9, 192.0.2.9" } })).statusCode).toBe(429);
    // Y la primera entrada no cuenta: "192.0.2.9, 5.5.5.5" tiene cupo nuevo.
    expect((await app.inject({ method: "GET", url: "/artists", headers: { "x-forwarded-for": "192.0.2.9, 5.5.5.5" } })).statusCode).toBe(200);
  });
});
