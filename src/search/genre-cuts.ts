import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Preserve the exact authored inputs and derived map before later cuts replace
 * their working copies. A version cannot silently acquire different contents. */
export async function preserveGenreCut(root: string, version: string, inputs: {
  book: string; manifest: string; map: string;
}) {
  const match = /^crv-genre-knowledge-(\d+\.\d+\.\d+)$/u.exec(version);
  if (!match) throw new Error("Versión de corte de géneros no válida");
  const relative = `reports/unified-search-stage2/cuts/${match[1]}`;
  const directory = path.join(root, relative);
  const files = [
    { file: "genre-descriptions.json", text: inputs.book },
    { file: "genre-source-captures.json", text: inputs.manifest },
    { file: "genre-map.json", text: inputs.map },
  ];
  const metadata = {
    version: "crv-genre-cut-v1", bookVersion: version, restoredFromVerifiedHashes: false,
    inputs: files.map(f => ({ file: f.file, sha256: createHash("sha256").update(f.text).digest("hex") })),
  };
  const complete = [...files, { file: "inputs.json", text: `${JSON.stringify(metadata, null, 2)}\n` }];
  await mkdir(directory, { recursive: true });
  // Check the whole existing cut before adding any missing files.
  for (const f of complete) {
    try {
      if (await readFile(path.join(directory, f.file), "utf8") !== f.text)
        throw new Error(`El corte ${version} ya existe con otros datos; incrementar versión`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const f of complete) {
    try { await writeFile(path.join(directory, f.file), f.text, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(path.join(directory, f.file), "utf8") !== f.text)
        throw new Error(`El corte ${version} cambió durante la escritura`, { cause: error });
    }
  }
  return { directory: relative, inputs: metadata.inputs };
}
