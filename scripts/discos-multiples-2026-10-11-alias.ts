// CRV · Discos múltiples: alias principal de las fichas renombradas (2026-10-11).
//
// El run 18980 renombró fichas («Live in Paris - Lado A» → «Live in Paris») y
// dejó el título viejo como alias, pero el alias principal (⭐) seguía siendo
// el viejo. En el catálogo el principal es el título (13.194 fichas); aquí
// pasa al título actual en cada ficha que ese run renombró.
//
//   ./scripts/with-node22.sh npx tsx scripts/discos-multiples-2026-10-11-alias.ts [--confirm]
import { closeDb } from "../src/db/client.js";
import { promotePrimaryAlias } from "../src/api/repositories/aliases.js";
import { withOperatorRun } from "../src/merge/operator.js";

const MERGE_RUN = 18980;
const confirm = process.argv.includes("--confirm");
const NOTE = `Discos múltiples 2026-10-11: el alias principal de la ficha renombrada pasa a su título actual (run ${MERGE_RUN})`;

let fixed = 0;
const { runId } = await withOperatorRun({ name: "curation:album-discs-alias", operator: "claude-code", note: NOTE, params: { mergeRun: MERGE_RUN } }, async (context) => {
  const albums = (await context.client.query<{ id: string; title: string }>(`
    SELECT a.id::text, a.title FROM public.albums a
     WHERE a.id IN (SELECT (row_pk->>'id')::bigint FROM ingest.change_journal
                     WHERE run_id=$1 AND table_name='public.albums' AND op='U' AND new_data ? 'title')
       AND NOT EXISTS (SELECT 1 FROM ingest.album_aliases x WHERE x.album_id=a.id AND x.is_primary AND x.alias=a.title)
     ORDER BY a.id`, [MERGE_RUN])).rows;
  for (const album of albums) {
    await promotePrimaryAlias(context, "album", Number(album.id), album.title, "alternate_title");
    fixed += 1;
  }
}, { rollbackOnly: !confirm });

console.log(`${confirm ? `run ${runId}` : `ensayo (run ${runId} revertido)`}: ${fixed} fichas con el título como alias principal`);
await closeDb();
