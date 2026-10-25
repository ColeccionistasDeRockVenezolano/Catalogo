import { albumTypeEnum } from "../../db/schema/core.js";
import { syncCoreAlbumLabel } from "../../catalog/album-labels.js";
import { writeModel } from "../../catalog/model.js";
import { dateYear } from "../../catalog/date-value.js";
import { dateValueText, parseDateValue } from "../../catalog/date-value.js";
import { writeAlbumClassifications } from "../../catalog/album-classifications.js";
import { isMusicalClassification } from "../../catalog/album-classifications.js";
// CRV · Escritura de entidades del core (PHASES §E7B): artistas, personas,
// organizaciones, álbumes y pistas. Los controllers solo validan y traducen;
// cada petición es una transacción de `merge/operator.ts` sobre el motor.
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OperatorError, type OperatorContext, createEntity, deleteEntity, updateEntity, withOperatorRun, type CreateEntityOptions } from "../../merge/operator.js";
import type { ResolvableClaimKind } from "../../merge/specs.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { idParamSchema, writeErrorResponses } from "../schemas.js";

export const text = (max: number) => z.string().trim().min(1).max(max);
export const longText = z.string().trim().min(1).max(20_000);
export const year = z.number().int().min(1000).max(9999);
export const noteSchema = z.string().trim().min(1).max(2000)
  .describe("Motivo de la edición; queda en el run, en la auditoría y en la evidencia del claim.");
// Las fichas pueden apuntar a un recurso descargado por el catálogo. Se
// conserva la validación de URL externa para enlaces editoriales, pero las
// portadas y fotos locales se expresan como rutas absolutas bajo /crv/media.
const url = z.string().trim().max(2000).refine(
  (value) => z.string().url().safeParse(value).success || /^\/crv\/media\/[A-Za-z0-9_./-]+$/u.test(value),
  "debe ser una URL válida o una ruta local /crv/media/...",
);
const isoDate = z.string().max(40).transform((value, context) => {
  try { return dateValueText(parseDateValue(value)); }
  catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); return z.NEVER; }
});
const publication = z.enum(["published", "unlisted", "unpublished", "copyright_blocked", "unknown"]);

// Tipos de organización y artista: viven aquí para que la creación (esta ruta)
// y la conversión persona → organización/artista (E11.7) usen el mismo enum.
export const organizationTypeSchema = z.enum(["record_label", "production_company", "recording_studio", "distributor", "management", "other"]);
export const artistTypeSchema = z.enum(["band", "solo_artist", "duo", "project", "group", "other"]);

// Campos editables por entidad (camelCase de las columnas de ENTITY_SPECS).
// `.nullable()` solo donde la columna admite NULL: vaciar un NOT NULL no se ofrece.
export const ENTITY_FIELDS = {
  artist: {
    name: text(200),
    artistType: artistTypeSchema,
    biography: longText.nullable(), pictureUrl: url.nullable(),
    originCity: text(120).nullable(), originCountry: text(120),
    currentCity: text(120).nullable(), currentCountry: text(120).nullable(),
    email: text(200).nullable(),
    formedYear: year.nullable(), disbandedYear: year.nullable(), notes: longText.nullable(),
    status: text(50).nullable(), themes: longText.nullable(), yearsActive: text(200).nullable(), logoUrl: url.nullable(),
  },
  person: {
    name: text(200), biography: longText.nullable(), pictureUrl: url.nullable(), nationality: text(120).nullable(),
    isVenezuelan: z.boolean().nullable(), isDeceased: z.boolean().nullable(), birthDate: isoDate.nullable(), deathDate: isoDate.nullable(), notes: longText.nullable(),
    realName: text(200).nullable(), birthCity: text(120).nullable(), deathCause: longText.nullable(), trivia: longText.nullable(), gender: text(50).nullable(),
  },
  organization: {
    name: text(200),
    organizationType: organizationTypeSchema,
    biography: longText.nullable(), pictureUrl: url.nullable(), websiteUrl: url.nullable(), country: text(120).nullable(),
    notes: longText.nullable(),
  },
  album: {
    title: text(250), releaseYear: year.nullable(),
    releaseDateText: text(40).nullable(), catalogId: text(80).nullable(), mediaFormat: text(50).nullable(),
    albumType: z.enum(albumTypeEnum.enumValues),
    genre: text(200).nullable(), labelId: z.number().int().positive().nullable(), coverUrl: url.nullable(),
    description: longText.nullable(), youtubeUrl: url.nullable(), youtubeStatus: publication,
    instagramUrl: url.nullable(), instagramStatus: publication, wordpressUrl: url.nullable(), wordpressStatus: publication,
    notes: longText.nullable(),
  },
  track: {
    lyrics: z.string().trim().min(1).max(100_000).nullable(),
    title: text(250), discNumber: z.number().int().positive().max(99), trackNumber: z.number().int().positive().max(999),
    durationSeconds: z.number().int().nonnegative().nullable(), youtubeStartSeconds: z.number().int().nonnegative().nullable(),
    notes: longText.nullable(),
  },
} satisfies Record<ResolvableClaimKind, z.ZodRawShape>;

