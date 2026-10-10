import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Source and compiled entrypoints must resolve the same SQL and migrations. */
export function projectRoot(moduleUrl: string): string {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(path.join(directory, "crv_simple_v1.sql")) && existsSync(path.join(directory, "migrations"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("No se encuentra el catálogo y su directorio de migraciones");
    directory = parent;
  }
}
