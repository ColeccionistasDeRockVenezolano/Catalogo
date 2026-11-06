// Ejecutar con la conexión de migraciones; nunca imprime la contraseña.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { getPool, closeDb } from '../src/db/client.js';
import { getEnv } from '../src/config/env.js';

const role = 'crv_landing_runtime';
const target = process.argv[2];
if (!target?.startsWith('/')) throw Error('Indica la ruta absoluta del archivo de credenciales (0600).');
const db = getPool();
const client = await db.connect();
try {
  await client.query('BEGIN');
  const info = (await client.query<{ name: string; owner: string }>('SELECT current_database() AS name, current_user AS owner')).rows[0]!;
  if (info.name !== 'crv' && !info.name.includes('staging') && !info.name.includes('test')) throw Error('Base de datos no prevista.');
  if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) throw Error('El rol ya existe. Conserva su archivo de credenciales; no se rota automáticamente.');
  const password = randomBytes(32).toString('hex');
  // Ambos identificadores son constantes y la contraseña solo contiene hexadecimales.
  await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30`);
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  await client.query(`GRANT CONNECT ON DATABASE ${quote(info.name)} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA auth, public, media, ingest, chat TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public, media, ingest, chat TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO ${role}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(info.owner)} IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(info.owner)} IN SCHEMA auth GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
  for (const schema of ['public', 'media', 'ingest', 'chat']) {
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(info.owner)} IN SCHEMA ${quote(schema)} GRANT SELECT ON TABLES TO ${role}`);
    const result = await client.query<{ allowed: boolean }>('SELECT has_schema_privilege($1,$2,\'CREATE\') AS allowed', [role, schema]);
    if (result.rows[0]?.allowed) throw Error(`El rol hereda CREATE en ${schema}; revisa los permisos PUBLIC antes de continuar.`);
  }
  await client.query(`ALTER ROLE ${role} SET statement_timeout='30s'`);
  await client.query(`ALTER ROLE ${role} SET lock_timeout='5s'`);
  await client.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout='60s'`);
  const url = new URL(getEnv().DATABASE_URL);
  url.username = role; url.password = password;
  // wx evita sustituir unas credenciales ya operativas.
  await writeFile(target, `DATABASE_URL=${JSON.stringify(url.toString())}\n`, { flag: 'wx', mode: 0o600 });
  await client.query('COMMIT');
  console.log('Rol limitado creado. Archivo de conexión guardado con permisos 0600.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release(); await closeDb();
}
