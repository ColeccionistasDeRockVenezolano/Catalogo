import type { PoolClient } from "pg";
import { canonicalJson } from "./store.js";
import type { GenreEntityKind } from "./rules.js";

type Row = Record<string, unknown>;
const TABLE = "ingest.genre_external_identities";

export interface ExternalIdentitySnapshot {
  kind: GenreEntityKind;
  keepId: number;
  dropId: number;
  before: Row[];
  after: Row[];
}

async function read(client: PoolClient, kind: GenreEntityKind, ids: number[]): Promise<Row[]> {
  const present = await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL AS present", [TABLE]);
  if (!present.rows[0]?.present) return [];
  // JSON from PostgreSQL keeps timestamp precision when the snapshot is restored.
  const result = await client.query<{ row: Row }>(
    `SELECT to_jsonb(i) AS row FROM ${TABLE} i WHERE entity_kind=$1 AND entity_id=ANY($2::bigint[]) ORDER BY id FOR UPDATE`, [kind, ids]);
  return result.rows.map(({ row }) => row);
}

/** Preserve both original decisions in the merge audit, including collisions. */
export async function transferExternalIdentities(client: PoolClient, kind: GenreEntityKind, keepId: number, dropId: number): Promise<ExternalIdentitySnapshot | undefined> {
  const before = await read(client, kind, [keepId, dropId]);
  if (!before.length) return undefined;
  const groups = new Map<string, Row[]>();
  for (const row of before) {
    const key = canonicalJson([row["source_id"], row["external_id"]]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const matchedBySource = new Map<string, Set<string>>();
  for (const row of before.filter((item) => item["status"] === "matched")) {
    const key = String(row["source_id"]);
    matchedBySource.set(key, new Set([...(matchedBySource.get(key) ?? []), String(row["external_id"])]));
  }
  // Remove first: the unique matched-source index otherwise blocks a valid move.
  await client.query(`DELETE FROM ${TABLE} WHERE entity_kind=$1 AND entity_id=ANY($2::bigint[])`, [kind, [keepId, dropId]]);
  for (const rows of groups.values()) {
    const winner = rows.find((row) => Number(row["entity_id"]) === keepId) ?? rows[0]!;
    const conflicting = (matchedBySource.get(String(winner["source_id"]))?.size ?? 0) > 1
      || new Set(rows.map((row) => row["status"])).size > 1;
    const signals = [...new Map(rows.flatMap((row) => Array.isArray(row["signals"]) ? row["signals"] : [])
      .map((signal: unknown) => [canonicalJson(signal), signal])).values()];
    const merged = { ...winner, entity_id: keepId, signals,
      ...(conflicting ? { status: "ambiguous", decision_kind: "rule", decided_by: "merge",
        reason: `Decisiones externas incompatibles al fusionar ${kind} ${dropId} en ${keepId}; originales conservados en la auditoría` } : {}) };
    await client.query(`INSERT INTO ${TABLE} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::${TABLE}, $1::jsonb)`, [JSON.stringify(merged)]);
  }
  return { kind, keepId, dropId, before, after: await read(client, kind, [keepId, dropId]) };
}

/** Reject undo if it would overwrite any subsequent external identity decision. */
export async function restoreExternalIdentities(client: PoolClient, snapshot: ExternalIdentitySnapshot): Promise<void> {
  const current = await read(client, snapshot.kind, [snapshot.keepId, snapshot.dropId]);
  if (canonicalJson(current) !== canonicalJson(snapshot.after)) {
    throw new Error("las identidades externas cambiaron después de la fusión; revísalas antes de deshacer");
  }
  await client.query(`DELETE FROM ${TABLE} WHERE entity_kind=$1 AND entity_id=ANY($2::bigint[])`, [snapshot.kind, [snapshot.keepId, snapshot.dropId]]);
  for (const row of snapshot.before) {
    await client.query(`INSERT INTO ${TABLE} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::${TABLE}, $1::jsonb)`, [JSON.stringify(row)]);
  }
}

/** A retirement archives these rows in its durable operation result. */
export async function detachExternalIdentities(client: PoolClient, kind: GenreEntityKind, id: number): Promise<Row[]> {
  const rows = await read(client, kind, [id]);
  if (rows.length) await client.query(`DELETE FROM ${TABLE} WHERE entity_kind=$1 AND entity_id=$2`, [kind, id]);
  return rows;
}
