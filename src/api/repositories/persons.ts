// CRV · Consultas de lectura para personas (PHASES §E7A/E11.7/E11.9).
import { getPool } from "../../db/client.js";
import type { PaginationQuery } from "../pagination.js";
import { searchIds } from "../search-index.js";
import { classifyPersonName, type PersonNameClass } from "../../review/person-junk.js";
import { personDeceasedSql } from "./deceased.js";
import { loadPersonFacts, scorePersonPair } from "../../review/person-candidates.js";
import { compareCatalog, type PersonComparison } from "../../review/person-comparison.js";
import { personIdentityAssessment } from "../../review/person-identity-assessment.js";

export interface PersonListRow {
  id: number;
  name: string;
  nationality: string | null;
  isVenezuelan: boolean | null;
  /** Fallecido/a: `is_deceased` o fecha de fallecimiento. */
  isDeceased: boolean;
  pictureUrl: string | null;
  /** Créditos de disco y de pista. */
  creditCount: number;
  /** Membresías de banda. */
  bandCount: number;
  /** Clasificación del nombre (E11.7): la web avisa cuando no es `ok`. */
  nameClass: PersonNameClass;
  nameClassReason: string;
}

/** Clases de «sospechosa» (E11.7); `ok` no se ofrece como filtro. */
export type PersonSuspectClass = Exclude<PersonNameClass, "ok">;

export interface PersonListQuery extends PaginationQuery {
  q?: string | undefined;
  hasCredits?: boolean | undefined;
  /** Tipo de crédito registrado, o membresía de banda. */
  role?: string | undefined;
  suspect?: PersonSuspectClass | undefined;
  sort?: "name" | "credits" | undefined;
}

const PERSON_COLUMNS = `
  p.id::text AS id, p.name, p.nationality, p.is_venezuelan, ${personDeceasedSql("p")} AS is_deceased, p.picture_url,
  ((SELECT count(*) FROM public.album_credits WHERE person_id=p.id)
   + (SELECT count(*) FROM public.track_credits WHERE person_id=p.id))::int AS credit_count,
  (SELECT count(*) FROM public.artist_members WHERE person_id=p.id)::int AS band_count`;

const HAS_ANY_RELATION = `(
  EXISTS (SELECT 1 FROM public.album_credits WHERE person_id=p.id)
  OR EXISTS (SELECT 1 FROM public.track_credits WHERE person_id=p.id)
  OR EXISTS (SELECT 1 FROM public.artist_members WHERE person_id=p.id))`;

interface PersonRowShape {
  id: string; name: string; nationality: string | null; is_venezuelan: boolean | null; is_deceased: boolean; picture_url: string | null;
  credit_count: number; band_count: number;
}

function toPersonRow(row: PersonRowShape): PersonListRow {
  const classification = classifyPersonName(row.name);
  return {
    id: Number(row.id), name: row.name, nationality: row.nationality,
    isVenezuelan: row.is_venezuelan, isDeceased: row.is_deceased, pictureUrl: row.picture_url,
    creditCount: row.credit_count, bandCount: row.band_count,
    nameClass: classification.kind, nameClassReason: classification.reason,
  };
}

/**
 * Listado con filtros. `q` se resuelve con el índice en memoria (la base no
 * pliega tildes), `suspect` se clasifica en Node (E11.7) y `sort=credits`
 * ordena por créditos + membresías descendente.
 */
