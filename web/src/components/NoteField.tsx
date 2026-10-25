// CRV · El motivo de un cambio. La API lo exige en toda escritura
// (src/api/auth.ts) y queda en la auditoría; aquí los motivos frecuentes se
// eligen con un clic y el texto sigue siendo editable.
import { useId } from "react";

export const NOTE_PRESETS = {
  edit: ["Corrección de dato", "Dato de la fuente", "Completar la ficha", "Error de ingesta"],
  remove: ["Ficha duplicada", "No pertenece al catálogo", "Error de ingesta", "Dato inventado o sin fuente"],
  undo: ["Cambio hecho por error", "No correspondía", "Lo revisé y estaba bien antes"],
  redo: ["Sí correspondía", "Deshecho por error"],
  relation: ["Según los créditos", "Dato de la fuente", "Corrección de dato", "Duplicado"],
} as const;

interface NoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  presets?: readonly string[];
  label?: string;
  placeholder?: string;
  error?: string | undefined;
  rows?: number;
  hint?: string;
  autoFocus?: boolean;
  required?: boolean;
}

export function NoteField({
  value, onChange, presets = NOTE_PRESETS.edit, label = "Motivo", placeholder = "Por qué se hace este cambio",
  error, rows = 2, hint, autoFocus, required = true,
}: NoteFieldProps) {
  const id = useId();
  const current = value.trim();
  return (
    <div className={`field note-field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}{required ? " *" : ""}</label>
      {presets.length ? (
        <div className="note-field__presets" role="group" aria-label="Sugerencias de motivo">
          {presets.map((preset) => (
            <button key={preset} type="button" className="note-chip" aria-pressed={current === preset}
              onClick={() => onChange(current === preset ? "" : preset)}>
              {preset}
            </button>
          ))}
        </div>
      ) : null}
      <textarea id={id} rows={rows} maxLength={2000} value={value} placeholder={placeholder} autoFocus={autoFocus}
        aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
