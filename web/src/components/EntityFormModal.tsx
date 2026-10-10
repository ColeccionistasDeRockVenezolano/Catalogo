import { useId, useState } from "react";
import { Modal } from "./Modal";
import { FormFields, type FieldConfig, type FieldValue } from "./FormFields";
import { ApiError } from "../lib/api";
import type { EntityWriteResult } from "../lib/types";

interface EntityFormModalProps {
  title: string;
  fields: readonly FieldConfig[];
  initialValues: Record<string, FieldValue>;
  extraFields?: React.ReactNode;
  panels?: ReadonlyArray<{ key: string; label: string; content: React.ReactNode }>;
  submitLabel?: string;
  onSubmit: (values: Record<string, FieldValue>, note: string) => Promise<EntityWriteResult>;
  onSuccess: (result: EntityWriteResult) => void;
  onClose: () => void;
  wide?: boolean;
}

export function EntityFormModal({
  title, fields, initialValues, extraFields, panels, submitLabel = "Guardar", onSubmit, onSuccess, onClose, wide,
}: EntityFormModalProps) {
  const [values, setValues] = useState<Record<string, FieldValue>>(initialValues);
  const [activePanel, setActivePanel] = useState("data");
  const panelId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function handleChange(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) { setError("El motivo es obligatorio: queda en la auditoría."); return; }
    setBusy(true);
    setError(undefined);
    try {
      const normalized = { ...values };
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
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} {...(wide === undefined ? {} : { wide })}>
      {panels?.length ? <div className="entity-edit-nav" aria-label="Secciones de edición">
        {[{ key: "data", label: "Datos de la ficha" }, ...panels].map((panel) => (
          <button type="button" key={panel.key} className={`btn btn--sm${activePanel === panel.key ? " btn--primary" : ""}`}
            aria-pressed={activePanel === panel.key} aria-controls={`${panelId}-${panel.key}`} onClick={() => setActivePanel(panel.key)}>{panel.label}</button>
        ))}
      </div> : null}
      <form id={`${panelId}-data`} hidden={activePanel !== "data"} onSubmit={handleSubmit}>
        {error ? <p className="form-error-banner">{error}</p> : null}
        {extraFields}
        <FormFields fields={fields} values={values} onChange={handleChange} />
        <div className="field span-2" style={{ marginTop: 14 }}>
          <label htmlFor="entity-note">Motivo *</label>
          <textarea id="entity-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="Por qué se hace este cambio" />
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : submitLabel}</button>
        </div>
      </form>
      {panels?.map((panel) => <div key={panel.key} hidden={activePanel !== panel.key} id={`${panelId}-${panel.key}`}>{panel.content}</div>)}
    </Modal>
  );
}
