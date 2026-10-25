import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { registerImageUploadRoutes } from "../../src/api/routes/image-uploads.js";
import { registerCatalogWriteRoutes } from "../../src/api/routes/catalog-writes.js";
import { registerCatalogEditorRoutes } from "../../src/api/routes/catalog-editor.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { registerAlbumRoutes } from "../../src/api/routes/albums.js";
import { registerPersonRoutes } from "../../src/api/routes/persons.js";
import { registerOrganizationRoutes } from "../../src/api/routes/organizations.js";
import { registerChangeRoutes } from "../../src/api/routes/changes.js";

const token = "image-upload-contract-admin-0123456789";
describe("imágenes subidas conectadas con fichas, versiones e historial", () => {
  let app: FastifyInstance;
  let pg: PgContainer;
  let directory: string;
  const previousEnv = { ...process.env };
  const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Admin de imágenes" };
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = token;
    delete process.env["CRV_HERRA_DB_PATH"];
    resetEnvCache(); await applyCore(pg.name); await migrateUp();
    directory = await mkdtemp(path.join(tmpdir(), "crv-upload-contract-"));
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    await registerOperatorAuth(app); await registerImageUploadRoutes(app, directory);
    await registerCatalogWriteRoutes(app); await registerCatalogEditorRoutes(app);
    await registerArtistRoutes(app); await registerAlbumRoutes(app);
    await registerPersonRoutes(app); await registerOrganizationRoutes(app); await registerChangeRoutes(app);
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN", "CRV_HERRA_DB_PATH"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    resetEnvCache(); resetAuthStateForTests();
  });
  async function write(method: "POST" | "PATCH", url: string, payload: Record<string, unknown>) {
    const response = await app.inject({ method, url, headers, payload: { ...payload, note: "Imagen confirmada por administración" } });
    expect(response.statusCode, response.body).toBeLessThan(300);
    return response.json();
  }
  const detail = async (url: string) => (await app.inject({ url })).json();
  it("sube, crea y sustituye todas las imágenes editables; las fichas públicas leen la ruta y deshacer restaura", async () => {
    const payload = await sharp({ create: { width: 40, height: 30, channels: 4, background: "red" } }).png().toBuffer();
    const response = await app.inject({ method: "POST", url: "/media/uploads", headers: { ...headers, "content-type": "image/png" }, payload });
    expect(response.statusCode, response.body).toBe(201);
    const { url } = response.json() as { url: string };
    expect((await readFile(path.join(directory, "uploads", path.basename(url)))).length).toBeGreaterThan(0);
    const artist = await write("POST", "/artists", { name: "Artista con imagen subida", pictureUrl: url, logoUrl: url });
    const person = await write("POST", "/persons", { name: "Persona con imagen subida", pictureUrl: url });
    const organization = await write("POST", "/organizations", { name: "Organización con imagen subida", pictureUrl: url, organizationType: "record_label" });
    const album = await write("POST", "/albums", { artistId: artist.id, title: "Disco con portada subida", coverUrl: url });
    expect(await detail(`/artists/${artist.id}`)).toMatchObject({ pictureUrl: url, logoUrl: url });
    expect(await detail(`/persons/${person.id}`)).toMatchObject({ pictureUrl: url });
    expect(await detail(`/organizations/${organization.id}`)).toMatchObject({ pictureUrl: url });
    expect(await detail(`/albums/${album.id}`)).toMatchObject({ coverUrl: url });
    const version = await write("POST", `/catalog-editor/album/${album.id}/version`, { title: "Versión con portada propia", coverUrl: url, position: 1 });
    expect((await detail(`/albums/${album.id}`)).versions).toEqual(expect.arrayContaining([expect.objectContaining({ id: version.id, coverUrl: url })]));
    const otherImage = "https://example.org/otra-imagen.jpg";
    for (const [route, id, fields] of [
      ["artists", artist.id, { pictureUrl: otherImage, logoUrl: otherImage }],
      ["persons", person.id, { pictureUrl: otherImage }],
      ["organizations", organization.id, { pictureUrl: otherImage }],
      ["albums", album.id, { coverUrl: otherImage }],
    ] as const) {
      const changed = await write("PATCH", `/${route}/${id}`, fields);
      expect(await detail(`/${route}/${id}`)).toMatchObject(fields);
      const audit = await getPool().query("SELECT count(*)::int n FROM ingest.merge_audit WHERE run_id=$1", [changed.runId]);
      expect(audit.rows[0]!.n).toBeGreaterThan(0);
      await write("POST", `/changes/${changed.runId}/undo`, {});
      expect(await detail(`/${route}/${id}`)).toMatchObject(Object.fromEntries(Object.keys(fields).map(key => [key, url])));
    }
    const changedVersion = await write("PATCH", `/catalog-editor/album/${album.id}/version/${version.id}`, { coverUrl: otherImage });
    expect((await detail(`/albums/${album.id}`)).versions).toEqual(expect.arrayContaining([expect.objectContaining({ id: version.id, coverUrl: otherImage })]));
    await write("POST", `/changes/${changedVersion.runId}/undo`, {});
    expect((await detail(`/albums/${album.id}`)).versions).toEqual(expect.arrayContaining([expect.objectContaining({ id: version.id, coverUrl: url })]));
  });
});
