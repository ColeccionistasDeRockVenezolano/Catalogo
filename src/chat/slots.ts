/** Ranuras compartidas por el protocolo, el repositorio y la tienda. */
export const EQUIPPED_SLOTS = ["name", "name_font", "badge", "frame", "background", "ambient"] as const;
export type EquippedSlot = typeof EQUIPPED_SLOTS[number];

export function isEquippedSlot(value: string): value is EquippedSlot {
  return (EQUIPPED_SLOTS as readonly string[]).includes(value);
}
