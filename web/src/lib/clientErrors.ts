// CRV · Errores del navegador hacia los logs del servidor.
//
// Regla (Brian, 2026-11-12): quien visita el catálogo no ve qué falló ni cómo
// se maneja; solo un código corto de referencia («CRV-7F3A9K»). El detalle
// viaja a POST /client-errors y queda en el log de la API con ese mismo código,
// para buscarlo cuando alguien lo reporte. Las páginas de Curaduría y
// Administración siguen mostrando el detalle, pero solo a administradores.
import { API_BASE_URL, ApiError } from "./api";

export type ClientErrorKind = "render" | "load" | "runtime";

export interface ClientErrorReport {
  code: string;
  kind: ClientErrorKind;
  message?: string | undefined;
  stack?: string | undefined;
  componentStack?: string | undefined;
  status?: number | undefined;
  apiCode?: string | undefined;
}

// Sin 0/O ni 1/I: el código se dicta o se copia a mano.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_PATTERN = /^CRV-[2-9A-HJ-NP-Z]{6}$/u;
// Un bucle de errores no debe convertirse en una ráfaga contra la API.
const MAX_REPORTS_PER_PAGE = 15;

const reported = new Set<string>();

export function newIncidentCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `CRV-${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

/** Un fallo 5xx de la API ya trae su código (el servidor lo registró con él). */
export function incidentFromError(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const incident = error.details?.["incident"];
  return typeof incident === "string" && CODE_PATTERN.test(incident) ? incident : undefined;
}

export function incidentCodeFor(error: unknown): string {
  return incidentFromError(error) ?? newIncidentCode();
}

const clip = (value: string | undefined, max: number) => (value === undefined ? undefined : value.slice(0, max));

/** Envía el detalle al log del servidor. Nunca lanza ni bloquea la interfaz; un mismo código se envía una vez. */
export function reportClientError(report: ClientErrorReport): void {
  if (reported.has(report.code) || reported.size >= MAX_REPORTS_PER_PAGE) return;
  reported.add(report.code);
  const body = JSON.stringify({
    code: report.code,
    kind: report.kind,
    path: clip(`${window.location.pathname}${window.location.search}`, 300),
    message: clip(report.message, 500),
    stack: clip(report.stack, 4000),
    componentStack: clip(report.componentStack, 4000),
    status: report.status,
    apiCode: clip(report.apiCode, 60),
  });
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  try {
    // keepalive: el reporte sale aunque el usuario pulse «Reintentar» y la página recargue.
    void fetch(new URL("client-errors", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch { /* Sin red no hay a quién avisar. */ }
}

/** Reporte de un error ya capturado (objeto Error, ApiError o texto). */
export function reportError(code: string, kind: ClientErrorKind, error: unknown, extra: Partial<ClientErrorReport> = {}): void {
  reportClientError({
    code,
    kind,
    message: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    status: error instanceof ApiError ? error.status : undefined,
    apiCode: error instanceof ApiError ? error.code : undefined,
    ...extra,
  });
}

/** Errores que nadie captura (promesas sin catch, scripts): al log, sin interfaz. */
export function installGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => {
    reportError(newIncidentCode(), "runtime", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    // Una petición cancelada a propósito no es un fallo.
    if (event.reason instanceof DOMException && event.reason.name === "AbortError") return;
    reportError(newIncidentCode(), "runtime", event.reason);
  });
}
