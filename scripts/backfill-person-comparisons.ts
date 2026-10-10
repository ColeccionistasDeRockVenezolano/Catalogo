// Reevalúa las investigaciones previas contra páginas ya guardadas; no llama a IA ni escribe fichas.
import { getPool, closeDb } from "../src/db/client.js";
import { loadPersonFacts } from "../src/review/person-candidates.js";
import { buildPersonComparison, pairPolicyContext, personContext, validateWebVerdict, type VerifiedEvidence, type WebVerdict } from "../src/ambiguity/person-web-verification.js";
import { eraConflictBetween } from "../src/merge/era-guard.js";
import type { WebPage } from "../src/ambiguity/web-search.js";

try {
  const pool = getPool();
  const facts = new Map((await loadPersonFacts(pool)).map((p) => [p.id, p]));
  const refresh = process.argv.includes("--refresh");
  const rows = await pool.query<{ id: string; a: string; b: string; verdict: WebVerdict["verdict"]; rationale: string;
    evidence: VerifiedEvidence[]; sources: Array<{ url: string; contentHash: string }> }>(`
    SELECT v.id::text,COALESCE(v.person_a_id,q.person_a_id)::text AS a,COALESCE(v.person_b_id,q.person_b_id)::text AS b,
           v.verdict,v.rationale,v.evidence,v.sources
      FROM ingest.person_web_verifications v LEFT JOIN ingest.review_queue q ON q.id=v.review_id
     WHERE ($1::boolean OR v.comparison IS NULL) AND v.status IN ('proposed','reviewed')
       AND COALESCE(v.person_a_id,q.person_a_id) IS NOT NULL AND COALESCE(v.person_b_id,q.person_b_id) IS NOT NULL`, [refresh]);
  let updated = 0; let unavailable = 0;
  for (const row of rows.rows) {
    const cached = await pool.query<{ url: string; title: string; content: string; content_hash: string; fetched_at: string }>(
      "SELECT url,title,content,content_hash,fetched_at::text FROM ingest.person_web_page_cache WHERE url=ANY($1::text[])", [row.sources.map((s) => s.url)]);
    const pages: WebPage[] = cached.rows.filter((p) => row.sources.some((s) => s.url === p.url && s.contentHash === p.content_hash))
      .map((p) => ({ url:p.url,title:p.title,content:p.content,contentHash:p.content_hash,fetchedAt:p.fetched_at,origin:"page" }));
    if (!pages.length) { unavailable++; continue; }
    const aId = Number(row.a); const bId = Number(row.b);
    const [a,b,conflict] = await Promise.all([personContext(aId),personContext(bId),eraConflictBetween(pool,aId,bId)]);
    const proposal: WebVerdict = { verdict:row.verdict,rationale:row.rationale,evidence:row.evidence.map((e) => ({
      source:pages.findIndex((p)=>p.url===e.url),quote:e.quote,supports:e.supports })),uncertainties:[],groups:[] };
    const validated = validateWebVerdict(proposal,pages,pairPolicyContext(a,b,pages,conflict));
    const comparison = buildPersonComparison(a,b,pages,validated,[facts.get(aId)!,facts.get(bId)!]);
    await pool.query("UPDATE ingest.person_web_verifications SET comparison=$1::jsonb WHERE id=$2 AND ($3::boolean OR comparison IS NULL)",[JSON.stringify(comparison),row.id,refresh]);
    updated++;
  }
  console.log(JSON.stringify({updated,unavailable}));
} finally { await closeDb(); }
