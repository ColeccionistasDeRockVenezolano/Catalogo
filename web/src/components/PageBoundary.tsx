import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { ServiceErrorPage } from "./ServiceErrorPage";
import { useShowErrorDetail } from "../lib/errorVisibility";

/** Keep navigation and other persistent sections alive when a page fails. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  return (
    <ErrorBoundary resetKey={`${pathname}${search}`} fallback={(error, retry, code) => <PageErrorFallback error={error} retry={retry} code={code} />}>
      {children}
    </ErrorBoundary>
  );
}

function PageErrorFallback({ error, retry, code }: { error: Error; retry: () => void; code: string }) {
  const showDetail = useShowErrorDetail();
  if (!showDetail) return <ServiceErrorPage variant="unexpected" code={code} heading="h1" onRetry={retry} />;
  return (
    <div className="state-block is-error" role="alert">
      <h3>No se pudo mostrar esta página</h3>
      <p>{error.message}</p>
      <p style={{ color: "var(--text-faint)", fontSize: 12.5 }}>Código en el log: <code>{code}</code></p>
      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn btn--sm" onClick={retry}>Reintentar</button>
      </div>
    </div>
  );
}