interface EntityRoute {
  kind: ResolvableClaimKind;
  path: string;
  label: string;
  identity: "name" | "title";
  /** Clave del cuerpo que fija el parental al crear (y que el PATCH puede reatribuir). */
  parent?: "artistId" | "albumId";
}

const ENTITY_ROUTES: readonly EntityRoute[] = [
  { kind: "artist", path: "/artists", label: "artista", identity: "name" },
  { kind: "person", path: "/persons", label: "persona", identity: "name" },
  { kind: "organization", path: "/organizations", label: "organización", identity: "name" },
  { kind: "album", path: "/albums", label: "álbum", identity: "title", parent: "artistId" },
  { kind: "track", path: "/tracks", label: "pista", identity: "title", parent: "albumId" },
];

const CONTROL_KEYS = new Set(["note", "allowSimilar", "artistId", "albumId", "classifications", "releaseDate"]);
const classificationsSchema = z.array(z.string().trim().min(1).max(60).refine(isMusicalClassification, "Gestiona las piezas audiovisuales en Audiovisuales")).max(100);

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

/** Cuerpo → campos del core en snake_case, sin las claves de control. */
function catalogFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body)
    .filter(([key, value]) => !CONTROL_KEYS.has(key) && value !== undefined)
    .map(([key, value]) => [toSnake(key), value]));
}

export function noteFrom(body: { note?: unknown } | undefined, fallback: string): string {
  return typeof body?.note === "string" && body.note.trim() ? body.note : fallback;
}

const fieldWriteSchema = z.object({
  field: z.string(),
  action: z.enum(["applied", "unchanged", "corrected"]),
  conflictsClosed: z.array(z.number().int()),
});

const entityWriteSchema = z.object({
  kind: z.string(),
  id: z.number().int(),
  runId: z.number().int(),
  fields: z.array(fieldWriteSchema),
});

export const removalSchema = z.object({
  kind: z.string(),
  id: z.number().int(),
  runId: z.number().int(),
  claimsRejected: z.array(z.number().int()),
  parentAuditId: z.number().int().nullable(),
});

export const deleteQuerySchema = z.object({ note: noteSchema.optional() });

