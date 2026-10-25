import { realpath } from "node:fs/promises";
import path from "node:path";

// These directories may be relocated by the operator. A manifest cannot add
// another trusted root, and symlinks inside a root must remain within it.
const relocatedRoots = ["data/raw", "data/research", "reports", "web/public/media", "tmp-analysis"] as const;

export async function resolveProjectFile(root: string, relative: string, options: {
  dataOnly?: boolean;
  outsideMessage?: string;
} = {}): Promise<string> {
  const outside = () => new Error(options.outsideMessage ?? "Referencia fuera del proyecto");
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || relative.split(/[\\/]/u).includes("..")) throw outside();
  const normalized = path.normalize(relative);
  const logical = normalized.split(path.sep).join("/");
  if (options.dataOnly && !logical.startsWith("data/")) throw outside();
  const relocated = relocatedRoots.find(directory => logical.startsWith(`${directory}/`));
  const base = await realpath(path.join(root, relocated ?? (options.dataOnly ? "data" : ".")));
  const filename = await realpath(path.resolve(root, normalized));
  if (!filename.startsWith(`${base}${path.sep}`)) throw outside();
  return filename;
}
