// CRV · Controles del editor de estilos: dial de ángulo, deslizadores con
// valor editable, interruptores, fichas de opción y colores.
import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const clampAngle = (value: number): number => Math.min(360, Math.max(0, Math.round(value)));

/** Dial circular de 0–360° con campo numérico y atajos a los cuatro ejes. */
export function AngleDial({ label, value, onChange, hint }: {
  label: string; value: number; onChange: (value: number, commit?: boolean) => void; hint?: string;
}) {
  const dial = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const fromPointer = (event: PointerEvent<HTMLDivElement>): number => {
    const box = dial.current!.getBoundingClientRect();
    const degrees = Math.atan2(event.clientX - (box.left + box.width / 2), (box.top + box.height / 2) - event.clientY) * 180 / Math.PI;
    const angle = (degrees + 360) % 360;
    // Imanta cada 5°; con Mayús, grado a grado.
    return event.shiftKey ? Math.round(angle) % 360 : (Math.round(angle / 5) * 5) % 360;
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 15 : 1;
    const keys: Record<string, number> = {
      ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step,
      PageUp: value + 45, PageDown: value - 45, Home: 0, End: 360,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(event.key === "End" ? 360 : ((next % 360) + 360) % 360);
  };
  return <div className="ne-angle" role="group" aria-label={label} aria-describedby={hint ? hintId : undefined}>
    <span className="ne-field-label">{label}</span>
    <div className="ne-angle-row">
      <div
        ref={dial} className="ne-dial" role="slider" tabIndex={0}
        aria-label={`${label}: dial`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={value} aria-valuetext={`${value} grados`}
        style={{ "--angle": `${value}deg` } as CSSProperties}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onChange(fromPointer(event)); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(fromPointer(event)); }}
        onKeyDown={onKey}
      >
        <span className="ne-dial-needle" aria-hidden="true" />
      </div>
      <div className="ne-angle-side">
        <span className="ne-number"><input aria-label={`${label}: grados`} type="number" min="0" max="360" value={value} onChange={(event) => { if (event.target.value !== "" && event.target.validity.valid) onChange(clampAngle(Number(event.target.value)), true); }} /><span aria-hidden="true">°</span></span>
        <span className="ne-angle-presets">
          {[[0, "↑"], [90, "→"], [180, "↓"], [270, "←"]].map(([angle, arrow]) => <button key={angle} type="button" className={value === angle ? "is-on" : undefined} aria-label={`${label}: ${angle}°`} aria-pressed={value === angle} onClick={() => onChange(Number(angle), true)}>{arrow}</button>)}
        </span>
      </div>
    </div>
    {hint ? <small id={hintId} className="ne-hint">{hint}</small> : null}
  </div>;
}

/** Deslizador con el valor exacto editable al lado. */
export function RangeField({ label, value, min, max, step = 1, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (value: number, commit?: boolean) => void;
}) {
  const id = useId();
  return <div className="ne-range">
    <div className="ne-range-head">
      <label htmlFor={id}>{label}</label>
      <span className="ne-number"><input aria-label={`${label}: valor`} type="number" min={min} max={max} step={step} value={value} onChange={(event) => { if (event.target.value !== "" && event.target.validity.valid) onChange(Number(event.target.value), true); }} />{unit ? <span aria-hidden="true">{unit}</span> : null}</span>
    </div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

/** Interruptor accesible (checkbox con rol switch). */
export function Toggle({ label, checked, onChange, description }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; description?: string;
}) {
  return <label className="ne-switch">
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="ne-switch-track" aria-hidden="true" />
    <span className="ne-switch-text"><span>{label}</span>{description ? <small>{description}</small> : null}</span>
  </label>;
}

/** Grupo de opciones visibles de una sola elección. */
export function Choices<T extends string>({ label, value, options, onChange, columns }: {
  label: string; value: T; onChange: (value: T) => void; columns?: number;
  options: ReadonlyArray<{ value: T; label: string; hint?: string; sample?: ReactNode }>;
}) {
  const name = useId();
  return <fieldset className="ne-choices" style={columns ? { "--columns": columns } as CSSProperties : undefined}>
    <legend className="ne-field-label">{label}</legend>
    <div className="ne-choices-grid">
      {options.map((option) => <label key={option.value} className={`ne-choice${option.value === value ? " is-on" : ""}`}>
        <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
        {option.sample ? <span className="ne-choice-sample" aria-hidden="true">{option.sample}</span> : null}
        <span className="ne-choice-label">{option.label}</span>
        {option.hint ? <small>{option.hint}</small> : null}
      </label>)}
    </div>
  </fieldset>;
}

/** Muestra de color con su código hexadecimal. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="ne-color">
    <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    <span><span>{label}</span><code>{value.toUpperCase()}</code></span>
  </label>;
}
