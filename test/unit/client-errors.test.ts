import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerClientErrorRoutes } from "../../src/api/routes/client-errors.js";
import { toApiError } from "../../src/api/http-errors.js";
import { INCIDENT_CODE, newIncidentCode } from "../../src/api/incident-code.js";

describe("errores del navegador al log", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code } });
      return reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: { code: "bad_request" } });
    });
    await registerClientErrorRoutes(app);
  });
  afterAll(async () => { await app.close(); });

  it("genera códigos legibles, sin 0/O ni 1/I", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = newIncidentCode();
      expect(code).toMatch(INCIDENT_CODE);
      expect(code.slice(4)).not.toMatch(/[01IO]/u);
    }
  });

  it("acepta un reporte válido sin devolver nada", async () => {
    const res = await app.inject({ method: "POST", url: "/client-errors", payload: { code: newIncidentCode(), kind: "load", path: "/artistas/1", message: "error interno", status: 500 } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("rechaza códigos inventados y campos desconocidos", async () => {
    expect((await app.inject({ method: "POST", url: "/client-errors", payload: { code: "CRV-000000", kind: "load" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/client-errors", payload: { code: newIncidentCode(), kind: "load", extra: 1 } })).statusCode).toBe(400);
  });

  it("limita la ráfaga por IP", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 32; index += 1) {
      statuses.push((await app.inject({ method: "POST", url: "/client-errors", remoteAddress: "203.0.113.9", payload: { code: newIncidentCode(), kind: "runtime" } })).statusCode);
    }
    expect(statuses.filter((status) => status === 204)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
  });
});
