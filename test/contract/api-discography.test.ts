// CRV · Plan del primo, etapa 2 — API del modelo discográfico (0068):
// versiones con sello y rol, serie, créditos en frase con tramos, página de
// lugar, página de serie, sucesión de sellos e integrantes (fundador,
// instrumentos). Contra una PostgreSQL desechable, con `app.inject()`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import { buildApp } from "../../src/api/app.js";

describe("API del modelo discográfico (plan del primo, etapa 2)", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    const db = getPool();
    const one = async (sql: string, params: unknown[] = []) => Number((await db.query<{ id: string }>(sql, params)).rows[0]!.id);

    ids["band"] = await one("INSERT INTO public.artists(name, artist_type) VALUES ('Desorden Público', 'band') RETURNING id");
    ids["va"] = await one("INSERT INTO public.artists(name, artist_type) VALUES ('Various Artists', 'band') RETURNING id");
    ids["rodven"] = await one("INSERT INTO public.organizations(name, organization_type) VALUES ('Rodven', 'record_label') RETURNING id");
    ids["polygram"] = await one("INSERT INTO public.organizations(name, organization_type) VALUES ('Polygram Records S.A.', 'record_label') RETURNING id");
    ids["am"] = await one("INSERT INTO public.organizations(name, organization_type) VALUES ('A&M Studios', 'recording_studio') RETURNING id");
    ids["person"] = await one("INSERT INTO public.persons(name) VALUES ('James A. Labinski') RETURNING id");
    ids["horacio"] = await one("INSERT INTO public.persons(name) VALUES ('Horacio Blanco') RETURNING id");
    ids["antonio"] = await one("INSERT INTO public.persons(name) VALUES ('Antonio Rojas') RETURNING id");
    ids["album"] = await one("INSERT INTO public.albums(title, artist_id, release_year, album_type, label_id) VALUES ('Plomo Revienta', $1, 1997, 'studio_album', $2) RETURNING id", [ids["band"], ids["rodven"]]);
    ids["vol1"] = await one("INSERT INTO public.albums(title, artist_id, release_year, album_type) VALUES ('Venezuela Electrónica Vol. 1', $1, 2006, 'compilation') RETURNING id", [ids["va"]]);
    ids["vol2"] = await one("INSERT INTO public.albums(title, artist_id, release_year, album_type) VALUES ('Venezuela Electrónica Vol. 2', $1, 2007, 'compilation') RETURNING id", [ids["va"]]);

    await db.query("UPDATE public.albums SET cover_url = '/crv/media/vol2.jpg' WHERE id = $1", [ids["vol2"]]);

    const primary = await one(`INSERT INTO ingest.album_versions(album_id, position, title, format, country, release_year, is_primary, source)
      VALUES ($1, 1, 'Edición original', 'CD', 'Venezuela', 1997, true, 'albums') RETURNING id`, [ids["album"]]);
    const reissue = await one(`INSERT INTO ingest.album_versions(album_id, position, title, format, format_details, country, release_year, is_primary, source, source_ref)
      VALUES ($1, 2, 'Edición estadounidense', 'CD', 'CD, Álbum', 'Estados Unidos', 1998, false, 'discogs', 'https://www.discogs.com/release/1 (máster)') RETURNING id`, [ids["album"]]);
    await db.query("INSERT INTO ingest.album_labels(album_id, version_id, organization_id, role) VALUES ($1, $2, $3, 'label'), ($1, $4, $5, 'distributor')",
      [ids["album"], primary, ids["rodven"], reissue, ids["polygram"]]);

    const series = await one("INSERT INTO ingest.series(title, artist_id, source) VALUES ('Venezuela Electrónica', $1, 'plan-primo') RETURNING id", [ids["va"]]);
    ids["series"] = series;
    await db.query("INSERT INTO ingest.series_albums(series_id, album_id, volume_number, volume_label) VALUES ($1, $2, 1, 'Vol. 1'), ($1, $3, 2, 'Vol. 2')", [series, ids["vol1"], ids["vol2"]]);

    ids["country"] = await one("INSERT INTO ingest.places(name, place_type, country) VALUES ('Estados Unidos', 'country', 'Estados Unidos') RETURNING id");
    ids["place"] = await one("INSERT INTO ingest.places(name, place_type, city, region, country, parent_id) VALUES ('Hollywood, California', 'city', 'Hollywood', 'California', 'Estados Unidos', $1) RETURNING id", [ids["country"]]);
    await db.query("INSERT INTO ingest.place_aliases(place_id, alias, alias_key) VALUES ($1, 'Hollywood, CA', 'hollywood ca')", [ids["place"]]);
    await db.query("INSERT INTO ingest.organization_places(organization_id, place_id, source) VALUES ($1, $2, 'youtube_description')", [ids["am"], ids["place"]]);
    // «Recorded by James A. Labinski at A&M Studios (Hollywood, California)»
    const statement = await one(`INSERT INTO ingest.credit_statements(album_id, section_kind, line_number, text)
      VALUES ($1, 'other_credits', 1, 'Recorded by James A. Labinski at A&M Studios (Hollywood, California)') RETURNING id`, [ids["album"]]);
    await db.query(`INSERT INTO ingest.credit_statement_parts(statement_id, start_offset, end_offset, part_type, role_key, person_id, organization_id, place_id) VALUES
      ($1, 0, 8, 'role', 'recording', NULL, NULL, NULL), ($1, 12, 29, 'person', NULL, $2, NULL, NULL),
      ($1, 33, 44, 'organization', NULL, NULL, $3, NULL), ($1, 46, 67, 'place', NULL, NULL, NULL, $4)`,
    [statement, ids["person"], ids["am"], ids["place"]]);

    await db.query(`INSERT INTO ingest.organization_relations(from_organization_id, to_organization_id, relation_type, start_year, evidence_note, source_urls)
      VALUES ($1, $2, 'absorbed_by', 1995, '«It was ultimately acquired by PolyGram in 1995.»', ARRAY['https://en.wikipedia.org/wiki/Rodven_Records'])`, [ids["rodven"], ids["polygram"]]);

    const horacio = await one("INSERT INTO public.artist_members(artist_id, person_id, role, from_year, is_current) VALUES ($1, $2, 'Guitar & Vocals', 1985, true) RETURNING id", [ids["band"], ids["horacio"]]);
    const antonio = await one("INSERT INTO public.artist_members(artist_id, person_id, role, from_year, to_year) VALUES ($1, $2, 'Guitar', 1985, 2004) RETURNING id", [ids["band"], ids["antonio"]]);
    await db.query(`INSERT INTO ingest.membership_details(artist_member_id, is_founder, founder_evidence, founder_source, instruments) VALUES
      ($1, true, 'fundada en 1985 por Horacio Blanco', 'biografía CRV', ARRAY['vocals','guitar']), ($2, NULL, NULL, NULL, ARRAY['guitar'])`, [horacio, antonio]);

    app = await buildApp();
    await app.ready();
  }, 240_000);

  afterAll(async () => { await app?.close(); await closeDb(); resetEnvCache(); await container?.stop(); }, 60_000);

  it("el disco trae sus versiones con sello, rol, país y año, la principal primero", async () => {
    const res = await app.inject({ method: "GET", url: `/albums/${ids["album"]}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.versions.map((version: { title: string }) => version.title)).toEqual(["Edición original", "Edición estadounidense"]);
    expect(body.versions[1]).toMatchObject({ country: "Estados Unidos", releaseYear: 1998, sourceUrl: "https://www.discogs.com/release/1",
      labels: [{ name: "Polygram Records S.A.", role: "distributor", roleLabel: "Distribuidor" }] });
    expect(body.labels).toEqual([expect.objectContaining({ name: "Rodven", role: "label" })]);
  });

  it("el disco trae sus créditos en frase con los tramos enlazados", async () => {
    const body = (await app.inject({ method: "GET", url: `/albums/${ids["album"]}` })).json();
    expect(body.creditStatements).toHaveLength(1);
    const parts = body.creditStatements[0].parts;
    expect(parts.find((part: { type: string }) => part.type === "place")).toMatchObject({ placeId: ids["place"], start: 46, end: 67 });
    expect(parts.find((part: { type: string }) => part.type === "organization")).toMatchObject({ organizationId: ids["am"] });
  });

  it("un volumen dice a qué serie pertenece, con el anterior y el siguiente", async () => {
    const body = (await app.inject({ method: "GET", url: `/albums/${ids["vol1"]}` })).json();
    expect(body.series).toEqual([expect.objectContaining({ title: "Venezuela Electrónica", line: "Venezuela Electrónica – Vol. 1", previous: null,
      next: { albumId: ids["vol2"], title: "Venezuela Electrónica Vol. 2", coverUrl: "/crv/media/vol2.jpg" } })]);
  });

  it("el último volumen enlaza al anterior aunque no tenga portada", async () => {
    const body = (await app.inject({ method: "GET", url: `/albums/${ids["vol2"]}` })).json();
    expect(body.series[0]).toMatchObject({
      previous: { albumId: ids["vol1"], title: "Venezuela Electrónica Vol. 1", coverUrl: null }, next: null,
    });
  });

  it("la página de serie lista los volúmenes en orden", async () => {
    const res = await app.inject({ method: "GET", url: `/series/${ids["series"]}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().volumes.map((volume: { volumeLabel: string }) => volume.volumeLabel)).toEqual(["Vol. 1", "Vol. 2"]);
    expect((await app.inject({ method: "GET", url: "/series/999999" })).statusCode).toBe(404);
  });

  it("el índice agrupa compilados y conserva filtros, orden y paginación", async () => {
    const body = (await app.inject({ method: "GET", url: "/series?limit=1&q=Electrónica&decade=2000&albumType=compilation" })).json();
    expect(body.pagination).toEqual({ limit: 1, offset: 0, total: 1 });
    expect(body.data).toEqual([expect.objectContaining({ id: ids["series"], title: "Venezuela Electrónica", albumCount: 2,
      covers: ["/crv/media/vol2.jpg"], firstYear: 2006, lastYear: 2007 })]);
    expect((await app.inject({ method: "GET", url: "/series?q=Electrónica&offset=1&limit=1" })).json().data).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/series?decade=1990" })).json().pagination.total).toBe(0);
    expect((await app.inject({ method: "GET", url: "/series?albumType=compilation,single" })).json().pagination.total).toBe(0);
    expect((await app.inject({ method: "GET", url: "/series?limit=0" })).statusCode).toBe(400);
  });

  it("solo Various Artists forma series: un disco de un artista deja el grupo fuera del índice, las fichas y /series/:id", async () => {
    const db = getPool();
    const group = Number((await db.query("INSERT INTO ingest.series(title, source) VALUES ('Grupo de estudio', 'test') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id) VALUES($1,$2)", [group, ids["album"]]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/series?q=Grupo" })).json().pagination.total).toBe(0);
    expect((await app.inject({ method: "GET", url: `/albums/${ids["album"]}` })).json().series).toEqual([]);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id) VALUES($1,$2)", [group, ids["vol1"]]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(404);
    // Un «grandes éxitos» de un artista dentro de una colección de sello sigue fuera aunque sea compilado.
    await db.query("INSERT INTO ingest.album_classifications(album_id,classification,position,inferred) VALUES($1,'Compilation Album',1,false)", [ids["album"]]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(404);
    await db.query("DELETE FROM ingest.album_classifications WHERE album_id=$1", [ids["album"]]);
    // Un festival en directo de Various Artists sí es entrega de su serie.
    const live = Number((await db.query("INSERT INTO public.albums(title,artist_id,release_year,album_type) VALUES('Festival en vivo',$1,2000,'live_album') RETURNING id", [ids["va"]])).rows[0].id);
    await db.query("DELETE FROM ingest.series_albums WHERE series_id=$1 AND album_id=$2", [group, ids["album"]]);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id) VALUES($1,$2)", [group, live]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/series?q=Grupo&albumType=live_album" })).json().pagination.total).toBe(1);
    await db.query("DELETE FROM ingest.series WHERE id=$1", [group]);
    await db.query("DELETE FROM public.albums WHERE id=$1", [live]);
  });

  it("una serie de sesiones (una banda por entrega, como «Sonó Así») se publica sin ser de Various Artists", async () => {
    const db = getPool();
    const other = Number((await db.query("INSERT INTO public.artists(name,artist_type) VALUES('Famasloop','band') RETURNING id")).rows[0].id);
    const session = Number((await db.query("INSERT INTO public.albums(title,artist_id,release_year,album_type) VALUES('Sonó Así',$1,2009,'ep') RETURNING id", [other])).rows[0].id);
    const group = Number((await db.query("INSERT INTO ingest.series(title,source) VALUES('Sonó Así','test') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id) VALUES($1,$2),($1,$3)", [group, ids["album"], session]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(404);
    await db.query("UPDATE ingest.series SET kind='sessions' WHERE id=$1", [group]);
    const body = (await app.inject({ method: "GET", url: `/series/${group}` })).json();
    expect(body.kind).toBe("sessions");
    expect(body.volumes.map((volume: { artistId: number }) => volume.artistId).sort()).toEqual([ids["band"], other].sort());
    expect((await app.inject({ method: "GET", url: "/series?q=Sonó" })).json().data[0]).toMatchObject({ title: "Sonó Así", kind: "sessions", albumCount: 2 });
    await db.query("DELETE FROM ingest.series WHERE id=$1", [group]);
    await db.query("DELETE FROM public.albums WHERE id=$1", [session]);
    await db.query("DELETE FROM public.artists WHERE id=$1", [other]);
  });

  it("una serie con una sola entrega catalogada queda registrada pero no se publica", async () => {
    const db = getPool();
    const group = Number((await db.query("INSERT INTO ingest.series(title,source) VALUES('Colección solitaria','test') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label) VALUES($1,$2,1,'Vol. 1')", [group, ids["vol1"]]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/series?q=Colección solitaria" })).json().pagination.total).toBe(0);
    expect((await app.inject({ method: "GET", url: `/albums/${ids["vol1"]}` })).json().series.some((item: {id:number}) => item.id === group)).toBe(false);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id,volume_number,volume_label) VALUES($1,$2,2,'Vol. 2')", [group, ids["vol2"]]);
    expect((await app.inject({ method: "GET", url: `/series/${group}` })).statusCode).toBe(200);
    await db.query("DELETE FROM ingest.series WHERE id=$1", [group]);
  });

  it("una entrega anterior sin número conserva la continuidad y el orden de sus carátulas", async () => {
    const db = getPool();
    const first = Number((await db.query(`INSERT INTO public.albums(title,artist_id,release_year,album_type,cover_url)
      VALUES('Primera recopilación',$1,2005,'compilation','/first-cover.jpg') RETURNING id`, [ids["va"]])).rows[0].id);
    const group = Number((await db.query("INSERT INTO ingest.series(title,source) VALUES('Colección mixta','test') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO ingest.series_albums(series_id,album_id,volume_number) VALUES($1,$2,NULL),($1,$3,1),($1,$4,2)", [group, first, ids["vol1"], ids["vol2"]]);
    const detail = (await app.inject({method:'GET',url:`/series/${group}`})).json();
    expect(detail.volumes.map((volume: {albumId:number}) => volume.albumId)).toEqual([first,ids["vol1"],ids["vol2"]]);
    const membership = (await app.inject({method:'GET',url:`/albums/${ids["vol1"]}`})).json().series.find((item: {id:number}) => item.id === group);
    expect(membership.previous.albumId).toBe(first);
    const list = (await app.inject({method:'GET',url:'/series?q=Colección mixta'})).json();
    expect(list.data[0].covers).toEqual(['/first-cover.jpg','/crv/media/vol2.jpg']);
    await db.query('DELETE FROM ingest.series WHERE id=$1',[group]);
    await db.query('DELETE FROM public.albums WHERE id=$1',[first]);
  });

  it("la página de lugar muestra el estudio y los discos grabados ahí, por rol", async () => {
    const body = (await app.inject({ method: "GET", url: `/places/${ids["place"]}` })).json();
    expect(body).toMatchObject({ name: "Hollywood, California", parent: { id: ids["country"], name: "Estados Unidos" }, aliases: ["Hollywood, CA"] });
    expect(body.studios).toEqual([{ id: ids["am"], name: "A&M Studios", albumCount: 1 }]);
    expect(body.albumsByRole).toEqual([{ roleKey: "recording", albums: [expect.objectContaining({ albumId: ids["album"], studios: [{ id: ids["am"], name: "A&M Studios" }] })] }]);
    // El país incluye lo que pasa en sus ciudades.
    const country = (await app.inject({ method: "GET", url: `/places/${ids["country"]}` })).json();
    expect(country.children).toEqual([{ id: ids["place"], name: "Hollywood, California" }]);
    expect(country.studios.map((studio: { id: number }) => studio.id)).toEqual([ids["am"]]);
  });

  it("el sello muestra su sucesión con la fuente y el estudio su lugar", async () => {
    const rodven = (await app.inject({ method: "GET", url: `/organizations/${ids["rodven"]}` })).json();
    expect(rodven.relations).toEqual([expect.objectContaining({ direction: "outgoing", relationType: "absorbed_by", startYear: 1995,
      other: { id: ids["polygram"], name: "Polygram Records S.A." }, sourceUrls: ["https://en.wikipedia.org/wiki/Rodven_Records"] })]);
    const polygram = (await app.inject({ method: "GET", url: `/organizations/${ids["polygram"]}` })).json();
    expect(polygram.relations[0]).toMatchObject({ direction: "incoming", other: { id: ids["rodven"] } });
    expect(polygram.roleAlbums).toEqual([expect.objectContaining({ albumId: ids["album"], role: "distributor" })]);
    const studio = (await app.inject({ method: "GET", url: `/organizations/${ids["am"]}` })).json();
    expect(studio.places).toEqual([{ id: ids["place"], name: "Hollywood, California" }]);
    expect(studio.studioAlbums).toEqual([expect.objectContaining({ albumId: ids["album"], roles: ["recording"] })]);
  });

  it("los integrantes traen fundador, cita e instrumentos", async () => {
    const body = (await app.inject({ method: "GET", url: `/artists/${ids["band"]}` })).json();
    const horacio = body.members.find((member: { personName: string }) => member.personName === "Horacio Blanco");
    expect(horacio).toMatchObject({ isFounder: true, founderEvidence: "fundada en 1985 por Horacio Blanco", instruments: ["vocals", "guitar"] });
    const antonio = body.members.find((member: { personName: string }) => member.personName === "Antonio Rojas");
    expect(antonio).toMatchObject({ isFounder: null, instruments: ["guitar"] });
  });
});
