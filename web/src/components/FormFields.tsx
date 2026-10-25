import { useId, useState } from "react";
import { ImageUploadField } from "./ImageUploadField";

export type FieldValue = string | number | boolean | string[] | null | undefined;

export type FieldConfig =
  | { key: string; label: string; type: "text" | "url" | "mediaUrl" | "date"; required?: boolean; span2?: boolean; hint?: string }
  | { key: string; label: string; type: "number"; required?: boolean; hint?: string }
  /** Segundos que se escriben y leen como m:ss (o h:mm:ss). */
  | { key: string; label: string; type: "duration"; required?: boolean; hint?: string }
  | { key: string; label: string; type: "textarea"; required?: boolean; span2?: boolean; hint?: string }
  | { key: string; label: string; type: "select"; required?: boolean; options: ReadonlyArray<{ value: string; label: string }>; allowEmpty?: boolean; hint?: string }
  | { key: string; label: string; type: "checkbox"; hint?: string }
  | { key: string; label: string; type: "multiselect"; options: ReadonlyArray<{ value: string; label: string }>; allowCustom?: boolean; span2?: boolean; hint?: string }
  /** Sí / No / Sin dato: un booleano donde NULL significa «nadie lo dijo». */
  | { key: string; label: string; type: "tristate"; required?: false; hint?: string };

interface FormFieldsProps {
  fields: readonly FieldConfig[];
  values: Record<string, FieldValue>;
  onChange: (key: string, value: FieldValue) => void;
  errors?: Record<string, string>;
}

export function FormFields({ fields, values, onChange, errors }: FormFieldsProps) {
  const formId = useId();
  return (
    <div className="form-grid">
      {fields.map((field) => {
        const value = values[field.key];
        const fieldId = `${formId}-${field.key}`;
        const error = errors?.[field.key];
        const spanClass = "span2" in field && field.span2 ? "field span-2" : "field";

        if (field.type === "multiselect") {
          const selected = Array.isArray(value) ? value : [];
          return <fieldset className={`${spanClass} field--multiselect`} key={field.key}>
            <legend>{field.label}</legend>
            <div className="field-choices">{[...field.options,...selected.filter(v=>!field.options.some(o=>o.value===v)).map(value=>({value,label:value}))].map(option => <label className="checkbox-field" key={option.value}>
              <input type="checkbox" checked={selected.includes(option.value)} onChange={event => onChange(field.key,
                event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value))} />
              {option.label}
            </label>)}</div>
            {field.allowCustom ? <ClassificationInput onAdd={value=>onChange(field.key,[...new Set([...selected,value])])}/> : null}
            {field.hint ? <span className="hint">{field.hint}</span> : null}
          </fieldset>;
        }

        if (field.type === "checkbox") {
          return (
            <div className={`${spanClass} checkbox-field`} key={field.key}>
              <input
                id={fieldId} type="checkbox" checked={Boolean(value)}
                onChange={(event) => onChange(field.key, event.target.checked)}
              />
              <label htmlFor={fieldId}>{field.label}</label>
            </div>
          );
        }

        return (
          <div className={`${spanClass} ${error ? "has-error" : ""}`} key={field.key}>
            <label htmlFor={fieldId}>{field.label}{field.required ? " *" : ""}</label>
            {field.type === "mediaUrl" ? (
              <ImageUploadField id={fieldId} label={field.label} value={typeof value === "string" ? value : ""} required={field.required ?? false} onChange={url => onChange(field.key, url)} />
            ) : field.type === "textarea" ? (
              <textarea id={fieldId} value={(value as string) ?? ""} onChange={(event) => onChange(field.key, event.target.value)} />
            ) : field.type === "select" ? (
              <select id={fieldId} required={field.required} value={(value as string) ?? ""} onChange={(event) => onChange(field.key, event.target.value || null)}>
                <option value="">{field.required && !field.allowEmpty ? "Selecciona…" : "—"}</option>
                {typeof value === "string" && value && !field.options.some((option) => option.value === value) ? <option value={value}>{value}</option> : null}
                {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.type === "tristate" ? (
              <select id={fieldId} value={value === true ? "yes" : value === false ? "no" : ""}
                onChange={(event) => onChange(field.key, event.target.value === "yes" ? true : event.target.value === "no" ? false : null)}>
                <option value="">Sin dato</option>
                <option value="yes">Sí</option>
                <option value="no">No</option>
              </select>
            ) : field.type === "duration" ? (
              <DurationInput id={fieldId} value={typeof value === "number" ? value : null} onChange={(seconds) => onChange(field.key, seconds)} />
            ) : field.type === "number" ? (
              <input
                id={fieldId} type="number" required={field.required} value={value === null || value === undefined ? "" : String(value)}
                onChange={(event) => onChange(field.key, event.target.value === "" ? null : Number(event.target.value))}
              />
            ) : (
              <input
                id={fieldId} required={field.required} type={field.type === "url" ? "url" : field.type === "date" ? "date" : "text"}
                value={(value as string) ?? ""} onChange={(event) => onChange(field.key, event.target.value)}
              />
            )}
            {field.hint ? <span className="hint">{field.hint}</span> : null}
            {error ? <span className="error">{error}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ClassificationInput({onAdd}:{onAdd:(value:string)=>void}) {
 const [value,setValue]=useState("");const id=useId();
 return <div className="field"><label htmlFor={id}>Otra clasificación musical</label><div className="relation-editor__actions"><input id={id} value={value} maxLength={60} placeholder="Nombre de la clasificación" onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(value.trim()){onAdd(value.trim());setValue("");}}}} onChange={e=>setValue(e.target.value)}/><button type="button" className="btn" disabled={!value.trim()} onClick={()=>{onAdd(value.trim());setValue("");}}>Añadir clasificación</button></div></div>;
}

/** 245 → «4:05»; 3725 → «1:02:05». */
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** «4:05», «1:02:05» o solo segundos («245»); null si no se entiende. */
export function parseDuration(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Number(value);
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/u.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return undefined;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

function DurationInput({ id, value, onChange }: { id: string; value: number | null; onChange: (seconds: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : formatSeconds(value));
  const parsed = parseDuration(text);
  return (
    <>
      <input id={id} inputMode="numeric" placeholder="m:ss" value={text} aria-invalid={parsed === undefined ? true : undefined}
        onChange={(event) => { setText(event.target.value); const next = parseDuration(event.target.value); if (next !== undefined) onChange(next); }}
        onBlur={() => { if (parsed !== undefined && parsed !== null) setText(formatSeconds(parsed)); }} />
      {parsed === undefined ? <span className="error">Escribe minutos y segundos, por ejemplo 4:05.</span> : null}
    </>
  );
}
