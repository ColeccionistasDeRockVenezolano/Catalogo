import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { registerAlbumRoutes } from "../../src/api/routes/albums.js";

describe("filtros por décadas", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerArtistRoutes(app);
    await registerAlbumRoutes(app);
    await getPool().query(`INSERT INTO public.artists(name, artist_type, formed_year) VALUES
      ('Archivo 1969', 'band', 1969), ('Archivo 1970', 'band', 1970),
      ('Archivo 1979', 'solo_artist', 1979), ('Archivo 1980', 'band', 1980), ('Archivo sin año', 'band', NULL)`);
    await getPool().query(`INSERT INTO public.albums(artist_id, title, release_year, album_type)
      SELECT id, name, formed_year, CASE WHEN artist_type = 'solo_artist' THEN 'ep'::public.album_type ELSE 'studio_album'::public.album_type END
      FROM public.artists`);
  });
  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); });

  for (const route of ["artists", "albums"]) {
    it(`${route}: incluye los límites 1970–1979 y pagina el conjunto filtrado`, async () => {
      const first = await app.inject(`/${route}?decade=1970&limit=1`);
      expect(first.statusCode).toBe(200);
      expect(first.json().pagination.total).toBe(2);
      const second = await app.inject(`/${route}?decade=1970&limit=1&offset=1`);
      expect(second.statusCode).toBe(200);
      expect(second.json().pagination).toEqual({ total: 2, limit: 1, offset: 1 });
      expect(first.json().data[0].id).not.toBe(second.json().data[0].id);
      const years = (await app.inject(`/${route}?decade=1970`)).json().data.map((row: { formedYear?: number; releaseYear?: number }) => row.formedYear ?? row.releaseYear);
      expect(years.sort()).toEqual([1970, 1979]);
    });
    it(`${route}: conserva fichas sin año y facetas completas`, async () => {
      const unknown = await app.inject(`/${route}?withoutYear=true`);
      expect(unknown.statusCode).toBe(200);
      expect(unknown.json().pagination.total).toBe(1);
      const facets = await app.inject(`/${route}/facets`);
      expect(facets.statusCode).toBe(200);
      expect(facets.json()).toMatchObject({ total: 5, withoutYear: 1, decades: [
        { decade: 1960, count: 1 }, { decade: 1970, count: 2 }, { decade: 1980, count: 1 },
      ] });
      expect((await app.inject(`/${route}`)).json().pagination.total).toBe(5);
    });
    it(`${route}: combina búsqueda y tipo, y rechaza décadas inválidas`, async () => {
      const type = route === "artists" ? "artistType=solo_artist" : "albumType=ep";
      const response = await app.inject(`/${route}?decade=1970&q=Archivo&${type}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().pagination.total).toBe(1);
      for (const value of ["1971", "texto", "1890", "2110"]) {
        expect((await app.inject(`/${route}?decade=${value}`)).statusCode).toBe(400);
      }
    });
  }
});
