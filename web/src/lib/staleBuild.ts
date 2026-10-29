/**
 * Pestañas abiertas antes de un deploy. `vite build` vacía dist-public/assets,
 * así que una pestaña vieja pide chunks con hash que ya no existen (404).
 * React.lazy guarda la promesa rechazada: reintentar el render vuelve a lanzar
 * el mismo error sin tocar la red. La única salida es recargar el documento
 * para recibir el index.html nuevo (servido con no-cache).
 */

const RELOAD_KEY = "crv:stale-build-reload";
// Si el build nuevo también falla, no recargar en bucle: una sola recarga
// automática por ventana; después queda el aviso con su botón.
const RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR = [
  "Failed to fetch dynamically imported module", // Chrome
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
  "Unable to preload CSS", // Vite
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR.some(fragment => message.includes(fragment));
}

/** Recarga una vez por ventana; devuelve false si ya se intentó hace poco. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* Sin sessionStorage se recarga igual; el navegador corta bucles evidentes. */ }
  window.location.reload();
  return true;
}
