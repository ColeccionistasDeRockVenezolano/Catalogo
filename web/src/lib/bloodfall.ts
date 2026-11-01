/** Encuentra soporte real de tinta. Las columnas vacías (espacios) nunca originan gotas. */
export function bloodfallAnchors(rgba: Uint8ClampedArray, width: number, height: number, count: number) {
  const ink: Array<{ x: number; y: number }> = [];
  for (let x = 1; x < width - 1; x++) {
    for (let y = height - 1; y >= 0; y--) {
      const alpha = (y * width + x) * 4 + 3;
      if ((rgba[alpha] ?? 0) > 140 && (rgba[alpha - 4] ?? 0) > 80) {
        ink.push({ x, y }); break;
      }
    }
  }
  if (!ink.length) return [];
  const size = Math.min(Math.max(1, Math.round(count)), ink.length);
  return Array.from({ length: size }, (_, i) => ink[Math.min(ink.length - 1, Math.floor((i + .5) * ink.length / size))]!);
}
