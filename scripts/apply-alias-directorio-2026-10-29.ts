// CRV · Alias de nombre para las fichas que el directorio rockhechovenezuela.com
// publica con otra grafía (2026-10-29).
//
// Entrada: <ALIAS_DIR>/aliases.json  { aliases: [{alias, artist_id, nota}] }
// Crea cada alias como `name_variant` del artista indicado, en UN run del
// operador (reversible con `runs undo`). Idempotente: salta los que ya existan.
//
// Uso: ALIAS_DIR=… ./scripts/with-node22.sh npx tsx scripts/apply-alias-directorio-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { createAlias } from "../src/api/repositories/aliases.js";

const DIR = process.env["ALIAS_DIR"] ?? "reports/artistas-2026-10-29";
const OUT = process.env["ALIAS_OUT"] ?? DIR;
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";

interface Entrada { alias: string; artist_id: number; nota?: string }

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const plan = JSON.parse(readFileSync(path.join(DIR, "aliases.json"), "utf8")) as { aliases: Entrada[] };
  console.log("alias en el plan:", plan.aliases.length);

  const res = await withOperatorRun({
    name: "catalogo:alias-directorio-rockhecho",
    operator: "Hermes (encargo de Brian)",
    note: "Alias de nombre para las fichas que rockhechovenezuela.com publica con otra grafía " +
      "(artículo invertido, «La Banda», «Grupo», erratas). Son la misma entidad: el sitio enlaza la " +
      "misma ficha y su discografía ya está en el artista del catálogo. No se crea ninguna ficha nueva.",
    params: { alias: plan.aliases.length, confirm: CONFIRM },
  }, async (ctx) => {
    const report = { creados: [] as unknown[], saltados: [] as unknown[], errores: [] as unknown[] };
    for (const item of plan.aliases) {
      try {
        const exists = await ctx.client.query(
          "SELECT 1 FROM ingest.artist_aliases WHERE artist_id=$1 AND lower(alias)=lower($2)",
          [item.artist_id, item.alias]);
        if (exists.rowCount) {
          report.saltados.push({ alias: item.alias, artist_id: item.artist_id, motivo: "ya existe" });
          continue;
        }
        const row = await createAlias(ctx, "artist", item.artist_id, {
          alias: item.alias, aliasType: "name_variant", isPrimary: false,
        });
        // nota propia del caso, además de la del run
        if (item.nota) {
          await ctx.client.query("UPDATE ingest.artist_aliases SET notes=$2 WHERE id=$1",
            [row.id, item.nota.slice(0, 1000)]);
        }
        report.creados.push({ id: row.id, alias: item.alias, artist_id: item.artist_id });
      } catch (error) {
        report.errores.push({ alias: item.alias, error: (error as Error).message.slice(0, 200) });
      }
    }
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ creados: report.creados.length, saltados: report.saltados.length,
        errores: report.errores.length })]);
    return report;
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { creados: unknown[]; saltados: unknown[]; errores: unknown[] };
  writeFileSync(path.join(OUT, `alias-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, ...r }, null, 2) + "\n");
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} creados=${r.creados.length} ` +
    `saltados=${r.saltados.length} errores=${r.errores.length}`);
  for (const e of r.errores.slice(0, 6)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
