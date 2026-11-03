// Oculta los enlaces que la auditoría 2026-11-01 da por ajenos o muertos: verified=false,
// el motivo en notes y source='crv-operador' (los escritores de enlaces, como
// ops/spotify-diario/enlaces-lote.ts, no reactivan esa fuente). No borra nada.
// UN run; sin --confirm se deshace al terminar.
//
//   ./scripts/with-node22.sh npx tsx scripts/auditar-enlaces/aplicar.ts <decisiones.jsonl> [--confirm]
//
// Cada línea: {"k":"stream"|"social","id":123,"motivo":"…"}
import { readFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const file = process.argv[2];
if (!file) throw new Error("falta el archivo de decisiones");
const CONFIRM = process.argv.includes("--confirm");
const decisions = readFileSync(file, "utf8").split("\n").filter(Boolean)
  .map((line) => JSON.parse(line) as { k: "stream" | "social"; id: number; motivo: string });

const TABLE = { stream: "public.streaming_links", social: "public.social_links" } as const;

try {
  const { runId, result } = await withOperatorRun({
    name: "auditoria-enlaces-2026-11-01", operator: "claude-code (pedido de Brian)",
    note: "Enlaces de homónimos, cuentas genéricas y páginas inexistentes: ocultos, no borrados.",
    params: { file, decisions: decisions.length },
  }, async (context) => {
    const changed = { stream: 0, social: 0, alreadyHidden: 0, editorialBlocked: [] as string[] };
    for (const d of decisions) {
      // El guardián editorial (PCE01) manda: esa fila se deja como está y se informa.
      await context.client.query("SAVEPOINT fila");
      let rowCount: number | null;
      try {
        ({ rowCount } = await context.client.query(
        `UPDATE ${TABLE[d.k]}
            SET verified=false, source='crv-operador',
                notes=concat_ws(' · ', NULLIF(notes,''), $2::text, 'fuente anterior: ' || source)
          WHERE id=$1 AND verified`,
        [d.id, `auditoría 2026-11-01: ${d.motivo}`]));
        await context.client.query("RELEASE SAVEPOINT fila");
      } catch (error) {
        if ((error as { code?: string }).code !== "PCE01") throw error;
        await context.client.query("ROLLBACK TO SAVEPOINT fila");
        changed.editorialBlocked.push(`${d.k}:${d.id}`);
        continue;
      }
      if (rowCount) changed[d.k] += 1; else changed.alreadyHidden += 1;
    }
    return changed;
  }, { rollbackOnly: !CONFIRM });
  process.stdout.write(`${JSON.stringify({ runId, confirm: CONFIRM, total: decisions.length, ...result })}\n`);
} finally {
  await closeDb();
}
