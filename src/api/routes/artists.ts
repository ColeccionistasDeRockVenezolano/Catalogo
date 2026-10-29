import { galleryPhotoSchema } from "./artist-gallery.js";
import { documentSchema } from "./artist-documents.js";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { catalogSortSchema } from "../catalog-sort.js";
import { dailyCycleSchema, dailyDateSchema } from "../daily-cycle.js";
import { artistTypeEnum } from "../../db/schema/core.js";
import { getTypeFacets } from "../repositories/type-facets.js";
import { paginationQuerySchema, toPage } from "../pagination.js";
import {
  idParamSchema, aliasSchema, decadeListFilterSchema, decadeFacetsSchema, genreListFilterSchema, genreStatusSchema, paginatedResponseSchema, publicGenreSchema,
} from "../schemas.js";
import { getArtistDetail, listArtists } from "../repositories/artists.js";
import { RELATED_RULES, SIMILAR_RULES } from "../repositories/artist-neighbors.js";
import { notFoundEntity } from "../repositories/redirects.js";
import { layaDecidedIds } from "../../genres/public.js";
import { varyOnCookie } from "./albums.js";
import { AUDIOVISUAL_KINDS } from "../../youtube/audiovisual-rules.js";

const artistBaseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  artistType: z.string(),
  artistGroup: z.string().describe("Banda, solista o dúo para el público (band, solo_artist, duo): agrupa Agrupación y Proyecto por número de integrantes."),
  originCity: z.string().nullable(),
  originCountry: z.string(),
  formedYear: z.number().int().nullable(),
  disbandedYear: z.number().int().nullable(),
  pictureUrl: z.string().nullable(),
  isDeceased: z.boolean().describe("Su proyecto es de una persona fallecida (titular o único integrante)."),
  primaryGenre: publicGenreSchema.nullable(),
  genreStatus: genreStatusSchema,
});

const artistListItemSchema = artistBaseSchema.extend({
  /** Solo con sesión iniciada: el género principal lo eligió Laya (o vino de discos cuyo único origen fue Laya). */
  genreByLaya: z.boolean().optional(),
});

const discographyItemSchema = z.object({
  albumId: z.number().int(), title: z.string(), releaseYear: z.number().int().nullable(),
  albumType: z.string(), coverUrl: z.string().nullable(), genres: z.array(publicGenreSchema),
  isLive: z.boolean().describe("Álbum en vivo, o sencillo/EP/demo/compilado con la clasificación «En vivo»."),
  isBSides: z.boolean().describe("B-Sides: clasificación de la hoja o «B-Side(s)» en el título."),
  classifications: z.array(z.object({ classification: z.string() })),
  editionTypes: z.array(z.string()),
});

