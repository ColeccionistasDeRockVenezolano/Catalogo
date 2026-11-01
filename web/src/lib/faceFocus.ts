// Cálculo puro del encuadre por rostros: sin React, lo comparten el hook y las
// pruebas del backend (el typecheck raíz no instala las dependencias de web).
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
