import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { GALLERY_CATEGORIES } from "../../shared/artist-gallery.js";
import { withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { notFound } from "../http-errors.js";
import { noteSchema } from "./catalog-writes.js";

const optionalText = (max: number) => z.string().trim().max(max).nullable().transform(value => value || null);
const imageUrl = z.string().trim().min(1).max(2000).refine(value => {
  if (/^\/crv\/media\/[a-zA-Z0-9/_\-.]+$/u.test(value) && !value.includes("..")) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "Usa una URL de imagen HTTP(S) o una imagen subida al catálogo.");
export const galleryPhotoInputSchema = z.object({
  imageUrl, category: z.enum(GALLERY_CATEGORIES), title: optionalText(300), description: optionalText(5000),
  date: z.string().date().nullable(), location: optionalText(300),
}).strict();
// Lectura tolerante: un image_url heredado o importado con otro formato no debe
// tumbar la ficha entera (pasó el 2026-10-24: 486 artistas devolvían 500). El
// formato se exige al escribir (galleryPhotoInputSchema), no al servir.
export const galleryPhotoSchema = galleryPhotoInputSchema.extend({
  id: z.number().int(),
  imageUrl: z.string().trim().min(1).max(2000),
});
const params = z.object({ id: z.coerce.number().int().positive(), photoId: z.coerce.number().int().positive() });
const mutation = z.object({ runId: z.number().int() });

export async function registerArtistGalleryRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post("/artists/:id/gallery", {
    schema: { tags: ["artists"], security: OPERATOR_SECURITY, params: params.omit({ photoId: true }),
      body: z.object({ photos: z.array(galleryPhotoInputSchema).min(1).max(100), note: noteSchema }).strict(),
      response: { 201: mutation.extend({ ids: z.array(z.number().int()) }) } },
  }, async (request, reply) => {
    const { runId, result } = await withOperatorRun({ name: "api:create:artist-gallery", operator: request.operator,
      note: request.body.note, params: { artistId: request.params.id } }, async ({ client }) => {
      const artist = await client.query("SELECT id FROM ingest.catalog_artists WHERE id=$1 FOR KEY SHARE", [request.params.id]);
      if (!artist.rowCount) throw notFound("Artista", request.params.id);
      const ids: number[] = [];
      for (const photo of request.body.photos) {
        const result = await client.query<{ id: string }>(`INSERT INTO media.artist_gallery
          (artist_id,image_url,category,title,description,photo_date,location) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [request.params.id, photo.imageUrl, photo.category, photo.title, photo.description, photo.date, photo.location]);
        ids.push(Number(result.rows[0]!.id));
      }
      return ids;
    });
    return reply.code(201).send({ runId, ids: result });
  });
  api.patch("/artists/:id/gallery/:photoId", {
    schema: { tags: ["artists"], security: OPERATOR_SECURITY, params,
      body: galleryPhotoInputSchema.extend({ note: noteSchema }), response: { 200: mutation } },
  }, async request => {
    const { runId } = await withOperatorRun({ name: "api:update:artist-gallery", operator: request.operator,
      note: request.body.note, params: { artistId: request.params.id } }, async ({ client }) => {
      const p = request.body;
      const result = await client.query(`UPDATE media.artist_gallery SET image_url=$3,category=$4,title=$5,
        description=$6,photo_date=$7,location=$8,updated_at=now() WHERE artist_id=$1 AND id=$2 RETURNING id`,
      [request.params.id, request.params.photoId, p.imageUrl, p.category, p.title, p.description, p.date, p.location]);
      if (!result.rowCount) throw notFound("Foto", request.params.photoId);
    });
    return { runId };
  });
  api.delete("/artists/:id/gallery/:photoId", {
    schema: { tags: ["artists"], security: OPERATOR_SECURITY, params,
      querystring: z.object({ note: noteSchema }), response: { 200: mutation } },
  }, async request => {
    const { runId } = await withOperatorRun({ name: "api:delete:artist-gallery", operator: request.operator,
      note: request.query.note, params: { artistId: request.params.id } }, async ({ client }) => {
      const result = await client.query("DELETE FROM media.artist_gallery WHERE artist_id=$1 AND id=$2 RETURNING id",
        [request.params.id, request.params.photoId]);
      if (!result.rowCount) throw notFound("Foto", request.params.photoId);
    });
    return { runId };
  });
}
