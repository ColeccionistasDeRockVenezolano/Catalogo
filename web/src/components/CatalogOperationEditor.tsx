import { sharedOptionLabel } from "../lib/labels";
import { useId } from "react";
import { ImageUploadField } from "./ImageUploadField";
import { EntityPicker } from "./EntityPicker";
import type {
  CatalogField,
  CatalogKind,
  CatalogOperation,
  CatalogPreview,
  CatalogRef,
  CatalogVocabulary,
} from "../../../src/curation/ai/types";

export const KIND_LABELS: Record<CatalogKind, string> = {
  artist: "Artista",
  person: "Persona",
  album: "Disco",
  organization: "Organización",
  track: "Pista",
};
const LABELS: Record<string, string> = {
  values: "Campos",
  target: "Ficha",
  parent: "Ficha principal",
  artist: "Artista",
  labelEntity: "Sello",
  keep: "Ficha que se conserva",
  drop: "Ficha que se fusiona",
  fieldChoices: "Campos que se conservan",
  endpoints: "Fichas relacionadas",
  name: "Nombre",
  title: "Título",
  biography: "Biografía",
  pictureUrl: "Foto",
  originCity: "Ciudad de origen",
  originCountry: "País de origen",
  formedYear: "Año de formación",
  disbandedYear: "Año de separación",
  artistType: "Tipo de artista",
  status: "Estado",
  themes: "Temas",
  yearsActive: "Períodos de actividad",
  logoUrl: "Logo",
  realName: "Nombre real",
  nationality: "Nacionalidad",
  birthDate: "Fecha de nacimiento",
  birthCity: "Ciudad de nacimiento",
  deathDate: "Fecha de fallecimiento",
  deathCause: "Causa de fallecimiento",
  isVenezuelan: "Venezolano",
  isDeceased: "Fallecido",
  gender: "Género personal",
  trivia: "Información adicional",
  releaseYear: "Año de publicación",
  releaseDateText: "Fecha de publicación",
  catalogId: "Número de catálogo",
  mediaFormat: "Soporte",
  albumType: "Tipo de disco",
  labelId: "ID del sello",
  coverUrl: "Portada",
  description: "Descripción",
  youtubeUrl: "YouTube",
  youtubeStatus: "Estado en YouTube",
  instagramUrl: "Instagram",
  instagramStatus: "Estado en Instagram",
  wordpressUrl: "WordPress",
  wordpressStatus: "Estado en WordPress",
  discNumber: "Disco Nº",
  trackNumber: "Pista Nº",
  durationSeconds: "Duración (segundos)",
  youtubeStartSeconds: "Inicio en YouTube (segundos)",
  tracks: "Pistas",
  credits: "Créditos",
  genres: "Géneros",
  aliases: "Alias",
  formats: "Formatos",
  positions: "Orden de pistas",
  track: "Pista",
  album: "Disco",
  role: "Rol",
  creditType: "Tipo de crédito",
  format: "Formato",
  quality: "Calidad",
  archiveStatus: "Estado del archivo",
  notes: "Notas",
  slug: "Género",
  genreSlug: "Género",
  alias: "Alias",
  aliasType: "Tipo de alias",
  isPrimary: "Alias principal",
  fromYear: "Desde el año",
  toYear: "Hasta el año",
  isCurrent: "Integrante actual",
  organizationType: "Tipo de organización",
  websiteUrl: "Sitio web",
  country: "País",
  id: "ID de relación",
  personId: "Persona",
  artistId: "Artista",
  organizationId: "Organización",
  albumId: "Disco",
  trackId: "Pista",
};
export const catalogFieldLabel = (key: string) => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const label = catalogFieldLabel;
const OPTIONS: Record<string,string> = {studio_album:'Álbum de estudio',live_album:'Álbum en vivo',compilation:'Compilado',single:'Sencillo',ep:'EP',band:'Banda',solo:'Solista',active:'Activo',inactive:'Inactivo',disbanded:'Separado',unknown:'Sin confirmar',primary:'Principal',secondary:'Secundario',musician:'Músico',producer:'Productor',composer:'Compositor',production:'Producción',technical:'Técnico',other:'Otro',published:'Publicado',unpublished:'Inédito',name_variant:'Variante del nombre',spelling_variant:'Variante de escritura',former_name:'Nombre anterior',stage_name:'Nombre artístico',acronym:'Sigla',misspelling:'Error de escritura',alternate_title:'Título alternativo',keep:'Conservar ficha principal',drop:'Tomar de la ficha fusionada',record_label:'Sello discográfico',recording_studio:'Estudio de grabación'};
export const catalogOptionLabel = (value:string) => sharedOptionLabel(value) !== value ? sharedOptionLabel(value) : OPTIONS[value] ?? value;
function isRef(value: unknown): value is CatalogRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      ("id" in value || "key" in value),
  );
}
function RefEditor({
  value,
  onChange,
  preview,
  creators,
  title,
}: {
  value: CatalogRef;
  onChange: (v: CatalogRef) => void;
  preview: CatalogPreview | null;
  creators: CatalogOperation[];
  title: string;
}) {
  const known =
    "id" in value
      ? preview?.affected.find(
          (r) => r.kind === value.kind && r.id === value.id,
        )
      : undefined;
  return (
    <div className="ai-ref">
      <span>
        {title} · {KIND_LABELS[value.kind]}
      </span>
      <label>
        Tipo de ficha
        <select
          value={value.kind}
          onChange={(e) =>
            onChange({ kind: e.target.value as CatalogKind, id: 0 })
          }
        >
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="ai-ref__inputs">
        {value.kind !== "track" ? (
          <EntityPicker
            kind={value.kind}
            label="Buscar ficha existente"
            value={"id" in value ? value.id : null}
            valueLabel={
              known?.label ?? ("id" in value ? `ID ${value.id}` : null)
            }
            onSelect={(id) => onChange({ kind: value.kind, id })}
          />
        ) : null}
        <details className="ai-advanced-ref" open={value.kind === "track"}>
          <summary>Usar un identificador</summary>
        <label>
          ID existente
          <input
            type="number"
            min="1"
            value={"id" in value ? value.id : ""}
            onChange={(e) =>
              onChange({ kind: value.kind, id: Number(e.target.value) })
            }
          />
        </label>
        </details>
        {creators.some(
          (o) =>
            (o.op === "create_album" && value.kind === "album") ||
            (o.op === "create_entity" && o.kind === value.kind),
        ) ? (
          <label>
            Ficha creada en esta propuesta
            <select
              value={"key" in value ? value.key : ""}
              onChange={(e) => {
                if (e.target.value)
                  onChange({ kind: value.kind, key: e.target.value });
              }}
            >
              <option value="">Seleccionar…</option>
              {creators
                .filter(
                  (o) =>
                    (o.op === "create_album" && value.kind === "album") ||
                    (o.op === "create_entity" && o.kind === value.kind),
                )
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
function arrayDefault(key: string): unknown {
  switch (key) {
    case "tracks":
      return {
        title: "Nueva pista",
        discNumber: 1,
        trackNumber: 1,
        durationSeconds: null,
      };
    case "credits":
      return {
        target: { kind: "person", id: 0 },
        role: "",
        creditType: "musician",
      };
    case "genres":
      return { slug: "", role: "primary" };
    case "formats":
      return {
        format: "",
        quality: "unknown",
        archiveStatus: "unknown",
        notes: null,
      };
    case "positions":
      return { track: { kind: "track", id: 0 }, discNumber: 1, trackNumber: 1 };
    default:
      return "";
  }
}
interface ValueProps {
  value: unknown;
  name: string;
  onChange: (v: unknown) => void;
  fields: CatalogField[];
  vocabulary: CatalogVocabulary;
  preview: CatalogPreview | null;
  creators: CatalogOperation[];
  parent?: string;
}
function ValueEditor(props: ValueProps) {
  const {
    value,
    name,
    onChange,
    fields,
    vocabulary,
    preview,
    creators,
    parent,
  } = props;
  const inputId = useId();
  if (isRef(value))
    return (
      <RefEditor
        value={value}
        title={label(name)}
        onChange={onChange}
        preview={preview}
        creators={creators}
      />
    );
  if (Array.isArray(value))
    return (
      <fieldset className="ai-collection">
        <legend>
          {label(name)} ({value.length})
        </legend>
        {value.map((item, index) => (
          <details className="ai-collection__row" key={index} open={value.length <= 3}>
            <summary>{typeof item === 'object' && item !== null ? String(item.title ?? item.alias ?? item.format ?? (item.slug ? vocabulary.genres.find(g=>g.slug===item.slug)?.name ?? item.slug : null) ?? `${label(name)} ${index+1}`) : String(item || `${label(name)} ${index+1}`)}</summary>
            <ValueEditor
              {...props}
              name={
                typeof item === "object" ? name : `${label(name)} ${index + 1}`
              }
              parent={name}
              value={item}
              onChange={(v) =>
                onChange(value.map((x, i) => (i === index ? v : x)))
              }
            />
            <button
              type="button"
              className="btn btn--sm"
              aria-label={`Retirar ${label(name)} ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Retirar de la propuesta
            </button>
          </details>
        ))}
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onChange([...value, arrayDefault(name)])}
        >
          Añadir {label(name).toLowerCase()}
        </button>
      </fieldset>
    );
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      <fieldset className="ai-fields">
        <legend>{label(name)}</legend>
        <div className="ai-fields__grid">
          {Object.entries(record).map(([key, item]) => (
            <div
              key={key}
              className={
                item && typeof item === "object" ? "ai-fields__wide" : ""
              }
            >
              <ValueEditor
                {...props}
                name={key}
                parent={name}
                value={item}
                onChange={(v) => onChange({ ...record, [key]: v })}
              />
              {name === "values" ? (
                <button
                  type="button"
                  className="ai-field-remove"
                  aria-label={`Omitir ${label(key)}`}
                  onClick={() =>
                    onChange(
                      Object.fromEntries(
                        Object.entries(record).filter(([k]) => k !== key),
                      ),
                    )
                  }
                >
                  Omitir campo
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {name === "values" || name === "fieldChoices" ? (
          <label className="ai-add-field">
            Añadir campo
            <select
              value=""
              onChange={(e) => {
                const f = fields.find((f) => f.key === e.target.value);
                if (f)
                  onChange({
                    ...record,
                    [f.key]:
                      name === "fieldChoices"
                        ? "keep"
                        : f.nullable
                          ? null
                          : (f.options?.[0] ??
                            (f.type === "number"
                              ? 0
                              : f.type === "boolean"
                                ? false
                                : "")),
                  });
              }}
            >
              <option value="">Seleccionar…</option>
              {fields
                .filter((f) => !(f.key in record))
                .map((f) => (
                  <option value={f.key} key={f.key}>
                    {label(f.key)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </fieldset>
    );
  }
  const field = fields.find((f) => f.key === name);
  const numeric =
    field?.type === "number" ||
    typeof value === "number" ||
    /^(discNumber|trackNumber|durationSeconds|youtubeStartSeconds|fromYear|toYear|id)$/u.test(
      name,
    );
  let options = field?.options;
  if (name === "aliasType")
    options = [
      "name_variant",
      "spelling_variant",
      "former_name",
      "stage_name",
      "acronym",
      "misspelling",
      "alternate_title",
      "other",
    ];
  if (name === "quality") options = ["HQ", "LQ", "unknown"];
  if (name === "archiveStatus")
    options = ["published", "unpublished", "unknown"];
  if (name === "role" && parent === "genres")
    options = ["primary", "secondary"];
  if (parent === "fieldChoices") options = ["keep", "drop"];
  const boolean =
    field?.type === "boolean" ||
    typeof value === "boolean" ||
    name === "isPrimary" ||
    name === "isCurrent";
  const genre = name === "slug" || name === "genreSlug";
  return (
    <div className="field">
      <label htmlFor={inputId}>{label(name)}</label>
      {parent !== "fieldChoices" && ["pictureUrl", "logoUrl", "coverUrl", "thumbnailUrl"].includes(name) ? (
        <ImageUploadField id={inputId} label={label(name)} value={String(value ?? "")} onChange={url => onChange(url || null)} />
      ) : genre ? (
        <select
          id={inputId}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Seleccionar género…</option>
          {vocabulary.genres.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
      ) : boolean ? (
        <select
          id={inputId}
          value={value === null ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : e.target.value === "true")
          }
        >
          {field?.nullable ? <option value="">Sin dato</option> : null}
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      ) : options ? (
        <select
          id={inputId}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        >
          {field?.nullable ? <option value="">Sin dato</option> : null}
          {options.map((o) => (
            <option value={o} key={o}>
              {catalogOptionLabel(o)}
            </option>
          ))}
        </select>
      ) : numeric ? (
        <input
          id={inputId}
          type="number"
          value={value === null ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      ) : (
        <textarea
          id={inputId}
          rows={/biography|description|notes|trivia/u.test(name) ? 3 : 1}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )}
      {field?.nullable && value !== null && !boolean ? (
        <button
          type="button"
          className="ai-field-remove"
          onClick={() => onChange(null)}
        >
          Vaciar dato
        </button>
      ) : null}
    </div>
  );
}
export function CatalogOperationEditor({
  operation,
  onChange,
  vocabulary,
  preview,
  operations,
}: {
  operation: CatalogOperation;
  onChange: (o: CatalogOperation) => void;
  vocabulary: CatalogVocabulary;
  preview: CatalogPreview | null;
  operations: CatalogOperation[];
}) {
  const kind =
    "kind" in operation
      ? operation.kind
      : "target" in operation
        ? operation.target.kind
        : operation.op === "create_album"
          ? "album"
          : operation.op === "merge_entities"
            ? operation.keep.kind
            : "";
  const fields =
    kind in vocabulary.entities
      ? vocabulary.entities[kind as CatalogKind]
      : kind in vocabulary.relations
        ? vocabulary.relations[kind as keyof CatalogVocabulary["relations"]]
        : [];
  const body = Object.fromEntries(
    Object.entries(operation).filter(
      ([key]) =>
        ![
          "op",
          "key",
          "label",
          "reason",
          "enabled",
          "evidenceIds",
          "kind",
        ].includes(key),
    ),
  );
  return (
    <ValueEditor
      name="Datos propuestos"
      value={body}
      fields={fields}
      vocabulary={vocabulary}
      preview={preview}
      creators={operations}
      onChange={(v) => onChange({ ...operation, ...(v as object) })}
    />
  );
}
