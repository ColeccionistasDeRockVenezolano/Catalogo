import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { searchLocalEvidence } from "../../src/research/local-evidence.js";

describe("evidencia local para la IA (contrato)", () => {
  let container: PgContainer;
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
  }, 120_000);
  afterAll(async () => { await closeDb(); await container.stop(); });

  it("recupera fragmentos citables por nombre y prioriza la fuente", async () => {
    await getPool().query(`
      INSERT INTO ingest.local_evidence(source,source_path,artist_key,artist_name,title,url,body,captured_at)
      VALUES ('rym','/tmp/rym.json','yorghaki','Yorghaki','Biografía','https://rateyourmusic.com/artist/yorghaki','Banda caraqueña de rock alternativo.',now()),
             ('rhv','/tmp/rhv.json','yorghaki','Yorghaki','Ficha','https://rockhechovenezuela.com/a/yorghaki/','Ficha de Rock Hecho en Venezuela con discografía.',now())`);
    const rows = await searchLocalEvidence(getPool(), ["Yorghaki"], 5);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ source: "rhv", url: "https://rockhechovenezuela.com/a/yorghaki/" });
    expect(rows[0]!.snippet).toContain("Rock Hecho");
    expect(rows.every((row) => row.snippet.length <= 702)).toBe(true);
  }, 60_000);

  it("devuelve vacío si no hay coincidencia", async () => {
    expect(await searchLocalEvidence(getPool(), ["Artista Inexistente XYZ"], 5)).toEqual([]);
  }, 60_000);
});
