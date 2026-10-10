// CRV · Careos «Produciones León» (Sincopa, Venezuela Suite) que quedaron
// abiertos porque su candidato 1824 se fusionó en 1789 en el run 13285
// (Fichas repetidas). Se resuelven contra 1789 y los 9 discos toman el sello.
//   ./scripts/with-node22.sh npx tsx scripts/fix-produciones-leon-2026-10-04.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { mergeClaim } from "../src/merge/engine.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { loadClaimForApproval } from "../src/review/approval.js";

const TARGET = 1789;
const ALBUMS = [15296, 15298, 15299, 15300, 15301, 15302, 15303, 15304, 15346];
const NOTE = "Careos «Produciones León» resueltos contra la ficha final 1789 tras la fusión del run 13285 (Brian, 2026-10-04)";
const confirm = process.argv.includes("--confirm");
const { rows } = await getPool().query<{ id: string; claim: string }>(
  "SELECT id::text, claim_a_id::text claim FROM ingest.review_queue WHERE id BETWEEN 1495380 AND 1495397 AND status IN ('open','in_progress')");
const claims = await Promise.all(rows.map(async (r) => ({ review: Number(r.id), claim: Number(r.claim), loaded: await loadClaimForApproval(Number(r.claim)) })));
try {
  const { runId, result } = await withOperatorRun({ name: "fix-produciones-leon-2026-10-04", operator: "brian", note: NOTE, params: { TARGET, ALBUMS } }, async (context) => {
    const out: string[] = [];
    for (const item of claims) {
      if (!item.loaded) throw new Error(`claim ${item.claim} no cargado`);
      const outcome = await mergeClaim({ ...item.loaded, createdBy: "human", runId: context.runId }, { id: item.claim, inserted: false }, {
        client: context.client, humanResolution: { verdict: "same", targetId: TARGET, decidedBy: "brian" },
      });
      await context.client.query(`UPDATE ingest.review_queue SET status='approved', resolved_by='human', resolved_at=now(), updated_at=now(), resolution_note=$2
        WHERE id=$1 AND status IN ('open','in_progress')`, [item.review, `[run ${context.runId}] ${NOTE}`]);
      out.push(`${item.review}: ${outcome.action}`);
    }
    for (const album of ALBUMS) {
      const current = await context.client.query<{ label_id: string | null }>("SELECT label_id::text FROM public.albums WHERE id=$1", [album]);
      if (current.rows[0]?.label_id === null) { await updateEntity(context, "album", album, { label_id: TARGET }); out.push(`disco ${album}: sello ${TARGET}`); }
    }
    out.push(`nombre de ${TARGET}: ${(await context.client.query("SELECT name FROM public.organizations WHERE id=$1", [TARGET])).rows[0]?.name}`);
    out.push(`alias: ${(await context.client.query("SELECT string_agg(alias, ', ') a FROM ingest.organization_aliases WHERE organization_id=$1", [TARGET])).rows[0]?.a}`);
    if (!confirm) throw Object.assign(new Error("dry-run"), { out });
    return out;
  });
  console.log(`run ${runId}\n${result.join("\n")}`);
} catch (error) {
  const out = (error as { out?: string[] }).out;
  if (!out) throw error;
  console.log(`ensayo (deshecho)\n${out.join("\n")}`);
} finally {
  await closeDb();
}
