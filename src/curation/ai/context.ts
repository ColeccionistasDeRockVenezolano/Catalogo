import { sourceProvenance } from "../../evidence/provenance.js";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ENTITY_SPECS } from "../../merge/specs.js";
import { RELATION_SPECS } from "../../merge/relations.js";
import { WebSearchBroker, type WebPage } from "../../ambiguity/web-search.js";
import { usablePage } from "../../verification/proof.js";
import {visibleSegments,requiresPdfReread} from "../../verification/documents/visibility.js";
import type { CatalogEvidence, CatalogKind } from "./types.js";
import { ENTITY_FIELDS } from "../../api/routes/catalog-writes.js";
import { RELATION_ROUTES } from "../../api/routes/relation-writes.js";
import { describeFields } from "./fields.js";
import { curationFindings } from "../../verification/curation.js";
import type { VerificationReport } from "../../verification/types.js";
import { genreReviewCandidates } from "./genre-review.js";

export type Database = Pick<Pool | PoolClient, "query">;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const hashValue = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export async function entityRow(
  db: Database,
  kind: CatalogKind,
  id: number,
): Promise<Record<string, unknown>> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${ENTITY_SPECS[kind].table} WHERE id=$1`,
    [id],
  );
  if (!rows[0]) throw new Error(`${kind} ${id} no existe`);
  return rows[0];
}
const RELATION_ENDPOINTS: Record<CatalogKind, string> = {
  artist: "artist_id",
  person: "person_id",
  organization: "organization_id",
  album: "album_id",
  track: "track_id",
};
export async function entityState(
  db: Database,
  kind: CatalogKind,
  id: number,
): Promise<Record<string, unknown>> {
  const spec = ENTITY_SPECS[kind];
  const row = await entityRow(db, kind, id);
  const aliases = (
    await db.query(
      `SELECT * FROM ${spec.aliasTable} WHERE ${spec.aliasTargetColumn}=$1 ORDER BY id`,
      [id],
    )
  ).rows;
  const relations: Record<string, unknown> = {};
  for (const relation of Object.values(RELATION_SPECS)) {
    const relevant: Record<CatalogKind, string[]> = {
      artist: ["artist_membership", "album_credit", "track_credit"],
      person: [
        "artist_membership",
        "person_organization",
        "album_credit",
        "track_credit",
      ],
      organization: ["person_organization", "album_credit", "track_credit"],
      album: ["album_credit", "album_format"],
      track: ["track_credit"],
    };
    if (relevant[kind].includes(relation.kind))
      relations[relation.kind] = (
        await db.query(
          `SELECT * FROM ${relation.table} WHERE ${RELATION_ENDPOINTS[kind]}=$1 ORDER BY id`,
          [id],
        )
      ).rows;
  }
  if (kind === "album")
    relations["tracks"] = (
      await db.query(
        "SELECT * FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id",
        [id],
      )
    ).rows;
  if (kind === "artist")
    relations["albums"] = (
      await db.query(
        "SELECT * FROM public.albums WHERE artist_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
  if (kind === "artist") {
    relations["social_links"] = (
      await db.query(
        "SELECT * FROM public.social_links WHERE artist_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
    relations["artist_relations"] = (
      await db.query(
        "SELECT * FROM ingest.artist_relations WHERE from_artist_id=$1 OR to_artist_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
  }
  if (kind === "artist" || kind === "album")
    relations["streaming_links"] = (
      await db.query(
        `SELECT * FROM public.streaming_links WHERE ${kind}_id=$1 ORDER BY id`,
        [id],
      )
    ).rows;
  if (kind === "organization")
    relations["albums"] = (
      await db.query(
        "SELECT * FROM public.albums WHERE label_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
  if (kind === "artist" || kind === "album")
    relations["genres"] = (
      await db.query(
        `SELECT * FROM ingest.${kind}_genres WHERE ${kind}_id=$1 ORDER BY id`,
        [id],
      )
    ).rows;
  return { row, aliases, relations };
}
async function relatedLabels(
  db: Database,
  state: Record<string, unknown>,
): Promise<unknown[]> {
  const ids: Partial<Record<CatalogKind, Set<number>>> = {};
  for (const rows of Object.values(
    state["relations"] as Record<string, unknown>,
  ))
    if (Array.isArray(rows))
      for (const row of rows)
        for (const [kind, column] of Object.entries(RELATION_ENDPOINTS))
          if (row[column]) {
            const key = kind as CatalogKind;
            (ids[key] ??= new Set()).add(Number(row[column]));
          }
  const result: unknown[] = [];
  for (const [kind, found] of Object.entries(ids)) {
    const spec = ENTITY_SPECS[kind as CatalogKind];
    const rows = (
      await db.query(
        `SELECT id,${spec.identityColumn} AS label FROM ${spec.table} WHERE id=ANY($1::bigint[]) ORDER BY id LIMIT 80`,
        [[...found]],
      )
    ).rows;
    result.push(...rows.map((r) => ({ kind, ...r })));
  }
  return result;
}
function compact(value: unknown, limit = 100, textLimit = 1600): unknown {
  if (value instanceof Date) return value.toJSON();
  if (typeof value === "string")
    return value.length > textLimit
      ? `${value.slice(0, textLimit)} [texto recortado]`
      : value;
  if (Array.isArray(value))
    return {
      items: value.slice(0, limit).map((v) => compact(v, limit, textLimit)),
      omitted: Math.max(0, value.length - limit),
    };
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !/^created_at|updated_at$/u.test(k))
        .map(([k, v]) => [
          k,
          typeof v === "string" &&
          /^(id|.*_id)$/u.test(k) &&
          /^\d+$/u.test(v) &&
          Number.isSafeInteger(Number(v))
            ? Number(v)
            : compact(v, limit, textLimit),
        ]),
    );
  return value;
}
export async function catalogLookup(
  db: Database,
  query: string,
  kind?: CatalogKind,
): Promise<unknown> {
  const results: unknown[] = [];
  for (const k of kind
    ? [kind]
    : ([
        "artist",
        "person",
        "album",
        "organization",
        "track",
      ] as CatalogKind[])) {
    const spec = ENTITY_SPECS[k];
    const pattern = `%${query.replace(/[%_\\]/gu, "\\$&")}%`;
    const found = /^\d+$/u.test(query)
      ? await db.query(
          `SELECT id::int,${spec.identityColumn} AS label FROM ${spec.table} WHERE id=$1`,
          [Number(query)],
        )
      : await db.query(
          `SELECT id::int,${spec.identityColumn} AS label FROM ${spec.table} WHERE translate(lower(${spec.identityColumn}),'áéíóúüñ','aeiouun') LIKE translate(lower($1),'áéíóúüñ','aeiouun') ORDER BY id LIMIT 6`,
          [pattern],
        );
    // Every retrieved row retains its kind: numeric ids are never interchangeable.
    for (const row of found.rows) {
      const state = await entityState(db, k, Number(row.id));
      results.push({
        kind: k,
        ...row,
        data: compact(
          state,
          /^\d+$/u.test(query) ? 150 : 20,
        ),
        narrativeOriginals: Object.fromEntries(Object.entries(state["row"] as Record<string, unknown>).filter(([field, value]) => ["biography", "description", "notes"].includes(field) && typeof value === "string" && value.length)),
      });
    }
  }
  return results;
}
export function evidenceFromPage(
  page: WebPage,
  terms: string[],
  start: number,
): CatalogEvidence[] {
  if (!usablePage(page)||requiresPdfReread(page.document)) return [];
  // Read across the source, including facts outside the initial request and visual resources.
  // Overlap preserves statements and image URLs that cross a chunk boundary.
  const chunks: string[] = [];
  for(const segment of page.document?visibleSegments(page.content,page.document.locations):[page.content]){
    for (let offset = 0; offset < segment.length; offset += 1300)
      chunks.push(segment.slice(offset, offset + 1800));
  }
  const needles = terms.map(term => term.toLocaleLowerCase()).filter(term => term.length > 3);
  const rank = (chunk: string) => needles.filter(term => chunk.toLocaleLowerCase().includes(term)).length;
  chunks.sort((a, b) => rank(b) - rank(a));
  return chunks
    .filter((q) => q.trim().length>0)
    .map((quote, i) => ({
      id: `E${start + i}`,
      url: page.url,
      quote,
      fetchedAt: page.fetchedAt,
      ...sourceProvenance(page),
      origin: page.origin ?? "page",
      contentHash: page.contentHash,
      label: page.title,
    }));
}
export async function planningContext(
  db: Database,
  kind: CatalogKind,
  id: number,
  instruction: string,
): Promise<{ context: Record<string, unknown>; evidence: CatalogEvidence[] }> {
  const state = await entityState(db, kind, id);
  const root = state["row"] as Record<string, unknown>;
  const column = ENTITY_SPECS[kind].targetColumn;
  const findings = (
    await db.query(
      "SELECT id,detector,field,value,suggestion,title,evidence FROM ingest.curation_findings WHERE entity_kind=$1 AND entity_id=$2 AND status='open' ORDER BY id",
      [kind, id],
    )
  ).rows;
  const claims = (
    await db.query(
      `SELECT c.field,c.raw_value,c.status,s.slug,e.url,e.excerpt FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id LEFT JOIN ingest.claim_evidence e ON e.claim_id=c.id WHERE c.${column}=$1 ORDER BY c.id DESC,e.id`,
      [id],
    )
  ).rows;
  const evidence: CatalogEvidence[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<CatalogEvidence, "id">): string | undefined => {
    const signature = `${e.url}\n${e.quote}`;
    if (!e.quote) return;
    if (seen.has(signature)) return evidence.find((item) => item.url === e.url && item.quote === e.quote)?.id;
    seen.add(signature);
    evidence.push({ id: `E${evidence.length + 1}`, ...e });
    return evidence[evidence.length - 1]!.id;
  };
  let report: Record<string, unknown> | null = null;
  {
    const savedReport = (
      await db.query<{ report: Record<string, unknown> }>(
        "SELECT report FROM ingest.entity_verification_reports WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1",
        [kind, id],
      )
    ).rows[0]?.report;
    const checkpoint = (await db.query<{ checkpoint: Record<string, unknown> | null }>(
      "SELECT checkpoint FROM ingest.entity_verification_jobs WHERE entity_kind=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1", [kind, id],
    )).rows[0]?.checkpoint;
    const saved = checkpoint && (!savedReport || String(checkpoint["createdAt"]) >= String(savedReport["createdAt"])) ? checkpoint : savedReport;
    if (saved) {
      const pending = (
        (saved["findings"] as Array<Record<string, unknown>>) ?? []
      ).filter((f) => f["status"] !== "confirmed");
      const review = curationFindings(saved as unknown as VerificationReport) as unknown as Array<Record<string, unknown>>;
      const rawExtractions=(saved["extractions"]??[]) as NonNullable<VerificationReport["extractions"]>;
      const preservedSources=(saved["sources"]??[]) as VerificationReport["sources"];
      const additional=rawExtractions.filter(item=>item.destination!=="already_present"&&item.destination!=="discarded"&&!item.findingKey).map(item=>({
        key:`extracted.${item.id}`,area:item.area,label:"Dato extraído por resolver",value:null,observed:item.value,status:item.state==="contradicted"?"contradicted":"unverified",context:item.context,explanation:item.reason,
        evidence:item.evidence.filter(citation=>citation.url&&citation.valid).map(citation=>({...preservedSources.find(source=>source.url===citation.url&&source.contentHash===citation.contentHash),url:citation.url!,quote:citation.quote,contentHash:citation.contentHash??""})),
      })) as Array<Record<string,unknown>>;
      const selected = [...review, ...pending,...additional].find(f => instruction.includes(`hallazgo ${String(f["key"])} (`)||String(f["key"]).startsWith("extracted.")&&instruction.includes(`dato extraído ${String(f["key"]).slice(10)}`));
      // A targeted request must retain its finding and citations even when it is past every broad-plan limit.
      const candidates = [...new Map([
        ...review.filter(f => f["observed"]),
        ...review.filter(f => !f["observed"]),
        ...pending,...additional,
      ].map(f=>[String(f["key"]),f])).values()];
      const units = selected ? [selected] : candidates;
      if (selected) {
        const match = /^(album|track)\.(\d+)/u.exec(String(selected["key"]));
        if (match) {
          const selectedKind = match[1] as CatalogKind, selectedId = Number(match[2]);
          const exists = (await db.query(`SELECT id FROM ${ENTITY_SPECS[selectedKind].table} WHERE id=$1`, [selectedId])).rowCount;
          state["selectedEntity"] = { kind: selectedKind, id: selectedId, ...(exists ? { data: await entityState(db, selectedKind, selectedId) } : { missingFromCurrentCatalog: true }) };
        }
        const member = /^member\.(\d+)/u.exec(String(selected["key"]));
        if (member) state["selectedMembership"] = (await db.query("SELECT * FROM public.artist_members WHERE id=$1", [Number(member[1])])).rows[0] ?? null;
      }
      const linkedUnits = units.map((f) => {
        const evidenceIds = ((f["evidence"] as Array<Record<string, unknown>>) ?? []).map((e) => add({
          url: String(e["url"]), quote: String(e["quote"]),
          fetchedAt: String(e["fetchedAt"] ?? ""), ...sourceProvenance({ capturedAt:e["capturedAt"],readAt:e["readAt"],acquisitionMethod:e["acquisitionMethod"] }), origin: String(e["origin"] ?? "page"),
          contentHash: String(e["contentHash"]??""), label: String(f["label"] ?? f["key"]),
        })).filter((id): id is string => !!id);
        return { key: f["key"], area: f["area"], label: f["label"], value: f["value"], observed: f["observed"], status: f["status"], context: f["context"], explanation: f["explanation"], evidenceIds };
      });
      report = {
        createdAt: saved["createdAt"],
        selectedKey: selected?.["key"],
        pending: linkedUnits,
        omitted: 0,
      };
    }
  }
  for (const claim of claims)
    if (claim.url && claim.excerpt && !String(claim.url).startsWith("crv-api:"))
      add({ url: String(claim.url), quote: String(claim.excerpt), fetchedAt: "", origin: "ingest_claim", contentHash: "", label: String(claim.field) });
  const taxonomy = (
    await db.query<{ slug: string; name: string; level: string; parent: string | null }>(
      "SELECT g.slug,g.name,g.level,p.slug AS parent FROM ingest.genres g LEFT JOIN ingest.genres p ON p.id=g.parent_genre_id WHERE g.active ORDER BY g.id LIMIT 500",
    )
  ).rows;
  const currentGenres = kind === "artist" || kind === "album" ? (await db.query(
    `SELECT g.slug,g.name,a.role,a.status FROM ingest.${kind}_genres a JOIN ingest.genres g ON g.id=a.genre_id WHERE a.${kind}_id=$1 ORDER BY g.id`, [id],
  )).rows : [];
  const context: Record<string, unknown> = {
    root: { kind, id, label: root[ENTITY_SPECS[kind].identityColumn] },
    instruction,
    current: compact(state, 80),
    relatedEntities: await relatedLabels(db, state),
    findings: compact(findings, 40),
    claims: compact(claims, 40),
    report,
    taxonomy: {
      columns: ["slug", "name", "level", "parentSlug"],
      rows: taxonomy.map((g) => [g.slug, g.name, g.level, g.parent]),
    },
    entityFields: Object.fromEntries(
      Object.entries(ENTITY_FIELDS).map(([k, v]) => [k, describeFields(v)]),
    ),
    relations: RELATION_ROUTES.map((r) => ({
      kind: r.kind,
      createFields: describeFields(r.create),
      updateFields: describeFields(r.update),
    })),
    evidence,
    currentGenres,
    ...(report && (report["pending"] as Array<Record<string, unknown>>).some(f => f["area"] === "genres") ? {
      genreReview: { candidates: genreReviewCandidates(evidence.filter(e => (report["pending"] as Array<{ area: string; evidenceIds: string[] }>).some(f => f.area === "genres" && f.evidenceIds.includes(e.id))), taxonomy), defaultNewRole: "secondary", roleReason: "Criterio editorial cuando la fuente no jerarquiza los géneros; conservar el principal existente." },
    } : {}),
  };
  context["narrativeOriginals"] = {
    current: Object.fromEntries(Object.entries(root).filter(([key, value]) => ["biography", "description", "notes"].includes(key) && typeof value === "string" && value.length)),
    conflicts: findings.filter((finding) => /biograph|description|bio/iu.test(`${finding.field ?? ""} ${finding.detector ?? ""}`)),
  };
  // This is the preserved research inventory, not a model prompt. The planner
  // partitions it into bounded tasks; no citation or pending fact is deleted here.
  return { context, evidence };
}
export const createPlanningBroker = () => new WebSearchBroker();
