import { scryptSync } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { resetEnvCache } from "../../src/config/env.js";

const PASSWORD = "una-clave-larga-de-prueba";
const SALT = Buffer.from("sal-para-tests-123", "utf8");
const HASH = `scrypt$16384$8$1$${SALT.toString("base64url")}$${scryptSync(PASSWORD, SALT, 64).toString("base64url")}`;

describe("sesiones de colaboradores", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env["CRV_COLLABORATORS_JSON"] = JSON.stringify([
      { username: "ana.crv", name: "Ana Archivo", passwordHash: HASH },
      { username: "lucia.lee", name: "Lucía Lectora", passwordHash: HASH, role: "reader" },
    ]);
    delete process.env["CRV_OPERATOR_TOKEN"];
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
    app.post("/protected", async (request) => ({ operator: request.operator }));
    app.get("/review-queue", async (request) => ({ operator: request.operator }));
    app.get("/persons/:id/merge-preview", async () => ({ ok: true }));
    app.get("/artists", async () => ({ public: true }));
    app.get("/albums", async (request) => ({ viewer: request.viewer }));
    app.get("/catalog-links/artist/:id/social", async () => ({ private: true }));
    app.patch("/catalog-links/artist/:id/social/instagram", async () => ({ ok: true }));
    app.post("/genres/artist/:id/decision", async () => ({ ok: true }));
    app.get("/sources", async () => ({ private: true }));
    app.get("/sources/:id", async () => ({ private: true }));
    app.get("/claims", async () => ({ private: true }));
    app.get("/discovery/contexts/coverage", async () => ({ private: true }));
    app.get("/discovery/contexts/ontology", async () => ({ private: true }));
    app.get("/discovery/contexts/tracks/:id/review", async () => ({ private: true }));
    app.get("/credit-sources", async () => ({ private: true }));
    app.get("/persons/identity-research", async () => ({ private: true }));
    app.get("/persons/:id/identity-research", async () => ({ private: true }));
    app.get("/persons/identity-research/active-job", async () => ({ private: true }));
    app.get("/persons/identity-research/jobs/:id", async () => ({ private: true }));
    app.get("/runs/:id", async () => ({ private: true }));
    app.get("/persons/:id/split-preview", async () => ({ private: true }));
    app.get("/docs/json", async () => ({ private: true }));
  });

  afterEach(async () => {
    await app.close();
    delete process.env["CRV_COLLABORATORS_JSON"];
    resetEnvCache();
    resetAuthStateForTests();
  });

  it("crea una cookie HttpOnly y atribuye las escrituras a la cuenta", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "ANA.CRV", password: PASSWORD },
      headers: { origin: "https://crv.example", host: "crv.example", "x-forwarded-proto": "https" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { username: "ana.crv", name: "Ana Archivo", role: "admin" }, csrf: expect.any(String) });
    const setCookie = login.headers["set-cookie"] as string;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    const cookie = setCookie.split(";", 1)[0]!;

    const withoutCsrf = await app.inject({ method: "POST", url: "/protected", headers: { cookie } });
    expect(withoutCsrf.statusCode).toBe(403);
    expect(withoutCsrf.json()).toMatchObject({ error: { code: "invalid_csrf" } });

    const written = await app.inject({
      method: "POST",
      url: "/protected",
      headers: { cookie, "x-crv-csrf": login.json().csrf },
    });
    expect(written.statusCode).toBe(200);
    expect(written.json()).toEqual({ operator: "Ana Archivo" });

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("solo una cuenta admin escribe, revisa y compara; el catálogo sigue público", async () => {
    const loginAs = async (username: string) => {
      const response = await app.inject({ method: "POST", url: "/auth/login", payload: { username, password: PASSWORD } });
      return { cookie: (response.headers["set-cookie"] as string).split(";", 1)[0]!, csrf: response.json().csrf as string, body: response.json() };
    };

    expect((await app.inject({ method: "GET", url: "/artists" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/review-queue" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/persons/3/merge-preview?with=4" })).statusCode).toBe(401);

    const reader = await loginAs("lucia.lee");
    expect(reader.body).toMatchObject({ user: { role: "reader" } });
    const readerWrite = await app.inject({ method: "POST", url: "/protected", headers: { cookie: reader.cookie, "x-crv-csrf": reader.csrf } });
    expect(readerWrite.statusCode).toBe(403);
    expect(readerWrite.json()).toMatchObject({ error: { code: "admin_required" } });
    expect((await app.inject({ method: "GET", url: "/review-queue", headers: { cookie: reader.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/artists", headers: { cookie: reader.cookie } })).statusCode).toBe(200);
    const readerMe = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: reader.cookie } });
    expect(readerMe.json()).toMatchObject({ user: { role: "reader" } });

    const admin = await loginAs("ana.crv");
    const review = await app.inject({ method: "GET", url: "/review-queue", headers: { cookie: admin.cookie } });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toEqual({ operator: "Ana Archivo" });
    expect((await app.inject({ method: "GET", url: "/persons/3/merge-preview?with=4", headers: { cookie: admin.cookie } })).statusCode).toBe(200);
  });

  it("protege fuentes y evidencia frente a visitantes y lectores, también HEAD y consultas directas", async () => {
    const loginAs = async (username: string) => {
      const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username, password: PASSWORD } });
      return (res.headers["set-cookie"] as string).split(";", 1)[0]!;
    };
    const reader = await loginAs("lucia.lee");
    const admin = await loginAs("ana.crv");
    for (const url of ["/discovery/contexts/coverage", "/discovery/contexts/ontology", "/discovery/contexts/tracks/1/review", "/sources", "/sources/1", "/claims?entity=album&id=1", "/claims?entity=person&id=1", "/claims?entity=organization&id=1", "/claims?entity=artist&id=1", "/credit-sources?entity=album&id=1", "/credit-sources?entity=track&id=1", "/claims?entity=album_credit&id=1", "/claims?entity=track_credit&id=1", "/persons/identity-research?aId=1&bId=2", "/persons/1/identity-research", "/persons/identity-research/active-job?aId=1&bId=2", "/persons/identity-research/jobs/1"]) {
      for (const method of ["GET", "HEAD"] as const) {
        expect((await app.inject({ method, url })).statusCode).toBe(401);
        expect((await app.inject({ method, url, headers: { cookie: reader } })).statusCode).toBe(403);
        const response = await app.inject({ method, url, headers: { cookie: admin } });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    }
  });

  it("no enumera usuarios, rechaza orígenes externos y permite revocar la sesión", async () => {
    for (const username of ["nadie", "ana.crv"]) {
      const rejected = await app.inject({ method: "POST", url: "/auth/login", payload: { username, password: "incorrecta" } });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json()).toMatchObject({ error: { code: "invalid_credentials", message: "Usuario o contraseña incorrectos." } });
    }

    const external = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "ana.crv", password: PASSWORD },
      headers: { origin: "https://evil.example", host: "crv.example" },
    });
    expect(external.statusCode).toBe(403);

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "ana.crv", password: PASSWORD } });
    const cookie = (login.headers["set-cookie"] as string).split(";", 1)[0]!;
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie, "x-crv-csrf": login.json().csrf },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("limita los intentos repetidos por cuenta e IP", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const rejected = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "otra.cuenta", password: "incorrecta" } });
      expect(rejected.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "otra.cuenta", password: "incorrecta" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "too_many_attempts" } });
  });

  it("frena también por IP sola aunque cada cuenta probada sea distinta (spray)", async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const rejected = await app.inject({ method: "POST", url: "/auth/login", payload: { username: `cuenta-${attempt}`, password: "incorrecta" } });
      expect(rejected.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "cuenta-21", password: "incorrecta" } });
    expect(limited.statusCode).toBe(429);

    // Acertar con la cuenta correcta no debe perdonar el cupo de la IP: sigue
    // limitada aunque pruebe la cuenta legítima que sí conoce.
    const correct = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "ana.crv", password: PASSWORD } });
    expect(correct.statusCode).toBe(429);
  });

  it("el cupo por IP usa la IP real detrás del proxy, no la del propio proxy", async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const rejected = await app.inject({ method: "POST", url: "/auth/login", headers: { "x-forwarded-for": "203.0.113.9" }, payload: { username: `cuenta-${attempt}`, password: "incorrecta" } });
      expect(rejected.statusCode).toBe(401);
    }
    const attacker = await app.inject({ method: "POST", url: "/auth/login", headers: { "x-forwarded-for": "203.0.113.9" }, payload: { username: "ana.crv", password: PASSWORD } });
    expect(attacker.statusCode).toBe(429);
    const admin = await app.inject({ method: "POST", url: "/auth/login", headers: { "x-forwarded-for": "198.51.100.4" }, payload: { username: "ana.crv", password: PASSWORD } });
    expect(admin.statusCode).toBe(200);
  });

  it("no se salta la protección codificando la ruta y reserva la documentación y las divisiones", async () => {
    for (const url of ["/%72eview-queue", "/review%2Dqueue", "/runs/%31", "/persons/%31/merge-preview", "/persons/1/split-preview?into=a,b", "/docs/json"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: "GET", url: "/%E0%A4%A" })).statusCode).toBe(400);
  });

  it("no deja pasar más intentos que el cupo aunque lleguen en paralelo", async () => {
    const burst = await Promise.all(Array.from({ length: 8 }, () =>
      app.inject({ method: "POST", url: "/auth/login", payload: { username: "concurrente", password: "incorrecta" } })));
    const limited = burst.filter((response) => response.statusCode === 429).length;
    // 5 se cuentan como fallo (401) y el resto ya debía toparse con el 429,
    // así que a lo sumo 5 evaluaron la contraseña de verdad.
    expect(limited).toBeGreaterThanOrEqual(3);
    expect(burst.filter((response) => response.statusCode === 401).length).toBe(8 - limited);
  });

  it("reserva los perfiles editables y las nuevas escrituras a administradores", async () => {
    const url = "/catalog-links/artist/1/social";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "lucia.lee", password: PASSWORD } });
    const headers = { cookie: (login.headers["set-cookie"] as string).split(";", 1)[0]!, "x-crv-csrf": login.json().csrf };
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `${url}/instagram`, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/genres/artist/1/decision", headers })).statusCode).toBe(403);
    const admin = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "ana.crv", password: PASSWORD } });
    const adminHeaders = { cookie: (admin.headers["set-cookie"] as string).split(";", 1)[0]!, "x-crv-csrf": admin.json().csrf };
    expect((await app.inject({ method: "GET", url, headers: adminHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `${url}/instagram`, headers: adminHeaders })).statusCode).toBe(200);
  });

  it("la lectura pública reconoce a quien tiene sesión, sin exigirla (etiqueta de Laya)", async () => {
    expect((await app.inject({ method: "GET", url: "/albums" })).json()).toEqual({ viewer: null });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "lucia.lee", password: PASSWORD } });
    const cookie = (login.headers["set-cookie"] as string).split(";", 1)[0]!;
    expect((await app.inject({ method: "GET", url: "/albums", headers: { cookie } })).json())
      .toEqual({ viewer: { name: "Lucía Lectora", role: "reader" } });
    expect((await app.inject({ method: "GET", url: "/albums", headers: { cookie: "crv_session=inventada" } })).json()).toEqual({ viewer: null });
  });
});
