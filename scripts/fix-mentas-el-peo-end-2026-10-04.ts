// Los Mentas «Hasta Que Los Bares Nos Separen» (595): Sincopa titula la pista 10
// «El Peo (End)» y el core la tiene como «Outro», justo después de «El Peo». El
// run 12014 la creó aparte al final (158830); se fusiona en la 5425 y el título
// de Sincopa queda como alias (Brian, 2026-10-04: «comprobar antes de decidir»).
//
//   tsx scripts/fix-mentas-el-peo-end-2026-10-04.ts [--confirm]
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { mergeInto } from "../src/review/duplicates.js";

const KEEP = 5425;
const DROP = 158830;

if (process.argv.includes("--confirm")) {
  const note = "«El Peo (End)» de Sincopa es el «Outro» (pista 10) de Los Mentas 595; se fusiona la pista creada en el run 12014";
  const result = await withOperatorRun({ name: "fix-mentas-el-peo-end-2026-10-04", operator: "brian", note, params: { KEEP, DROP } }, async (context) => {
    await mergeInto(context.client, "track", KEEP, DROP, note, context.runId, { alias: true });
    // La pista vuelve al número que da Sincopa: el número 10 deja de estar descartado.
    const claims = await context.client.query(
      `UPDATE ingest.claims SET status = 'accepted' WHERE track_id = $1 AND field = 'track_number' AND status = 'superseded' AND normalized_value = '10'`, [KEEP]);
    return { merged: true, claimsRestored: claims.rowCount };
  });
  console.log(JSON.stringify(result));
} else {
  console.log(`ensayo: fusionaría la pista ${DROP} en la ${KEEP}; usa --confirm`);
}
await closeDb();
