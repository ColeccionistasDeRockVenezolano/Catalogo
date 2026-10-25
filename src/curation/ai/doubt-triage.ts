import { z } from "zod";
import type { DeepSeekGateway } from "../../ai/gateway.js";
import type { CatalogDraft } from "./types.js";

/**
 * Lots read different parts of the citations, so the same doubt arrives many times and some only
 * say that one lot did not see a fact another lot proposed. The model only classifies indices:
 * every doubt that stays keeps the wording of one of the lots, and an incomplete answer changes nothing.
 */
const INSTRUCTIONS = `Ordenas las dudas de un plan editorial del catálogo de rock venezolano. Recibes operations (lo que el plan propone) y doubts con índice. Devuelve SOLO índices, nunca texto nuevo.
groups: dudas que piden lo mismo sobre el mismo dato; keep es el índice con más detalle (valores, URL, ids) y same los demás. Una duda sin repetición es un grupo sin same.
drop: dudas que no hace falta revisar, con reason:
- absence_in_lot: solo dice que sus citas, su lote o su contexto no mencionan un dato, sin aportar un valor, una URL nueva ni una contradicción.
- resolved_by_operation: lo que pide ya lo hace una operación de operations (indica su key en operation).
- not_a_doubt: explica algo hecho o confirma lo existente sin pedir nada.
Conserva toda duda con un valor documentado, una discrepancia entre fuentes, una identidad por decidir o un dato que falta a una operación. Ante la duda, consérvala. Cada índice aparece exactamente una vez entre keep, same y drop.`;

const triageSchema = z.object({
  groups: z.array(z.object({ keep: z.number().int(), same: z.array(z.number().int()) })),
  drop: z.array(z.object({ index: z.number().int(), reason: z.enum(["absence_in_lot", "resolved_by_operation", "not_a_doubt"]), operation: z.string().max(80).optional() })),
});

export interface DoubtTriage { kept: number; merged: number; dropped: Record<string, number>; /** Doubts kept because the model did not classify them. */ fallback: number; usage: { calls: number; tokensIn: number; tokensOut: number } }
const CHUNK = 60;

export async function triageDoubts(gateway: DeepSeekGateway, draft: CatalogDraft): Promise<{ draft: CatalogDraft; triage: DoubtTriage }> {
  const triage: DoubtTriage = { kept: 0, merged: 0, dropped: {}, fallback: 0, usage: { calls: 0, tokensIn: 0, tokensOut: 0 } };
  const operations = draft.operations.map(op => ({ key: op.key, op: op.op, label: op.label }));
  const result: string[] = [];
  for (let start = 0; start < draft.unresolved.length; start += CHUNK) {
    const doubts = draft.unresolved.slice(start, start + CHUNK);
    if (doubts.length < 3) { result.push(...doubts); triage.kept += doubts.length; continue; }
    try {
      triage.usage.calls++;
      const answer = await gateway.propose({
        taskKind: "cheap_classification", schemaVersion: "curation-doubt-triage.v1", modelClass: "fast",
        responseSchema: triageSchema, instructions: INSTRUCTIONS,
        input: { operations, doubts: doubts.map((text, index) => ({ index, text: text.slice(0, 700) })) },
      });
      triage.usage.tokensIn += answer.tokensIn ?? 0; triage.usage.tokensOut += answer.tokensOut ?? 0;
      // An index the model left out, repeated or misplaced stays as a doubt: omission never deletes.
      const keys = new Set(operations.map(op => op.key)), placed = new Set<number>();
      const valid = (index: number) => Number.isInteger(index) && index >= 0 && index < doubts.length && !placed.has(index);
      const groups: Array<{ keep: number; same: number[] }> = [];
      for (const group of answer.proposal.groups) {
        if (!valid(group.keep)) continue;
        placed.add(group.keep);
        const same = group.same.filter(index => valid(index) && (placed.add(index), true));
        groups.push({ keep: group.keep, same });
      }
      for (const item of answer.proposal.drop) {
        if (!valid(item.index) || (item.reason === "resolved_by_operation" && !(item.operation && keys.has(item.operation)))) continue;
        placed.add(item.index); triage.dropped[item.reason] = (triage.dropped[item.reason] ?? 0) + 1;
      }
      for (let index = 0; index < doubts.length; index++) if (!placed.has(index)) { groups.push({ keep: index, same: [] }); triage.fallback++; }
      for (const group of groups.sort((a, b) => a.keep - b.keep)) {
        const same = group.same.length;
        result.push(same ? `${doubts[group.keep]} (+${same} ${same === 1 ? "lote coincide" : "lotes coinciden"})` : doubts[group.keep]!);
      }
      triage.kept += groups.length; triage.merged += groups.reduce((sum, group) => sum + group.same.length, 0);
    } catch {
      result.push(...doubts); triage.fallback += doubts.length;
    }
  }
  return { draft: { ...draft, unresolved: result }, triage };
}
