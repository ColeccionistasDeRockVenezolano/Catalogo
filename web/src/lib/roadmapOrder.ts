// CRV · Reglas de orden del roadmap de administración (B6).
//
// El arrastre no guarda nada hasta soltar: mientras se arrastra, la lista se
// pinta con el elemento ya colocado en su destino. Estas funciones puras
// calculan esa vista previa y la posición 1-based que entiende la API
// (`position` en PATCH /tasks/:id y /categories/:id), para poder probarlas sin
// navegador.

/** Posición 1-based que corresponde a soltar sobre una fila (0-based). */
export function dropPosition(rowIndex: number, after: boolean): number {
  return Math.max(1, rowIndex + (after ? 2 : 1));
}

/** Posición final al soltar antes o después de una fila, con índices 1-based. */
export function taskDropPosition(target: number, after: boolean, source: number | null): number {
  return Math.max(1, target + (after ? 1 : 0) - (source !== null && source < target ? 1 : 0));
}

/** Acota una posición al rango de inserción de una lista de `length` elementos. */
export function clampPosition(position: number, length: number): number {
  return Math.min(Math.max(1, Math.round(position)), Math.max(1, length + 1));
}

/**
 * Lista con `dragged` insertado en `position` (1-based). Si ya estaba, se
 * quita antes de insertarlo: el destino se cuenta siempre sin el arrastrado,
 * que es justo lo que devuelve la API al mover.
 */
export function previewOrder<T>(items: readonly T[], dragged: T, position: number): T[] {
  const rest = items.filter((item) => item !== dragged);
  const at = clampPosition(position, rest.length) - 1;
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

/** Posición que ocupa `item` dentro de `items` (1-based); 0 si no está. */
export function positionOf<T>(items: readonly T[], item: T): number {
  const index = items.indexOf(item);
  return index < 0 ? 0 : index + 1;
}

/**
 * Posición siguiente al mover con flechas dentro de una lista de `length`
 * posiciones. `null` significa «salta a la etapa vecina»: arriba desde la
 * primera o abajo desde la última.
 */
export function keyboardStep(direction: "up" | "down", position: number, length: number): number | null {
  const limit = Math.max(1, length);
  if (direction === "up") return position > 1 ? position - 1 : null;
  return position < limit ? position + 1 : null;
}

/** Recorrido circular de etapas: -1 anterior, +1 siguiente, sin salirse. */
export function neighbourIndex(index: number, count: number, direction: -1 | 1): number | null {
  const next = index + direction;
  return next >= 0 && next < count ? next : null;
}
