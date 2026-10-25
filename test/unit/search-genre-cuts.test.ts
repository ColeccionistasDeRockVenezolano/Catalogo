import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { preserveGenreCut } from "../../src/search/genre-cuts.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(path.join(os.tmpdir(), "crv-genre-cut-")); roots.push(value); return value; }
const input = { book: '{"definition":"first"}\n', manifest: '{"sources":[]}\n', map: '{"genres":[]}\n' };
it("conserva bytes y permite repetir el mismo corte sin duplicarlo", async () => {
  const directory = await root();
  const first = await preserveGenreCut(directory, "crv-genre-knowledge-0.7.0", input);
  expect(await preserveGenreCut(directory, "crv-genre-knowledge-0.7.0", input)).toEqual(first);
  expect(await readFile(path.join(directory, first.directory, "genre-descriptions.json"), "utf8")).toBe(input.book);
  expect(first.inputs).toHaveLength(3);
});
it("rechaza sobrescribir una versión y conserva la anterior al crear otra", async () => {
  const directory = await root();
  const first = await preserveGenreCut(directory, "crv-genre-knowledge-0.7.0", input);
  const changed = { ...input, book: '{"definition":"revised"}\n' };
  await expect(preserveGenreCut(directory, "crv-genre-knowledge-0.7.0", changed)).rejects.toThrow(/incrementar versión/u);
  expect(await readFile(path.join(directory, first.directory, "genre-descriptions.json"), "utf8")).toBe(input.book);
  const second = await preserveGenreCut(directory, "crv-genre-knowledge-0.8.0", changed);
  expect(second.directory).not.toBe(first.directory);
  expect(second.inputs[0]!.sha256).not.toBe(first.inputs[0]!.sha256);
});
it("no permite usar la versión como ruta fuera del archivo", async () => {
  await expect(preserveGenreCut(await root(), "../../outside", input)).rejects.toThrow(/Versión/u);
});
