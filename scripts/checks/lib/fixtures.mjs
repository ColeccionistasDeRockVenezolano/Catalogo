// CRV · ciclo de vida de las cuentas de rol de staging.
//
// Los guiones de navegador usan `fase1-admin`, `fase1-community` y
// `fase1-curator`. Antes se suponía que alguien las había creado y nadie las
// retiraba: las sesiones y las cuentas quedaban en staging y rompían la foto del
// cierre (61/27/5, 3 admins, 5 usuarios, 8 personas, 0 sesiones de prueba).
//
// `preparar()` las crea (idempotente) al empezar y `limpiar()` las borra con sus
// sesiones al terminar, incluso si el guion falló antes. El script de fixtures
// comprueba por su cuenta que la base es de staging antes de escribir.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function ejecutar(argumentos) {
  return execFileSync(
    path.join(RAIZ, "scripts/with-node22.sh"),
    [path.join(RAIZ, "node_modules/.bin/tsx"), "scripts/fase1-fixtures.ts", ...argumentos],
    {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CRV_ENV_FILE: process.env.CRV_ENV_FILE ?? path.join(os.homedir(), "apps/crv-staging/staging.env"),
      },
    },
  ).trim();
}

/** Crea (o recrea) las cuentas de rol con contraseñas conocidas. */
export function prepararFixtures() {
  return ejecutar([]);
}

/** Borra las cuentas de rol, sus sesiones y las personas huérfanas de prueba. */
export function limpiarFixtures() {
  const salida = ejecutar(["--clean"]);
  // Las sesiones guardadas por los guiones apuntan a cuentas que acaban de
  // desaparecer: si se reutilizaran, /auth/me podría confirmar una sesión vieja
  // y la página siguiente quedaría sin acceso. Se tiran con las cuentas.
  const sesiones = path.join(os.homedir(), "crv-staging/sesiones");
  try {
    for (const archivo of readdirSync(sesiones)) {
      if (archivo.includes("fase1-")) rmSync(path.join(sesiones, archivo), { force: true });
    }
  } catch {
    // Sin carpeta de sesiones no hay nada que limpiar.
  }
  return salida;
}
