import { useCallback, useRef } from "react";
import type { ImageFocus } from "./types.js";

/** Desplazamiento de un eje: el centro de la caja va a `target` sin dejar bordes vacíos. */
function axisOffset(box: number, scaled: number, start: number, size: number, target: number) {
  let offset = target * box - (start + size / 2) * scaled;
  // Si la caja cabe, se ve entera aunque el destino la empuje hacia un borde.
  if (size * scaled <= box) offset = Math.max(-start * scaled, Math.min(box - (start + size) * scaled, offset));
  return Math.min(0, Math.max(box - scaled, offset));
}

/** `object-position` en píxeles para una imagen con `object-fit: cover`. */
export function focusPosition(
  box: { width: number; height: number }, natural: { width: number; height: number },
  focus: ImageFocus, target: { x: number; y: number },
): string {
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const x = axisOffset(box.width, natural.width * scale, focus.x, focus.width, target.x);
  const y = axisOffset(box.height, natural.height * scale, focus.y, focus.height, target.y);
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

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
