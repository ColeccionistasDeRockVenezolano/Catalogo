import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "../config/project-root.js";
const execFileAsync = promisify(execFile);
/** Original en SSD, publicación verificada al almacén y retirada del staging. */
export async function publishCuratedImage(bytes: Buffer, filename: string): Promise<string> {
  const cwd = projectRoot(import.meta.url);
  await execFileAsync("python3", ["scripts/shared-storage.py", "status"], { cwd });
  const campaign = `curated-image-${randomUUID()}`;
  const { stdout } = await execFileAsync("python3", ["scripts/staging.py", "new", "web/public/media", campaign], { cwd });
  const directory = stdout.trim().split("\n")[0]!;
  await writeFile(path.join(directory, filename), bytes, { flag: "wx", mode: 0o644 });
  // Ante un fallo se conserva la etapa para recuperar los bytes originales.
  await execFileAsync("python3", ["scripts/staging.py", "publish", "web/public/media", campaign, "--hash"], { cwd });
  return `/crv/media/${campaign}/${filename}`;
}
