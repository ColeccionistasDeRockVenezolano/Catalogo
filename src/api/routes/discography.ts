// CRV · Rutas del modelo discográfico (plan del primo, etapa 2): página de
// lugar y página de serie. Las versiones, sellos con rol, series y créditos en
// frase viajan dentro de la ficha del disco; la sucesión, dentro de la de la
// organización (esquemas exportados aquí).
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { idParamSchema } from "../schemas.js";
import { ApiError } from "../http-errors.js";
import { getPlaceDetail, getSeriesDetail } from "../repositories/discography.js";

const int = z.number().int();
const ref = z.object({ id: int, name: z.string() });

export const labelRefSchema = z.object({
  organizationId: int, name: z.string(), role: z.enum(["label", "distributor", "licensee"]), roleLabel: z.string(),
});

export const albumDiscographySchema = {
  versions: z.array(z.object({
    id: int, position: int, title: z.string().nullable(), format: z.string().nullable(), formatDetails: z.string().nullable(),
    catalogNumber: z.string().nullable(), country: z.string().nullable(), releaseYear: int.nullable(), releaseDate: z.string().nullable(),
    coverUrl: z.string().nullable(), notes: z.string().nullable(), distinctTracks: z.boolean(), discNumbers: z.array(int), isPrimary: z.boolean(),
    source: z.string().nullable(), sourceUrl: z.string().nullable(), hasOwnPage: z.boolean(), labels: z.array(labelRefSchema),
  })).describe("Versiones de la obra (formato, sello con rol, país, año); la principal primero."),
  labels: z.array(labelRefSchema).describe("Sellos de la obra con su rol (sello, distribuidor, licenciatario)."),
  series: z.array(z.object({
    id: int, title: z.string(), volumeNumber: z.number().nullable(), volumeLabel: z.string().nullable(), line: z.string(),
    previous: z.object({ albumId: int, title: z.string() }).nullable(), next: z.object({ albumId: int, title: z.string() }).nullable(),
  })).describe("Series a las que pertenece («Venezuela Electrónica – Vol. 1»)."),
  creditStatements: z.array(z.object({
    id: int, lineNumber: int, sectionKind: z.string(), text: z.string(), trackNumbers: z.array(int),
    parts: z.array(z.object({
      start: int, end: int, type: z.string(), roleKey: z.string().nullable(), personId: int.nullable(), artistId: int.nullable(),
      organizationId: int.nullable(), placeId: int.nullable(), year: int.nullable(),
    })),
  })).describe("Créditos del canal en frase, con sus tramos enlazados (offsets en code points)."),
};

export const organizationDiscographySchema = {
  relations: z.array(z.object({
    direction: z.enum(["outgoing", "incoming"]), relationType: z.string(), other: ref, startYear: int.nullable(), endYear: int.nullable(),
    evidenceNote: z.string(), sourceUrls: z.array(z.string()),
  })).describe("Sucesión del sello, siempre con fuente."),
  places: z.array(ref),
  roleAlbums: z.array(z.object({
    albumId: int, title: z.string(), releaseYear: int.nullable(), artistId: int, artistName: z.string(),
    role: z.enum(["label", "distributor", "licensee"]), roleLabel: z.string(),
  })),
  studioAlbums: z.array(z.object({ albumId: int, title: z.string(), releaseYear: int.nullable(), artistId: int, artistName: z.string(), roles: z.array(z.string()) })),
};

const placeDetailSchema = z.object({
  id: int, name: z.string(), placeType: z.string(), city: z.string().nullable(), region: z.string().nullable(), country: z.string().nullable(),
  parent: ref.nullable(), children: z.array(ref), aliases: z.array(z.string()),
  studios: z.array(ref.extend({ albumCount: int })),
  albumsByRole: z.array(z.object({
    roleKey: z.string(),
    albums: z.array(z.object({
      albumId: int, title: z.string(), releaseYear: int.nullable(), artistId: int, artistName: z.string(), coverUrl: z.string().nullable(), studios: z.array(ref),
    })),
  })),
});

const seriesDetailSchema = z.object({
  id: int, title: z.string(), description: z.string().nullable(), artist: ref.nullable(), organization: ref.nullable(),
  volumes: z.array(z.object({
    albumId: int, title: z.string(), releaseYear: int.nullable(), coverUrl: z.string().nullable(), volumeNumber: z.number().nullable(), volumeLabel: z.string().nullable(),
  })),
});

export async function registerDiscographyRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/places/:id", {
    schema: { tags: ["discography"], params: idParamSchema, response: { 200: placeDetailSchema } },
  }, async (request) => {
    const place = await getPlaceDetail(request.params.id);
    if (!place) throw new ApiError(404, "not_found", `No existe el lugar ${request.params.id}.`);
    return place;
  });

  server.get("/series/:id", {
    schema: { tags: ["discography"], params: idParamSchema, response: { 200: seriesDetailSchema } },
  }, async (request) => {
    const series = await getSeriesDetail(request.params.id);
    if (!series) throw new ApiError(404, "not_found", `No existe la serie ${request.params.id}.`);
    return series;
  });
}
