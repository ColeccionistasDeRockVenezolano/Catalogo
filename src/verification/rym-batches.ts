import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { withOperatorRun, type OperatorContext } from "../merge/operator.js";

/** Resume from the live catalog, not a cursor that can skip uncommitted work.
 * Each bounded transaction leaves its report immediately after committing. */
export async function applyRymBatches<T>(input: {
  directory: string; phase: string; items: T[]; batchSize?: number;
  apply: (context: OperatorContext, item: T) => Promise<boolean>;
}): Promise<{ runs: number[]; changed: number; unchanged: number }> {
  const batchSize = input.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new Error("Lote RYM fuera de 1–200 filas");
  mkdirSync(input.directory, { recursive: true });
  const aggregate = { runs: [] as number[], changed: 0, unchanged: 0 };
  for (let offset = 0; offset < input.items.length; offset += batchSize) {
    const items = input.items.slice(offset, offset + batchSize);
    const hash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
    const result = await withOperatorRun({
      name: `catalogo:rym-${input.phase}`, operator: "Codex (encargo de Brian: puntos 1–5)",
      note: `Aprovechamiento RYM: ${input.phase}, lote ${offset + 1}–${offset + items.length}; identidad y capturas acreditadas, sin sobrescribir decisiones existentes.`,
      params: { phase: input.phase, offset, size: items.length, planHash: hash },
    }, async context => {
      await context.client.query("SET LOCAL lock_timeout='5s'");
      await context.client.query("SET LOCAL statement_timeout='30s'");
      let changed = 0;
      for (const item of items) if (await input.apply(context, item)) changed++;
      return { changed, unchanged: items.length - changed };
    });
    aggregate.runs.push(result.runId);
    aggregate.changed += result.result.changed;
    aggregate.unchanged += result.result.unchanged;
    writeFileSync(path.join(input.directory, `${input.phase}-run${result.runId}.json`), JSON.stringify({ runId: result.runId, ...result.result, planHash: hash, items }, null, 2) + "\n");
  }
  return aggregate;
}
