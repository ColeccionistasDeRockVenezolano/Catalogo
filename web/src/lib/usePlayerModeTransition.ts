import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Efecto único de los reproductores (Brian, 2026-11-13): el rebote corto que
 * ya tenía la miniatura se usa en todos los cambios de modo —incrustado, cine
 * y flotante— y al ampliar o reducir la ventana flotante. Mantener en sincronía
 * con `--player-pop-*` en `styles/video-player.css`.
 */
export const PLAYER_POP = { duration: 150, easing: "cubic-bezier(0.18, 0.89, 0.32, 1.28)" } as const;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * El reproductor no se remonta al cambiar de modo (el iframe sigue sonando):
 * se guarda su caja antes del cambio y se anima desde ella hasta la nueva.
 * Se mide en el siguiente cuadro, cuando la ventana flotante o el hueco
 * incrustado ya fijaron su posición, y antes de pintarlo.
 */
export function usePlayerModeTransition(panel: RefObject<HTMLElement>, mode: string) {
  const from = useRef<DOMRect | null>(null);
  const capture = useCallback(() => {
    const rect = panel.current?.getBoundingClientRect();
    if (rect && rect.width && rect.height) from.current = rect;
  }, [panel]);
  const previousMode = useRef(mode);
  useLayoutEffect(() => {
    const old = from.current;
    from.current = null;
    const entering = previousMode.current !== mode;
    previousMode.current = mode;
    if (prefersReducedMotion()) return;
    if (!old) {
      // Sin caja de origen fiable (se cambió de página, o el hueco desapareció):
      // la ventana flotante entra con el mismo rebote en todos los reproductores.
      if (!entering || mode !== "floating") return;
      const frame = requestAnimationFrame(() => {
        panel.current?.animate([
          { opacity: 0, transform: "scale(0.85)" },
          { opacity: 1, transform: "scale(1)" },
        ], { ...PLAYER_POP, composite: "add" });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => {
      const element = panel.current;
      if (!element) return;
      // Una transición CSS de ancho a medio camino falsearía la caja final.
      element.style.transition = "none";
      const now = element.getBoundingClientRect();
      element.style.transition = "";
      if (!now.width || !now.height) return;
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(old.width - now.width) < 1) return;
      element.animate([
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${old.width / now.width}, ${old.height / now.height})` },
        { transformOrigin: "0 0", transform: "translate(0, 0) scale(1, 1)" },
      ], { ...PLAYER_POP, composite: "add" });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, panel]);
  return capture;
}
