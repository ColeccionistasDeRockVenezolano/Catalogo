import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerArtistGalleryRoutes } from "../../src/api/routes/artist-gallery.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { toApiError } from "../../src/api/http-errors.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { listChanges } from "../../src/api/repositories/changes.js";

const token = "artist-gallery-test-admin-01234567890123";
const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Admin galería" };
const note = "Archivo fotográfico verificado";
const image = { imageUrl: "/crv/media/uploads/test.webp", category: "artist", title: null, description: null, date: null, location: null };

describe("galería de artista: permisos, lotes, metadatos y deshacer", () => {
  let pg: PgContainer, app: FastifyInstance, artist: number, other: number;
  const previous = { ...process.env };
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = token;
    delete process.env["CRV_HERRA_DB_PATH"];
    resetEnvCache(); resetAuthStateForTests();
    await applyCore(pg.name); await migrateUp();
    const artists = (await getPool().query("INSERT INTO public.artists(name) VALUES('Archivo de prueba'),('Otro archivo') RETURNING id")).rows;
    artist = Number(artists[0]!.id); other = Number(artists[1]!.id);
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.code(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    await registerOperatorAuth(app); await registerArtistGalleryRoutes(app); await registerArtistRoutes(app);
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop();
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN", "CRV_HERRA_DB_PATH"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    resetEnvCache(); resetAuthStateForTests();
  });
  it("solo administración escribe, valida fechas y URLs y no acepta lotes inválidos", async () => {
    const url = `/artists/${artist}/gallery`;
    expect((await app.inject({ method: "POST", url, payload: { photos: [image], note } })).statusCode).toBe(401);
    for (const photos of [[{ ...image, date: "2025-02-30" }], [{ ...image, imageUrl: "javascript:alert(1)" }],
      [{ ...image, category: "unknown" }], [image, { ...image, imageUrl: "/crv/media/../secret" }], Array(101).fill(image)]) {
      expect((await app.inject({ method: "POST", url, headers, payload: { photos, note } })).statusCode).toBe(400);
    }
    expect((await getPool().query("SELECT count(*) FROM media.artist_gallery")).rows[0].count).toBe("0");
  });
  it("añade un lote con datos opcionales y lo publica en el perfil", async () => {
    const response = await app.inject({ method: "POST", url: `/artists/${artist}/gallery`, headers,
      payload: { photos: [image, { ...image, category: "poster", title: "Afiche de concierto", description: "Comentario del archivo", date: "1998-05-02", location: "Caracas" }], note } });
    expect(response.statusCode, response.body).toBe(201);
    const { ids, runId } = response.json(); expect(ids).toHaveLength(2);
    const detail = (await app.inject(`/artists/${artist}`)).json();
    expect(detail.gallery).toEqual([expect.objectContaining({ id: ids[0], title: null, date: null }),
      expect.objectContaining({ id: ids[1], category: "poster", date: "1998-05-02", location: "Caracas" })]);
    const history = await listChanges({ entity: "artist", id: artist, limit: 20, offset: 0 });
    expect(history.rows.some(row => row.runId === runId)).toBe(true);
  });
  it("edita y elimina una sola foto, verifica su artista y permite deshacer", async () => {
    const before = (await app.inject(`/artists/${artist}`)).json().gallery;
    const id = before[0].id;
    const wrong = await app.inject({ method: "PATCH", url: `/artists/${other}/gallery/${id}`, headers, payload: { ...image, title: "Ajena", note } });
    expect(wrong.statusCode).toBe(404);
    const edited = await app.inject({ method: "PATCH", url: `/artists/${artist}/gallery/${id}`, headers,
      payload: { ...image, title: "En vivo", description: "En el escenario", category: "concert", date: "2000-01-01", location: "Valencia", note } });
    expect(edited.statusCode, edited.body).toBe(200);
    const removed = await app.inject({ method: "DELETE", url: `/artists/${artist}/gallery/${id}?note=${encodeURIComponent(note)}`, headers });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await app.inject(`/artists/${artist}`)).json().gallery).toHaveLength(1);
    await withOperatorRun({ name: "test:undo-gallery", operator: "test", note }, context => undoRun(context, removed.json().runId));
    expect((await app.inject(`/artists/${artist}`)).json().gallery).toEqual([
      expect.objectContaining({ id, title: "En vivo", description: "En el escenario", date: "2000-01-01", location: "Valencia" }), before[1],
    ]);
    await withOperatorRun({ name: "test:undo-gallery-edit", operator: "test", note }, context => undoRun(context, edited.json().runId));
    expect((await app.inject(`/artists/${artist}`)).json().gallery).toEqual(before);
  });
});
