import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerCatalogOverviewRoutes } from "../../src/api/routes/catalog-overview.js";
import { genreFacets } from "../../src/genres/public.js";
import { registerCatalogCache } from "../../src/api/catalog-cache.js";
import { getPersonFacets } from "../../src/api/repositories/persons.js";

describe("resumen ligero del menú del catálogo", () => {
  let pg: PgContainer, app: FastifyInstance;
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    const artist = (await getPool().query("INSERT INTO public.artists(name,artist_type) VALUES('Artista del menú','band') RETURNING id")).rows[0].id;
    for (const year of [1959, 1960, 1969, 1971, 2001, null]) {
      await getPool().query("INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,'Disco del menú',$2)", [artist, year]);
    }
    await getPool().query("INSERT INTO public.persons(name) VALUES('Persona sin créditos')");
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    registerCatalogCache(app);
    await registerCatalogOverviewRoutes(app);
  });
  afterAll(async () => { await app?.close(); await closeDb(); await pg?.stop(); });

  it("mantiene los totales del catálogo y las décadas únicas desde 1960", async () => {
    const response = await app.inject("/catalog/overview");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-cache");
    const { rows: [totals] } = await getPool().query(`SELECT
      (SELECT count(*)::int FROM ingest.catalog_artists) AS artists,
      (SELECT count(*)::int FROM ingest.catalog_albums) AS albums,
      (SELECT count(*)::int FROM public.persons) AS persons,
      (SELECT count(*)::int FROM public.organizations) AS organizations`);
    const families = (await genreFacets("artist")).families;
    expect(response.json()).toEqual({
      totals: { "/artistas": totals.artists, "/discos": totals.albums, "/personas": totals.persons, "/organizaciones": totals.organizations },
      genres: families.sort((a, b) => b.count - a.count).slice(0, 8).map(({ slug, name }) => ({ slug, name })),
      decades: [1960, 1970, 2000],
    });
  });

  it("comparte la respuesta entre aperturas simultáneas", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => app.inject("/catalog/overview")));
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(responses[0]!.json());
    }
  });

  it("cuenta personas únicas por rol y conserva el significado de sin créditos", async () => {
    const pool = getPool();
    const artist = (await pool.query("SELECT id FROM public.artists LIMIT 1")).rows[0].id;
    const album = (await pool.query("SELECT id FROM public.albums LIMIT 1")).rows[0].id;
    const musician = (await pool.query("INSERT INTO public.persons(name) VALUES('Músico con dos créditos') RETURNING id")).rows[0].id;
    const member = (await pool.query("INSERT INTO public.persons(name) VALUES('Integrante sin créditos') RETURNING id")).rows[0].id;
    const track = (await pool.query("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,1,'Tema') RETURNING id", [album])).rows[0].id;
    await pool.query("INSERT INTO public.album_credits(album_id,person_id,credit_type,role) VALUES($1,$2,'musician','Guitarra')", [album, musician]);
    await pool.query("INSERT INTO public.track_credits(track_id,person_id,credit_type,role) VALUES($1,$2,'musician','Guitarra'),($1,$2,'composer','Composición')", [track, musician]);
    await pool.query("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Voz')", [artist, member]);
    expect(await getPersonFacets()).toEqual({ total: 3, withoutCredits: 1,
      roles: [{ role: "band_member", count: 1 }, { role: "composer", count: 1 }, { role: "musician", count: 1 }] });
  });
});
