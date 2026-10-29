import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadForNewBuild } from "../lib/staleBuild";

interface ErrorBoundaryState {
  error: Error | undefined;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
  resetKey?: unknown;
  onError?: () => void;
  fallback?: (error: Error, retry: () => void) => ReactNode;
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
 * mensaje ni salida. Aquí se muestra qué pasó, se ofrece recargar y el error
 * queda en consola para el reporte.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  private retry = () => {
    // Un chunk perdido tras un deploy no se recupera re-renderizando: React.lazy
    // conserva el rechazo. Reintentar significa recargar con el build nuevo.
    if (isChunkLoadError(this.state.error)) window.location.reload();
    else this.setState({ error: undefined });
  };

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    // Changing a URL only resets a failed page; healthy pages keep their state.
    if (this.state.error && !Object.is(previous.resetKey, this.props.resetKey)) this.retry();
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error) && reloadForNewBuild()) return;
    // eslint-disable-next-line no-console -- la consola del navegador es el canal de diagnóstico de un error de render
    console.error("CRV: error de render", error, info.componentStack);
    this.props.onError?.();
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    if (this.props.label) return <ErrorNotice label={this.props.label} onRetry={this.retry} />;
    return (
      <div className="state-block is-error" role="alert">
        <h3>La interfaz encontró un error</h3>
        <p>
          No se pudo mostrar la interfaz. Recarga la página;
          si vuelve a pasar, el detalle está en la consola del navegador (F12).
        </p>
        <p style={{ color: "var(--text-faint)", fontSize: 12.5 }}>{error.message}</p>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>Recargar</button>
        </div>
      </div>
    );
  }
}
