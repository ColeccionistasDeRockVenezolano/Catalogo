import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { getEnv } from "../config/env.js";

/** Marcador pequeño en el SSD: comunica deploy, CLI y API sin reiniciar sesiones. */
export function catalogRevisionPath(): string { return resolve(getEnv().DATA_DIR, ".catalog-cache-revision"); }

export async function readCatalogRevision(): Promise<string> {
  try { return (await readFile(catalogRevisionPath(), "utf8")).trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "initial";
    throw error;
  }
}

export async function publishCatalogRevision(): Promise<string> {
  const path = catalogRevisionPath();
  const revision = randomUUID();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${revision}.tmp`;
  await writeFile(temporary, revision, { mode: 0o600 });
  await rename(temporary, path);
  return revision;
}
