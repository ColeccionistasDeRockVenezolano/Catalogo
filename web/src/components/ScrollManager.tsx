import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// BrowserRouter no gestiona el desplazamiento: al abrir una ficha desde una
// lista bajada, la ventana conservaba la altura anterior. Aquí:
//  - cambiar de ruta (enlace o redirección) empieza arriba, o en el #ancla;
//  - Atrás/Adelante vuelve a donde estaba esa entrada del historial;
//  - cambiar solo la búsqueda (filtros, pestañas, paginación) no mueve nada:
//    la paginación lleva su propio salto al inicio de su lista.
const STORAGE_KEY = "crv:scroll-positions";
const MAX_ENTRIES = 80;
// Las listas piden sus datos de nuevo al volver: hay que esperar a que crezcan.
const RESTORE_TIMEOUT_MS = 10_000;

function readPositions(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Map(raw ? JSON.parse(raw) as [string, number][] : []);
  } catch {
    return new Map();
  }
}

const positions = readPositions();

function remember(key: string, top: number) {
  positions.delete(key);
  positions.set(key, top);
  while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value as string);
}

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions])); } catch { /* sin almacenamiento: solo en memoria */ }
}

function scrollToHash(hash: string): boolean {
  if (!hash) return false;
  let target: Element | null;
  try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return false; }
  if (!target) return false;
  target.scrollIntoView({ block: "start", behavior: "instant" });
  return true;
}

/**
 * Las páginas cargan sus datos tras montarse: la altura guardada puede no
 * existir todavía. Se reintenta hasta alcanzarla, agotar el plazo o que la
 * persona mueva la página por su cuenta.
 */
function restore(top: number): () => void {
  let frame = 0;
  const started = performance.now();
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.removeEventListener(type, stop);
  };
  const step = () => {
    const reachable = document.documentElement.scrollHeight - window.innerHeight >= top;
    window.scrollTo({ top, left: 0, behavior: "instant" });
    if (reachable || performance.now() - started > RESTORE_TIMEOUT_MS) stop();
    else frame = requestAnimationFrame(step);
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) window.addEventListener(type, stop, { passive: true });
  step();
  return stop;
}

export function ScrollManager() {
  const { key, pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  // La entrada que se está leyendo: el desplazamiento se anota a su nombre.
  const current = useRef({ key, pathname, hash });

  useEffect(() => {
    if (!("scrollRestoration" in history)) return;
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const onScroll = () => remember(current.current.key, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      history.scrollRestoration = previous;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
    };
  }, []);

  // Antes de pintar la nueva ruta, para que no se vea un instante a media altura.
  useLayoutEffect(() => {
    const previous = current.current;
    if (previous.key === key) return;
    // No se lee window.scrollY aquí: la página nueva ya está montada y la
    // altura vieja llega recortada a la suya. Vale la última anotada al desplazarse.
    persist();
    current.current = { key, pathname, hash };
    if (navigationType === "POP") {
      const saved = positions.get(key);
      if (saved !== undefined) return restore(saved);
    } else if (previous.pathname === pathname && previous.hash === hash) {
      // Solo cambió la búsqueda (filtros, pestañas, paginación): no es una página nueva.
      return;
    }
    if (!scrollToHash(hash)) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [key, pathname, hash, navigationType]);

  return null;
}
