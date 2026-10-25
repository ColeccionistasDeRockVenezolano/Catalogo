// CRV · Decisiones de Brian sobre el cotejo de fuentes oficiales (2026-10-13).
//
//   - Zapato 3: Javier Avellaneda primero dejó la banda, se hizo policía y después se suicidó
//     (la biografía decía que cantó «hasta su suicidio en 1988»). Su ficha queda como fallecido.
//   - Simón Díaz: nació en Barbacoas, estado Aragua, como dice simondiaz.com (no Guárico).
//   - Zeta Once (1130) → Zeta (459): renombre = alias; las biografías se unen para reescribir.
// Sin --confirm la transacción se revierte.
// Uso: tsx scripts/fuentes-oficiales/decisiones-brian.mts [--confirm]
import { closeDb } from "../../src/db/client.js";
import { mergeEntities, previewEntityMerge } from "../../src/merge/entity-merge.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const ZAPATO3 = 266, SIMON = 4285, JAVIER = 3361, ZETA = 459, ZETA_ONCE = 1130;
const fixes = [
  { id: ZAPATO3, from: "Javier Avellaneda asumió el micrófono hasta su suicidio en 1988; entonces Carlos Segura",
    to: "Javier Avellaneda asumió el micrófono hasta que dejó la banda para hacerse policía (más tarde se quitó la vida); entonces Carlos Segura" },
  { id: SIMON, from: "Nacido en Barbacoas, estado Guárico,", to: "Nacido en Barbacoas, estado Aragua," },
];

async function main(): Promise<void> {
  const { runId, result } = await withOperatorRun({
    name: "fuentes-oficiales:decisiones-brian",
    operator: "claude-code (delegado por Brian)",
    note: "Decisiones de Brian (2026-10-13) sobre el cotejo de fuentes oficiales: Javier Avellaneda dejó Zapato 3, se hizo policía y luego se suicidó; Simón Díaz nació en Barbacoas, Aragua (sitio oficial); Zeta Once es el nombre anterior de Zeta.",
    params: { fixes: fixes.map((fix) => fix.id), merge: { keep: ZETA, drop: ZETA_ONCE } },
  }, async (context) => {
    for (const fix of fixes) {
      const { rows } = await context.client.query<{ biography: string }>("SELECT biography FROM public.artists WHERE id=$1 FOR UPDATE", [fix.id]);
      const biography = rows[0]?.biography ?? "";
      if (!biography.includes(fix.from)) throw new Error(`la biografía de ${fix.id} ya no contiene «${fix.from}»`);
      await updateEntity(context, "artist", fix.id, { biography: biography.replace(fix.from, fix.to) });
    }
    await updateEntity(context, "person", JAVIER, { is_deceased: true, death_cause: "Suicide" });
    const preview = await previewEntityMerge(context.client, "artist", ZETA, ZETA_ONCE, { lock: true });
    const merge = await mergeEntities(context, { kind: "artist", keepId: ZETA, dropId: ZETA_ONCE, previewHash: preview.previewHash, keepDropNameAsAlias: true });
    return { conflicts: preview.fieldConflicts, merge };
  }, { rollbackOnly: !CONFIRM });
  console.log(JSON.stringify({ confirm: CONFIRM, run: CONFIRM ? runId : null, ...result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
