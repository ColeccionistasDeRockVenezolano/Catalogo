import { createHash } from "node:crypto";
import type pg from "pg";
export function tracklistFingerprint(titles: string[]): string {
  const normalized = titles.map(title => title.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim());
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
/** A corrected empty album must not receive the same misattributed list again.
 * A different list from the very same page remains eligible for verification. */
export async function rejectedTracklist(client: pg.Pool | pg.PoolClient, albumId: number, titles: string[]): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM ingest.review_queue WHERE album_id=$1
    AND payload->>'operation'='tracklist_source_rejected' AND payload->>'fingerprint'=$2 LIMIT 1`,
  [albumId, tracklistFingerprint(titles)]);
  return !!result.rowCount;
}
