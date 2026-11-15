export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string | undefined; action?: ReactNode }) {
  return (
    <div className="state-block">
      <MagnifyingGlass className="icon" aria-hidden="true" />
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

/**
 * Fallo de carga. Quien visita ve la pantalla de servicio con un código de
 * referencia; el detalle (mensaje, estado HTTP) va al log con ese código.
 * Solo un administrador dentro de Curaduría o Administración ve el mensaje.
 * `error` (el valor original, p. ej. ApiError) permite reutilizar el código
 * que el servidor ya registró en un 5xx.
 */
export function ErrorState({ message, onRetry, error }: { message: string; onRetry?: () => void; error?: unknown }) {
  const showDetail = useShowErrorDetail();
  // Un mensaje nuevo es un incidente nuevo, aunque no llegue el valor original.
  const code = useMemo(() => incidentCodeFor(error), [message, error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reportError(code, "load", error ?? message); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps -- un reporte por código
  if (!showDetail) return <ServiceErrorPage code={code} onRetry={onRetry} />;
  return (
    <div className="state-block is-error" role="alert">
      <WarningCircle className="icon" aria-hidden="true" weight="bold" />
      <h3>No se pudo cargar</h3>
      <p>{message}</p>
      <p style={{ color: "var(--text-faint)", fontSize: 12.5 }}>Código en el log: <code>{code}</code></p>
      {onRetry ? (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button>
        </div>
      ) : null}
    </div>
  );
}
import { useEffect, useMemo, type ReactNode } from "react";
import { incidentCodeFor, reportError } from "../lib/clientErrors";
import { useShowErrorDetail } from "../lib/errorVisibility";
import { ServiceErrorPage } from "./ServiceErrorPage";
import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
