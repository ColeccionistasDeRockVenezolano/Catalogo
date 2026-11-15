import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { registerImageCandidateRoutes } from "../../src/api/routes/image-candidates.js";
import { registerArtistGalleryRoutes } from "../../src/api/routes/artist-gallery.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { addRejectedArtistCandidatesToGallery } from "../../src/merge/gallery-from-candidates.js";

const token = "gallery-rejected-contract-admin-0123456789";
const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Admin galería" };
const note = "Prueba de galería y foto de perfil";

describe("fotos descartadas en la galería y foto de perfil desde la galería", () => {
  let app: FastifyInstance, pg: PgContainer, mediaRoot: string;
  const previousEnv = { ...process.env };
  const images = new Map<string, Buffer>();
  const serve = async (url: string) => images.has(url) ? { bytes: images.get(url)! } : { error: "HTTP 404" };
  const db = () => getPool();
  const gallery = async (artist: number) => (await db().query<{ id: string; image_url: string; source_key: string | null; source_url: string | null }>(
    "SELECT id::text, image_url, source_key, source_url FROM media.artist_gallery WHERE artist_id=$1 ORDER BY id", [artist])).rows;
  const picture = async (artist: number) => (await db().query("SELECT picture_url FROM public.artists WHERE id=$1", [artist])).rows[0].picture_url as string | null;
  async function artistWith(name: string, current: string | null, urls: string[]): Promise<{ artist: number; ids: number[] }> {
    const artist = Number((await db().query("INSERT INTO public.artists(name,picture_url) VALUES($1,$2) RETURNING id", [name, current])).rows[0].id);
    const ids: number[] = [];
    for (const url of urls) ids.push(Number((await db().query(
      "INSERT INTO ingest.image_candidates(entity_kind,artist_id,current_url,candidate_url,source,page_url,origin) VALUES('artist',$1,$2,$3,'web','https://fuente.example/p','prueba') RETURNING id",
      [artist, current, url])).rows[0].id));
    return { artist, ids };
  }
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = token;
    delete process.env["CRV_HERRA_DB_PATH"];
    resetEnvCache(); resetAuthStateForTests(); await applyCore(pg.name); await migrateUp();
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code, message: expected.message } });
      return reply.send(error);
    });
    mediaRoot = await mkdtemp(path.join(tmpdir(), "crv-media-"));
    await registerOperatorAuth(app);
    await registerImageCandidateRoutes(app, { mediaRoot, download: serve, worker: false });
    await registerArtistGalleryRoutes(app, { mediaRoot, download: serve });
    const photo = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#c33" } }).jpeg().toBuffer();
    for (const name of ["a", "b", "c", "d", "e"]) images.set(`https://img.example/${name}.jpg`, photo);
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN", "CRV_HERRA_DB_PATH"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    resetEnvCache(); resetAuthStateForTests();
  });

  it("elegir una candidata lleva las otras a la galería; deshacer las retira y reabre", async () => {
    const { artist, ids } = await artistWith("Banda Elegida", "https://img.example/actual.jpg", ["https://img.example/a.jpg", "https://img.example/b.jpg", "https://img.example/c.jpg"]);
    await db().query("UPDATE ingest.image_candidates SET quality='failed' WHERE id=$1", [ids[2]]);
    const chosen = await app.inject({ method: "POST", url: `/curation/images/artist/${artist}/decide`, headers, payload: { candidateId: ids[0] } });
    expect(chosen.statusCode, chosen.body).toBe(200);
    // La elegida es la foto de perfil; la rota no entra; la otra queda con su página de origen.
    expect(await gallery(artist)).toEqual([expect.objectContaining({ image_url: "https://img.example/b.jpg", source_key: `curaduria-descartada:${ids[1]}`, source_url: "https://fuente.example/p" })]);
    await withOperatorRun({ name: "test:undo", operator: "test", note }, context => undoRun(context, chosen.json().runId));
    expect(await gallery(artist)).toEqual([]);
    expect((await db().query("SELECT count(*)::int AS n FROM ingest.image_candidates WHERE artist_id=$1 AND status='open'", [artist])).rows[0].n).toBe(3);
  });

  it("«dejar las actuales» lleva todas a la galería y una segunda pasada no las duplica", async () => {
    const { artist } = await artistWith("Banda Actual", "https://img.example/actual.jpg", ["https://img.example/a.jpg", "https://img.example/actual.jpg"]);
    const kept = await app.inject({ method: "POST", url: "/curation/images/artist/keep-current", headers, payload: { entityIds: [artist] } });
    expect(kept.statusCode, kept.body).toBe(200);
    // La que coincide con la foto de perfil no se repite en la galería.
    expect((await gallery(artist)).map(row => row.image_url)).toEqual(["https://img.example/a.jpg"]);
    const client = await db().connect();
    try { expect(await addRejectedArtistCandidatesToGallery(client, { all: true })).toBe(0); } finally { client.release(); }
  });

  it("una foto de la galería pasa a ser la de perfil con copia estable; la anterior entra a la galería; deshacer revierte", async () => {
    const { artist } = await artistWith("Banda Perfil", "https://img.example/vieja.jpg", ["https://img.example/d.jpg"]);
    await app.inject({ method: "POST", url: "/curation/images/artist/keep-current", headers, payload: { entityIds: [artist] } });
    const [photo] = await gallery(artist);
    const unauthenticated = await app.inject({ method: "POST", url: `/artists/${artist}/gallery/${photo!.id}/profile`, payload: { note } });
    expect(unauthenticated.statusCode).toBe(401);
    const promoted = await app.inject({ method: "POST", url: `/artists/${artist}/gallery/${photo!.id}/profile`, headers, payload: { note } });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json().pictureUrl).toMatch(/^\/crv\/media\/curated\/[0-9a-f]{64}\.jpg$/u);
    expect(await picture(artist)).toBe(promoted.json().pictureUrl);
    expect(await gallery(artist)).toEqual([expect.objectContaining({ id: String(promoted.json().previousPhotoId), image_url: "https://img.example/vieja.jpg" })]);
    await withOperatorRun({ name: "test:undo", operator: "test", note }, context => undoRun(context, promoted.json().runId));
    expect(await picture(artist)).toBe("https://img.example/vieja.jpg");
    expect((await gallery(artist)).map(row => row.image_url)).toEqual(["https://img.example/d.jpg"]);
  });

  it("si la fuente ya no responde, la ficha y la galería no cambian", async () => {
    const { artist } = await artistWith("Banda Caída", null, ["https://img.example/desaparecida.jpg"]);
    await app.inject({ method: "POST", url: "/curation/images/artist/keep-current", headers, payload: { entityIds: [artist] } });
    const [photo] = await gallery(artist);
    const refused = await app.inject({ method: "POST", url: `/artists/${artist}/gallery/${photo!.id}/profile`, headers, payload: { note } });
    expect(refused.statusCode).toBe(502);
    expect(await picture(artist)).toBeNull();
    expect(await gallery(artist)).toHaveLength(1);
    const other = await artistWith("Otra Banda", null, []);
    expect((await app.inject({ method: "POST", url: `/artists/${other.artist}/gallery/${photo!.id}/profile`, headers, payload: { note } })).statusCode).toBe(404);
  });
});
