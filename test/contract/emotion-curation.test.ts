import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerEmotionCurationRoutes } from "../../src/api/routes/emotion-curation.js";
import { toApiError } from "../../src/api/http-errors.js";
import { emotionArtists, emotionArtistCount } from "../../src/api/repositories/emotions.js";

describe("decisiones editoriales de emociones", () => {
  let pg: PgContainer;
  let app: FastifyInstance;
  const originalEnv = { ...process.env };
  const token = "emotion-curation-test-token";

  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl;
    process.env["CRV_OPERATOR_TOKEN"] = token;
    delete process.env["CRV_COLLABORATORS_JSON"];
    resetEnvCache();
    await applyCore(pg.name);
    await migrateUp();
    const pool = getPool();
    const artist = (await pool.query<{ id: string }>("INSERT INTO public.artists(name) VALUES('Prueba de emoción') RETURNING id::text")).rows[0]!;
    await pool.query("INSERT INTO ingest.lastfm_artist_verifications(artist_id,lastfm_url,evidence,reviewed_by) VALUES($1,'https://www.last.fm/music/Prueba+de+emoci%C3%B3n','Identidad documentada para esta prueba','test')", [artist.id]);
    await pool.query("INSERT INTO public.entity_user_tags(artist_id,source,tag,weight,emotions) VALUES($1,'lastfm','hot',12,$2::jsonb)",
      [artist.id, JSON.stringify({ categoria: "cachonda", p: 0.81 })]);
    await pool.query("INSERT INTO public.entity_emotions(artist_id,emotion,basis,score) VALUES($1,'cachonda','tags',12)", [artist.id]);
    const unverified = (await pool.query<{ id: string }>("INSERT INTO public.artists(name) VALUES('Homónimo sin verificar') RETURNING id::text")).rows[0]!;
    await pool.query("INSERT INTO public.entity_user_tags(artist_id,source,tag,weight,emotions) VALUES($1,'lastfm','cold',20,$2::jsonb)",
      [unverified.id, JSON.stringify({ categoria: "no_expresa_emocion", p: 0.71 })]);
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    await registerOperatorAuth(app);
    await registerEmotionCurationRoutes(app);
  });

  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop(); resetAuthStateForTests();
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN", "CRV_COLLABORATORS_JSON"]) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    resetEnvCache();
  });

  it("protege la cola y guarda una corrección que cambia el agregado publicado", async () => {
    expect((await app.inject("/curation/emotions/tags")).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Brian" };
    const first = await app.inject({ method: "GET", url: "/curation/emotions/tags?limit=5", headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().data[0]).toMatchObject({ tag: "hot", suggested: "cachonda", category: null });
    expect((await getPool().query("SELECT count(*)::int AS n FROM public.entity_emotions WHERE emotion='cachonda'")).rows[0]).toEqual({ n: 1 });
    const saved = await app.inject({ method: "POST", url: "/curation/emotions/tags/decision", headers,
      payload: { tag: "hot", category: "no_expresa_emocion", note: "Ambigua sin contexto musical" } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ saved: true });
    const reviewed = await app.inject({ method: "GET", url: "/curation/emotions/tags?status=reviewed", headers });
    expect(reviewed.json().data[0]).toMatchObject({ tag: "hot", category: "no_expresa_emocion", decidedBy: "Brian" });
    const pool = getPool();
    expect((await pool.query("SELECT emotions->>'categoria' AS category FROM public.entity_user_tags WHERE tag='hot'")).rows[0]).toEqual({ category: "no_expresa_emocion" });
    expect((await pool.query("SELECT count(*)::int AS n FROM public.entity_emotions WHERE emotion='cachonda'")).rows[0]).toEqual({ n: 0 });
  });

  it("conserva la decisión editorial sin publicar datos de un homónimo no verificado", async () => {
    const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Brian" };
    const saved = await app.inject({ method: "POST", url: "/curation/emotions/tags/decision", headers,
      payload: { tag: "cold", category: "tristeza", note: "Etiqueta revisada; identidad pendiente" } });
    expect(saved.statusCode).toBe(200);
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM public.entity_emotions e
      JOIN public.artists a ON a.id=e.artist_id WHERE a.name='Homónimo sin verificar'`);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("conserva el vocabulario sin atribuir las etiquetas a homónimos sin verificar", async () => {
    const response = await app.inject({ method: "GET", url: "/curation/emotions/tags?status=all",
      headers: { authorization: `Bearer ${token}`, "x-crv-operator": "Brian" } });
    const tags = response.json().data;
    expect(tags.find((t: { tag: string }) => t.tag === "cold")).toMatchObject({ artists: [] });
    expect(tags.find((t: { tag: string }) => t.tag === "hot").artists).toEqual([
      expect.objectContaining({ name: "Prueba de emoción" }),
    ]);
  });

  it("excluye shouts y agregados de identidades sin verificar incluso si reaparecen", async () => {
    const pool = getPool();
    await pool.query(`INSERT INTO public.entity_emotions(artist_id,emotion,basis,score)
      SELECT id,'libertad','shouts',200 FROM public.artists WHERE name='Prueba de emoción'
      UNION ALL SELECT id,'libertad','tags',300 FROM public.artists WHERE name='Homónimo sin verificar'`);
    expect(await emotionArtistCount("libertad")).toBe(0);
    expect(await emotionArtists("libertad", 10)).toEqual([]);
    await pool.query(`INSERT INTO public.entity_emotions(artist_id,emotion,basis,score)
      SELECT id,'libertad','tags',1 FROM public.artists WHERE name='Prueba de emoción'`);
    expect(await emotionArtistCount("libertad")).toBe(1);
    expect(await emotionArtists("libertad", 10)).toEqual([
      expect.objectContaining({ name: "Prueba de emoción", score: 1, shouts: [] }),
    ]);
  });
});
