// CRV · Biografías revisadas a mano tras la unión automática (Brian, 2026-10-13).
//
// La unión con DeepSeek (run 19481) dejó Zapato 3 con la cronología revuelta y párrafos repetidos, y Zeta con
// la formación de Zeta Once como actual y «Caracas, en Anzoátegui»; C4 Trío falló (perdía 2020). Claude las
// redactó desde las mismas fuentes (reports/fuentes-oficiales-2026-10-13/biografias-revisadas/*.txt) sin perder
// años ni datos. Solo escribe si la biografía sigue siendo la que se revisó (md5); C4 Trío cierra su
// entrada de la cola (text_rewrites 846). Sin --confirm la transacción se revierte.
// Uso: tsx scripts/fuentes-oficiales/biografias-revisadas.mts [--confirm]
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { closeDb } from "../../src/db/client.js";
import { updateEntity, withOperatorRun } from "../../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const DIR = "reports/fuentes-oficiales-2026-10-13/biografias-revisadas";
const REVIEWED: Record<number, string> = { 53: "895079cd48db040ec9e854ca1e896fdc", 266: "3ca51dab51f72548cc077479e7b2cc1e", 459: "75818c5a8df7ed884f893d05e11a47e8" };
const C4_REWRITE = 846;
const years = (text: string) => new Set(text.match(/\b(?:19|20)\d\d\b/gu) ?? []);

async function main(): Promise<void> {
  const { runId, result } = await withOperatorRun({
    name: "fuentes-oficiales:biografias-revisadas",
    operator: "claude-code (delegado por Brian)",
    note: "Biografías de Zapato 3, Zeta y C4 Trío redactadas por Claude desde la vigente y el sitio oficial: orden cronológico, sin repeticiones y sin perder años (campaña de fuentes oficiales 2026-10-13, visto bueno de Brian).",
    params: { artists: Object.keys(REVIEWED).map(Number) },
  }, async (context) => {
    const done: Array<{ id: number; from: number; to: number }> = [];
    for (const [key, md5] of Object.entries(REVIEWED)) {
      const id = Number(key);
      const { rows } = await context.client.query<{ biography: string }>("SELECT biography FROM public.artists WHERE id=$1 FOR UPDATE", [id]);
      const current = rows[0]?.biography ?? "";
      if (createHash("md5").update(current).digest("hex") !== md5) throw new Error(`la biografía de ${id} cambió desde la revisión; no se toca`);
      const text = readFileSync(`${DIR}/${id}.txt`, "utf8").trim();
      const lost = [...years(current)].filter((year) => !years(text).has(year));
      if (lost.length) throw new Error(`la biografía revisada de ${id} pierde años: ${lost.join(", ")}`);
      await updateEntity(context, "artist", id, { biography: text });
      done.push({ id, from: current.length, to: text.length });
    }
    await context.client.query("UPDATE ingest.text_rewrites SET status='done', resolved_run_id=$2, resolved_at=now() WHERE id=$1 AND status='pending'", [C4_REWRITE, context.runId]);
    return done;
  }, { rollbackOnly: !CONFIRM });
  console.log(JSON.stringify({ confirm: CONFIRM, run: CONFIRM ? runId : null, biografias: result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
