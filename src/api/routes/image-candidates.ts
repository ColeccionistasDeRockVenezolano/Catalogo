// CRV · Curaduría: elegir portada o foto de artista a ojo (Brian, 2026-10-04).
//
// `ingest.image_candidates` (0038) guarda, por ficha, imágenes candidatas que
// nadie aplicó solo: portadas dudosas de la mejora de portadas y fotos de
// artista alternativas. Aquí se listan agrupadas por ficha y se decide:
// usar una candidata (escribe cover_url/picture_url por el motor, con
// auditoría) o dejar la actual (solo cierra las candidatas). Cada decisión es
// un run de operador que `POST /changes/:run/undo` deshace entero.
//
// Lecturas solo admin (ADMIN_READS cubre `/curation`); escrituras con la
// guarda de sesión admin + CSRF o el token de operador.
import path from "node:path";
import { registerImageJobRoutes } from "./image-curation-jobs.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import { OperatorError, withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { paginationQuerySchema } from "../pagination.js";
import { writeErrorResponses } from "../schemas.js";
import { noteSchema } from "./catalog-writes.js";
import { fingerprintDistance } from "../../verification/image-quality.js";
import { inspectImageCandidates, type downloadImage } from "../../merge/image-inspection.js";
import { decideImage } from "../../merge/image-decisions.js";
import { createDeepSeekGateway } from "../../ai/gateway.js";
import { createVisionClassifier, type VisionClassifier } from "../../verification/image-vision.js";

const KINDS = ["album", "artist"] as const;
type ImageKind = (typeof KINDS)[number];
const ID_COLUMN: Record<ImageKind, "album_id" | "artist_id"> = { album: "album_id", artist: "artist_id" };

const candidateSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  source: z.string(),
  pageUrl: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  score: z.number().nullable(),
  /** Inspección al descargar (0090); null mientras no se haya inspeccionado. */
  naturalWidth: z.number().int().nullable(),
  naturalHeight: z.number().int().nullable(),
  effectiveWidth: z.number().int().nullable(),
  quality: z.enum(["high", "medium", "low", "failed"]).nullable(),
  use: z.string().nullable(),
  reasons: z.array(z.string()),
  /** Cómo describe la página esta imagen (pie, alt, «Imagen: …»), cuando se conoce (0091). */
  context: z.string().nullable(),
  /** Candidatas con la misma huella perceptual: variantes de una misma imagen. */
  variantOf: z.number().int().nullable(),
});

const groupSchema = z.object({
  kind: z.enum(KINDS),
  entityId: z.number().int(),
  name: z.string(),
  subtitle: z.string().nullable(),
  /** La imagen que la ficha muestra hoy. */
  currentUrl: z.string().nullable(),
  /** La ficha cambió de imagen desde que se propusieron las candidatas. */
  stale: z.boolean(),
  candidates: z.array(candidateSchema),
});

const listQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(KINDS).default("album"),
  entityId: z.coerce.number().int().positive().optional().describe("Solo las candidatas de esta ficha"),
  artistId: z.coerce.number().int().positive().optional().describe("Con kind=album, solo las portadas de los discos de este artista"),
});
const decideParamsSchema = z.object({ kind: z.enum(KINDS), id: z.coerce.number().int().positive() });
const decideBodySchema = z.object({
  candidateId: z.number().int().positive().nullable()
    .describe("Candidata elegida; null = dejar la imagen actual y descartar todas."),
  note: noteSchema.optional(),
}).strict();

interface GroupRow {
  entity_id: string; name: string; subtitle: string | null; current_url: string | null; proposed_url: string | null;
  candidates: Array<{ id: number; url: string; source: string; pageUrl: string | null; width: number | null; height: number | null; score: string | number | null;
    naturalWidth: number | null; naturalHeight: number | null; effectiveWidth: number | null; quality: "high" | "medium" | "low" | "failed" | null; use: string | null; reasons: string[] | null; context: string | null; fingerprint: string | null }>;
}

const ENTITY_SQL: Record<ImageKind, { join: string; name: string; subtitle: string; current: string }> = {
  album: {
    join: "JOIN public.albums e ON e.id = c.album_id JOIN public.artists ar ON ar.id = e.artist_id",
    name: "e.title",
    subtitle: "ar.name || COALESCE(' · ' || e.release_year::text, '')",
    current: "e.cover_url",
  },
  artist: { join: "JOIN public.artists e ON e.id = c.artist_id", name: "e.name", subtitle: "NULL::text", current: "e.picture_url" },
};

