import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { invalidateSearchIndex, refreshSearchIndex, searchIds, warmSearchIndex } from "../../src/api/search-index.js";
import { globalSearch } from "../../src/api/repositories/search.js";
import { normalizeEntityName } from "../../src/normalization/entity-name.js";

// Auditoría de rendimiento #2 — El índice sirve lo que tiene y refresca de
// fondo: una lectura no paga la recarga (por eso una escritura sin refresco no
// se ve), la invalidación que dispara cada escritura del catálogo refresca en
// el acto, y los alias participan igual que los nombres.
describe("índice de búsqueda con refresco en segundo plano (contrato)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    await warmSearchIndex();
  }, 120_000);

  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  async function newPerson(name: string): Promise<number> {
    const { rows } = await getPool().query<{ id: string }>("INSERT INTO public.persons(name) VALUES($1) RETURNING id", [name]);
    return Number(rows[0]!.id);
  }

  async function newArtist(name: string): Promise<number> {
    const { rows } = await getPool().query<{ id: string }>("INSERT INTO public.artists(name, origin_country) VALUES($1,'Venezuela') RETURNING id", [name]);
    return Number(rows[0]!.id);
  }

  it("una persona nueva entra al índice con el refresco, y se encuentra con y sin tildes", async () => {
    const id = await newPerson("José Ñáñez");
    // Sin refresco la lectura sirve la copia en memoria: la base no se consulta.
    expect(await searchIds("person", "jose")).not.toContain(id);

    await refreshSearchIndex("person");
    expect(await searchIds("person", "jose")).toContain(id);
    expect(await searchIds("person", "nanez")).toContain(id);
    expect(await searchIds("person", " ÑÁÑEZ ")).toContain(id);
  });

  it("la invalidación refresca en el acto y los alias participan", async () => {
    const id = await newArtist("Los Sin Nombre");
    await getPool().query(
      "INSERT INTO ingest.artist_aliases(artist_id, alias, normalized_alias) VALUES($1,$2,$3)",
      [id, "El Nombre", normalizeEntityName("El Nombre").primaryKey]);
    expect(await searchIds("artist", "el nombre")).not.toContain(id);

    // La invalidación es lo que corre cada escritura del catálogo: no bloquea
    // (void) y deja el refresco en marcha; `warmSearchIndex` lo espera.
    expect(invalidateSearchIndex("artist")).toBeUndefined();
    await warmSearchIndex();
    expect(await searchIds("artist", "el nombre")).toContain(id);
    expect(await searchIds("artist", "sin nombre")).toContain(id);
  });

  it("la invalidación total también refresca los tres índices", async () => {
    const person = await newPerson("Zulema Camacaro");
    const organization = await getPool().query<{ id: string }>(
      "INSERT INTO public.organizations(name, organization_type) VALUES('Sello Del Sur','record_label') RETURNING id");
    invalidateSearchIndex();
    await refreshSearchIndex();
    expect(await searchIds("person", "zulema")).toContain(person);
    expect(await searchIds("organization", "sello del sur")).toContain(Number(organization.rows[0]!.id));
  });

  async function newAlbum(artistId: number, title: string): Promise<number> {
    const { rows } = await getPool().query<{ id: string }>("INSERT INTO public.albums(artist_id, title) VALUES($1,$2) RETURNING id", [artistId, title]);
    return Number(rows[0]!.id);
  }

  async function newTrack(albumId: number, title: string, trackNumber: number): Promise<number> {
    const { rows } = await getPool().query<{ id: string }>(
      "INSERT INTO public.tracks(album_id, title, track_number) VALUES($1,$2,$3) RETURNING id", [albumId, title, trackNumber]);
    return Number(rows[0]!.id);
  }

  it("consultas cortas: comienzos sí, «contiene» no; las siglas solo como alias", async () => {
    const band = await newArtist("Desorden Público");
    const inner = await newArtist("Ladpx Banda");
    await getPool().query(
      "INSERT INTO ingest.artist_aliases(artist_id, alias, alias_type, normalized_alias) VALUES($1,'DP','acronym','dp')", [band]);
    await refreshSearchIndex("artist");
    // La sigla documentada es un alias idéntico: primer nivel.
    expect((await searchIds("artist", "DP"))[0]).toBe(band);
    expect(await searchIds("artist", "d")).toContain(band);
    // «dp» aparece dentro de «Ladpx», pero dos letras no buscan «contiene».
    expect(await searchIds("artist", "dp")).not.toContain(inner);
    expect(await searchIds("artist", "dpx")).toContain(inner);
    // Ya no se calculan iniciales: «lb» no encuentra a «Ladpx Banda».
    expect(await searchIds("artist", "lb")).not.toContain(inner);
    expect(await searchIds("artist", "l", 1)).toHaveLength(1);
  });

  it("a igual coincidencia, primero el artista con más discos", async () => {
    const small = await newArtist("Mareas Bajas");
    const big = await newArtist("Mareas Altas Del Sur");
    for (const title of ["Uno", "Dos", "Tres"]) await newAlbum(big, title);
    await refreshSearchIndex("artist");
    const ids = await searchIds("artist", "mareas");
    expect(ids.indexOf(big)).toBeLessThan(ids.indexOf(small));
  });

  it("una consulta corta corta el recorrido sin perder el nombre idéntico que va al final", async () => {
    const exact = await newArtist("Zq");
    const crowd: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const id = await newArtist(`Zq Banda ${index}`);
      await newAlbum(id, `Disco ${index}`); // más discos: van antes que «Zq» en el orden
      crowd.push(id);
    }
    await refreshSearchIndex("artist");
    const ids = await searchIds("artist", "ZQ", 20);
    expect(ids[0]).toBe(exact);
    expect(ids).toHaveLength(20);
    expect(crowd).toEqual(expect.arrayContaining(ids.slice(1)));
  });

  it("las pistas se buscan en memoria, sin tildes, y con una letra solo por comienzo", async () => {
    const artist = await newArtist("Banda De Pistas");
    const album = await newAlbum(artist, "Disco De Pistas");
    const track = await newTrack(album, "Canción Nocturna", 1);
    const inner = await newTrack(album, "Xnocturnal", 2);
    await refreshSearchIndex("track");
    expect(await searchIds("track", "cancion noct")).toContain(track);
    expect(await searchIds("track", "nocturna")).toEqual(expect.arrayContaining([track, inner]));
    expect(await searchIds("track", "c")).toContain(track);
    expect(await searchIds("track", "oc")).not.toContain(track);
    const hits = (await globalSearch("cancion nocturna", 20)).track;
    expect(hits[0]).toMatchObject({ id: track, albumId: album, context: "Banda De Pistas · Disco De Pistas" });
  });

  it("la búsqueda global repite desde caché sin volver a la base", async () => {
    expect(await globalSearch("ab", 20)).toBe(await globalSearch(" AB ", 20));
  });
});
