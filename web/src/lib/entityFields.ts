// CRV · Configuración de campos editables por entidad, en el mismo orden y
// alcance que ENTITY_FIELDS en src/api/routes/catalog-writes.ts.
import type { FieldConfig, FieldValue } from "../components/FormFields";
import { ALBUM_EDITABLE_CLASSIFICATIONS } from "../../../src/shared/album-categories";
import { ALBUM_TYPES, ARTIST_TYPES, ORGANIZATION_TYPES, PUBLICATION_STATUSES, albumTypeLabel, artistTypeLabel, organizationTypeLabel, publicationStatusLabel } from "./labels";

const options = (values: readonly string[], toLabel: (v: string) => string) => values.map((value) => ({ value, label: toLabel(value) }));

export const ARTIST_FIELDS: readonly FieldConfig[] = [
  { key: "name", label: "Nombre", type: "text", required: true, span2: true },
  { key: "artistType", label: "Tipo", type: "select", required: true, options: options(ARTIST_TYPES, artistTypeLabel) },
  { key: "originCountry", label: "País de origen", type: "text", required: true },
  { key: "originCity", label: "Ciudad de origen", type: "text" },
  { key: "currentCity", label: "Ubicación actual (ciudad)", type: "text", hint: "Dónde está radicado hoy; por ejemplo: Miami, FL." },
  { key: "currentCountry", label: "Ubicación actual (país)", type: "text" },
  { key: "email", label: "Correo de contacto", type: "text", hint: "Correo que el artista publica en su perfil oficial." },
  { key: "formedYear", label: "Año de formación", type: "number" },
  { key: "disbandedYear", label: "Año de disolución", type: "number" },
  { key: "status", label: "Estado de actividad", type: "select", options: [{ value: "active", label: "Activo" }, { value: "split_up", label: "Disuelto" }, { value: "on_hold", label: "En pausa" }, { value: "changed_name", label: "Cambió de nombre" }, { value: "unknown", label: "Desconocido" }] },
  { key: "yearsActive", label: "Períodos de actividad", type: "text", hint: "Por ejemplo: 1990–2000, 2005–presente." },
  { key: "themes", label: "Temas de las letras", type: "textarea", span2: true },
  { key: "logoUrl", label: "Logo", type: "mediaUrl", span2: true },
  { key: "pictureUrl", label: "Foto", type: "mediaUrl", span2: true },
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
  { key: "pictureUrl", label: "Foto", type: "mediaUrl", span2: true },
  { key: "biography", label: "Biografía", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const ORGANIZATION_FIELDS: readonly FieldConfig[] = [
  { key: "name", label: "Nombre", type: "text", required: true, span2: true },
  { key: "organizationType", label: "Tipo", type: "select", required: true, options: options(ORGANIZATION_TYPES, organizationTypeLabel) },
  { key: "country", label: "País", type: "text" },
  { key: "websiteUrl", label: "Sitio web", type: "url" },
  { key: "pictureUrl", label: "Imagen", type: "mediaUrl", span2: true },
  { key: "biography", label: "Descripción", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

export const ALBUM_FIELDS: readonly FieldConfig[] = [
  { key: "title", label: "Título", type: "text", required: true, span2: true },
  { key: "albumType", label: "Tipo", type: "select", required: true, options: options(ALBUM_TYPES, albumTypeLabel) },
  { key: "classifications", label: "Clasificaciones adicionales", type: "multiselect", span2: true, allowCustom: true,
    options: ALBUM_EDITABLE_CLASSIFICATIONS.map(item => ({ value: item.classification, label: item.label })),
    hint: "Puedes añadir B-Sides, en vivo y otras características al tipo principal (EP, sencillo, compilado…). Deluxe, remasterizado y reedición corresponden a la versión." },
  { key: "releaseYear", label: "Año de publicación", type: "number" },
  { key: "releaseDate", label: "Fecha de publicación", type:"text", hint:"AAAA, AAAA-MM o AAAA-MM-DD; ~ para aproximación e inicio/fin para un intervalo." },
  { key: "releaseDateText", label: "Fecha literal de la fuente", type: "text", hint: "Admite fecha completa, mes y año o solo año, según la fuente." },
  { key: "catalogId", label: "Número de catálogo", type: "text" },
  { key: "mediaFormat", label: "Formato de la edición", type: "text", hint: "Por ejemplo: CD, LP, casete o digital." },
  { key: "genre", label: "Texto de género de la fuente", type: "text", hint: "Los géneros confirmados se gestionan en la sección Géneros." },
  { key: "coverUrl", label: "Portada", type: "mediaUrl", span2: true },
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
  { key: "durationSeconds", label: "Duración", type: "duration", hint: "Minutos y segundos, por ejemplo 4:05." },
  { key: "lyrics", label: "Letra", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas", type: "textarea", span2: true },
];

/**
 * Secciones del editor de fichas, en el orden en que se leen. Una clave
 * significa lo mismo en todas las entidades (name, pictureUrl, notes…), así
 * que basta un mapa por clave; lo que no figure cae en «Otros datos».
 */
export const FIELD_GROUPS: ReadonlyArray<{ key: string; title: string; description?: string; fields: readonly string[] }> = [
  { key: "identidad", title: "Identidad", fields: ["name", "title", "realName", "artistType", "organizationType", "albumType", "classifications", "gender"] },
  { key: "posicion", title: "Posición en el disco", fields: ["discNumber", "trackNumber", "durationSeconds"] },
  { key: "origen", title: "Origen y ubicación", fields: ["originCountry", "originCity", "currentCity", "currentCountry", "birthCity", "nationality", "isVenezuelan", "country"] },
  { key: "trayectoria", title: "Fechas y trayectoria", fields: ["formedYear", "disbandedYear", "status", "yearsActive", "birthDate", "deathDate", "isDeceased", "deathCause", "releaseYear", "releaseDate", "releaseDateText"] },
  { key: "edicion", title: "Edición", description: "Lo que identifica esta edición física o digital.", fields: ["catalogId", "mediaFormat", "genre"] },
  { key: "imagenes", title: "Imágenes", fields: ["logoUrl", "pictureUrl", "coverUrl"] },
  { key: "publicacion", title: "Publicación y enlaces", description: "Dónde está publicado este disco en los canales del proyecto.", fields: ["youtubeUrl", "youtubeStatus", "instagramUrl", "instagramStatus", "wordpressUrl", "wordpressStatus", "websiteUrl"] },
  { key: "textos", title: "Textos", fields: ["biography", "description", "themes", "trivia", "lyrics"] },
  { key: "notas", title: "Notas internas", description: "Solo las ven las cuentas administradoras.", fields: ["notes"] },
];

export interface FieldSection { key: string; title: string; description?: string; fields: FieldConfig[] }

/** Reparte los campos de un formulario en las secciones de FIELD_GROUPS (solo las que tienen campos). */
export function groupFields(fields: readonly FieldConfig[]): FieldSection[] {
  const sections: FieldSection[] = FIELD_GROUPS.map((group) => ({
    key: group.key, title: group.title, ...(group.description ? { description: group.description } : {}),
    fields: group.fields.flatMap((key) => fields.filter((field) => field.key === key)),
  }));
  const known = new Set(FIELD_GROUPS.flatMap((group) => group.fields));
  const rest = fields.filter((field) => !known.has(field.key));
  if (rest.length) sections.push({ key: "otros", title: "Otros datos", fields: rest });
  return sections.filter((section) => section.fields.length > 0);
}

/** Precarga todos los campos disponibles sin enviar relaciones ni datos derivados. */
export function entityFormValues(fields: readonly FieldConfig[], entity: object): Record<string, FieldValue> {
  const source = entity as Record<string, unknown>;
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    const { key } = field;
    const value = source[key];
    if (field.type === "multiselect" && Array.isArray(value)) {
      values[key] = value.flatMap(item => {
        const candidate: unknown = typeof item === "object" && item !== null ? item.classification : item;
        return typeof candidate === "string" ? [candidate] : [];
      });
      continue;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key] = value;
    }
  }
  return values;
}
