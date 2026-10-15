// Corrección puntual: dos bandas creadas en la fase B quedaron con términos de temas sin glosario
// («Invocations», «Wickedness»). Se añaden al glosario y se corrigen sus temas en un run del operador.
// Uso: ./scripts/with-node22.sh npx tsx scripts/corregir-temas-2026-10-15.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const GLOS = "reports/themes-es-2026-10-15/glosario-en-es.json";
const CAMBIOS = [
  { id: 6974, name: "Nigrium Mortualia", antes: "Satanismo, Blasfemia, Invocations", despues: "Satanismo, Blasfemia, Invocaciones" },
  { id: 6976, name: "Beheaded", antes: "Mal, Wickedness, Sufrimiento", despues: "Mal, Malicia, Sufrimiento" },
];

async function main(): Promise<void> {
  const glos = JSON.parse(readFileSync(GLOS, "utf8")) as Record<string, string>;
  glos["Invocations"] = "Invocaciones";
  glos["Wickedness"] = "Malicia";
  writeFileSync(GLOS, JSON.stringify(Object.fromEntries(Object.entries(glos).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n");

  if (!CONFIRM) { console.log("vista previa:", JSON.stringify(CAMBIOS, null, 1)); console.log("repite con --confirm"); await closeDb(); return; }
  const { runId } = await withOperatorRun({
    name: "hermes:temas-letras-es-correccion",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Corrección de dos temas de bandas creadas en la fase B que quedaron con términos sin glosario (Invocations, Wickedness).",
  }, async (context) => {
    for (const c of CAMBIOS) await updateEntity(context, "artist", c.id, { themes: c.despues });
    return { n: CAMBIOS.length };
  });
  console.log(`run ${runId}: ${CAMBIOS.length} fichas corregidas`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
