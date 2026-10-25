// CRV · Repara la marca de fundador de Daniel Hernández Saud (Dani Debuto) en Zeta.
//
// La fusión del run 20054 unió sus dos membresías (6129 se queda, 12198 se va) y el detalle de la 12198
// (is_founder, con la cita de Live in Boston) chocó con el de la 6129 y se descartó. El fallo de mergeInto ya
// está corregido (absorbMembershipDetails); esto devuelve el dato desde el diario de cambios.
// Sin --confirm la transacción se revierte.
// Uso: tsx scripts/fuentes-oficiales/reparar-fundador-dani.mts [--confirm]
import { closeDb } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const KEEP_MEMBER = 6129, LOST_MEMBER = "12198", MERGE_RUN = 20054;

async function main(): Promise<void> {
  const { runId, result } = await withOperatorRun({
    name: "fuentes-oficiales:reparar-fundador-dani",
    operator: "claude-code (delegado por Brian)",
    note: "Devuelve la marca de fundador de Daniel Hernández Saud (Dani Debuto) en Zeta, perdida al unir sus membresías en el run 20054.",
    params: { member: KEEP_MEMBER, from: { run: MERGE_RUN, member: Number(LOST_MEMBER) } },
  }, async (context) => {
    const lost = (await context.client.query<{ old_data: { is_founder: boolean; founder_evidence: string; founder_source: string } }>(`
      SELECT old_data FROM ingest.change_journal
       WHERE run_id=$1 AND table_name='ingest.membership_details' AND op='D' AND old_data->>'artist_member_id'=$2`, [MERGE_RUN, LOST_MEMBER])).rows[0]?.old_data;
    if (!lost?.is_founder) throw new Error("no está en el diario el detalle perdido");
    const updated = await context.client.query(`
      UPDATE ingest.membership_details SET is_founder=true, founder_evidence=$2, founder_source=$3, run_id=$4, updated_at=now()
       WHERE artist_member_id=$1 AND is_founder IS NULL`, [KEEP_MEMBER, lost.founder_evidence, lost.founder_source, context.runId]);
    if (updated.rowCount !== 1) throw new Error(`se esperaba 1 fila en membership_details de ${KEEP_MEMBER}, hubo ${updated.rowCount}`);
    return { member: KEEP_MEMBER, founder: true, evidence: lost.founder_evidence };
  }, { rollbackOnly: !CONFIRM });
  console.log(JSON.stringify({ confirm: CONFIRM, run: CONFIRM ? runId : null, ...result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
