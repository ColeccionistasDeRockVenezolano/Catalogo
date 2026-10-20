// CRV · Regenera la lista de sellos conocidos de Venciclopedia.
//
// La wiki usa la MISMA categoría (`Discos de X`) para artistas, sellos, años y
// géneros. El adapter necesita saber qué nombres son sellos para no inventar
// artistas llamados «Top Hits». La lista se deriva del campo `sello` de las
// fichas reales, no de una corazonada.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/venciclopedia-listas.mts [--write]
//
// Sin `--write` solo informa de lo que cambiaría.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { VenciclopediaAdapter } from "../src/adapters/venciclopedia.js";
import { VENCI_KNOWN_LABELS } from "../src/adapters/venciclopedia-labels.js";
import { projectRoot } from "../src/config/project-root.js";

const ROOT = projectRoot(import.meta.url);
const TARGET = path.join(ROOT, "src", "adapters", "venciclopedia-labels.ts");
const NOISE = new Set(["as", "ag", "yvkct", "balada", "salsa", "rock", "pop", "n/a", "ninguno", "varios"]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function collectLabels(): Promise<string[]> {
  const adapter = new VenciclopediaAdapter();
  const labels = new Set<string>();
  for await (const page of adapter.listPages("https://www.venciclopedia.org")) {
    const response = await fetch(page.url, { headers: { "user-agent": "CRV-research/1.0" } });
    if (!response.ok) continue;
    const body = await response.text();
    for (const record of adapter.extractSnapshot({ url: page.url, kind: "json", rawPageId: 0, body })) {
      const label = record.fields.find((field) => field.field === "label")?.value;
      if (typeof label === "string") {
        for (const piece of label.split(/[,;/]/)) {
          const value = piece.trim();
          if (value.length > 2 && !NOISE.has(value.toLowerCase())) labels.add(value);
        }
      }
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b, "es"));
}

function render(labels: string[]): string {
  const body = labels.map((label) => `  ${JSON.stringify(label)},`).join("\n");
  return `// CRV · Sellos conocidos de Venciclopedia, derivados de su propio corpus.
//
// La wiki etiqueta igual \`Discos de <artista>\`, \`Discos de <sello>\`,
// \`Discos de <año>\` y \`Discos de <género>\`. Sin esta lista, «Top Hits» o
// «El Palacio de la Música» se convertirían en artistas inventados.
// Generada del campo \`sello\` de las fichas de disco del volcado vigente más
// los sellos que solo aparecen como categoría. Se regenera con
// \`scripts/venciclopedia-listas.mts --write\` cuando el corpus crezca.

export const VENCI_KNOWN_LABELS: readonly string[] = [
${body}
];

/** Alias que la wiki usa con y sin tilde/artículo para el mismo sello. */
export const VENCI_LABEL_ALIASES: Readonly<Record<string, string>> = {
  "Palacio de la Música": "El Palacio de la Música",
  "Velvet de Venezuela": "Velvet",
  "Magic Record's": "Magic Records",
  "Sony International": "Sony Music",
  "Sony BMG": "Sony Music",
  "RCA Victor": "RCA",
};
`;
}

const current = new Set(VENCI_KNOWN_LABELS.map(fold));
const labels = await collectLabels();
const added = labels.filter((label) => !current.has(fold(label)));
const removed = VENCI_KNOWN_LABELS.filter((label) => !labels.some((item) => fold(item) === fold(label)));

console.log(`sellos en el corpus: ${labels.length} · en el archivo: ${VENCI_KNOWN_LABELS.length}`);
console.log(`nuevos (${added.length}): ${added.slice(0, 25).join(", ") || "—"}`);
console.log(`desaparecidos (${removed.length}): ${removed.slice(0, 25).join(", ") || "—"}`);

if (process.argv.includes("--write")) {
  await writeFile(TARGET, render(labels), "utf8");
  console.log(`escrito ${TARGET}`);
} else {
  console.log("sin --write no se toca el archivo");
}
