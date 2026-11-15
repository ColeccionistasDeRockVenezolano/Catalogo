import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadForNewBuild } from "../lib/staleBuild";
import { newIncidentCode, reportError } from "../lib/clientErrors";
import { ServiceErrorPage } from "./ServiceErrorPage";

interface ErrorBoundaryState {
  error: Error | undefined;
  /** Código de referencia que ve el usuario y que lleva la entrada del log. */
  code: string | undefined;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
  resetKey?: unknown;
  onError?: () => void;
  fallback?: (error: Error, retry: () => void, code: string) => ReactNode;
}

export function ErrorNotice({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div className="state-block is-error" role="alert" aria-label={label}>
    <h3>No se pudo mostrar {label}</h3>
    <p>Puedes reintentar o continuar navegando por el catálogo.</p>
    <button type="button" className="btn btn--sm" onClick={onRetry}>Reintentar</button>
  </div>;
}

/**
 * Red de seguridad de la SPA: un error de render en cualquier página (un dato
 * con forma inesperada, por ejemplo) dejaba la aplicación en blanco, sin
 * mensaje ni salida. El detalle va al log del servidor con un código; quien
 * visita solo ve la pantalla de servicio y ese código (lib/clientErrors.ts).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined, code: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)), code: newIncidentCode() };
  }

  private retry = () => {
    // Un chunk perdido tras un deploy no se recupera re-renderizando: React.lazy
    // conserva el rechazo. Reintentar significa recargar con el build nuevo.
    if (isChunkLoadError(this.state.error)) window.location.reload();
    else this.setState({ error: undefined, code: undefined });
  };

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    // Changing a URL only resets a failed page; healthy pages keep their state.
    if (this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) this.retry();
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error) && reloadForNewBuild()) return;
    const code = this.state.code ?? newIncidentCode();
    reportError(code, "render", error, { componentStack: info.componentStack ?? undefined });
    // eslint-disable-next-line no-console -- en desarrollo la consola sigue siendo el canal rápido; en producción, solo el log
    if (import.meta.env.DEV) console.error("CRV: error de render", code, error, info.componentStack);
    this.props.onError?.();
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const code = this.state.code ?? "CRV-000000";
    if (this.props.fallback) return this.props.fallback(error, this.retry, code);
    if (this.props.label) return <ErrorNotice label={this.props.label} onRetry={this.retry} />;
    // Raíz: fuera del router y de la sesión; sin detalle para nadie (el detalle está en el log).
    return <ServiceErrorPage variant="unexpected" code={code} heading="h1" onRetry={() => window.location.reload()} />;
  }
}
