/** Desarrollo: muestra los fragmentos del segmentador para consultas de un conjunto ya gastado. */
import { readFileSync } from "node:fs";
import { loadQueryLexicon } from "../../../src/search/query-interpretation/lexicon.js";
import { segmentQuery } from "../../../src/search/query-interpretation/segmenter.js";
import { loadCatalogSnapshot } from "../../../src/search/query-interpretation/catalog.js";
const lexicon = loadQueryLexicon();
const catalog = loadCatalogSnapshot(`${process.env["HOME"]}/.cache/crv-stage3/catalog-names-2026-10-25.json`);
const [file, ...ids] = process.argv.slice(2);
const texts = file!.endsWith(".json") ? (JSON.parse(readFileSync(file!, "utf8")) as { cases: { id: string; text: string }[] }).cases.filter(c => !ids.length || ids.includes(c.id)) : [{ id: "-", text: file! }];
for (const c of texts) {
  const seg = segmentQuery(c.text, lexicon, catalog);
  console.log(c.id, "|", c.text, seg.listenerStates ? `ctx=${seg.listenerStates}` : "");
  for (const s of seg.spans) console.log("   ", s.kind, s.mode, s.cue ?? "", JSON.stringify(s.text), s.candidates.slice(0, 4).join(","));
}
