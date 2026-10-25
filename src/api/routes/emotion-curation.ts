import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { ApiError } from "../http-errors.js";
import { EMOTION_VALUES } from "../repositories/emotions.js";
import { writeErrorResponses } from "../schemas.js";

const categorySchema = z.enum(["no_expresa_emocion", ...EMOTION_VALUES]);
const tagSchema = z.object({
  tag: z.string(), suggested: z.string(), probability: z.number().nullable(),
  category: categorySchema.nullable(), uses: z.number().int(), weight: z.number().int(),
  artists: z.array(z.object({ id: z.number().int(), name: z.string(), weight: z.number().int() })),
  decidedBy: z.string().nullable(), decidedAt: z.string().nullable(), note: z.string().nullable(),
});
const listSchema = z.object({ data: z.array(tagSchema), total: z.number().int(), pending: z.number().int() });
const querySchema = z.object({
  status: z.enum(["pending", "reviewed", "all"]).default("pending"),
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function registerEmotionCurationRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/curation/emotions/tags", {
    schema: { tags: ["curation"], querystring: querySchema, response: { 200: listSchema } },
  }, async (request, reply) => {
    const { status, q, limit, offset } = request.query;
    const pool = getPool();
    const base = `WITH tags AS (
      SELECT lower(tag) AS tag_key, min(tag) AS tag,
             count(*)::int AS uses, sum(weight)::int AS weight,
             max(emotions->>'categoria') AS suggested,
             max((emotions->>'p')::real) AS probability
        FROM public.entity_user_tags GROUP BY lower(tag)
    ), cases AS (
      SELECT t.*, d.category, d.note, d.decided_by, d.decided_at
        FROM tags t LEFT JOIN ingest.emotion_tag_decisions d ON d.tag_key = t.tag_key
       WHERE ($1::text = '' OR t.tag_key LIKE '%' || lower($1) || '%')
         AND ($2::text = 'all' OR ($2 = 'reviewed') = (d.tag_key IS NOT NULL))
    )`;
    const { rows: countRows } = await pool.query<{ total: string; pending: string }>(
      `${base} SELECT (SELECT count(*)::text FROM cases) AS total,
              (SELECT count(*)::text FROM tags t LEFT JOIN ingest.emotion_tag_decisions d ON d.tag_key=t.tag_key WHERE d.tag_key IS NULL) AS pending`, [q, status],
    );
    const { rows } = await pool.query<{
      tag: string; suggested: string; probability: number | null; category: z.infer<typeof categorySchema> | null;
      uses: number; weight: number; artists: { id: number; name: string; weight: number }[];
      decided_by: string | null; decided_at: Date | null; note: string | null;
    }>(`${base}
      SELECT c.tag, coalesce(c.suggested, 'no_expresa_emocion') AS suggested,
             c.probability, c.category, c.uses, c.weight, c.decided_by, c.decided_at, c.note,
             coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'weight', u.weight))
               FROM (SELECT a.id, a.name, t.weight FROM public.entity_user_tags t
                     JOIN public.artists a ON a.id=t.artist_id
                    WHERE lower(t.tag)=c.tag_key
                      AND t.source='lastfm'
                      AND EXISTS (SELECT 1 FROM ingest.lastfm_artist_verifications v WHERE v.artist_id=a.id)
                    ORDER BY t.weight DESC, a.id LIMIT 3) u), '[]'::jsonb) AS artists
        FROM cases c
       ORDER BY CASE WHEN c.suggested NOT IN ('no_expresa_emocion', 'dudoso') THEN 0
                     WHEN c.suggested = 'dudoso' THEN 1 ELSE 2 END,
                c.weight DESC, c.tag_key
       LIMIT $3 OFFSET $4`, [q, status, limit, offset]);
    reply.header("Cache-Control", "no-store");
    return { data: rows.map((row) => ({
      tag: row.tag, suggested: row.suggested, probability: row.probability,
      category: row.category, uses: row.uses, weight: row.weight, artists: row.artists,
      decidedBy: row.decided_by, decidedAt: row.decided_at?.toISOString() ?? null, note: row.note,
    })), total: Number(countRows[0]?.total ?? 0), pending: Number(countRows[0]?.pending ?? 0) };
  });

  api.post("/curation/emotions/tags/decision", {
    schema: {
      tags: ["curation"], security: OPERATOR_SECURITY,
      body: z.object({ tag: z.string().trim().min(1).max(250), category: categorySchema, note: z.string().trim().max(500).default("") }).strict(),
      response: { 200: z.object({ saved: z.literal(true) }), ...writeErrorResponses },
    },
  }, async (request) => {
    const { tag, category, note } = request.body;
    const tagKey = tag.toLowerCase();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query("SELECT 1 FROM public.entity_user_tags WHERE lower(tag)=$1 LIMIT 1", [tagKey]);
      if (!exists.rowCount) throw new ApiError(404, "tag_missing", "La etiqueta ya no existe en la cosecha");
      await client.query(`INSERT INTO ingest.emotion_tag_decisions(tag_key,category,note,decided_by)
        VALUES ($1,$2,$3,$4) ON CONFLICT(tag_key) DO UPDATE SET category=EXCLUDED.category,
        note=EXCLUDED.note, decided_by=EXCLUDED.decided_by, decided_at=now()`, [tagKey, category, note, request.operator]);
      await client.query(`UPDATE public.entity_user_tags SET emotions=coalesce(emotions,'{}'::jsonb)
        || jsonb_build_object('categoria',$2::text,'decision','editorial') WHERE lower(tag)=$1`, [tagKey, category]);
      await client.query("DELETE FROM public.entity_emotions WHERE basis='tags'");
      await client.query(`INSERT INTO public.entity_emotions(artist_id,emotion,basis,score,evidence,detail,model_version)
        SELECT artist_id, emotions->>'categoria', 'tags', sum(weight)::real, count(*)::int,
               jsonb_build_object('tags', jsonb_agg(jsonb_build_object('tag',tag,'weight',weight) ORDER BY weight DESC)),
               'laya-editorial-v1'
          FROM public.entity_user_tags
         WHERE artist_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM ingest.lastfm_artist_verifications v WHERE v.artist_id=entity_user_tags.artist_id)
           AND emotions->>'categoria' IN (${EMOTION_VALUES.map((_, i) => `$${i + 1}`).join(",")})
         GROUP BY artist_id, emotions->>'categoria'`, [...EMOTION_VALUES]);
      await client.query("COMMIT");
      return { saved: true as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
