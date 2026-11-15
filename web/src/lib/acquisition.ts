// Procedencia de quien entra por el catálogo: espejo de web/public/landing/acquisition.js.
//
// Un aviso por documento cargado (la app es de una sola página: navegar dentro
// no vuelve a contar). Solo viajan las etiquetas de campaña (`ref`, `utm_source`,
// `utm_medium`, `utm_campaign`, `utm_content`) y el origen del referente; nunca la
// URL completa, `utm_term` ni la búsqueda. El servidor resuelve la primera
// procedencia del día (src/traffic/acquisition.ts) y descarta etiquetas inválidas.
// Sin cookies ni identidad persistente. Un fallo nunca interrumpe la navegación.

const TAGS: Array<[string, string]> = [
  ["ref", "ref"], ["utm_source", "source"], ["utm_medium", "medium"], ["utm_campaign", "campaign"], ["utm_content", "content"],
];
// Pantallas internas: no son una entrada de visitantes y no deben mezclarse con la procedencia.
const EXCLUDED = /^\/(curaduria|administrar|configuracion|historial|cuenta|revision)(\/|$)/u;

/** Etiquetas de campaña de una dirección; exportada para las pruebas. */
export function campaignAttribution(search: string, referrer: string, ownOrigin: string): Record<string, string> {
  const query = new URLSearchParams(search);
  const attribution: Record<string, string> = {};
  for (const [param, key] of TAGS) {
    const value = query.get(param);
    if (value && value.length <= 80) attribution[key] = value;
  }
  try {
    if (referrer) {
      const origin = new URL(referrer).origin;
      if (origin !== ownOrigin) attribution["referrer"] = origin;
    }
  } catch { /* referente oculto o malformado */ }
  return attribution;
}

/** Ruta dentro de la app, sin el prefijo de publicación (`/crv`). */
export function appPath(pathname: string, base: string): string {
  const prefix = base.replace(/\/$/u, "");
  return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;
}

let installed = false;

/** `apiBase` llega de main.tsx (API_BASE_URL) para que este módulo no dependa del navegador al importarse. */
export function installCatalogAcquisition(apiBase: string): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (EXCLUDED.test(appPath(window.location.pathname, import.meta.env.BASE_URL))) return;
  const attribution = campaignAttribution(window.location.search, document.referrer, window.location.origin);
  const documentId = window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const endpoint = new URL("traffic/event", apiBase.endsWith("/") ? apiBase : `${apiBase}/`).toString();
  let sent = false;
  const send = () => {
    if (sent || document.hidden) return;
    sent = true;
    document.removeEventListener("visibilitychange", send);
    void fetch(endpoint, {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ page: "catalog", kind: "page", eventId: `${documentId}_page`, webdriver: navigator.webdriver === true, attribution }),
    }).catch(() => undefined);
  };
  send();
  if (!sent) document.addEventListener("visibilitychange", send);
}
