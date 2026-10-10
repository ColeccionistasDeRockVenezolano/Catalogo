import type { OperatorContext } from "../merge/operator.js";
import { ENTITY_SPECS } from "../merge/specs.js";
import { RELATION_SPECS } from "../merge/relations.js";
import { transferExternalIdentities } from "../genres/external-lifecycle.js";
import { resolveRedirect } from "../merge/redirects.js";

export async function reconcileIntegrity(context: OperatorContext): Promise<Record<string, number>> {
  const { client, runId } = context;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:integrity:reconcile'))");
  const counts = { snapshots: 0, auditLimitations: 0, runLimitations: 0, identityTransfers: 0, identityArchived: 0, journalInventories: 0 };
  const specs = [
    ...Object.values(ENTITY_SPECS).map((spec) => ({ kind: spec.kind, table: spec.table, column: spec.targetColumn })),
    ...Object.entries(RELATION_SPECS).map(([kind, spec]) => ({ kind, table: spec.table, column: spec.column })),
    { kind: "media_link", table: "media.media_links", column: "media_link_id" },
  ];
  for (const spec of specs) {
    // Current-state maintenance audit: no invented claims or original dates.
    const result = await client.query(`
      INSERT INTO ingest.merge_audit(run_id,entity_kind,${spec.column},field,new_value,reason,confidence,performed_by)
      SELECT $1,$2::ingest.claim_entity_kind,t.id,'maintenance_snapshot',to_jsonb(t),$3,'low','system'
        FROM ${spec.table} t WHERE NOT EXISTS (SELECT 1 FROM ingest.merge_audit a WHERE a.${spec.column}=t.id)`,
    [runId, spec.kind, "Instantánea de mantenimiento del estado actual; procedencia original no reconstruida"]);
    counts.snapshots += result.rowCount ?? 0;
  }
  for (const [classification, condition, limitation, countKey] of [
    ["audit_without_claim", "NOT EXISTS (SELECT 1 FROM ingest.merge_audit_claims c WHERE c.merge_audit_id=a.id)", "No se recuperó el claim original de esta auditoría. Se conserva su contenido; el estado actual no demuestra la fuente histórica.", "auditLimitations"],
    ["audit_without_run", "a.run_id IS NULL", "No se recuperó la ejecución original. El run de mantenimiento registra esta limitación y no sustituye la ejecución histórica.", "runLimitations"],
  ] as const) {
    const result = await client.query(`
      INSERT INTO ingest.integrity_reconciliations(run_id,classification,object_key,before_state,limitation)
      SELECT $1,$2,a.id::text,to_jsonb(a),$3 FROM ingest.merge_audit a WHERE ${condition}
      ON CONFLICT (classification,object_key) DO NOTHING`, [runId, classification, limitation]);
    counts[countKey] = result.rowCount ?? 0;
  }
  const invalid = await client.query<{ entity_kind: "artist" | "album"; entity_id: string }>(`
    SELECT DISTINCT entity_kind,entity_id::text FROM ingest.genre_external_identities i
     WHERE (entity_kind='artist' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id=i.entity_id))
        OR (entity_kind='album' AND NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id=i.entity_id))`);
  for (const row of invalid.rows) {
    const id = Number(row.entity_id);
    const target = await resolveRedirect(row.entity_kind, id, client);
    const table = ENTITY_SPECS[row.entity_kind].table;
    const live = target?.kind === row.entity_kind && (await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [target.id])).rowCount;
    if (live) {
      const snapshot = await transferExternalIdentities(client, row.entity_kind, target!.id, id);
      await client.query(`INSERT INTO ingest.integrity_reconciliations(run_id,classification,object_key,before_state,after_state,limitation)
        VALUES($1,'identity_redirect',$2,$3,$4,$5) ON CONFLICT (classification,object_key) DO NOTHING`,
      [runId, `${row.entity_kind}:${id}`, JSON.stringify(snapshot?.before ?? []), JSON.stringify(snapshot?.after ?? []), "Destino recuperado mediante la redirección auditada existente. Las decisiones originales se conservan en before_state."]);
      counts.identityTransfers += 1;
    } else {
      const original = await client.query<{ row: unknown }>("SELECT to_jsonb(i) AS row FROM ingest.genre_external_identities i WHERE entity_kind=$1 AND entity_id=$2 FOR UPDATE", [row.entity_kind,id]);
      await client.query(`INSERT INTO ingest.integrity_reconciliations(run_id,classification,object_key,before_state,limitation)
        VALUES($1,'identity_orphan',$2,$3,$4) ON CONFLICT (classification,object_key) DO NOTHING`,
      [runId, `${row.entity_kind}:${id}`, JSON.stringify(original.rows.map(({ row }) => row)), "No existe destino recuperable. Se archiva el vínculo inválido sin afirmar que la identidad externa sea falsa."]);
      await client.query("DELETE FROM ingest.genre_external_identities WHERE entity_kind=$1 AND entity_id=$2", [row.entity_kind,id]);
      counts.identityArchived += original.rowCount ?? 0;
    }
  }
  // Inventory the immutable historical journal; leave its original NULL run untouched.
  const journal = await client.query<{ inventory: { throughId: number | null; count: number } }>(`
    SELECT jsonb_build_object('throughId',max(id),'count',count(*),'firstId',min(id),
      'recordedBefore',now(),'runIdUnrecoverable',true) AS inventory FROM ingest.change_journal WHERE run_id IS NULL`);
  const inventory = journal.rows[0]!.inventory;
  if (inventory.throughId !== null) {
    const inserted = await client.query(`INSERT INTO ingest.integrity_reconciliations(run_id,classification,object_key,before_state,limitation)
      VALUES($1,'journal_without_run',$2,$3,$4) ON CONFLICT (classification,object_key) DO NOTHING`,
    [runId, `through:${inventory.throughId}`, JSON.stringify(inventory), "Cambios históricos sin ejecución recuperable. Se conserva cada entrada original del diario; el mantenimiento no los convierte en operaciones deshacibles."]);
    counts.journalInventories = inserted.rowCount ?? 0;
  }
  return counts;
}
