// CRV · Edición de series por la administración: la serie, sus entregas y la
// pertenencia de un disco. Las lecturas viven bajo /catalog-editor (solo
// administración) e incluyen las series que no cumplen la regla pública.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../../db/client.js";
import {
  SERIES_KINDS, deleteSeries, deleteSeriesEntry, listSeriesForEditor, readAlbumSeries, readSeriesForEditor, writeSeries, writeSeriesEntry,
} from "../../catalog/series.js";
import { withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { writeErrorResponses } from "../schemas.js";
import { noteSchema } from "./catalog-writes.js";

const id = z.coerce.number().int().positive();
const positive = z.number().int().positive();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const seriesShape = z.object({
  title: z.string().trim().min(1).max(250),
  kind: z.enum(SERIES_KINDS),
  description: optionalText(20_000),
  notes: optionalText(20_000),
  artistId: positive.nullable().optional(),
  organizationId: positive.nullable().optional(),
});
const entryShape = z.object({
  albumId: positive,
  // NUMERIC(6,2): 1, 2, 10 o 2.5 para una entrega intermedia documentada.
  volumeNumber: z.number().min(0).max(9999.99).multipleOf(0.01).nullable().optional(),
  volumeLabel: z.string().trim().max(40).nullable().optional(),
});
const written = { 200: z.object({ id: positive, runId: positive }), ...writeErrorResponses };
const privateRead = { security: OPERATOR_SECURITY, tags: ["series-editor"] };

export async function registerSeriesEditorRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/catalog-editor/series", {
    schema: { ...privateRead, querystring: z.object({
      q: z.string().trim().max(200).optional(), status: z.enum(["all", "public", "hidden"]).default("all"),
      limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
    }), response: { 200: z.unknown(), ...writeErrorResponses } },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const result = await listSeriesForEditor(getPool(), request.query);
    return { data: result.rows, pagination: { total: result.total, limit: request.query.limit, offset: request.query.offset } };
  });

  server.get("/catalog-editor/series/:id", {
    schema: { ...privateRead, params: z.object({ id }), response: { 200: z.unknown(), ...writeErrorResponses } },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readSeriesForEditor(getPool(), request.params.id);
  });

  server.get("/catalog-editor/album/:albumId/series", {
    schema: { ...privateRead, params: z.object({ albumId: id }), response: { 200: z.unknown(), ...writeErrorResponses } },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return readAlbumSeries(getPool(), request.params.albumId);
  });

  server.post("/catalog-editor/series", {
    schema: { ...privateRead, body: seriesShape.extend({ note: noteSchema }).strict(), response: written },
  }, async (request) => {
    const { note, ...input } = request.body;
    const result = await withOperatorRun({ name: "api:series:create", operator: request.operator, note }, (ctx) => writeSeries(ctx, input));
    return { id: result.result, runId: result.runId };
  });

  server.patch("/catalog-editor/series/:id", {
    schema: { ...privateRead, params: z.object({ id }), body: seriesShape.partial().extend({ note: noteSchema }).strict(), response: written },
  }, async (request) => {
    const { note, ...input } = request.body;
    const result = await withOperatorRun({ name: "api:series:update", operator: request.operator, note }, (ctx) => writeSeries(ctx, input, request.params.id));
    return { id: result.result, runId: result.runId };
  });

  server.delete("/catalog-editor/series/:id", {
    schema: { ...privateRead, params: z.object({ id }), querystring: z.object({ note: noteSchema }), response: written },
  }, async (request) => {
    const result = await withOperatorRun({ name: "api:series:delete", operator: request.operator, note: request.query.note }, (ctx) => deleteSeries(ctx, request.params.id));
    return { id: result.result, runId: result.runId };
  });

  server.post("/catalog-editor/series/:id/entries", {
    schema: { ...privateRead, params: z.object({ id }), body: entryShape.extend({ note: noteSchema }).strict(), response: written },
  }, async (request) => {
    const { note, ...input } = request.body;
    const result = await withOperatorRun({ name: "api:series:add-entry", operator: request.operator, note }, (ctx) => writeSeriesEntry(ctx, request.params.id, input));
    return { id: result.result, runId: result.runId };
  });

  server.patch("/catalog-editor/series/:id/entries/:entryId", {
    schema: { ...privateRead, params: z.object({ id, entryId: id }), body: entryShape.omit({ albumId: true }).extend({ note: noteSchema }).strict(), response: written },
  }, async (request) => {
    const { note, ...input } = request.body;
    const result = await withOperatorRun({ name: "api:series:update-entry", operator: request.operator, note },
      (ctx) => writeSeriesEntry(ctx, request.params.id, input, request.params.entryId));
    return { id: result.result, runId: result.runId };
  });

  server.delete("/catalog-editor/series/:id/entries/:entryId", {
    schema: { ...privateRead, params: z.object({ id, entryId: id }), querystring: z.object({ note: noteSchema }), response: written },
  }, async (request) => {
    const result = await withOperatorRun({ name: "api:series:remove-entry", operator: request.operator, note: request.query.note },
      (ctx) => deleteSeriesEntry(ctx, request.params.id, request.params.entryId));
    return { id: result.result, runId: result.runId };
  });
}