export async function listPersons(query: PersonListQuery): Promise<{ rows: PersonListRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.q?.trim()) {
    const ids = await searchIds("person", query.q.trim());
    if (ids.length === 0) return { rows: [], total: 0 };
    params.push(ids);
    conditions.push(`p.id = ANY($1::bigint[])`);
  }
  if (query.hasCredits !== undefined) conditions.push(query.hasCredits ? HAS_ANY_RELATION : `NOT ${HAS_ANY_RELATION}`);
  if (query.role === "band_member") {
    conditions.push("EXISTS (SELECT 1 FROM public.artist_members WHERE person_id=p.id)");
  } else if (query.role) {
    params.push(query.role);
    const roleParam = `$${params.length}::text`;
    conditions.push(`(
      EXISTS (SELECT 1 FROM public.album_credits WHERE person_id=p.id AND credit_type::text=${roleParam})
      OR EXISTS (SELECT 1 FROM public.track_credits WHERE person_id=p.id AND credit_type::text=${roleParam}))`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const base = `SELECT ${PERSON_COLUMNS} FROM public.persons p ${where}`;

  // Solo la búsqueda añade el array de relevancia; un rol añade un parámetro de texto.
  const order = query.q?.trim()
    ? "ORDER BY array_position($1::bigint[], x.id::bigint)"
    : query.sort === "credits" ? "ORDER BY (x.credit_count + x.band_count) DESC, x.name, x.id" : "ORDER BY x.name, x.id";

  if (query.suspect) {
    // El filtro de basura es de texto (TypeScript, regla 0.1.11): se cargan
    // los nombres que cumplen el resto de filtros y se clasifican aquí.
    const all = await getPool().query<PersonRowShape>(`SELECT * FROM (${base}) x ${order}`, params);
    const matched = all.rows.filter((row) => classifyPersonName(row.name).kind === query.suspect);
    return {
      rows: matched.slice(query.offset, query.offset + query.limit).map(toPersonRow),
      total: matched.length,
    };
  }

  // El orden va en una consulta externa: PostgreSQL no admite expresiones
  // sobre los alias de salida (`ORDER BY credit_count + band_count` falla),
  // y con `q` el orden lo manda el índice (primero los que empiezan).
  const [rows, count] = await Promise.all([
    getPool().query<PersonRowShape>(
      `SELECT * FROM (${base}) x ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset]),
    getPool().query<{ count: string }>(`SELECT count(*)::text AS count FROM public.persons p ${where}`, params),
  ]);
  return { rows: rows.rows.map(toPersonRow), total: Number(count.rows[0]?.count ?? 0) };
}

/** Personas únicas por participación: varios créditos del mismo tipo cuentan una vez. */
export async function getPersonFacets(): Promise<{
  total: number;
  withoutCredits: number;
  roles: Array<{ role: string; count: number }>;
}> {
  const [counts, participation] = await Promise.all([
    getPool().query<{ total: string; without_credits: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE NOT ${HAS_ANY_RELATION})::text AS without_credits
         FROM public.persons p`,
    ),
    getPool().query<{ role: string; count: string }>(
      `WITH participation AS (
         SELECT person_id, credit_type::text AS role FROM public.album_credits WHERE person_id IS NOT NULL
         UNION
         SELECT person_id, credit_type::text AS role FROM public.track_credits WHERE person_id IS NOT NULL
         UNION
         SELECT person_id, 'band_member' AS role FROM public.artist_members
       )
       SELECT role, count(*)::text AS count FROM participation
        GROUP BY role ORDER BY count(*) DESC, role`,
    ),
  ]);
  return {
    total: Number(counts.rows[0]?.total ?? 0),
    withoutCredits: Number(counts.rows[0]?.without_credits ?? 0),
    roles: participation.rows.map((row) => ({ role: row.role, count: Number(row.count) })),
  };
}

export interface PersonDetail {
  id: number;
  name: string;
  biography: string | null;
  pictureUrl: string | null;
  nationality: string | null;
  isVenezuelan: boolean | null;
  /** Fallecido/a: `is_deceased` o fecha de fallecimiento. */
  isDeceased: boolean;
  /** Lo que dice la columna `is_deceased` (NULL = sin dato), para el formulario. */
  isDeceasedFlag: boolean | null;
  realName: string | null;
  birthCity: string | null;
  deathCause: string | null;
  trivia: string | null;
  gender: string | null;
  birthDate: string | null;
  deathDate: string | null;
  notes: string | null;
  /** Créditos de disco y de pista. */
  creditCount: number;
  /** Membresías de banda. */
  bandCount: number;
  /** Clasificación del nombre (E11.7): la web avisa cuando no es `ok`. */
  nameClass: PersonNameClass;
  nameClassReason: string;
  bands: Array<{ id: number; artistId: number; artistName: string; artistType: string; role: string; fromYear: number | null; toYear: number | null; isCurrent: boolean }>;
  albumCredits: Array<{ id: number; albumId: number; albumTitle: string; artistId: number; artistName: string; creditType: string; role: string }>;
  trackCredits: Array<{ id: number; trackId: number; trackTitle: string; albumId: number; albumTitle: string; creditType: string; role: string }>;
  organizations: Array<{ id: number; organizationId: number; organizationName: string; role: string; fromYear: number | null; toYear: number | null }>;
  aliases: Array<{ id: number; alias: string; aliasType: string; isPrimary: boolean }>;
}

export interface PersonDuplicateCandidateRow {
  comparison: PersonComparison | null;
  reviewId: number;
  a: { id: number; name: string; creditCount: number };
  b: { id: number; name: string; creditCount: number };
  priority: number;
  score: number | null;
  effectiveScore: number | null;
  scoreBlocked: string | null;
  webVerdict: "same" | "different" | "mixed" | "unknown" | null;
  webRationale: string | null;
  webEvidence: Array<{ supports: "same" | "different" | "mixed" }>;
  features: Array<{ key: string; value: number; evidence: string }>;
  notes: string | null;
  createdAt: string;
}

/** Créditos y membresías de una ficha: lo que se movería al fusionarla. */
const CREDIT_COUNT = (column: string) => `(
  (SELECT count(*) FROM public.album_credits WHERE person_id=c.${column})
  + (SELECT count(*) FROM public.track_credits WHERE person_id=c.${column})
  + (SELECT count(*) FROM public.artist_members WHERE person_id=c.${column}))::int`;

/**
 * Revisiones vivas del detector de candidatos de persona (E11.5), con nombre,
 * créditos de cada lado, score y features. Solo lectura.
 */
export async function listPersonDuplicateCandidates(
  query: PaginationQuery & { minScore?: number | undefined },
): Promise<{ rows: PersonDuplicateCandidateRow[]; total: number }> {
  const rows = await getPool().query<Record<string, unknown>>(`
      WITH candidate AS (
        SELECT q.id, q.priority, q.payload, q.notes, q.created_at::text AS created_at, q.person_a_id, q.person_b_id
          FROM ingest.review_queue q
         WHERE q.kind::text='person_duplicate' AND q.status IN ('open','in_progress')
      )
      SELECT c.id::text AS review_id, c.priority, (c.payload->>'score')::float8 AS score,
             COALESCE(c.payload->'features', '[]'::jsonb) AS features, c.notes, c.created_at,
             v.comparison, v.verdict AS web_verdict, v.rationale AS web_rationale, COALESCE(v.evidence, '[]'::jsonb) AS web_evidence,
             c.person_a_id::text AS a_id, pa.name AS a_name, ${CREDIT_COUNT("person_a_id")} AS a_credits,
             c.person_b_id::text AS b_id, pb.name AS b_name, ${CREDIT_COUNT("person_b_id")} AS b_credits
        FROM candidate c
        JOIN public.persons pa ON pa.id=c.person_a_id
        JOIN public.persons pb ON pb.id=c.person_b_id
        LEFT JOIN LATERAL (
          SELECT verdict, rationale, evidence, comparison FROM ingest.person_web_verifications
           WHERE review_id=c.id OR (person_a_id=LEAST(c.person_a_id,c.person_b_id)
             AND person_b_id=GREATEST(c.person_a_id,c.person_b_id))
           ORDER BY created_at DESC,id DESC LIMIT 1
        ) v ON TRUE
       ORDER BY c.priority DESC, c.id`);
  // El catálogo cambia después de abrir una revisión. Recalcular evita usar
  // señales antiguas (y cubre también las revisiones creadas a mano).
  const facts = new Map((await loadPersonFacts(getPool())).map((person) => [person.id, person]));
  const candidates = rows.rows.map((row) => {
      const left = facts.get(Number(row["a_id"]));
      const right = facts.get(Number(row["b_id"]));
      const current = left && right ? scorePersonPair(left, right) : null;
      const discoveryScore = current?.score ?? (row["score"] === null ? null : Number(row["score"]));
      const scoreBlocked = current?.blocked ?? null;
      const webVerdict = (row["web_verdict"] ?? null) as PersonDuplicateCandidateRow["webVerdict"];
      const webEvidence = (row["web_evidence"] ?? []) as PersonDuplicateCandidateRow["webEvidence"];
      const comparison = left && right ? compareCatalog(left, right, (row["comparison"] ?? null) as PersonComparison | null) : null;
      const score = comparison ? comparison.rows.reduce((sum, signal) => sum + signal.points, 0) / 100 : discoveryScore;
      const assessment = personIdentityAssessment(score, webVerdict ? { verdict: webVerdict, evidence: webEvidence, comparison } : null, scoreBlocked, comparison);
      const effectiveScore = assessment.score;
      return ({
      comparison,
      reviewId: Number(row["review_id"]),
      a: { id: Number(row["a_id"]), name: String(row["a_name"]), creditCount: Number(row["a_credits"]) },
      b: { id: Number(row["b_id"]), name: String(row["b_name"]), creditCount: Number(row["b_credits"]) },
      priority: Number(row["priority"]),
      score,
      effectiveScore,
      scoreBlocked,
      webVerdict,
      webRationale: (row["web_rationale"] ?? null) as string | null,
      webEvidence,
      features: current?.features ?? (row["features"] ?? []) as PersonDuplicateCandidateRow["features"],
      notes: (row["notes"] ?? null) as string | null,
      createdAt: String(row["created_at"]),
    });
    });
  const filtered = query.minScore === undefined ? candidates : candidates.filter((candidate) =>
    candidate.effectiveScore !== null && candidate.effectiveScore >= query.minScore!
    && (query.minScore! < 0.7 || personIdentityAssessment(candidate.score, candidate.webVerdict
      ? { verdict: candidate.webVerdict, evidence: candidate.webEvidence, comparison: candidate.comparison } : null,
      candidate.scoreBlocked, candidate.comparison).recommendation === "consider_merge"));
  filtered.sort((a, b) => b.priority - a.priority || (b.effectiveScore ?? -1) - (a.effectiveScore ?? -1) || a.reviewId - b.reviewId);
  return { rows: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length };
}

export async function getPersonDetail(id: number): Promise<PersonDetail | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.biography, p.picture_url, p.nationality, p.is_venezuelan,
            ${personDeceasedSql("p")} AS is_deceased, p.is_deceased AS is_deceased_flag,
            p.birth_date::text AS birth_date, p.death_date::text AS death_date, p.notes,
            p.real_name, p.birth_city, p.death_cause, p.trivia, p.gender,
            ((SELECT count(*) FROM public.album_credits WHERE person_id=p.id)
             + (SELECT count(*) FROM public.track_credits WHERE person_id=p.id))::int AS credit_count,
            (SELECT count(*) FROM public.artist_members WHERE person_id=p.id)::int AS band_count,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', am.id, 'artistId', ar.id, 'artistName', ar.name, 'artistType', ar.artist_type, 'role', am.role,
           'fromYear', am.from_year, 'toYear', am.to_year, 'isCurrent', am.is_current
         ) ORDER BY am.from_year NULLS LAST, ar.name)
         FROM public.artist_members am JOIN public.artists ar ON ar.id = am.artist_id
         WHERE am.person_id = p.id
       ), '[]'::jsonb) AS bands,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', ac.id, 'albumId', al.id, 'albumTitle', al.title, 'artistId', ar2.id, 'artistName', ar2.name,
           'creditType', ac.credit_type, 'role', ac.role
         ) ORDER BY al.title)
         FROM public.album_credits ac
         JOIN public.albums al ON al.id = ac.album_id
         JOIN public.artists ar2 ON ar2.id = al.artist_id
         WHERE ac.person_id = p.id
       ), '[]'::jsonb) AS album_credits,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', tc.id, 'trackId', t.id, 'trackTitle', t.title, 'albumId', al3.id, 'albumTitle', al3.title,
           'creditType', tc.credit_type, 'role', tc.role
         ) ORDER BY al3.title, t.disc_number, t.track_number)
         FROM public.track_credits tc
         JOIN public.tracks t ON t.id = tc.track_id
         JOIN public.albums al3 ON al3.id = t.album_id
         WHERE tc.person_id = p.id
       ), '[]'::jsonb) AS track_credits,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', po.id, 'organizationId', o.id, 'organizationName', o.name, 'role', po.role,
           'fromYear', po.from_year, 'toYear', po.to_year
         ) ORDER BY o.name)
         FROM public.person_organizations po JOIN public.organizations o ON o.id = po.organization_id
         WHERE po.person_id = p.id
       ), '[]'::jsonb) AS organizations,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', x.id, 'alias', x.alias, 'aliasType', x.alias_type, 'isPrimary', x.is_primary))
         FROM ingest.person_aliases x WHERE x.person_id = p.id
       ), '[]'::jsonb) AS aliases
     FROM public.persons p
     WHERE p.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  // El veredicto sobre el nombre se calcula aquí (no en la web): un solo
  // clasificador alimenta el filtro, el aviso y el plan de correcciones.
  const classification = classifyPersonName(String(row["name"]));
  return {
    id: Number(row["id"]),
    name: row["name"] as string,
    biography: row["biography"] as string | null,
    pictureUrl: row["picture_url"] as string | null,
    nationality: row["nationality"] as string | null,
    isVenezuelan: row["is_venezuelan"] as boolean | null,
    isDeceased: row["is_deceased"] as boolean,
    isDeceasedFlag: row["is_deceased_flag"] as boolean | null,
    realName: row["real_name"] as string | null,
    birthCity: row["birth_city"] as string | null,
    deathCause: row["death_cause"] as string | null,
    trivia: row["trivia"] as string | null,
    gender: row["gender"] as string | null,
    birthDate: row["birth_date"] as string | null,
    deathDate: row["death_date"] as string | null,
    notes: row["notes"] as string | null,
    creditCount: Number(row["credit_count"] ?? 0),
    bandCount: Number(row["band_count"] ?? 0),
    nameClass: classification.kind,
    nameClassReason: classification.reason,
    bands: row["bands"] as PersonDetail["bands"],
    albumCredits: row["album_credits"] as PersonDetail["albumCredits"],
    trackCredits: row["track_credits"] as PersonDetail["trackCredits"],
    organizations: row["organizations"] as PersonDetail["organizations"],
    aliases: row["aliases"] as PersonDetail["aliases"],
  };
}