/** The chosen original is kept under media/curated, served like uploads by the gateway and Vite. */
export async function registerImageCandidateRoutes(app: FastifyInstance, options: { mediaRoot?: string; download?: typeof downloadImage; vision?: VisionClassifier; worker?: boolean } = {}): Promise<void> {
  const mediaRoot = options.mediaRoot ?? path.resolve("web/public/media");
  const server = app.withTypeProvider<ZodTypeProvider>();
  await registerImageJobRoutes(app, options);

  server.get("/curation/images/summary", {
    schema: {
      tags: ["curation"],
      summary: "Fichas con imágenes candidatas pendientes de elegir, por tipo",
      response: { 200: z.object({ album: z.number().int(), artist: z.number().int() }) },
    },
  }, async () => {
    const { rows } = await getPool().query<{ album: string; artist: string }>(`
      SELECT count(DISTINCT album_id) FILTER (WHERE status = 'open')::text AS album,
             count(DISTINCT artist_id) FILTER (WHERE status = 'open')::text AS artist
        FROM ingest.image_candidates`);
    return { album: Number(rows[0]?.album ?? 0), artist: Number(rows[0]?.artist ?? 0) };
  });

  server.get("/curation/images", {
    schema: {
      tags: ["curation"],
      summary: "Imágenes candidatas pendientes agrupadas por ficha (mejor parecido primero)",
      querystring: listQuerySchema,
      response: {
        200: z.object({
          data: z.array(groupSchema),
          pagination: z.object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() }),
        }),
      },
    },
  }, async (request) => {
    const { kind, limit, offset, entityId, artistId } = request.query;
    const sql = ENTITY_SQL[kind];
    const column = ID_COLUMN[kind];
    const { rows } = await getPool().query<GroupRow & { total: string }>(`
      SELECT c.${column}::text AS entity_id, ${sql.name} AS name, ${sql.subtitle} AS subtitle,
             ${sql.current} AS current_url, min(c.current_url) AS proposed_url,
             jsonb_agg(jsonb_build_object('id', c.id, 'url', c.candidate_url, 'source', c.source, 'pageUrl', c.page_url,
                                          'width', c.width, 'height', c.height, 'score', c.score,
                                          'naturalWidth', c.natural_width, 'naturalHeight', c.natural_height, 'effectiveWidth', c.effective_width,
                                          'quality', c.quality, 'use', c.image_use, 'reasons', c.inspection_reasons, 'context', c.image_context, 'fingerprint', c.fingerprint)
                       ORDER BY CASE c.quality WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 3 WHEN 'failed' THEN 4 ELSE 2 END,
                                c.score DESC NULLS LAST, (COALESCE(c.effective_width, c.width)::bigint*COALESCE(c.natural_height, c.height)::bigint) DESC NULLS LAST, c.id) AS candidates,
             count(*) OVER ()::text AS total
        FROM ingest.image_candidates c
        ${sql.join}
       WHERE c.entity_kind = $1 AND c.status = 'open' AND ($4::bigint IS NULL OR c.${column} = $4)
         AND ($5::bigint IS NULL OR ${kind === "album" ? "e.artist_id = $5" : "c.artist_id = $5"})
       GROUP BY c.${column}, ${sql.name}, ${sql.subtitle}, ${sql.current}
       ORDER BY max(c.score) DESC NULLS LAST, ${sql.name}
       LIMIT $2 OFFSET $3`, [kind, limit, offset, entityId ?? null, artistId ?? null]);
    return {
      data: rows.map((row) => ({
        kind,
        entityId: Number(row.entity_id),
        name: row.name,
        subtitle: row.subtitle,
        currentUrl: row.current_url,
        stale: row.proposed_url !== row.current_url,
        candidates: row.candidates.map(({ fingerprint, ...candidate }, index) => ({
          ...candidate, score: candidate.score === null ? null : Number(candidate.score), reasons: candidate.reasons ?? [],
          variantOf: fingerprint ? row.candidates.slice(0, index).find((other) => other.fingerprint && fingerprintDistance(other.fingerprint, fingerprint) <= 10)?.id ?? null : null,
        })),
      })),
      pagination: { limit, offset, total: Number(rows[0]?.total ?? 0) },
    };
  });

  server.post("/curation/images/:kind/:id/decide", {
    schema: {
      tags: ["curation"],
      summary: "Usa una imagen candidata (o deja la actual) y cierra las candidatas de la ficha; un run que se puede deshacer",
      security: OPERATOR_SECURITY,
      params: decideParamsSchema,
      body: decideBodySchema,
      response: {
        200: z.object({ runId: z.number().int(), kind: z.enum(KINDS), entityId: z.number().int(), chosenUrl: z.string().nullable() }),
        ...writeErrorResponses,
      },
    },
  }, async (request) => {
    const { kind, id } = request.params;
    const { candidateId } = request.body;
    return decideImage({ kind, id, candidateId, operator: request.operator, ...(request.body.note ? { note: request.body.note } : {}) }, { mediaRoot, ...(options.download ? { download: options.download } : {}) });
  });

  // Plan 20/20, etapa 3: descargar y medir las candidatas antes de decidir (0090).
  server.post("/curation/images/inspect", {
    schema: {
      tags: ["curation"],
      summary: "Descarga e inspecciona candidatas pendientes (calidad, uso, variantes); no cambia ninguna ficha",
      security: OPERATOR_SECURITY,
      body: z.object({
        ids: z.array(z.number().int().positive()).max(100).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        // Visual reading (DeepSeek, budgeted) for images whose context does not say what they show.
        vision: z.boolean().default(false),
      }).strict(),
      response: {
        200: z.object({ runId: z.number().int(), inspected: z.number().int(), failed: z.number().int(), visual: z.number().int() }),
        ...writeErrorResponses,
      },
    },
  }, async (request) => {
    const { ids, limit, vision } = request.body;
    const classifier = vision ? (options.vision ?? createVisionClassifier(createDeepSeekGateway())) : undefined;
    const { runId, result } = await withOperatorRun({
      name: "image_inspection", operator: request.operator, note: "Curaduría: inspección de imágenes candidatas", params: { ids: ids ?? null, limit, vision },
    }, (context) => inspectImageCandidates(context, { ...(ids ? { ids } : {}), limit, ...(classifier ? { vision: classifier } : {}) }));
    return { runId, ...result };
  });

  // «Dejar las actuales en esta página» (Brian, 2026-10-04): descarta de una vez
  // las candidatas de varias fichas; la imagen de cada ficha no cambia. Un run.
  server.post("/curation/images/:kind/keep-current", {
    schema: {
      tags: ["curation"],
      summary: "Deja la imagen actual en varias fichas y descarta sus candidatas; un run que se puede deshacer",
      security: OPERATOR_SECURITY,
      params: z.object({ kind: z.enum(KINDS) }),
      body: z.object({ entityIds: z.array(z.number().int().positive()).min(1).max(100), note: noteSchema.optional() }).strict(),
      response: {
        200: z.object({ runId: z.number().int(), kind: z.enum(KINDS), entities: z.number().int(), candidates: z.number().int() }),
        ...writeErrorResponses,
      },
    },
  }, async (request) => {
    const { kind } = request.params;
    const entityIds = [...new Set(request.body.entityIds)];
    const label = kind === "album" ? "portada" : "foto de artista";
    const note = request.body.note ?? `Curaduría: se deja la ${label} actual en ${entityIds.length} fichas y se descartan sus candidatas`;
    const { runId, result } = await withOperatorRun({
      name: "image_choice_bulk", operator: request.operator, note, params: { kind, entityIds },
    }, async (context) => {
      const column = ID_COLUMN[kind];
      const closed = await context.client.query<{ entity_id: string }>(`
        UPDATE ingest.image_candidates
           SET status = 'rejected', decided_by = $3, decided_at = now(), decision_run_id = $4
         WHERE entity_kind = $1 AND ${column} = ANY($2::bigint[]) AND status = 'open'
        RETURNING ${column}::text AS entity_id`, [kind, entityIds, context.operator, context.runId]);
      if (closed.rows.length === 0) throw new OperatorError("not_open", "Estas fichas ya no tienen imágenes candidatas pendientes.", { kind });
      return { entities: new Set(closed.rows.map((row) => row.entity_id)).size, candidates: closed.rows.length };
    });
    return { runId, kind, ...result };
  });
}
