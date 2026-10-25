import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";
import { dailyDate } from "../shared/daily-cycle.js";
import { OBSERVABILITY_VERSION, type SearchIntention } from "./contracts.js";
import { searchSample } from "./privacy.js";

const log = moduleLogger("search:observability");
export const confirmationSchema = z.object({
  searchId: z.string().uuid(), receipt: z.string().uuid(),
  confirmation: z.enum(["enter", "all_results", "suggestion", "entity"]),
  selected: z.object({ type: z.enum(["artist", "person", "album", "track", "organization"]), id: z.number().int().positive() }).strict().optional(),
  clientIncident: z.enum(["network", "client", "invalid_response"]).optional(),
  perceivedMs: z.number().finite().min(0).max(600_000).optional(),
}).strict();
export type Confirmation = z.infer<typeof confirmationSchema>;
export interface SearchSnapshot {
  attemptId: string; at: string; intention: SearchIntention;
  counts: Record<string, number>; entities: Array<{ type: string; id: number }>;
  entityResolution: "resolved" | "ambiguous" | "absent" | "external" | "not_applicable" | "undetermined";
  resultReason: string;
  legacyMatch?: { emotion: string | null };
  backendOutcome?: "results" | "empty" | "partial" | "technical_failure";
  clientReportedIncident?: "network" | "client" | "invalid_response";
  outcome: "results" | "empty" | "partial" | "technical_failure";
  incident: "timeout" | "provider" | "database" | "invalid_response" | "rate_limit" | "overload" | "network" | "client" | null;
  timings: Record<string, number>; cache: "hit" | "miss" | "unknown"; cold: boolean;
  versions: Record<string, string>;
}
interface Ticket { snapshot: SearchSnapshot; query: ReturnType<typeof searchSample>; expires: number; searchId?: string }
interface Operation { event: Confirmation; ticket: Ticket; at: string }
export const RECORD_LIMIT = 5000;
export const DAILY_SAMPLE_LIMIT = 500;
export const RECEIPT_TTL = 10 * 60_000;

/** Bounded process-local receipts. Nothing about the visitor is stored. A restart invalidates outstanding receipts. */
export class SearchCollector {
  readonly tickets = new Map<string, Ticket>();
  private pending: Operation[] = [];
  private flushing: Promise<void> | undefined;
  readonly quality = { received: 0, queued: 0, duplicates: 0, excluded: 0, lost: 0, failed: 0, invalid: 0,
    requests: 0, previews: 0, receiptsExpired: 0, persisted: 0, lastFlush: null as string | null };
  constructor(private readonly write: (batch: Operation[]) => Promise<{ persisted: number; duplicates: number }> = persistOperations) {}
  issue(query: string, snapshot: SearchSnapshot): string | null {
    this.quality.requests++; this.quality.previews++;
    for (const [id, ticket] of this.tickets) if (ticket.expires < Date.now()) { this.tickets.delete(id); this.quality.receiptsExpired++; }
    if (this.tickets.size >= RECORD_LIMIT) { this.quality.lost++; return null; }
    const id = randomUUID();
    this.tickets.set(id, { snapshot, query: searchSample(query), expires: Date.now() + RECEIPT_TTL });
    return id;
  }
  confirm(event: Confirmation): string {
    this.quality.received++;
    const ticket = this.tickets.get(event.receipt);
    if (!ticket || ticket.expires < Date.now()) { this.quality.invalid++; return "expired_or_invalid"; }
    if (ticket.searchId) {
      if (ticket.searchId === event.searchId) { this.quality.duplicates++; return "duplicate"; }
      this.quality.invalid++; return "receipt_used";
    }
    if (event.confirmation === "entity" && (!event.selected || !ticket.snapshot.entities.some(e => e.id === event.selected!.id && e.type === event.selected!.type))) {
      this.quality.invalid++; return "invalid_selection";
    }
    if (this.pending.length >= RECORD_LIMIT) { this.quality.lost++; return "buffer_full"; }
    ticket.searchId = event.searchId; this.quality.previews--;
    this.pending.push({ event, ticket, at: new Date().toISOString() }); this.quality.queued++;
    return "queued";
  }
  status() { return { ...this.quality, pending: this.pending.length, receipts: this.tickets.size, version: OBSERVABILITY_VERSION }; }
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const batch = this.pending.splice(0, 250);
    if (!batch.length) return;
    this.flushing = (async () => {
      try {
        const result = await this.write(batch);
        this.quality.persisted += result.persisted; this.quality.duplicates += result.duplicates;
        this.quality.lastFlush = new Date().toISOString();
      } catch {
        this.quality.failed += batch.length;
        // Independent of PostgreSQL; never log the query, exception or visitor.
        log.warn({ count: batch.length, code: "analytics_write_failed" }, "falló el lote de analítica de búsqueda");
        if (this.pending.length + batch.length <= RECORD_LIMIT) this.pending.unshift(...batch);
        else this.quality.lost += batch.length;
      } finally { this.flushing = undefined; }
    })();
    return this.flushing;
  }
}

