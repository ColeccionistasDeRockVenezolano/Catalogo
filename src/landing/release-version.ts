import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

let version: string | undefined;

/** Cada release corre en su árbol inmutable; nunca depende del reloj del cliente. */
export function landingTemplateVersion(): string {
  if (version) return version;
  const hash = createHash("sha256");
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:ts|js|ejs|css|json)$/u.test(entry.name) && !entry.name.includes(".test.")) {
        hash.update(entry.name).update("\0").update(readFileSync(file)).update("\0");
      }
    }
  }
  visit(path.join(process.cwd(), "src/landing"));
  hash.update(readFileSync(path.join(process.cwd(), "src/shared/radio/credits.ts")));
  version = hash.digest("hex").slice(0, 20);
  return version;
}
