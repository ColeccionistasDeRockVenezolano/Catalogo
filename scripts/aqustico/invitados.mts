// Plan Aqustico · E4 (H6) — invitados («featuring») que faltan en pistas de CRV.
//
// Lee el hueco H6 de reports/aqustico-2026-10/tabla-maestra.json. Solo se
// acredita cuando E0 encontró una segunda prueba de identidad:
//   * artista: el id de Aqustico del invitado es un artista PROBADO (disco en común);
//   * persona: única persona con ese nombre o alias que ya tiene proyecto con el
//     artista de la pista (miembro o crédito en sus discos).
// El resto queda en el reporte (sin ficha, o nombre sin segunda prueba): no se
// crean personas. Rol «Invitado» (tipo guest), por el operador del catálogo en
// UN run reversible (`crv runs undo <run>`). Sin --confirm se deshace al final.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/invitados.mts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { createRelation, withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/aqustico-2026-10";
interface Hueco { hueco: string; crvId: number; aqId: number; valor: string; evidencia: string; detalle?: string; target?: string | null }

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const huecos = (JSON.parse(readFileSync(`${DIR}/tabla-maestra.json`, "utf8")) as { huecos: Hueco[] }).huecos.filter((h) => h.hueco === "H6");
  const todo = huecos.filter((h) => h.target);
  const results: Array<{ trackId: number; target: string; name: string; created?: boolean; id?: number; error?: string }> = [];
  let runId = 0;
  try {
    const out = await withOperatorRun({
      name: "aqustico:invitados",
      operator: "auto:aqustico",
      note: "Plan Aqustico E4/H6: invitados («featuring») de api.aqustico.com en pistas cruzadas exactas, con segunda prueba de identidad.",
      params: { plan: "~/Desktop/PLAN_AQUSTICO_2026-10-12.md", confirm },
    }, async (context) => {
      for (const h of todo) {
        const target = h.target!;
        await context.client.query("SAVEPOINT inv");
        try {
          const endpoints = { trackId: h.crvId, ...(target.startsWith("a") ? { artistId: Number(target.slice(1)) } : { personId: Number(target.slice(1)) }) };
          const r = await createRelation(context, "track_credit", endpoints, {
            credit_role: "Invitado", credit_type: "guest", credited_name: h.valor,
            notes: `Invitado según Aqustico (${h.evidencia}); ${h.detalle ?? ""}`.slice(0, 400),
          });
          results.push({ trackId: h.crvId, target, name: h.valor, created: r.created, id: r.id });
          await context.client.query("RELEASE SAVEPOINT inv");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT inv");
          results.push({ trackId: h.crvId, target, name: h.valor, error: (error as Error).message.slice(0, 200) });
        }
      }
      return results.length;
    }, { rollbackOnly: !confirm });
    runId = out.runId;
  } finally {
    const report = { mode: confirm ? "confirm" : "dry-run", runId, candidatos: huecos.length, acreditables: todo.length,
      creados: results.filter((r) => r.created).length, yaEstaban: results.filter((r) => r.created === false).length,
      errores: results.filter((r) => r.error), results,
      enEspera: huecos.filter((h) => !h.target).map((h) => ({ trackId: h.crvId, nombre: h.valor, detalle: h.detalle })) };
    const file = `${DIR}/e4-invitados-${report.mode}-run${runId}.json`;
    writeFileSync(file, JSON.stringify(report, null, 1));
    console.log(`invitados (${report.mode}, run ${runId}): ${report.creados} creados · ${report.yaEstaban} ya estaban · ${report.errores.length} errores · ${report.enEspera.length} en espera → ${file}`);
    for (const e of report.errores.slice(0, 5)) console.log("  ", JSON.stringify(e));
    await closeDb();
  }
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
