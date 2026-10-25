// CRV · Editor de fichas.
//
// El mismo patrón que Configuración › Temas: un menú de secciones a la
// izquierda, el contenido a la derecha y un borrador explícito. Los datos de
// la ficha se editan como borrador y se guardan JUNTOS desde la bandeja de
// abajo (un motivo, un run, un deshacer); la bandeja dice cuántos cambios hay
// pendientes y deja verlos antes de guardar.
//
// Las relaciones (géneros, integrantes, videos, enlaces…) tienen su propio
// guardado: se aplican al momento, cada una con su «Deshacer» en el aviso, y
// el menú lo dice en su propio grupo para que nadie espere que «Guardar» las
// confirme o «Descartar» las revierta.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Lightning } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormFields, formatSeconds, type FieldConfig, type FieldValue } from "./FormFields";
import { NOTE_PRESETS, NoteField } from "./NoteField";
import { useAsync } from "../lib/useAsync";
import { entityFormValues, groupFields, type FieldSection } from "../lib/entityFields";
import { albumTypeLabel } from "../lib/labels";
import { ApiError, catalogEditorApi } from "../lib/api";
import { hasPendingImageUploads, useImageUploadsPending } from "../lib/imageUploads";
import type { EntityWriteResult } from "../lib/types";

interface EntityFormModalProps {
  entity?: {kind: string; id: number};
  partial?: boolean;
  title: string;
  fields: readonly FieldConfig[];
  initialValues: Record<string, FieldValue>;
  /** Campos propios de la página (p. ej. el artista del disco); van al principio de «Identidad». */
  extraFields?: ReactNode;
  /** Cambios de esos campos propios, para que la bandeja los cuente. */
  extraChanges?: ReadonlyArray<{ label: string; before: string; after: string }>;
  panels?: ReadonlyArray<{ key: string; label: string; content: ReactNode }>;
  submitLabel?: string;
  onSubmit: (values: Record<string, FieldValue>, note: string) => Promise<EntityWriteResult>;
  onSuccess: (result: EntityWriteResult) => void;
  onClose: () => void;
  wide?: boolean;
}

export function EntityFormModal(props: EntityFormModalProps) {
  const needsVocabulary=props.fields.some(field=>field.key==="classifications");
  const {data,loading,error,reload}=useAsync(()=>props.entity?catalogEditorApi.entity(props.entity.kind,props.entity.id):needsVocabulary?catalogEditorApi.vocabulary().then(vocabulary=>({values:{},vocabulary})):Promise.resolve(null),[props.entity?.kind,props.entity?.id,needsVocabulary]);
  if((props.entity || needsVocabulary) && !data) return <Modal title={props.title} onClose={props.onClose} wide={props.wide ?? false}>{error?<p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p>:<p role="status">{loading?"Cargando datos de edición…":"Sin datos de edición."}</p>}</Modal>;
  const fields=props.fields.map(field=> {
    if(data && field.type==="select" && field.key==="albumType") return {...field,options:data.vocabulary.albumTypes.map(value=>({value,label:albumTypeLabel(value)}))};
    if(data && field.type==="multiselect" && field.key==="classifications") return {...field,options:data.vocabulary.classifications.map(value=>({value,label:value}))};
    return field;
  });
  return <EntityForm {...props} partial={props.partial ?? Boolean(props.entity)} fields={fields} initialValues={data?{...props.initialValues,...entityFormValues(fields,data.values)}:props.initialValues}/>;
}

const same = (a: FieldValue, b: FieldValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isBlank = (value: FieldValue) => value === null || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);

