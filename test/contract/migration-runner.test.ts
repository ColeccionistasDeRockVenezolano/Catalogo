import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp, migrateDownAll } from "../../src/db/migrate.js";

let container: PgContainer;
let directory: string;
beforeAll(async () => {
  container = await startPgContainer();
  process.env["DATABASE_URL"] = container.databaseUrl;
  process.env["GENRES_PROJECTION_ENABLED"] = "false";
  resetEnvCache();
  directory = await mkdtemp(path.join(tmpdir(), "crv-migration-failure-"));
});
afterAll(async () => {
  await closeDb();
  await container?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("fallar en up revierte DDL y versión; dos runners aplican una sola vez; fallar en down conserva datos y versión", async () => {
  const up = path.join(directory, "0001_probe.up.sql");
  const down = path.join(directory, "0001_probe.down.sql");
  await writeFile(up, "BEGIN;\nCREATE TABLE ingest.migration_probe (value text);\nSELECT 1/0;\nCOMMIT;\n");
  await writeFile(down, "BEGIN;\nDROP TABLE ingest.migration_probe;\nSELECT 1/0;\nCOMMIT;\n");
  await expect(migrateUp(directory)).rejects.toThrow(/division by zero/u);
  expect((await getPool().query("SELECT to_regclass('ingest.migration_probe') AS table_name")).rows).toEqual([{ table_name: null }]);
  expect((await getPool().query("SELECT version FROM ingest.schema_migrations")).rows).toEqual([]);

  await writeFile(up, "BEGIN;\nCREATE TABLE ingest.migration_probe (value text);\nINSERT INTO ingest.migration_probe VALUES ('dato preservado');\nCOMMIT;\n");
  const results = await Promise.all([migrateUp(directory), migrateUp(directory)]);
  expect(results.map(r => r.applied.length).sort()).toEqual([0, 1]);
  expect((await getPool().query("SELECT value FROM ingest.migration_probe")).rows).toEqual([{ value: "dato preservado" }]);
  await expect(migrateDownAll(directory)).rejects.toThrow(/division by zero/u);
  expect((await getPool().query("SELECT value FROM ingest.migration_probe")).rows).toEqual([{ value: "dato preservado" }]);
  expect((await getPool().query("SELECT version FROM ingest.schema_migrations")).rows).toEqual([{ version: "0001_probe" }]);
  await writeFile(down, "DROP TABLE ingest.migration_probe;\n");
  expect((await migrateDownAll(directory)).reverted).toEqual(["0001_probe"]);
  // An unapplied down that would fail must never be executed.
  expect((await migrateDownAll(directory)).reverted).toEqual([]);
});