async function persistOperations(batch: Operation[]) {
  const client = await getPool().connect();
  let persisted = 0, duplicates = 0;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    for (const { event, ticket, at } of batch) {
      const snapshot = structuredClone(ticket.snapshot);
      if (event.perceivedMs !== undefined) snapshot.timings["perceived"] = event.perceivedMs;
      if (event.confirmation === "entity") {
        snapshot.intention = { ...snapshot.intention, capabilities: ["direct"], interpretation: "identified", pending: [],
          entities: [{ role: "target", kind: event.selected!.type, id: event.selected!.id, name: "", resolution: "resolved" }] };
        snapshot.outcome = "results"; snapshot.entityResolution = "resolved"; snapshot.resultReason = "explicit_entity_selection";
      }
      if (event.clientIncident) {
        snapshot.backendOutcome = snapshot.outcome; snapshot.clientReportedIncident = event.clientIncident;
        snapshot.incident ??= event.clientIncident; snapshot.outcome = "technical_failure"; snapshot.resultReason = "client_reported_incident";
      }
      const day = dailyDate(new Date(at));
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`search:samples:${day}`]);
      const existing = (await client.query("SELECT sample IS NOT NULL AS sampled FROM ingest.search_operations WHERE search_id=$1", [event.searchId])).rows[0];
      const sampleCount = Number((await client.query("SELECT count(*) AS n FROM ingest.search_operations WHERE editorial_date=$1 AND sample IS NOT NULL", [day])).rows[0]?.n ?? 0);
      const sampled = existing ? Boolean(existing.sampled) : sampleCount < DAILY_SAMPLE_LIMIT && (snapshot.intention.interpretation !== "identified" || snapshot.incident !== null);
      if (!sampled) {
        // Keep counters, causes and observed statuses, without an unbounded second copy of query text in the plan.
        snapshot.intention.pending = snapshot.intention.pending.map(fragment => ({ ...fragment, text: "" }));
      }
      // A retry can revise the final result but never erase an earlier incident or observed analysis.
      const insert = await client.query(`INSERT INTO ingest.search_operations AS o
        (search_id,confirmed_at,editorial_date,entry_point,confirmation,origin,snapshot,attempt_at,had_incident,perceived_ms,sample,normalized,fingerprint,query_length,version)
        VALUES($1,$2,$3,'catalog',$4,'unattributed',$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(search_id) DO UPDATE SET
          snapshot=CASE WHEN EXCLUDED.attempt_at>o.attempt_at THEN EXCLUDED.snapshot ELSE o.snapshot END,
          perceived_ms=CASE WHEN EXCLUDED.attempt_at>o.attempt_at THEN EXCLUDED.perceived_ms ELSE o.perceived_ms END,
          attempt_at=GREATEST(o.attempt_at,EXCLUDED.attempt_at),had_incident=o.had_incident OR EXCLUDED.had_incident
        WHERE o.fingerprint=EXCLUDED.fingerprint RETURNING search_id`,
      [event.searchId, at, day, event.confirmation, snapshot, snapshot.at, snapshot.incident !== null,
        event.perceivedMs ?? null, sampled ? ticket.query.sample : null, sampled ? ticket.query.normalized : null, ticket.query.fingerprint, ticket.query.length, OBSERVABILITY_VERSION]);
      if (!insert.rowCount) { duplicates++; continue; }
      const attempt = await client.query(`INSERT INTO ingest.search_attempts(attempt_id,search_id,received_at,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [snapshot.attemptId, event.searchId, at, snapshot]);
      if (attempt.rowCount) persisted++; else duplicates++;
    }
    await client.query("COMMIT");
    return { persisted, duplicates };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export const searchCollector = new SearchCollector();

/** Retain detail for 30 editorial days and anonymous daily aggregates for 180; never purge legacy. */
export async function retainSearchAnalytics(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:search:retention'))");
    await client.query(`INSERT INTO ingest.search_daily(editorial_date,totals,version)
      SELECT editorial_date,jsonb_build_object('total',count(*),'empty',count(*) FILTER(WHERE snapshot->>'outcome'='empty'),
        'incidents',count(*) FILTER(WHERE had_incident),'failures',count(*) FILTER(WHERE snapshot->>'outcome'='technical_failure'),
        'direct',count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'direct'),
        'emotional',count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'emotional'),
        'contextual',count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'contextual')), $1
      FROM ingest.search_operations GROUP BY editorial_date
      ON CONFLICT(editorial_date) DO UPDATE SET totals=EXCLUDED.totals,updated_at=now(),version=EXCLUDED.version`, [OBSERVABILITY_VERSION]);
    await client.query("DELETE FROM ingest.search_operations WHERE editorial_date < $1::date - 30", [dailyDate()]);
    await client.query("DELETE FROM ingest.search_daily WHERE editorial_date < $1::date - 180", [dailyDate()]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
