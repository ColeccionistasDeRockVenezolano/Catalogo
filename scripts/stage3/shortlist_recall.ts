/** Etapa 3 · recall de la lista corta de géneros por descripción (desarrollo). Uso: tsx shortlist_recall.ts <dataset.json>... */
import { readFileSync } from "node:fs";
import { loadQueryLexicon } from "../../src/search/query-interpretation/lexicon.js";
import { genreShortlist } from "../../src/search/query-interpretation/questions.js";

const lexicon = loadQueryLexicon();
for (const file of process.argv.slice(2)) {
  const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: { id: string; text: string; gold: { alts?: string[] } }[] }).cases
    .filter(c => (c.gold.alts ?? []).some(a => a.startsWith("genre:")));
  let at3 = 0, at10 = 0;
  for (const c of cases) {
    const list = genreShortlist(c.text, lexicon);
    const gold = new Set(c.gold.alts);
    if (list.slice(0, 3).some(x => gold.has(x))) at3++;
    if (list.some(x => gold.has(x))) at10++;
    if (process.env["VERBOSE"]) console.log(c.id, c.text, "|", list.slice(0, 5).join(","), "| oro", [...gold].join(","));
  }
  console.log(file.split("/").at(-1), { n: cases.length, at3: at3 / cases.length, at10: at10 / cases.length });
}
