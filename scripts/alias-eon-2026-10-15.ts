// Alias que faltaba: EON (#6979) no tenía registrado su nombre anterior «Arioth»
// (la captura de MA lo dice: years_active «? (as Arioth )»). Se añade como former_name.
// El resto de las 13 fichas ya tenían sus alias de nombres antiguos/nuevos.
// Uso: ./scripts/with-node22.sh npx tsx scripts/alias-eon-2026-10-15.ts [--confirm]
import { writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { createAlias } from "../src/api/repositories/aliases.js";
import { withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");

async function main(): Promise<void> {
  if (!CONFIRM) { console.log("vista previa: alias «Arioth» [former_name] → EON (#6979); repite con --confirm"); await closeDb(); return; }
  const { runId, result } = await withOperatorRun({
    name: "hermes:alias-eon",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Alias del nombre anterior de EON («Arioth», captura de Metal Archives: years_active «? (as Arioth )»).",
  }, async (context) => {
    const alias = await createAlias(context, "artist", 6979, { alias: "Arioth", aliasType: "former_name", isPrimary: false });
    return { alias };
  });
  writeFileSync("reports/myspace-2026-10-15/alias-eon-aplicado.json", JSON.stringify({ run: runId, ...result }, null, 1));
  console.log(`run ${runId}: alias #${result.alias.id} «${result.alias.alias}» [${result.alias.aliasType}] → EON`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
