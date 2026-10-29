import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { getEnv } from "../src/config/env.js";
import { closeDb, getPool } from "../src/db/client.js";

// Una identidad de base separada: Herra solo puede operar el esquema auth.
const output = process.argv[2];
if (!output) throw new Error("Uso: tsx scripts/provision-herra-postgres.ts <archivo-privado-nuevo>");
const role = "crv_herra";
const rotate = process.argv.includes("--rotate");
const password = randomBytes(32).toString("base64url");
const url = new URL(getEnv().DATABASE_URL);
url.username = role;
url.password = password;
let created = false;
try {
  // Se reserva primero el destino: nunca rotar una credencial sin guardarla.
  await writeFile(output,`HERRA_DATABASE_URL=${url.toString()}\n`,{mode:0o600,flag:"wx"});
  await chmod(output,0o600);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[role])).rowCount;
    if (exists && !rotate) throw new Error("El rol crv_herra ya existe; reutilizar su secreto o rotarlo con --rotate");
    if (exists) await client.query(`ALTER ROLE crv_herra LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    else await client.query(`CREATE ROLE crv_herra LOGIN PASSWORD '${password}'`);
    await client.query("GRANT USAGE ON SCHEMA auth TO crv_herra");
    await client.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO crv_herra");
    await client.query("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO crv_herra");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO crv_herra");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT USAGE,SELECT ON SEQUENCES TO crv_herra");
    await client.query("COMMIT");
    created = true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  console.log(`Rol ${role} configurado con acceso a auth; secreto guardado en ${output}`);
} finally {
  await closeDb();
  if (!created) console.error("La provisión no terminó: el archivo reservado no es una credencial activa.");
}
