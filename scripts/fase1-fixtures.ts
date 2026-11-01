// CRV · Fixtures de la Fase 1 para STAGING.
//
// Crea tres administradores de prueba con contraseñas conocidas para verificar
// la matriz de roles (admin/community/curator) contra el servidor de staging.
// Nunca debe ejecutarse contra producción: comprueba la base antes de escribir.
//
//   CRV_ENV_FILE=~/apps/crv-staging/staging.env \
//     ./scripts/with-node22.sh tsx scripts/fase1-fixtures.ts
//   ... --clean            # elimina las cuentas de prueba y sus sesiones
//   ... --clean-personas   # elimina personas huérfanas que dejan los guiones
import { getPool, closeDb } from "../src/db/client.js";
import { getEnv } from "../src/config/env.js";
import { hashAccessCode } from "../src/api/community/validation.js";

const ACCOUNTS = [
  { username: "fase1-admin", password: "Fase1Admin2026", role: "admin" },
  { username: "fase1-community", password: "Fase1Community2026", role: "community" },
  { username: "fase1-curator", password: "Fase1Curator2026", role: "curator" },
] as const;

async function main(): Promise<void> {
  const pool = getPool();
  const { rows: db } = await pool.query<{ datname: string }>("SELECT current_database() AS datname");
  const database = db[0]?.datname ?? "";
  if (!database.includes("staging")) {
    throw new Error(`Este script solo puede escribir en una base de staging (actual: ${database}).`);
  }
  const clean = process.argv.includes("--clean");
  const cleanPersonas = process.argv.includes("--clean-personas");

  if (cleanPersonas) {
    // Personas que dejan los guiones de navegador (C5) cuando borran su cuenta:
    // el borrado conserva la persona global a propósito, así que se limpia aquí.
    const { rowCount } = await pool.query(
      `DELETE FROM auth.people p
        WHERE p.first_name = 'Persona' AND p.last_name IN ('C5', 'B7')
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.person_id = p.id)`,
    );
    console.log(`personas de prueba huérfanas eliminadas: ${rowCount ?? 0}`);
    await closeDb();
    return;
  }

  if (clean) {
    // Las sesiones de esas cuentas quedarían abiertas hasta caducar y romperían
    // el recuento de staging («0 sesiones»): se borran con las cuentas.
    const { rowCount: sessions } = await pool.query(
      "DELETE FROM auth.sessions WHERE lower(payload->>'username') LIKE 'fase1-%'",
    );
    console.log(`sesiones de fixtures eliminadas: ${sessions ?? 0}`);
  }

  const { rows: projects } = await pool.query<{ id: number }>(
    "SELECT id FROM auth.projects WHERE lower(slug::text) = lower($1)", [getEnv().CRV_HERRA_PROJECT_SLUG]);
  const project = projects[0]?.id;
  if (!project) throw new Error("No existe el proyecto de CRV.");

  for (const account of ACCOUNTS) {
    if (clean) {
      await pool.query("DELETE FROM auth.admins WHERE lower(username::text) = lower($1)", [account.username]);
      console.log(`eliminado ${account.username}`);
      continue;
    }
    await pool.query("DELETE FROM auth.admins WHERE lower(username::text) = lower($1)", [account.username]);
    await pool.query(
      `INSERT INTO auth.admins (username, password_hash, role, project_id, session_version)
       VALUES ($1, $2, $3, $4, 1)`,
      [account.username, hashAccessCode(account.password), account.role, project]);
    console.log(`${account.username} listo (rol ${account.role})`);
  }
  if (clean) {
    // Después de borrar las cuentas: las personas quedan sin usuario y se retiran.
    const { rowCount } = await pool.query(
      `DELETE FROM auth.people p
        WHERE p.first_name = 'Persona' AND p.last_name IN ('C5', 'B7')
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.person_id = p.id)`,
    );
    console.log(`personas de prueba huérfanas eliminadas: ${rowCount ?? 0}`);
  }
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exitCode = 1;
});
