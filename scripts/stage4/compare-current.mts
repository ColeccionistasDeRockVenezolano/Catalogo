/** Compara, para las consultas servibles de live-dev.json, el plan frente al buscador actual (solo lee). */
import { readFileSync, writeFileSync } from "node:fs";
import { getPool } from "../../src/db/client.js";
import { globalSearch } from "../../src/api/repositories/search.js";
const [inp, out] = process.argv.slice(2);
const rows = (JSON.parse(readFileSync(inp!, "utf8")) as { rows: { text: string; servable: boolean; interpretation?: { require: string[] }; totals?: { artist: number; album: number } }[] }).rows.filter(r => r.servable && r.totals);
const res: unknown[] = [];
for (const r of rows) {
  const cur = await globalSearch(r.text, 20, ["artist", "album"], () => {}, 0);
  const c = cur.totals.artist + cur.totals.album, p = r.totals!.artist + r.totals!.album;
  res.push({ text: r.text, require: r.interpretation?.require, plan: p, current: c, verdict: p === 0 && c === 0 ? "ambos_vacios" : c === 0 ? "plan_rescata" : p === 0 ? "plan_pierde" : "ambos_con_resultados" });
}
const tally: Record<string, number> = {};
for (const r of res as { verdict: string }[]) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(JSON.stringify(tally));
writeFileSync(out!, JSON.stringify(res, null, 1));
await getPool().end();
