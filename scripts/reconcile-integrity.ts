import "dotenv/config";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { reconcileIntegrity } from "../src/doctor/reconcile.js";

try {
  const confirm = process.argv.includes("--confirm");
  const result = await withOperatorRun({ name: "maintenance:integrity-reconciliation", operator: "crv-maintenance",
    note: "Reconciliar integridad conservando originales y declarando procedencia histórica irrecuperable" },
  reconcileIntegrity, { rollbackOnly: !confirm });
  process.stdout.write(`${JSON.stringify({ applied: confirm, ...result }, null, 2)}\n`);
} finally { await closeDb(); }
