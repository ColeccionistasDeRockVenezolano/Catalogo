// CRV · E11.9 — Búsqueda sin tildes y listado de personas con filtros.
// Contra PostgreSQL desechable: `q=jose` encuentra «José» (la base es
// SQL_ASCII y no pliega tildes), los filtros del listado responden y el orden
// por créditos es descendente.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import { buildApp } from "../../src/api/app.js";
import { refreshSearchIndex } from "../../src/api/search-index.js";
import { listPersons } from "../../src/api/repositories/persons.js";
import { createEntity, withOperatorRun } from "../../src/merge/operator.js";

describe("búsqueda sin tildes y filtros de personas (E11.9)", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let joseId: number;
  let josefinaId: number;
  let studioId: number;
  let emptyId: number;
  let memberOnlyId: number;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    app = await buildApp();

    const one = async (sql: string, params: unknown[] = []): Promise<number> =>
      Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);
    // Los nombres con tilde y la basura tipada como persona son el caso real.
    joseId = await one("INSERT INTO public.persons(name) VALUES('José Zapata') RETURNING id");
    josefinaId = await one("INSERT INTO public.persons(name) VALUES('Josefina Requena') RETURNING id");
    studioId = await one("INSERT INTO public.persons(name) VALUES('Estudio Sin Nombre Records') RETURNING id");
    emptyId = await one("INSERT INTO public.persons(name) VALUES('Ana Sin Créditos') RETURNING id");
    memberOnlyId = await one("INSERT INTO public.persons(name) VALUES('Pedro Integrante') RETURNING id");
    // Contiene «jose» pero no empieza por él: va después de los dos anteriores.
    await one("INSERT INTO public.persons(name) VALUES('María Josefa Pérez') RETURNING id");

    // Zapata tiene dos créditos y una membresía; Requena, uno.
    const band = await one("INSERT INTO public.artists(name) VALUES('Banda Filtros QA') RETURNING id");
    const album = await one("INSERT INTO public.albums(artist_id,title) VALUES($1,'Disco Filtros QA') RETURNING id", [band]);
    await getPool().query("INSERT INTO public.album_credits(album_id,person_id,credit_type,role) VALUES($1,$2,'musician','Guitarra'),($1,$2,'producer','Producción')", [album, joseId]);
    await getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Batería')", [band, joseId]);
    await getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Guitarra')", [band, memberOnlyId]);
    const track = await one("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,1,'Pista Filtros QA') RETURNING id", [album]);
    await getPool().query("INSERT INTO public.track_credits(track_id,person_id,credit_type,role) VALUES($1,$2,'musician','Bajo')", [track, josefinaId]);
    await getPool().query("INSERT INTO public.track_credits(track_id,person_id,credit_type,role) VALUES($1,$2,'musician','Guitarra')", [track, joseId]);

    // Un alta por el camino del operador invalida el índice (E11.9): el
    // siguiente listado ya ve la ficha nueva.
    await withOperatorRun({ name: "test:create:person", operator: "prueba", note: "fixture de filtros" },
      (context) => createEntity(context, "person", { name: "Ángela de los Ríos" }));

    // El índice en memoria se calienta en segundo plano al construir la app y
    // refresca por TTL o invalidación (auditoría 2026-09-18, SWR). Las fichas
    // de este archivo entran por SQL directo, así que el test fuerza el
    // refresco: sin esto, gana la carrera el warm de arranque en las máquinas
    // rápidas (visto en CI) y la búsqueda sirve la foto anterior.
    await refreshSearchIndex();
  }, 120_000);

  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); }, 60_000);

  it("q=jose encuentra «José» y ordena primero los que empiezan por la consulta", async () => {
    const res = await app.inject({ method: "GET", url: "/persons?q=jose&limit=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.data.map((row: { name: string }) => row.name);
    expect(names).toContain("José Zapata");
    expect(names).toContain("Josefina Requena");
    // Los que empiezan por la consulta van primero; el que solo la contiene, después.
    expect(names.slice(0, 2).sort()).toEqual(["Josefina Requena", "José Zapata"]);
    expect(names.indexOf("María Josefa Pérez")).toBeGreaterThan(1);
    expect(body.data.map((row: { id: number }) => row.id)).toContain(josefinaId);

    // La búsqueda global también pliega tildes para personas y artistas.
    const global = await app.inject({ method: "GET", url: "/search?q=jose&types=person" });
    expect(global.json().person.map((hit: { label: string }) => hit.label)).toContain("José Zapata");
  });

  it("hasCredits=false devuelve solo fichas sin crédito ni membresía", async () => {
    const res = await app.inject({ method: "GET", url: "/persons?hasCredits=false&limit=50" });
    const names = res.json().data.map((row: { name: string }) => row.name);
    expect(names).toContain("Ana Sin Créditos");
    expect(names).toContain("Estudio Sin Nombre Records");
    expect(names).not.toContain("José Zapata");
    expect(res.json().data.map((row: { id: number }) => row.id)).toContain(emptyId);
    // El listado trae los contadores por fila.
    const withCredits = await app.inject({ method: "GET", url: `/persons?q=Zapata` });
    expect(withCredits.json().data[0]).toMatchObject({ creditCount: 3, bandCount: 1 });
  });

  it("sort=credits ordena por créditos + membresías, descendente", async () => {
    const res = await app.inject({ method: "GET", url: "/persons?sort=credits&limit=10" });
    const rows = res.json().data as Array<{ name: string; creditCount: number; bandCount: number }>;
    const totals = rows.map((row) => row.creditCount + row.bandCount);
    expect(totals).toEqual([...totals].sort((left, right) => right - left));
    expect(rows[0]!.name).toBe("José Zapata"); // 3 créditos + 1 membresía
  });

  it("los conteos de participación cuentan personas, sin duplicar créditos de disco y pista", async () => {
    const res = await app.inject("/persons/facets");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 7, withoutCredits: 4, roles: [
      { role: "band_member", count: 2 }, { role: "musician", count: 2 }, { role: "producer", count: 1 },
    ] });
  });

  it("filtra créditos de disco y pista y pagina personas únicas", async () => {
    const all = (await app.inject("/persons?role=musician")).json();
    expect(all.pagination.total).toBe(2);
    expect(all.data.map((row: { id: number }) => row.id).sort()).toEqual([joseId, josefinaId].sort());
    const first = (await app.inject("/persons?role=musician&limit=1&sort=credits")).json();
    const second = (await app.inject("/persons?role=musician&limit=1&offset=1&sort=credits")).json();
    expect(first.pagination.total).toBe(2);
    expect(second.pagination.total).toBe(2);
    expect(first.data[0].id).toBe(joseId);
    expect(second.data[0].id).toBe(josefinaId);
  });

  it("incluye integrantes con membresías y sin créditos de disco o pista", async () => {
    const members = (await app.inject("/persons?role=band_member")).json();
    expect(members.pagination.total).toBe(2);
    expect(members.data.map((row: { id: number }) => row.id)).toContain(memberOnlyId);
    const without = (await app.inject("/persons?hasCredits=false")).json();
    expect(without.data.map((row: { id: number }) => row.id)).not.toContain(memberOnlyId);
  });

  it("combina participación, nombre sin tildes y revisión de nombres", async () => {
    const producer = await app.inject("/persons?q=jose&role=producer");
    expect(producer.statusCode).toBe(200);
    expect(producer.json().data.map((row: { id: number }) => row.id)).toEqual([joseId]);
    const suspect = await app.inject("/persons?role=producer&suspect=organization_like&sort=credits");
    expect(suspect.statusCode).toBe(200);
    expect(suspect.json()).toMatchObject({ data: [], pagination: { total: 0 } });
    const empty = await app.inject("/persons?role=mastering");
    expect(empty.json()).toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it("comparte solicitudes simultáneas y vuelve a leer después de una escritura", async () => {
    const query = { limit: 50, offset: 0, role: "producer" };
    const first = listPersons(query);
    const concurrent = listPersons({ ...query });
    expect(concurrent).toBe(first);
    expect((await first).rows.map(row => row.id)).toEqual([joseId]);
    await getPool().query("UPDATE public.persons SET nationality='VE' WHERE id=$1", [joseId]);
    const next = listPersons(query);
    expect(next).not.toBe(first);
    expect((await next).rows[0]?.nationality).toBe("VE");
  });

  it("cancela lecturas bloqueadas y recupera conexiones sin dejar el timeout en el pool", async () => {
    const locker = await getPool().connect();
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE public.persons IN ACCESS EXCLUSIVE MODE");
    try {
      await expect(listPersons({ limit: 1, offset: 0 })).rejects.toMatchObject({ code: "57014" });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    expect((await listPersons({ limit: 1, offset: 0 })).rows).toHaveLength(1);
    expect((await getPool().query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("0");
  });

  it("conteos precalculados (0128): una escritura directa se ve en el siguiente listado", async () => {
    const pool = getPool();
    // El primer listado filtrado construye la tabla y deja las anotaciones vacías.
    await listPersons({ limit: 50, offset: 0, role: "composer" });
    const state = await pool.query("SELECT built, (SELECT count(*)::int FROM ingest.person_counts_changes) AS pending FROM ingest.person_counts_state");
    expect(state.rows[0]).toEqual({ built: true, pending: 0 });
    const stored = await pool.query("SELECT credit_count, band_count FROM ingest.person_counts WHERE person_id=$1", [joseId]);
    expect(stored.rows[0]).toEqual({ credit_count: 3, band_count: 1 });

    // SQL directo, sin publicar revisión: el disparador anota la transacción.
    const album = (await pool.query<{ album_id: string }>(
      "SELECT album_id::text FROM public.album_credits WHERE person_id=$1 LIMIT 1", [joseId])).rows[0]!.album_id;
    await pool.query("INSERT INTO public.album_credits(album_id,person_id,credit_type,role) VALUES($1,$2,'composer','Composición')", [album, josefinaId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.person_counts_changes")).rows[0].n).toBe(1);

    // Dentro del minuto siguiente a un recálculo se cuenta en vivo: fresco, sin recalcular.
    const live = await listPersons({ limit: 50, offset: 0, role: "composer" });
    expect(live.rows.map(row => row.id)).toEqual([josefinaId]);
    expect(live.rows[0]?.creditCount).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.person_counts_changes")).rows[0].n).toBe(1);

    // Pasado el minuto, el listado filtrado recalcula la tabla y lee de ella.
    await pool.query("UPDATE ingest.person_counts_state SET refreshed_at = now() - interval '2 minutes'");
    const composers = await listPersons({ limit: 50, offset: 0, role: "composer" });
    expect(composers).toEqual(live);
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.person_counts_changes")).rows[0].n).toBe(0);

    // La página por nombre cuenta en vivo si la tabla está atrasada, y lee la tabla si está al día.
    await pool.query("DELETE FROM public.album_credits WHERE person_id=$1 AND credit_type='composer'", [josefinaId]);
    const byName = await listPersons({ limit: 50, offset: 0 });
    expect(byName.rows.find(row => row.id === josefinaId)?.creditCount).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.person_counts_changes")).rows[0].n).toBe(1);
    await pool.query("UPDATE ingest.person_counts_state SET refreshed_at = now() - interval '2 minutes'");
    expect((await listPersons({ limit: 50, offset: 0, role: "composer" })).rows).toEqual([]);
    const fromTable = await listPersons({ limit: 50, offset: 0 });
    expect(fromTable).toEqual(byName);
  });

  it("recálculos simultáneos: uno solo a la vez y el resultado es el mismo", async () => {
    const pool = getPool();
    await pool.query("UPDATE public.artists SET name = name WHERE name = 'Banda Filtros QA'");
    await pool.query("UPDATE ingest.person_counts_state SET refreshed_at = now() - interval '2 minutes'");
    const results = await Promise.all(Array.from({ length: 5 }, () => listPersons({ limit: 50, offset: 0, sort: "credits" })));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]!.rows[0]?.id).toBe(joseId);
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.person_counts_changes")).rows[0].n).toBe(0);
  });

  it("valida el rol solicitado", async () => {
    const invalid = await app.inject("/persons?role=record_label");
    expect(invalid.statusCode).toBe(400);
  });

  it("suspect=organization_like filtra por el clasificador (E11.7) y la ficha dice su clase", async () => {
    const res = await app.inject({ method: "GET", url: "/persons?suspect=organization_like&limit=50" });
    expect(res.json().data.map((row: { name: string }) => row.name)).toEqual(["Estudio Sin Nombre Records"]);

    const detail = await app.inject({ method: "GET", url: `/persons/${studioId}` });
    expect(detail.json()).toMatchObject({ nameClass: "organization_like", nameClassReason: expect.stringContaining("estudio") });
    const clean = await app.inject({ method: "GET", url: `/persons/${joseId}` });
    expect(clean.json()).toMatchObject({ nameClass: "ok", nameClassReason: "" });
  });

  it("el índice se invalida al escribir: una persona creada por el operador aparece de inmediato", async () => {
    const before = await app.inject({ method: "GET", url: "/persons?q=Ángela" });
    expect(before.json().data.map((row: { name: string }) => row.name)).toEqual(["Ángela de los Ríos"]);
    // Búsqueda sin tildes de la misma ficha.
    const plain = await app.inject({ method: "GET", url: "/persons?q=angela de los rios" });
    expect(plain.json().data.map((row: { name: string }) => row.name)).toEqual(["Ángela de los Ríos"]);
  });
});
