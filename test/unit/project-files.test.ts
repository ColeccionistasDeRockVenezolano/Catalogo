import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveProjectFile } from "../../src/storage/project-files.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "crv-project-files-")); temporary.push(base);
  const root = path.join(base, "project"), shared = path.join(base, "shared");
  await mkdir(root); await mkdir(shared);
  return { root, shared };
}

it.each(["data/raw", "data/research", "reports", "web/public/media", "tmp-analysis"])("lee %s desde un directorio externo y conserva el límite físico", async directory => {
  const { root, shared } = await fixture(), local = path.join(root, directory), target = path.join(shared, directory);
  await mkdir(local, { recursive: true }); await writeFile(path.join(local, "proof.txt"), "evidence");
  await mkdir(path.dirname(target), { recursive: true }); await rename(local, target); await symlink(target, local, "dir");
  expect(await readFile(await resolveProjectFile(root, `${directory}/proof.txt`), "utf8")).toBe("evidence");
  if (directory.startsWith("data/"))
    expect(await resolveProjectFile(root, `${directory}/proof.txt`, { dataOnly: true })).toBe(path.join(target, "proof.txt"));
  else await expect(resolveProjectFile(root, `${directory}/proof.txt`, { dataOnly: true })).rejects.toThrow(/fuera/);
  await writeFile(path.join(shared, "outside.txt"), "outside");
  await symlink(path.join(shared, "outside.txt"), path.join(target, "escape.txt"));
  await expect(resolveProjectFile(root, `${directory}/escape.txt`)).rejects.toThrow(/fuera/);
});

it("mantiene el acceso local y rechaza travesías, rutas absolutas y enlaces no autorizados", async () => {
  const { root, shared } = await fixture();
  await mkdir(path.join(root, "docs")); await writeFile(path.join(root, "docs/proof.txt"), "local");
  expect(await readFile(await resolveProjectFile(root, "docs/proof.txt"), "utf8")).toBe("local");
  for (const relative of ["../shared/proof.txt", "/etc/hosts", "C:\\Windows\\win.ini", "data/../docs/proof.txt"])
    await expect(resolveProjectFile(root, relative)).rejects.toThrow(/fuera/);
  await writeFile(path.join(shared, "proof.txt"), "private");
  await symlink(path.join(shared, "proof.txt"), path.join(root, "alias.txt"));
  await expect(resolveProjectFile(root, "alias.txt")).rejects.toThrow(/fuera/);
  await mkdir(path.join(root, "data"));
  await symlink(path.join(root, "docs/proof.txt"), path.join(root, "data/alias.txt"));
  await expect(resolveProjectFile(root, "data/alias.txt", { dataOnly: true })).rejects.toThrow(/fuera/);
});
