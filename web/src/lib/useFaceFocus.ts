import { useCallback, useRef } from "react";
import type { ImageFocus } from "./types.js";
import { focusPosition } from "./faceFocus.js";

function cssFraction(style: CSSStyleDeclaration, name: string, fallback: number) {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Encuadra una foto recortada con `object-fit: cover` en sus rostros. La hoja de
 * estilos decide dónde deben quedar con `--face-x` y `--face-y` (fracciones del
 * recuadro); sin rostros manda su `object-position`. Se recalcula al cargar la
 * imagen y cuando el recuadro cambia de tamaño.
 */
export function useFaceFocus(focus: ImageFocus | null) {
  const node = useRef<HTMLImageElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const apply = useCallback(() => {
    const image = node.current;
    if (!image) return;
    if (!focus || !image.naturalWidth || !image.clientWidth || !image.clientHeight) {
      image.style.removeProperty("object-position");
      return;
    }
    const style = getComputedStyle(image);
    image.style.objectPosition = focusPosition(
      { width: image.clientWidth, height: image.clientHeight },
      { width: image.naturalWidth, height: image.naturalHeight },
      focus,
      { x: cssFraction(style, "--face-x", 0.5), y: cssFraction(style, "--face-y", 0.4) },
    );
  }, [focus]);

  // React vuelve a llamar a la referencia con null y con la imagen cuando cambia el encuadre.
  return useCallback((image: HTMLImageElement | null) => {
    observer.current?.disconnect();
    node.current?.removeEventListener("load", apply);
    node.current = image;
    if (!image) return;
    image.addEventListener("load", apply);
    observer.current = new ResizeObserver(apply);
    observer.current.observe(image);
    apply();
  }, [apply]);
}
