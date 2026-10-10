import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOrganizationRoutes } from "../../src/api/routes/organizations.js";

describe("filtros de organizaciones", () => {
  let container: PgContainer;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerOrganizationRoutes(app);
    await getPool().query(`INSERT INTO public.organizations(name, organization_type) VALUES
      ('Archivo Records', 'record_label'), ('Archivo Records', 'record_label'),
      ('Archivo Studio', 'recording_studio'), ('Estudio Norte', 'recording_studio'),
      ('Productora Norte', 'production_company'), ('Distribuidora Norte', 'distributor'),
      ('Management Norte', 'management'), ('Archivo Gráfico', 'other')`);
  });

  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); });

  it("conserva el listado y la búsqueda existentes", async () => {
    const all = await app.inject("/organizations?limit=1");
    expect(all.statusCode).toBe(200);
    expect(all.json().pagination.total).toBe(8);
    expect(all.json().data).toHaveLength(1);
    const search = await app.inject("/organizations?q=archivo");
    expect(search.json().pagination.total).toBe(4);
  });

  it("incluye las imágenes de organizaciones y conserva las fichas sin foto", async () => {
    const pictureUrl = "/media/organizations/archivo-studio.jpg";
    await getPool().query("UPDATE public.organizations SET picture_url = $1 WHERE name = $2", [pictureUrl, "Archivo Studio"]);
    const result = await app.inject("/organizations?q=archivo");
    expect(result.statusCode).toBe(200);
    const rows = result.json().data;
    expect(rows.find((row: { name: string }) => row.name === "Archivo Studio").pictureUrl).toBe(pictureUrl);
    expect(rows.find((row: { name: string }) => row.name === "Archivo Gráfico").pictureUrl).toBeNull();
  });

  it("filtra por cada uno de los seis tipos válidos", async () => {
    for (const [type, count] of Object.entries({ record_label: 2, recording_studio: 2,
      production_company: 1, distributor: 1, management: 1, other: 1 })) {
      const result = await app.inject(`/organizations?organizationType=${type}`);
      expect(result.statusCode).toBe(200);
      expect(result.json().pagination.total).toBe(count);
      expect(result.json().data.every((row: { organizationType: string }) => row.organizationType === type)).toBe(true);
    }
  });

  it("combina nombre y tipo sin incluir coincidencias de otra categoría", async () => {
    const result = await app.inject("/organizations?q=archivo&organizationType=recording_studio");
    expect(result.json().pagination.total).toBe(1);
    expect(result.json().data.map((row: { name: string }) => row.name)).toEqual(["Archivo Studio"]);
    const empty = await app.inject("/organizations?q=archivo&organizationType=management");
    expect(empty.json()).toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it("pagina dentro del tipo y mantiene el total filtrado", async () => {
    const first = (await app.inject("/organizations?organizationType=record_label&limit=1")).json();
    const second = (await app.inject("/organizations?organizationType=record_label&limit=1&offset=1")).json();
    expect(first.pagination.total).toBe(2);
    expect(second.pagination).toEqual({ total: 2, limit: 1, offset: 1 });
    expect(first.data[0].id).not.toBe(second.data[0].id);
  });

  it("devuelve conteos del catálogo completo en la ruta de facetas", async () => {
    const result = await app.inject("/organizations/facets");
    expect(result.statusCode).toBe(200);
    const facets = result.json();
    expect(facets.total).toBe(8);
    expect(facets.types).toHaveLength(6);
    expect(facets.types).toContainEqual({ organizationType: "record_label", count: 2 });
    expect(facets.types.reduce((sum: number, type: { count: number }) => sum + type.count, 0)).toBe(facets.total);
  });

  it("rechaza tipos desconocidos en lugar de ignorar el filtro", async () => {
    const result = await app.inject("/organizations?organizationType=band");
    expect(result.statusCode).toBe(400);
  });
});
