import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";

export const HERRA_TABLES = ["activation_tokens", "admins", "application_catalog_terms", "application_links", "applications", "audit_log", "catalog_terms", "categories", "instance_settings", "people", "person_catalog_terms", "person_links", "project_assets", "project_features", "project_visit_stats", "project_visits", "projects", "registration_tokens", "task_assignees", "tasks", "traffic_daily", "traffic_visitors", "users"] as const;

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function fingerprint(rows: unknown[][]): string {
  const canonical = rows.map(row => JSON.stringify(row.map(value => value instanceof Uint8Array
    ? { bytes: Buffer.from(value).toString("base64") } : value))).sort();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface LocalAccountImport { username: string; name: string; passwordHash: string; role?: "admin" | "reader" | undefined }
export interface ImportReceipt { sourceSha256: string; tables: Record<string, { count: number; sha256: string }>; alreadyImported: boolean }

/** Una sola transacción. Nunca sobrescribe una base con datos ni actualiza una réplica. */
export async function importHerra(pool: Pool, sqlitePath: string, localAccounts: LocalAccountImport[] = []): Promise<ImportReceipt> {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const client = await pool.connect();
  try {
    sqlite.exec("BEGIN");
    const integrity = sqlite.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== "ok") throw new Error("SQLite no pasa integrity_check");
    if (sqlite.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SQLite tiene referencias inválidas");
    const sourceTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row["name"]);
    if (JSON.stringify(sourceTables) !== JSON.stringify(HERRA_TABLES)) throw new Error("El esquema de Herra difiere de la versión admitida; revisar antes de importar");
    const tables: ImportReceipt["tables"] = {};
    const content = HERRA_TABLES.map(table => {
      const columns = sqlite.prepare(`PRAGMA table_info(${identifier(table)})`).all().map(row => String(row["name"]));
      const rows = sqlite.prepare(`SELECT ${columns.map(identifier).join(",")} FROM ${identifier(table)}`).all()
        .map(row => columns.map(column => row[column]));
      tables[table] = { count: rows.length, sha256: fingerprint(rows) };
      return { table, columns, rows };
    });
    tables["local_accounts"] = { count: localAccounts.length, sha256: fingerprint(localAccounts.map(a => [a.username,a.name,a.passwordHash,a.role ?? "admin"])) };
    const sourceSha256 = createHash("sha256").update(JSON.stringify(tables)).digest("hex");
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:import-herra'))");
    const sharedTables = Object.fromEntries(Object.entries(tables).filter(([table]) => table !== "local_accounts"));
    // Después del corte el JSON del entorno se retira. Repetir la misma
    // instantánea sin ese JSON reconoce el recibo y conserva las cuentas.
    const previous = await client.query<{ source_sha256: string; tables: ImportReceipt["tables"] }>(
      `SELECT source_sha256,tables FROM auth.import_receipts WHERE source_sha256=$1
        OR ($2::boolean AND tables - 'local_accounts'=$3::jsonb) LIMIT 1`,
      [sourceSha256,localAccounts.length === 0,JSON.stringify(sharedTables)]);
    if (previous.rowCount) {
      await client.query("ROLLBACK");
      return { sourceSha256: previous.rows[0]!.source_sha256, tables: previous.rows[0]!.tables, alreadyImported: true };
    }
    for (const table of [...HERRA_TABLES, "local_accounts"]) {
      const occupied = await client.query(`SELECT 1 FROM auth.${identifier(table)} LIMIT 1`);
      if (occupied.rowCount) throw new Error(`auth.${table} ya contiene datos; importación cancelada`);
    }
    for (const { table, columns, rows } of content) {
      const target = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name=$1 ORDER BY ordinal_position", [table]);
      if (JSON.stringify(target.rows.map(row => row.column_name).sort()) !== JSON.stringify([...columns].sort())) throw new Error(`Columnas incompatibles: ${table}`);
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset,offset+100);
        const values = batch.flat().map(value => value instanceof Uint8Array ? Buffer.from(value) : value);
        const placeholders = batch.map((_,i) => `(${columns.map((_,j) => `$${i*columns.length+j+1}`).join(",")})`).join(",");
        await client.query(`INSERT INTO auth.${identifier(table)} (${columns.map(identifier).join(",")}) VALUES ${placeholders}`,values);
      }
      const imported = await client.query(`SELECT ${columns.map(identifier).join(",")} FROM auth.${identifier(table)}`);
      const actual = fingerprint(imported.rows.map(row => columns.map(column => row[column])));
      if (actual !== tables[table]!.sha256) throw new Error(`Contenido distinto tras importar ${table}`);
      const sequence = sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table)?.["seq"];
      if (sequence !== undefined) {
        await client.query("SELECT setval(pg_get_serial_sequence($1,'id'),greatest($2::bigint,1),$2::bigint>0)", [`auth.${table}`,Number(sequence)]);
      }
    }
    for (const account of localAccounts) {
      await client.query("INSERT INTO auth.local_accounts (username,name,password_hash,role) VALUES ($1,$2,$3,$4)",
        [account.username,account.name,account.passwordHash,account.role ?? "admin"]);
    }
    const localRows = await client.query("SELECT username::text,name,password_hash,role FROM auth.local_accounts");
    if (fingerprint(localRows.rows.map(row => [row["username"],row["name"],row["password_hash"],row["role"]])) !== tables["local_accounts"]!.sha256) throw new Error("Las cuentas locales importadas difieren");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("INSERT INTO auth.import_receipts (source_sha256,tables) VALUES ($1,$2)",[sourceSha256,JSON.stringify(tables)]);
    await client.query("COMMIT");
    return { sourceSha256, tables, alreadyImported: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    sqlite.close();
    client.release();
  }
}