export async function registerCatalogWriteRoutes(app: FastifyInstance): Promise<void> {
  const server = app.withTypeProvider<ZodTypeProvider>();

  for (const route of ENTITY_ROUTES) {
    const fields: z.ZodRawShape = ENTITY_FIELDS[route.kind];
    const required: z.ZodRawShape = {
      [route.identity]: fields[route.identity]!,
      ...(route.parent === undefined ? {} : { [route.parent]: z.number().int().positive() }),
      ...(route.kind === "track" ? { trackNumber: fields["trackNumber"]! } : {}),
    };
    const createBody = z.object(fields).partial().extend({
      ...required,
      ...(route.kind === "album" ? { classifications: classificationsSchema.optional(), releaseDate: isoDate.nullable().optional() } : {}),
      note: noteSchema.optional(),
      allowSimilar: z.boolean().optional()
        .describe("Decisión humana: crear aunque el ER vea candidatos parecidos (homónimos a sabiendas)."),
    }).strict();
    const updateBody = z.object(fields).partial().extend({
      ...(route.kind === "album" ? { classifications: classificationsSchema.optional(), releaseDate: isoDate.nullable().optional() } : {}),
      note: noteSchema.optional(),
      // El padre (artista del disco, disco de la pista) se fija al crear y se
      // reatribuye aquí: es una corrección con auditoría, no un campo más.
      ...(route.parent === undefined ? {} : { [route.parent]: z.number().int().positive().optional() }),
    }).strict();

    server.post(route.path, {
      schema: {
        tags: [`${route.path.slice(1)}:write`],
        summary: `Crea ${route.label} a través del merge engine (claims human/high)`,
        security: OPERATOR_SECURITY,
        body: createBody,
        response: { 201: entityWriteSchema, ...writeErrorResponses },
      },
    }, async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const options: CreateEntityOptions = {
        ...(body["allowSimilar"] === true ? { allowSimilar: true } : {}),
        ...(typeof body["artistId"] === "number" ? { artistId: body["artistId"] } : {}),
        ...(typeof body["albumId"] === "number" ? { albumId: body["albumId"] } : {}),
      };
      const values = catalogFields(body);
      const { runId, result } = await withOperatorRun({
        name: `api:create:${route.kind}`, operator: request.operator, note: noteFrom(body, `alta de ${route.label} por la API`),
        params: { kind: route.kind, values, options },
      }, async (context) => {
        const created = await createEntity(context, route.kind, values, options);
        if (route.kind === "album" && Array.isArray(body["classifications"])) {
          await writeAlbumClassifications(context, created.id, body["classifications"] as string[]);
        }
        if (route.kind === "album" && body["releaseDate"] !== undefined) await saveAlbumDate(context, created.id, body["releaseDate"] as string|null);
        if(route.kind === "album" && body["labelId"]!==undefined) await syncCoreAlbumLabel(context,created.id,body["labelId"] as number|null);
        return created;
      });
      return reply.status(201).send({ ...result, runId });
    });

    server.patch(`${route.path}/:id`, {
      schema: {
        tags: [`${route.path.slice(1)}:write`],
        summary: `Corrige campos de ${route.label}; un valor ya afirmado se sustituye con auditoría y cierra sus conflictos`,
        security: OPERATOR_SECURITY,
        params: idParamSchema,
        body: updateBody,
        response: { 200: entityWriteSchema, ...writeErrorResponses },
      },
    }, async (request) => {
      const body = request.body as Record<string, unknown>;
      const values = catalogFields(body);
      const parentKey = route.parent;
      const parentId = parentKey !== undefined && typeof body[parentKey] === "number" ? (body[parentKey] as number) : undefined;
      const { runId, result } = await withOperatorRun({
        name: `api:update:${route.kind}`, operator: request.operator, note: noteFrom(body, `corrección de ${route.label} por la API`),
        params: {
          kind: route.kind, id: request.params.id, values,
          ...(parentKey === undefined || parentId === undefined ? {} : { [parentKey]: parentId }),
        },
      }, async (context) => {
        if(route.kind === "album" && body["labelId"]!==undefined) await syncCoreAlbumLabel(context,request.params.id,body["labelId"] as number|null);
        const hasDate = route.kind === "album" && body["releaseDate"] !== undefined;
        if (hasDate) {
          const date=body["releaseDate"] as string|null;
          const projected=date===null?null:dateYear(date);
          if(values["release_year"]!==undefined && values["release_year"]!==null && projected!==null && values["release_year"]!==projected) throw new OperatorError("invalid","El año y la fecha de publicación no coinciden.");
          await saveAlbumDate(context,request.params.id,date);
          if(projected!==null) values["release_year"]=projected;
        } else if(route.kind === "album" && values["release_year"]!==undefined) {
          const old=(await context.client.query<{release_date:unknown}>("SELECT release_date FROM ingest.catalog_edition_details WHERE album_id=$1",[request.params.id])).rows[0]?.release_date;
          if(old && dateYear(dateValueText(old as Parameters<typeof dateValueText>[0]))!==values["release_year"]) await saveAlbumDate(context,request.params.id,null);
        }
        const hasClassifications = route.kind === "album" && Array.isArray(body["classifications"]);
        if (hasClassifications) await writeAlbumClassifications(context, request.params.id, body["classifications"] as string[]);
        if ((hasClassifications || hasDate) && Object.keys(values).length === 0 && parentId === undefined) {
          return { kind: route.kind, id: request.params.id, fields: [] };
        }
        return updateEntity(context, route.kind, request.params.id, values, parentId === undefined ? {} : { parentId });
      });
      return { ...result, runId };
    });

    server.delete(`${route.path}/:id`, {
      schema: {
        tags: [`${route.path.slice(1)}:write`],
        summary: `Retira ${route.label} sin dependientes; su historia se conserva en el run y en la ficha padre`,
        security: OPERATOR_SECURITY,
        params: idParamSchema,
        querystring: deleteQuerySchema,
        response: { 200: removalSchema, ...writeErrorResponses },
      },
    }, async (request) => {
      const { runId, result } = await withOperatorRun({
        name: `api:delete:${route.kind}`, operator: request.operator, note: noteFrom(request.query, `retiro de ${route.label} por la API`),
        params: { kind: route.kind, id: request.params.id },
      }, (context) => deleteEntity(context, route.kind, request.params.id));
      return { kind: result.kind, id: result.id, runId, claimsRejected: result.claimsRejected, parentAuditId: result.parentAuditId ?? null };
    });
  }
}

async function saveAlbumDate(context:OperatorContext,albumId:number,releaseDate:string|null) {
 const row=(await context.client.query<{id:string}>("SELECT id::text FROM ingest.catalog_edition_details WHERE album_id=$1 FOR UPDATE",[albumId])).rows[0];
 await writeModel(context,"edition",{albumId,releaseDate},row?Number(row.id):undefined);
}
