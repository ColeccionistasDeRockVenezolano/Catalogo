// CRV · Muestreo de auditoría de descartes automáticos (etapa 6).
//
// Revisa 1 de cada 20 descartes automáticos, empezando por el primero para que
// una muestra pequeña nunca quede vacía. Solo lee: la decisión y su nota están
// en `curation_distinct_pairs`; el run permite abrir el lote completo.
//
// Uso: tsx scripts/audit-duplicates.ts [--limit=20]
import { closeDb, getPool } from "../src/db/client.js";

const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length))) : 20;

const { rows } = await getPool().query<{
  id: string; kind: string; a_id: string; b_id: string; decided_by: string;
  note: string | null; run_id: string | null; created_at: string; rn: string;
}>(`
  SELECT id::text, kind, a_id::text, b_id::text, decided_by, note, run_id::text, created_at::text, rn::text
    FROM (
      SELECT *, row_number() OVER (ORDER BY created_at) AS rn
        FROM ingest.curation_distinct_pairs
       WHERE decided_by = 'crv-curaduria-auto'
    ) ordered
   WHERE (rn - 1) % 20 = 0
   ORDER BY rn
   LIMIT $1`, [limit]);

const total = Number((await getPool().query<{ n: string }>(
  "SELECT count(*)::text AS n FROM ingest.curation_distinct_pairs WHERE decided_by='crv-curaduria-auto'")).rows[0]!.n);

console.log(JSON.stringify({
  totalAutoDiscards: total,
  sampleRule: "1 de cada 20, empezando por el primero",
  sampleSize: rows.length,
  sample: rows.map((row) => ({
    pair: `${row.a_id}/${row.b_id}`, kind: row.kind, note: row.note,
    runId: row.run_id, createdAt: row.created_at,
  })),
}, null, 2));
await closeDb();
