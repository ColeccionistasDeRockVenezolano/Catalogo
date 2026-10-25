import { scryptSync } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerSiteAppearanceRoutes } from "../../src/api/routes/site-appearance.js";
import { toApiError } from "../../src/api/http-errors.js";

const password = "site-appearance-test-password";
const salt = Buffer.alloc(16, 6);
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;

describe("apariencia compartida del catálogo", () => {
  let pg: PgContainer;
  let app: FastifyInstance;
  const originalEnv = { ...process.env };
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl;
    process.env["CRV_COLLABORATORS_JSON"] = JSON.stringify([
      { username: "theme.admin", name: "Admin Temas", passwordHash, role: "admin" },
      { username: "theme.reader", name: "Lector Temas", passwordHash, role: "reader" },
    ]);
    delete process.env["CRV_OPERATOR_TOKEN"];
    delete process.env["CRV_HERRA_DB_PATH"];
    resetEnvCache();
    await applyCore(pg.name);
    await migrateUp();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status < 500) return reply.status(status).send({ error: { code: "bad_request", message: error instanceof Error ? error.message : "bad request" } });
      return reply.send(error);
    });
    await registerOperatorAuth(app);
    await registerSiteAppearanceRoutes(app);
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop(); resetAuthStateForTests();
    for (const key of ["DATABASE_URL", "CRV_COLLABORATORS_JSON", "CRV_OPERATOR_TOKEN", "CRV_HERRA_DB_PATH"]) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    resetEnvCache();
  });
  async function login(username: string) {
    const result = await app.inject({ method: "POST", url: "/auth/login", payload: { username, password } });
    expect(result.statusCode).toBe(200);
    return { cookie: String(result.headers["set-cookie"]).split(";", 1)[0]!, "x-crv-csrf": result.json().csrf as string };
  }
  it("conserva el tema original por defecto y permite leerlo sin sesión", async () => {
    const result = await app.inject("/site-appearance");
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.json()).toEqual({ catalogTheme: "current", updatedAt: null });
  });
  it("impide cambios anónimos, de lectores y sin CSRF", async () => {
    const payload = { catalogTheme: "charcoal" };
    expect((await app.inject({ method: "PATCH", url: "/site-appearance", payload })).statusCode).toBe(401);
    const reader = await login("theme.reader");
    expect((await app.inject({ method: "PATCH", url: "/site-appearance", headers: reader, payload })).statusCode).toBe(403);
    const admin = await login("theme.admin");
    expect((await app.inject({ method: "PATCH", url: "/site-appearance", headers: { cookie: admin.cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject("/site-appearance")).json().catalogTheme).toBe("current");
  });
  it("guarda para visitantes nuevos, atribuye al administrador y permite volver al original", async () => {
    const headers = await login("theme.admin");
    for (const catalogTheme of ["charcoal", "studio", "current"]) {
      const saved = await app.inject({ method: "PATCH", url: "/site-appearance", headers, payload: { catalogTheme } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ catalogTheme, updatedAt: expect.any(String) });
      expect((await app.inject("/site-appearance")).json()).toEqual(saved.json());
      expect((await getPool().query("SELECT updated_by FROM ingest.site_appearance")).rows[0]).toEqual({ updated_by: "Admin Temas" });
      expect(saved.json()).not.toHaveProperty("updatedBy");
    }
    expect((await app.inject({ method: "PATCH", url: "/site-appearance", headers, payload: { catalogTheme: "invalid" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/site-appearance", headers, payload: { catalogTheme: "charcoal", homeTheme: "charcoal" } })).statusCode).toBe(400);
    expect((await app.inject("/site-appearance")).json().catalogTheme).toBe("current");
  });
});
