/** Read-only verification of the frozen RHV cohort and the applied targets. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { closeDb, getPool } from "../src/db/client.js";
import { closureSchema, evidenceHash, shouldReopenEvidenceCase, sourceReviewFingerprint } from "../src/review/evidence-closure.js";
const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env["HOME"]}/crv-staging/`)) throw new Error("Informe en staging SSD");
const snapshot = JSON.parse(readFileSync(path.join(root, "reviews-before.json"), "utf8")) as Array<{ id: number; artistId: number | null; payload: Record<string, unknown> }>;
assert.equal(snapshot.length, 923);
const before = new Map(snapshot.map(r => [r.id, r]));
const sources = readFileSync("reports/rhv-directorio-2026-10-25/fichas.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
const primary = JSON.parse(readFileSync(path.join(root, "metalkinesia-tracklist.json"), "utf8"));
const client = await getPool().connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const rows = (await client.query<{ id: number; status: string; payload: Record<string, unknown> }>("SELECT id::int,status::text,payload FROM ingest.review_queue WHERE id=ANY($1::bigint[]) ORDER BY id", [snapshot.map(r => r.id)])).rows;
  assert.equal(rows.length, snapshot.length);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const closure = closureSchema.parse(row.payload["rhvClosure"]);
    assert.equal(closure.reviewId, row.id);
    assert.equal(closure.expectedPayloadHash, evidenceHash(before.get(row.id)!.payload));
    const source = sources.find(s => s.url === row.payload["url"]) ?? { albums: primary.tracks };
    assert.equal(shouldReopenEvidenceCase(row.payload, sourceReviewFingerprint(row.payload, source)), false, `La fuente cambió para ${row.id}`);
    assert.equal(row.status, ["confirmed", "already_resolved"].includes(closure.verdict) ? "approved" : "dismissed");
    for (const search of closure.research) {
      const relative = search.receipt.replace(/^reports\/rhv-cierre-incidencias-2026-10-29\//u, "");
      assert.ok(!relative.includes(".."));
      const receipt = JSON.parse(readFileSync(path.join(root, relative), "utf8"));
      assert.equal(receipt.query, search.query); assert.equal(receipt.status, search.status);
    }
    if (closure.target?.["kind"] === "artist_membership") {
      const target = (await client.query("SELECT artist_id::int,person_id::int FROM public.artist_members WHERE id=$1", [closure.target["id"]])).rows[0];
      assert.equal(target?.artist_id, before.get(row.id)!.artistId); assert.equal(target?.person_id, closure.target["personId"]);
    }
    if (closure.target?.["kind"] === "album_credit") {
      const target = (await client.query("SELECT album_id::int,artist_id::int FROM public.album_credits WHERE id=$1", [closure.target["id"]])).rows[0];
      assert.equal(target?.artist_id, before.get(row.id)!.artistId); assert.equal(target?.album_id, closure.target["albumId"]);
    }
    counts[closure.verdict] = (counts[closure.verdict] ?? 0) + 1;
  }
  const result = { checkedAt: new Date().toISOString(), cohort: rows.length, open: rows.filter(r => ["open", "in_progress"].includes(r.status)).length, counts, payloadHashesVerified: rows.length, researchReceiptsVerified: true, membershipAndAlbumTargetsVerified: true, unchangedSourceWouldReopen: 0 };
  assert.equal(result.open, 0);
  writeFileSync(path.join(root, "verification.json"), JSON.stringify(result, null, 2));
  writeFileSync(path.join(root, "reviews-after.json"), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(result));
  await client.query("ROLLBACK");
} finally { client.release(); await closeDb(); }
