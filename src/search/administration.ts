import path from "node:path";
import { projectRoot } from "../config/project-root.js";
import { readFile } from "node:fs/promises";
import { getEnv } from "../config/env.js";
import { sanitizeSearchText } from "./privacy.js";
import { getPool } from "../db/client.js";
import { dailyCycleAt } from "../shared/daily-cycle.js";
import { OBSERVABILITY_VERSION } from "./contracts.js";
import { DAILY_SAMPLE_LIMIT, searchCollector } from "./observability.js";
import { resourceFieldAdministration, resourceFieldStatus } from "./resource-field-review.js";

export async function searchAdministration() {
  const db = getPool();
  const cycle = dailyCycleAt();
  const [summary, combinations, queries, outcomes, latencies, daily, legacy, decisions, discovery, jobs] = await Promise.all([
    db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE sample IS NOT NULL)::int AS sampled,
      count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'direct')::int AS direct,
      count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'emotional')::int AS emotional,
      count(*) FILTER(WHERE snapshot->'intention'->'capabilities' ? 'contextual')::int AS contextual,
      count(*) FILTER(WHERE jsonb_array_length(COALESCE(snapshot->'intention'->'capabilities','[]'))>1)::int AS mixed,
      count(*) FILTER(WHERE snapshot->'intention'->>'interpretation' IN ('unrecognized','partial','ambiguous','out_of_scope'))::int AS unidentified,
      count(*) FILTER(WHERE snapshot->>'entityResolution' IN ('ambiguous','absent','external'))::int AS unresolved_entities,
      count(*) FILTER(WHERE snapshot->>'entityResolution'='undetermined')::int AS undetermined_entities,
      count(*) FILTER(WHERE had_incident)::int AS incidents,
      count(*) FILTER(WHERE snapshot->>'outcome'='technical_failure')::int AS failures,
      count(*) FILTER(WHERE snapshot->>'outcome'='empty')::int AS empty,
      count(*) FILTER(WHERE confirmation='entity')::int AS navigations,
      count(*) FILTER(WHERE snapshot->>'cache'='hit')::int AS cache_hits
      FROM ingest.search_operations WHERE confirmed_at>=now()-interval '30 days'`),
    db.query(`SELECT snapshot->'intention'->'capabilities' AS types,count(*)::int AS count FROM ingest.search_operations
      WHERE confirmed_at>=now()-interval '30 days' GROUP BY 1`),
    db.query(`SELECT fingerprint,min(sample) AS sample,count(*)::int AS count,
      count(*) FILTER(WHERE snapshot->>'outcome'='empty')::int AS empty,
      count(*) FILTER(WHERE snapshot->>'entityResolution' IN ('ambiguous','absent','external'))::int AS unresolved_entities,
      count(*) FILTER(WHERE snapshot->>'entityResolution'='undetermined')::int AS undetermined_entities,
      count(*) FILTER(WHERE had_incident)::int AS incidents,
      min(confirmed_at) AS first_seen,max(confirmed_at) AS last_seen,
      jsonb_agg(DISTINCT snapshot->'intention'->>'interpretation') AS interpretations
      FROM ingest.search_operations WHERE confirmed_at>=now()-interval '30 days' AND sample IS NOT NULL
      GROUP BY fingerprint ORDER BY count(*) DESC LIMIT 100`),
    db.query(`SELECT snapshot->>'outcome' AS outcome,count(*)::int AS count FROM ingest.search_operations
      WHERE confirmed_at>=now()-interval '30 days' GROUP BY 1`),
    db.query(`SELECT snapshot->>'cache' AS cache,snapshot->>'cold' AS cold,
      count(*)::int AS n,
      percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP(ORDER BY (snapshot->'timings'->>'server')::float) AS server_ms,
      percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP(ORDER BY (snapshot->'timings'->>'retrieval')::float) AS retrieval_ms,
      percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP(ORDER BY perceived_ms) AS perceived_ms
      FROM ingest.search_operations WHERE confirmed_at>=now()-interval '30 days' GROUP BY 1,2`),
    db.query(`WITH live AS (SELECT editorial_date,count(*)::int AS total,
      count(*) FILTER(WHERE snapshot->>'outcome'='empty')::int AS empty,count(*) FILTER(WHERE had_incident)::int AS incidents
      FROM ingest.search_operations GROUP BY 1)
      SELECT coalesce(l.editorial_date,d.editorial_date)::text AS day,
      coalesce(l.total,(d.totals->>'total')::int) AS total,coalesce(l.empty,(d.totals->>'empty')::int) AS empty,
      coalesce(l.incidents,(d.totals->>'incidents')::int) AS incidents
      FROM live l FULL JOIN ingest.search_daily d USING(editorial_date) ORDER BY 1 DESC`),
    db.query("SELECT normalized_query,sample_query,misses,first_seen,last_seen FROM ingest.search_misses ORDER BY misses DESC LIMIT 50"),
    db.query("SELECT state AS status,count(*)::int AS count FROM ingest.artist_search_suggestions GROUP BY state"),
    db.query("SELECT kind,count(*)::int AS count FROM ingest.discovery_metric_events GROUP BY kind"),
    db.query("SELECT * FROM ingest.discovery_metric_jobs ORDER BY started_at DESC LIMIT 5"),
  ]);
  const registry = JSON.parse(await readFile(path.join(projectRoot(import.meta.url), "docs/unified-search/resources.json"), "utf8")) as { checkedAt: string; resources: Array<{ id: string; resource: string; availability: string; status: string; nextTask: string; stagePriority: string }> };
  let resourceUses: { resources: Array<{ id:string; disposition:string; reason:string }> } = { resources:[] };
  try { resourceUses=JSON.parse(await readFile(path.join(projectRoot(import.meta.url), "reports/unified-search-stage2/resource-uses.json"),"utf8")); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") throw error; }
  const usage = new Map(resourceUses.resources.map(row=>[row.id,row]));
  let fieldReview: Awaited<ReturnType<typeof resourceFieldAdministration>> = null;
  let fieldReviewStatus: "verified" | "missing" | "needs_review" = "missing";
  try {
    fieldReview = await resourceFieldAdministration(projectRoot(import.meta.url));
    if (fieldReview) fieldReviewStatus = "verified";
  } catch {
    // A changed capture or proof must hide its unverified field dispositions,
    // while keeping the rest of the administration usable and errors private.
    fieldReviewStatus = "needs_review";
  }
  const fieldRows = new Map(fieldReview?.resources.map(row => [row.id, row.fields]) ?? []);
  return {
    resources: { checkedAt: registry.checkedAt, fieldReviewStatus,
      fieldReview: fieldReview ? {version:fieldReview.version,revision:fieldReview.revision,analyst:fieldReview.analyst,coverage:fieldReview.coverage,publicationAuthorized:false} : null,
      rows: registry.resources.map(({ id, resource, availability, status, nextTask, stagePriority }) => ({ id, resource, availability,
        status: status === "withdrawn" ? status : fieldReviewStatus === "needs_review" ? "field_review_required" : fieldRows.has(id) ? resourceFieldStatus(fieldRows.get(id)!) : usage.get(id)?.disposition ?? status,
        nextTask:usage.get(id)?.reason??nextTask, stagePriority, fields:fieldRows.get(id)??null })) },
    flags: { suggestions: getEnv().CRV_DISCOVERY_ENABLED, suggestionMetrics: getEnv().CRV_DISCOVERY_METRICS_ENABLED, recommendations: getEnv().CRV_RECOMMENDATIONS_ENABLED },
    sampling: { maximumExamplesPerEditorialDay: DAILY_SAMPLE_LIMIT, directEntityNavigationsSampled: false, policy: "problematic-first-up-to-daily-cap-v1" },
    version: OBSERVABILITY_VERSION, dailyCycle: cycle, generatedAt: new Date().toISOString(), periodDays: 30,
    summary: summary.rows[0], combinations: combinations.rows, queries: queries.rows, outcomes: outcomes.rows,
    latencies: latencies.rows, daily: daily.rows, quality: searchCollector.status(),
    legacy: { version: "0072_search_misses", includesPreviews: true, additive: false, seriesCut: "unavailable", rows: legacy.rows.map(row => ({ ...row, normalized_query: sanitizeSearchText(row.normalized_query), sample_query: sanitizeSearchText(row.sample_query) })) },
    suggestions: { decisions: decisions.rows, funnel: discovery.rows, jobs: jobs.rows, seriesCut: "UTC; separate from Caracas confirmed searches" },
    limitations: ["Lógica heredada: sin plan semántico completo ni Laya de consultas", "Grupos exactos sanitizados; similitud semántica pendiente de etapa 5", "Calidad del buffer desde el arranque del proceso; pérdidas al reiniciar no cuantificables", "30 días de detalle; 180 días de contadores sin muestras", "No se suman contadores solapados ni se equiparan sesiones con personas"],
  };
}

export type SearchAdministration = Awaited<ReturnType<typeof searchAdministration>>;
