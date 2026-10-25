import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerAlbumRoutes } from "../../src/api/routes/albums.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { syncAlbumClassifications } from "../../src/youtube/classifications.js";
import { isBSidesTitle } from "../../src/normalization/b-sides-title.js";
import { B_SIDES_SQL } from "../../src/api/repositories/albums.js";

describe("categorías de títulos: filtros, ficha y persistencia", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let artistId: number;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerAlbumRoutes(app);
    await registerArtistRoutes(app);
    artistId = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Ancla') RETURNING id")).rows[0].id);
    for (const [key, title, type, labels] of [
      ["album", "Directo", "live_album", []],
      ["single", "Single en vivo", "single", ["En vivo"]],
      ["demo", "Demo en vivo", "demo", ["En vivo"]],
      ["ep", "EP en vivo", "ep", ["En vivo"]],
      ["mixed", "EP / En vivo", "other", ["EP", "En vivo"]],
      ["bs1", "B - side y Rarezas", "compilation", []],
      ["bs2", "B- Side", "compilation", ["B-Sides"]],
      ["bs3", "B–Sides", "single", []],
      ["plain", "Normal", "studio_album", []],
    ] as const) {
      const id = Number((await getPool().query("INSERT INTO public.albums(artist_id,title,album_type) VALUES($1,$2,$3) RETURNING id", [artistId, title, type])).rows[0].id);
      ids[key] = id;
      for (const [position, label] of labels.entries()) await getPool().query(
        "INSERT INTO ingest.album_classifications(album_id,classification,position,inferred) VALUES($1,$2,$3,true)", [id, label, position + 1]);
    }
  });
  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); });

  it("En vivo reúne álbum, sencillo, demo, EP y ficha mixta, con facetas y paginación coherentes", async () => {
    const response = await app.inject("/albums?albumType=live&limit=2&offset=1");
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination).toEqual({ total: 5, limit: 2, offset: 1 });
    expect(response.json().data.every((row: { isLive: boolean }) => row.isLive)).toBe(true);
    const facets = (await app.inject("/albums/facets")).json();
    expect(facets.total).toBe(9);
    expect(facets.types).toEqual(expect.arrayContaining([
      { value: "live", count: 5 }, { value: "live_album", count: 1 }, { value: "ep", count: 2 }, { value: "b_sides", count: 3 },
    ]));
    const eps = (await app.inject("/albums?albumType=ep")).json();
    expect(eps.data.map((row: { id: number }) => row.id).sort()).toEqual([ids["ep"], ids["mixed"]].sort());
    expect((await app.inject("/albums?albumType=live&q=Demo")).json().pagination.total).toBe(1);
  });

  it("B-Sides acepta espacios y guiones sin contar dos veces la clasificación guardada", async () => {
    const response = await app.inject("/albums?albumType=b_sides");
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination.total).toBe(3);
    expect(response.json().data.every((row: { isBSides: boolean }) => row.isBSides)).toBe(true);
    for (const title of ["B-Sides", "B - side", "B- Side", "B‑Sides", "B–Side", "BSide", "Besides", "B-Sideshow", "ÁB-Sides", "Lado A Lado B"]) {
      const result = await getPool().query<{ matches: boolean }>(`SELECT ${B_SIDES_SQL} AS matches FROM (SELECT 0::bigint AS id, $1::text AS title) al`, [title]);
      expect(result.rows[0]!.matches, title).toBe(isBSidesTitle(title));
    }
  });

  it("la ficha conserva el tipo principal y expone las categorías con su carácter inferido", async () => {
    const response = await app.inject(`/albums/${ids["single"]}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ albumType: "single", isLive: true, isBSides: false, classifications: [{ classification: "En vivo", inferred: true }] });
    const bside = (await app.inject(`/albums/${ids["bs1"]}`)).json();
    expect(bside).toMatchObject({ albumType: "compilation", isBSides: true });
    const artist = (await app.inject(`/artists/${artistId}`)).json();
    expect(artist.discography.find((row: { albumId: number }) => row.albumId === ids["mixed"]))
      .toMatchObject({ albumType: "other", isLive: true, classifications: [{ classification: "EP" }, { classification: "En vivo" }] });
  });

  it("sincronizar la hoja conserva aportes locales e IDs, retira etiquetas antiguas de la hoja y es idempotente", async () => {
    const pool = getPool();
    const localBefore = (await pool.query("SELECT id,album_id,classification FROM ingest.album_classifications WHERE seed_upload_id IS NULL ORDER BY id")).rows;
    const seed = (await pool.query(`INSERT INTO ingest.seed_uploads(artist_name_raw,album_name_raw,type_raw,row_hash)
      VALUES('Ancla','Single en vivo','EP',repeat('a',64)) RETURNING id`)).rows[0].id;
    const dry = await syncAlbumClassifications({ dryRun: true });
    expect(dry.classifications).toBe(localBefore.length + 1);
    await syncAlbumClassifications();
    await pool.query("UPDATE ingest.seed_uploads SET type_raw='Single, En vivo' WHERE id=$1", [seed]);
    await syncAlbumClassifications();
    await syncAlbumClassifications();
    expect((await pool.query("SELECT id,album_id,classification FROM ingest.album_classifications WHERE seed_upload_id IS NULL ORDER BY id")).rows).toEqual(localBefore);
    const labels = (await pool.query("SELECT classification,inferred FROM ingest.album_classifications WHERE album_id=$1 ORDER BY position", [ids["single"]])).rows;
    expect(labels).toEqual([{ classification: "Single", inferred: false }, { classification: "En vivo", inferred: false }]);
  });

  it("combina características y ediciones con facetas, ficha, discografía y paginación coherentes", async () => {
    const pool = getPool();
    for (const [position, label] of ["Acústico", "Instrumental", "Remix"].entries()) await pool.query(
      "INSERT INTO ingest.album_classifications(album_id,classification,position,inferred) VALUES($1,$2,$3,true)", [ids["ep"], label, position + 2]);
    await pool.query(`INSERT INTO ingest.album_versions(album_id,title,edition_types,is_primary,source)
      VALUES($1,'Deluxe Remastered Edition',ARRAY['deluxe','remastered'],true,'titulo-disco'),
            ($1,'Deluxe Edition',ARRAY['deluxe'],false,'titulo-disco')`, [ids["ep"]]);
    for (const category of ["acoustic", "instrumental", "remix", "deluxe", "remastered"]) {
      const result = (await app.inject(`/albums?albumType=${category}&limit=1`)).json();
      expect(result.pagination.total).toBe(1);
      expect(result.data[0]).toMatchObject({ id: ids["ep"], albumType: "ep", editionTypes: ["deluxe", "remastered"] });
      const facets = (await app.inject("/albums/facets")).json();
      expect(facets.types).toContainEqual({ value: category, count: 1 });
    }
    expect((await app.inject("/albums?albumType=reissue")).json().pagination.total).toBe(0);
    const album = (await app.inject(`/albums/${ids["ep"]}`)).json();
    expect(album.versions[0]).toMatchObject({ title: "Deluxe Remastered Edition", editionTypes: ["deluxe", "remastered"] });
    const artist = (await app.inject(`/artists/${artistId}`)).json();
    expect(artist.discography.find((row: { albumId: number }) => row.albumId === ids["ep"]))
      .toMatchObject({ albumType: "ep", editionTypes: ["deluxe", "remastered"] });
    await syncAlbumClassifications();
    const labels = (await pool.query("SELECT classification FROM ingest.album_classifications WHERE album_id=$1", [ids["ep"]])).rows.map(row => row.classification);
    expect(labels).toEqual(expect.arrayContaining(["Acústico", "Instrumental", "Remix"]));
  });
  it("combina categorías con Y, admite enlaces simples y repetidos, y pagina sin duplicados", async () => {
    const pool = getPool();
    const artist = Number((await pool.query("INSERT INTO public.artists(name) VALUES('Categorías combinadas') RETURNING id")).rows[0].id);
    const create = async (title: string, type: string, labels: string[]) => {
      const id = Number((await pool.query("INSERT INTO public.albums(artist_id,title,album_type,release_year) VALUES($1,$2,$3,2022) RETURNING id", [artist,title,type])).rows[0].id);
      for (const [position,label] of labels.entries()) await pool.query("INSERT INTO ingest.album_classifications(album_id,classification,position,inferred) VALUES($1,$2,$3,true)", [id,label,position+1]);
      return id;
    };
    const instrumental = await create("A instrumental remix", "single", ["Remix", "Instrumental"]);
    const ep = await create("B EP remix", "ep", ["Remix"]);
    await create("C single sin características", "single", []);
    const live = await create("D sencillo en vivo remix", "single", ["En vivo", "Remix"]);
    const bside = await create("E B-Sides remix", "single", ["B-Sides", "Remix"]);
    const deluxe = await create("F deluxe remix", "single", ["Remix"]);
    const unplugged = await create("G unplugged", "live_album", ["Unplugged"]);
    await pool.query(`INSERT INTO ingest.album_versions(album_id,title,edition_types,is_primary,source)
      VALUES($1,'Deluxe Remastered',ARRAY['deluxe','remastered'],true,'titulo-disco'),
            ($1,'Deluxe',ARRAY['deluxe'],false,'titulo-disco')`, [deluxe]);
    const list = async (query: string) => {
      const response = await app.inject(`/albums?artistId=${artist}&${query}`);
      expect(response.statusCode,query).toBe(200);
      return response.json();
    };
    for (const query of ["albumType=single,remix", "albumType=single&albumType=remix", "albumType=single,remix,single"]) {
      const result = await list(query);
      expect(result.pagination.total,query).toBe(4);
      expect(result.data.map((a: { id: number }) => a.id),query).toEqual([instrumental,live,bside,deluxe]);
    }
    expect((await list("albumType=single,remix,instrumental")).data.map((a: { id: number }) => a.id)).toEqual([instrumental]);
    expect((await list("albumType=ep,remix")).data.map((a: { id: number }) => a.id)).toEqual([ep]);
    expect((await list("albumType=live,remix")).data.map((a: { id: number }) => a.id)).toEqual([live]);
    expect((await list("albumType=single,b_sides,remix")).data.map((a: { id: number }) => a.id)).toEqual([bside]);
    expect((await list("albumType=single,deluxe,remastered")).data.map((a: { id: number }) => a.id)).toEqual([deluxe]);
    expect((await list("albumType=acoustic,live")).data.map((a: { id: number }) => a.id)).toEqual([unplugged]);
    expect((await list("albumType=single,ep")).pagination.total).toBe(0);
    expect((await list("albumType=single,unknown")).pagination.total).toBe(0);
    expect((await list("albumType=single")).pagination.total).toBe(5);
    expect((await list("albumType=single,remix&decade=1990")).pagination.total).toBe(0);
    expect((await list("albumType=single,remix&decade=2020&q=instrumental")).pagination.total).toBe(1);
    const paged = await list("albumType=single,remix&limit=1&offset=1");
    expect(paged.pagination).toEqual({total:4,limit:1,offset:1});
    expect(paged.data.map((a: { id: number }) => a.id)).toEqual([live]);
    expect((await app.inject(`/albums?albumType=${encodeURIComponent("x' OR true --")}`)).json().pagination.total).toBe(0);
    expect((await app.inject(`/albums?albumType=${"x".repeat(41)}`)).statusCode).toBe(400);
    expect((await app.inject("/albums?albumType=,,")).statusCode).toBe(400);
  });
});
