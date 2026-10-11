// CRV · Configuración de campos editables por entidad, en el mismo orden y
// alcance que ENTITY_FIELDS en src/api/routes/catalog-writes.ts.
import type { FieldConfig, FieldValue } from "../components/FormFields";
import { ALBUM_TYPES, ARTIST_TYPES, ORGANIZATION_TYPES, PUBLICATION_STATUSES, albumTypeLabel, artistTypeLabel, organizationTypeLabel, publicationStatusLabel } from "./labels";

const options = (values: readonly string[], toLabel: (v: string) => string) => values.map((value) => ({ value, label: toLabel(value) }));

export const ARTIST_FIELDS: readonly FieldConfig[] = [
  { key: "name", label: "Nombre", type: "text", required: true, span2: true },
  { key: "artistType", label: "Tipo", type: "select", required: true, options: options(ARTIST_TYPES, artistTypeLabel) },
  { key: "originCountry", label: "País de origen", type: "text", required: true },
  { key: "originCity", label: "Ciudad de origen", type: "text" },
  { key: "formedYear", label: "Año de formación", type: "number" },
  { key: "disbandedYear", label: "Año de disolución", type: "number" },
  { key: "status", label: "Estado de actividad", type: "select", options: [{ value: "active", label: "Activo" }, { value: "split_up", label: "Disuelto" }, { value: "on_hold", label: "En pausa" }, { value: "changed_name", label: "Cambió de nombre" }, { value: "unknown", label: "Desconocido" }] },
  { key: "yearsActive", label: "Períodos de actividad", type: "text", hint: "Por ejemplo: 1990–2000, 2005–presente." },
  { key: "themes", label: "Temas de las letras", type: "textarea", span2: true },
  { key: "logoUrl", label: "Logo (URL)", type: "mediaUrl", span2: true },
  { key: "pictureUrl", label: "Foto (URL)", type: "mediaUrl", span2: true },
  { key: "biography", label: "Biografía", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const PERSON_FIELDS: readonly FieldConfig[] = [
  { key: "name", label: "Nombre", type: "text", required: true, span2: true },
  { key: "realName", label: "Nombre real", type: "text", span2: true },
  { key: "gender", label: "Género de la persona", type: "select", options: [{ value: "female", label: "Femenino" }, { value: "male", label: "Masculino" }, { value: "unknown", label: "Desconocido" }] },
  { key: "birthCity", label: "Ciudad de nacimiento", type: "text" },
  { key: "nationality", label: "Nacionalidad", type: "text" },
  { key: "isVenezuelan", label: "Venezolano/a", type: "tristate" },
  { key: "isDeceased", label: "Fallecido/a", type: "tristate" },
  { key: "birthDate", label: "Fecha de nacimiento", type: "text", hint: "AAAA, AAAA-MM o AAAA-MM-DD. ~ indica aproximación; inicio/fin indica intervalo." },
  { key: "deathDate", label: "Fecha de fallecimiento", type: "text", hint: "Guarda solo la precisión conocida, por ejemplo 2001 o ~2001-05." },
  { key: "deathCause", label: "Causa de fallecimiento", type: "textarea", span2: true },
  { key: "trivia", label: "Datos adicionales", type: "textarea", span2: true },
  { key: "pictureUrl", label: "Foto (URL)", type: "mediaUrl", span2: true },
  { key: "biography", label: "Biografía", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const ORGANIZATION_FIELDS: readonly FieldConfig[] = [
  { key: "name", label: "Nombre", type: "text", required: true, span2: true },
  { key: "organizationType", label: "Tipo", type: "select", required: true, options: options(ORGANIZATION_TYPES, organizationTypeLabel) },
  { key: "country", label: "País", type: "text" },
  { key: "websiteUrl", label: "Sitio web", type: "url" },
  { key: "pictureUrl", label: "Imagen (URL)", type: "mediaUrl", span2: true },
  { key: "biography", label: "Descripción", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const ALBUM_FIELDS: readonly FieldConfig[] = [
  { key: "title", label: "Título", type: "text", required: true, span2: true },
  { key: "albumType", label: "Tipo", type: "select", required: true, options: options(ALBUM_TYPES, albumTypeLabel) },
  { key: "releaseYear", label: "Año de publicación", type: "number" },
  { key: "releaseDateText", label: "Fecha de publicación", type: "text", hint: "Admite fecha completa, mes y año o solo año, según la fuente." },
  { key: "catalogId", label: "Número de catálogo", type: "text" },
  { key: "mediaFormat", label: "Formato de la edición", type: "text", hint: "Por ejemplo: CD, LP, casete o digital." },
  { key: "genre", label: "Texto de género de la fuente", type: "text", hint: "Los géneros confirmados se gestionan en la sección Géneros." },
  { key: "coverUrl", label: "Portada (URL)", type: "mediaUrl", span2: true },
  { key: "youtubeUrl", label: "URL de YouTube", type: "url" },
  { key: "youtubeStatus", label: "Estado en YouTube", type: "select", required: true, options: options(PUBLICATION_STATUSES, publicationStatusLabel) },
  { key: "instagramUrl", label: "URL de Instagram", type: "url" },
  { key: "instagramStatus", label: "Estado en Instagram", type: "select", required: true, options: options(PUBLICATION_STATUSES, publicationStatusLabel) },
  { key: "wordpressUrl", label: "URL de WordPress", type: "url" },
  { key: "wordpressStatus", label: "Estado en WordPress", type: "select", required: true, options: options(PUBLICATION_STATUSES, publicationStatusLabel) },
  { key: "description", label: "Descripción", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const TRACK_FIELDS: readonly FieldConfig[] = [
  { key: "title", label: "Título", type: "text", required: true, span2: true },
  { key: "discNumber", label: "Disco N.º", type: "number", required: true },
  { key: "trackNumber", label: "Pista N.º", type: "number", required: true },
  { key: "durationSeconds", label: "Duración (segundos)", type: "number" },
  { key: "youtubeStartSeconds", label: "Inicio en YouTube (segundos)", type: "number" },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

/** Precarga todos los campos disponibles sin enviar relaciones ni datos derivados. */
export function entityFormValues(fields: readonly FieldConfig[], entity: object): Record<string, FieldValue> {
  const source = entity as Record<string, unknown>;
  const values: Record<string, FieldValue> = {};
  for (const { key } of fields) {
    const value = source[key];
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key] = value;
    }
  }
  return values;
}