const artistDetailSchema = artistBaseSchema.extend({
  documents: z.array(documentSchema),
  gallery: z.array(galleryPhotoSchema),
  audiovisuals: z.array(z.object({
    id: z.number().int(), title: z.string(), releaseYear: z.number().int().nullable(), kind: z.enum(AUDIOVISUAL_KINDS), tags:z.array(z.string()).optional(),
    description: z.string().nullable(), videoId: z.string().nullable(), url: z.string().nullable(),
    thumbnailUrl: z.string().nullable(), durationSeconds: z.number().int().nullable(), publicationStatus: z.string(), playable: z.boolean(), publishedAt: z.string().nullable(),
    chapters: z.array(z.object({ title: z.string(), startSeconds: z.number().int().nonnegative() })),
  })),
  dailyCycle: dailyCycleSchema,
  channelVideo: z.object({ date: dailyDateSchema, videoId: z.string(), url: z.string(), title: z.string().nullable(), count: z.number().int().positive() }).nullable(),
  playbackAlbums: z.array(z.object({albumId:z.number().int(),albumTitle:z.string(),platform:z.string(),url:z.string(),externalId:z.string().nullable().optional()})),
  biography: z.string().nullable(),
  logoUrl: z.string().nullable(),
  status: z.string().nullable(),
  themes: z.string().nullable(),
  yearsActive: z.string().nullable(),
  currentCity: z.string().nullable().describe("Ubicación actual del artista (campo «Currently» de RYM), p. ej. «Miami, FL». Su análogo de origen es originCity."),
  currentCountry: z.string().nullable().describe("País de la ubicación actual, p. ej. «United States»."),
  email: z.string().nullable().describe("Correo de contacto declarado por el artista o su perfil oficial."),
  notes: z.string().nullable(),
  members: z.array(z.object({
    id: z.number().int(), personId: z.number().int(), personName: z.string(), personDisplayName: z.string().nullable(), personRealName: z.string().nullable(), personIsDeceased: z.boolean(), role: z.string(),
    // Fechas de la persona: la ficha de un proyecto solista las muestra como suyas.
    personBirthDate: z.string().nullable(), personBirthCity: z.string().nullable(), personDeathDate: z.string().nullable(),
    fromYear: z.number().int().nullable(), toYear: z.number().int().nullable(), isCurrent: z.boolean(),
    isFounder: z.boolean().nullable(), founderEvidence: z.string().nullable(), instruments: z.array(z.string()),
  })),
  discography: z.array(discographyItemSchema),
  appearsOn: z.array(discographyItemSchema.extend({
    ownerId: z.number().int(), ownerName: z.string(),
    kind: z.enum(["compilation", "collaboration"]).describe("Compilado o titular Various Artists; si no, disco de otro artista donde colabora."),
    tracks: z.array(z.string()).describe("Pistas en las que figura; vacío si el crédito es del disco entero."),
  })).describe("«Aparece en»: discos de otros titulares donde suena, calculados desde sus créditos."),
  aliases: z.array(aliasSchema),
  genres: z.array(publicGenreSchema),
  links: z.array(z.object({
    platform: z.enum(["youtube", "instagram", "wordpress"]), url: z.string(), albumId: z.number().int(), albumTitle: z.string(),
  })).describe("Enlaces públicos de sus discos."),
  platforms: z.array(z.object({ platform: z.string(), url: z.string(), externalId: z.string().nullable().optional() }))
    .describe("Perfiles del artista en plataformas de escucha (Spotify, Apple Music, Deezer…); solo los de identidad verificada."),
  socials: z.array(z.object({ platform: z.string(), url: z.string(), handle: z.string().nullable() }))
    .describe("Redes sociales del artista (Instagram, Facebook, X, TikTok…); solo las de identidad verificada."),
  related: z.array(z.object({
    id: z.number().int(), name: z.string(), pictureUrl: z.string().nullable(), originCountry: z.string(),
    rule: z.enum(RELATED_RULES).describe("La regla más alta que cumple; las fichas llegan ordenadas por regla."),
    sharedMembers: z.number().int(), sharedMemberNames: z.array(z.string()),
    relations: z.array(z.object({
      type: z.enum(["successor", "ex_member_project", "temporary_name"]),
      direction: z.enum(["earlier", "later"]).describe("earlier: la otra banda es la de origen; later: la posterior."),
      bridgeMembers: z.string().nullable(), startYear: z.number().int().nullable(), endYear: z.number().int().nullable(),
      note: z.string().nullable(), sources: z.array(z.string()), confidence: z.string(),
    })).describe("Linaje documentado (ingest.artist_relations); vacío si no lo hay."),
    bridges: z.array(z.object({ person: z.string().nullable(), album: z.string().nullable() }))
      .describe("Persona puente y disco donde se ve (colaboración, invitado, composición); hasta tres."),
  })).describe("Por reglas en orden: linaje documentado, 2+ integrantes en común, proyecto solista de un integrante, un integrante en común, colaboración, integrante invitado, composición cruzada."),
  similarDecade: z.number().int().nullable().describe("Década de arranque (formación o primer disco)."),
  similar: z.array(z.object({
    id: z.number().int(), name: z.string(), pictureUrl: z.string().nullable(), originCountry: z.string(),
    startYear: z.number().int().nullable(),
    rule: z.enum(SIMILAR_RULES).describe("La regla que lo trajo; las fichas llegan ordenadas por regla."),
    evidence: z.array(z.string()).describe("Recopilaciones, productores, ciudad o sellos en común; vacío en las reglas de género."),
  })).describe("Por reglas en orden: mismo estilo y década, mismo género y década, misma recopilación, mismo productor, misma escena, década vecina, mismo sello, mismo género. Sin repetir los relacionados."),
});

const listQuerySchema = paginationQuerySchema.extend({
  sort: catalogSortSchema.optional(),
  artistType: z.enum(artistTypeEnum.enumValues).optional()
    .describe("band, solo_artist y duo filtran por grupo (Bandas, Solistas, Dúos: incluyen agrupaciones y proyectos); project y group, por el tipo guardado."),
  q: z.string().trim().min(1).optional(),
  ...genreListFilterSchema,
  ...decadeListFilterSchema,
  genre: genreListFilterSchema.genre.describe("Género del artista: el propio y los que recibe de sus discos (0036)."),
});

export async function registerArtistRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/artists/facets", {
    schema: {
      tags: ["artists"],
      response: { 200: z.object({
        ...decadeFacetsSchema,
        total: z.number().int().nonnegative(),
        types: z.array(z.object({ value: z.string(), count: z.number().int().nonnegative() })),
      }) },
    },
  }, async () => getTypeFacets("artist"));

  server.get("/artists", {
    schema: {
      tags: ["artists"],
      querystring: listQuerySchema,
      response: { 200: paginatedResponseSchema(artistListItemSchema) },
    },
  }, async (request, reply) => {
    const { rows, total } = await listArtists(request.query);
    varyOnCookie(reply);
    if (!request.viewer) return toPage(rows, total, request.query);
    // Con sesión la respuesta lleva datos de trabajo: nunca a una caché compartida.
    reply.header("cache-control", "private, no-store");
    const laya = await layaDecidedIds("artist", rows.map((row) => row.id));
    return toPage(rows.map((row) => ({ ...row, genreByLaya: laya.has(row.id) })), total, request.query);
  });

  server.get("/artists/:id", {
    schema: {
      tags: ["artists"],
      params: idParamSchema,
      querystring: z.object({ date: dailyDateSchema.optional() }),
      response: { 200: artistDetailSchema },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const detail = await getArtistDetail(request.params.id, request.query.date);
    if (!detail) throw await notFoundEntity("artist", request.params.id);
    return detail;
  });
}