/** Cómo se lee un valor en la lista de cambios: el texto de la opción, no su clave. */
function displayValue(field: FieldConfig, value: FieldValue): string {
  if (isBlank(value)) return "vacío";
  if (field.type === "tristate" || field.type === "checkbox") return value === true ? "Sí" : value === false ? "No" : "Sin dato";
  if (field.type === "duration" && typeof value === "number") return formatSeconds(value);
  if ((field.type === "select" || field.type === "multiselect") && "options" in field) {
    const label = (item: string) => field.options.find((option) => option.value === item)?.label ?? item;
    return Array.isArray(value) ? value.map(String).map(label).join(", ") : label(String(value));
  }
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function EntityForm({
  title, fields, initialValues, extraFields, extraChanges = [], panels = [], partial=false, submitLabel = "Guardar", onSubmit, onSuccess, onClose, wide,
}: EntityFormModalProps) {
  const [original] = useState(initialValues);
  const [values, setValues] = useState<Record<string, FieldValue>>(initialValues);
  const [view, setView] = useState("data");
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(["data"]));
  const [activeSection, setActiveSection] = useState<string>();
  const [note, setNote] = useState("");
  const [saving, setBusy] = useState(false);
  const uploading = useImageUploadsPending();
  const busy = saving || uploading;
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [discarding, setDiscarding] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const formId = useId();
  const mainRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLParagraphElement>(null);
  const creating = !partial;

  // Una ficha que aún no trae valor no obliga a inventarlo (misma relajación que recibe FormFields).
  const effectiveFields = partial
    ? fields.map(field => "required" in field && field.required && !original[field.key] && !(field.key in values && values[field.key]) ? { ...field, required: false } : field)
    : fields;
  const sections: FieldSection[] = useMemo(() => groupFields(effectiveFields), [effectiveFields]);
  const changes = useMemo(() => [
    ...fields.filter((field) => !same(values[field.key], original[field.key]))
      .filter((field) => !(creating && isBlank(values[field.key])))
      .map((field) => ({ label: field.label, before: displayValue(field, original[field.key]), after: displayValue(field, values[field.key]) })),
    ...extraChanges,
  ], [fields, values, original, creating, extraChanges]);
  const dirty = changes.length > 0;
  // Con secciones y relaciones, el editor ocupa casi la pantalla y lleva menú; un formulario corto sigue siendo una ventana.
  const roomy = panels.length > 0 || sections.length > 2 || Boolean(wide);

  // El primer campo con error —o el aviso del servidor— recibe el foco: en un
  // formulario largo, un mensaje en la cabecera puede quedar fuera de la vista.
  useEffect(() => {
    if (!focusSignal) return;
    const target = formRef.current?.querySelector<HTMLElement>(".has-error textarea, .has-error select, .has-error input")
      ?? document.querySelector<HTMLElement>(`#${CSS.escape(`${formId}-tray`)} .has-error textarea`)
      ?? bannerRef.current;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [focusSignal, formId]);

  // La sección que se está leyendo queda marcada en el menú.
  useEffect(() => {
    if (!roomy || view !== "data" || !mainRef.current) return undefined;
    const root = mainRef.current;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSection(visible.target.getAttribute("data-section") ?? undefined);
    }, { root, rootMargin: "0px 0px -65% 0px" });
    root.querySelectorAll("[data-section]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [roomy, view, sections.length]);

  function clearFieldError(key: string) {
    setFieldErrors(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
  }

  function handleChange(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
    clearFieldError(key);
  }

  function open(key: string) {
    setView(key);
    setVisited((prev) => prev.has(key) ? prev : new Set([...prev, key]));
    mainRef.current?.scrollTo({ top: 0 });
  }

  function goToSection(key: string) {
    if (view !== "data") setView("data");
    requestAnimationFrame(() => {
      mainRef.current?.querySelector<HTMLElement>(`[data-section="${key}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      setActiveSection(key);
    });
  }

  /** Cerrar con cambios sin guardar exige confirmación: el descarte no debe ser accidental. */
  function requestClose() {
    if (busy || hasPendingImageUploads()) return;
    if (dirty) { setDiscarding(true); return; }
    onClose();
  }

  function discard() {
    setValues(original);
    setNote("");
    setFieldErrors({});
    setError(undefined);
    setShowDiff(false);
  }

  function validate(): Record<string, string> {
    const problems: Record<string, string> = {};
    if (!note.trim()) problems["__note"] = "Elige o escribe un motivo: queda en la auditoría.";
    for (const field of effectiveFields) {
      if (!("required" in field) || !field.required) continue;
      const value = values[field.key];
      const empty = value === null || value === undefined || (typeof value === "string" && !value.trim());
      if (empty) problems[field.key] = field.type === "select" ? `Selecciona ${field.label.toLowerCase()}.` : `${field.label} es obligatorio.`;
    }
    return problems;
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || hasPendingImageUploads()) return;
    if (!creating && !dirty) return;
    const problems = validate();
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      setError(undefined);
      if (Object.keys(problems).some((key) => key !== "__note")) setView("data");
      setFocusSignal((count) => count + 1);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(undefined);
    try {
      const normalized = Object.fromEntries(Object.entries(values).filter(([key,value])=>!partial || !same(value, original[key])));
      for (const field of fields) {
        const value = normalized[field.key];
        if ((field.type === "url" || field.type === "mediaUrl" || field.type === "date" || field.type === "text" || field.type === "textarea")
          && !field.required && typeof value === "string" && !value.trim()) {
          normalized[field.key] = null;
        }
      }
      const result = await onSubmit(normalized, note.trim());
      onSuccess(result);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "No se pudo guardar.");
      setFocusSignal((count) => count + 1);
      setBusy(false);
    }
  }

  const activePanel = panels.find((panel) => panel.key === view);
  const dataForm = (
    <form ref={formRef} id={`${formId}-data`} className="eedit__form" hidden={view !== "data"} onSubmit={(event) => void handleSubmit(event)} noValidate>
      {error ? <p ref={bannerRef} tabIndex={-1} className="form-error-banner" role="alert">{error}</p> : null}
      <fieldset disabled={saving} className="image-upload-fields eedit__fieldset">
        {sections.map((section, index) => (
          <section key={section.key} className="eedit__section" data-section={section.key} aria-labelledby={`${formId}-${section.key}`}>
            <h3 id={`${formId}-${section.key}`} className="eedit__section-title">{section.title}</h3>
            {section.description ? <p className="eedit__section-description">{section.description}</p> : null}
            {index === 0 && extraFields ? <div className="eedit__extra">{extraFields}</div> : null}
            <FormFields fields={section.fields} values={values} errors={fieldErrors} onChange={handleChange} />
          </section>
        ))}
      </fieldset>
    </form>
  );

  const tray = (
    <div className={`eedit__tray${dirty ? " is-dirty" : ""}`} id={`${formId}-tray`}>
      {dirty && showDiff ? (
        <ul className="eedit__diff" aria-label="Cambios sin guardar">
          {changes.map((change) => (
            <li key={change.label}>
              <span className="eedit__diff-label">{change.label}</span>
              <span className="eedit__diff-before">{change.before}</span>
              <span className="eedit__diff-arrow" aria-hidden="true">→</span>
              <span className="eedit__diff-after">{change.after}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* En las secciones que se guardan al momento el motivo de la bandeja estorba: cada panel pide el suyo. */}
      {(dirty || creating) && (view === "data" || fieldErrors["__note"]) ? (
        <NoteField value={note} onChange={(next) => { setNote(next); clearFieldError("__note"); }} rows={1}
          label="Motivo del cambio" presets={NOTE_PRESETS.edit} error={fieldErrors["__note"]} hint="Se guarda en el historial de la ficha." />
      ) : null}
      <div className="eedit__tray-row">
        <p className="eedit__status" role="status">
          {dirty ? (
            <>
              <span className="eedit__dot" aria-hidden="true" />
              {changes.length === 1 ? "1 cambio sin guardar" : `${changes.length} cambios sin guardar`}
              <button type="button" className="btn-link" aria-expanded={showDiff} onClick={() => setShowDiff((value) => !value)}>
                {showDiff ? "Ocultar" : "Ver cambios"}
              </button>
            </>
          ) : creating ? "Completa los datos y guarda." : "Sin cambios pendientes en los datos."}
        </p>
        <div className="eedit__tray-actions">
          {dirty && !creating ? <button type="button" className="btn btn--ghost" onClick={discard} disabled={busy}>Descartar</button> : null}
          <button type="button" className="btn" onClick={requestClose} disabled={busy}>{dirty ? "Cancelar" : "Cerrar"}</button>
          <button type="submit" form={`${formId}-data`} className="btn btn--primary" disabled={busy || (!creating && !dirty)}>
            {uploading ? "Subiendo imagen…" : saving ? "Guardando…" : creating ? submitLabel : changes.length > 1 ? `Guardar ${changes.length} cambios` : submitLabel === "Guardar" ? "Guardar cambio" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Modal title={title} onClose={requestClose} editor={roomy} closeOnOverlay={!dirty} {...(wide === undefined || roomy ? {} : { wide })}>
      <div className={`eedit${roomy ? " eedit--roomy" : ""}`}>
        {roomy ? (
          <nav className="eedit__nav" aria-label="Secciones de edición">
            <p className="eedit__nav-heading">Datos de la ficha</p>
            <ul>
              {sections.map((section) => (
                <li key={section.key}>
                  <button type="button" className="eedit__nav-item" aria-current={view === "data" && activeSection === section.key ? "true" : undefined}
                    onClick={() => goToSection(section.key)}>
                    {section.title}
                    {section.fields.some((field) => fieldErrors[field.key]) ? <span className="eedit__nav-error" aria-label="con errores">!</span>
                      : section.fields.some((field) => !same(values[field.key], original[field.key])) ? <span className="eedit__nav-dot" aria-label="con cambios" /> : null}
                  </button>
                </li>
              ))}
            </ul>
            {panels.length ? (
              <>
                <p className="eedit__nav-heading eedit__nav-heading--live" title="Cada cambio se guarda al momento y tiene «Deshacer» en el aviso.">
                  <Lightning size={13} weight="fill" aria-hidden="true" /> Se guardan al momento
                </p>
                <ul>
                  {panels.map((panel) => (
                    <li key={panel.key}>
                      <button type="button" className="eedit__nav-item" aria-current={view === panel.key ? "page" : undefined} onClick={() => open(panel.key)}>
                        {panel.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </nav>
        ) : null}
        <div className="eedit__main" ref={mainRef}>
          {dataForm}
          {panels.map((panel) => visited.has(panel.key) ? (
            <div key={panel.key} hidden={view !== panel.key} className="eedit__panel">
              <header className="eedit__panel-head">
                <h3>{panel.label}</h3>
                <p><Lightning size={13} weight="fill" aria-hidden="true" /> Cada cambio de esta sección se guarda al momento y tiene «Deshacer» en el aviso. No depende de «Guardar».</p>
              </header>
              {panel.content}
            </div>
          ) : null)}
          {activePanel && dirty ? (
            <p className="eedit__panel-pending">Tienes {changes.length === 1 ? "1 cambio" : `${changes.length} cambios`} en los datos de la ficha sin guardar: siguen en la bandeja.</p>
          ) : null}
        </div>
      </div>
      {tray}
      {discarding ? (
        <ConfirmDialog title="Descartar cambios" danger requireNote={false} confirmLabel="Descartar"
          description={`Hay ${changes.length === 1 ? "1 cambio" : `${changes.length} cambios`} sin guardar en los datos de esta ficha. Si descartas, se pierden. Lo guardado al momento en las otras secciones se conserva.`}
          onConfirm={() => onClose()} onClose={() => setDiscarding(false)} />
      ) : null}
    </Modal>
  );
}
