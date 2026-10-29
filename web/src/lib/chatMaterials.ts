// Physical/stylized models shared by the material stage and its tests.
export const MATERIAL_PRESETS = new Set([
  "chidori", "curse-aura", "karma-aura", "shadow-entity", "pastel-rainbow", "viscous-blood",
]);
export type MaterialPreset = "chidori" | "curse-aura" | "karma-aura" | "shadow-entity" | "pastel-rainbow" | "viscous-blood" | "fire";
export type MaterialTarget = "name" | "avatar" | "bubble";

/** Existing purchases gain the new renderer without changing their codes. */
export function materialPreset(preset?: string): MaterialPreset | null {
  if (preset && MATERIAL_PRESETS.has(preset)) return preset as MaterialPreset;
  switch (preset) {
    case "electric-ring": return "chidori";
    case "fire-ring": case "fire-letters": return "fire";
    case "blood": return "viscous-blood";
    case "rainbow": return "pastel-rainbow";
    case "plasma": return "karma-aura";
    default: return null;
  }
}

export function randomAt(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Smooth continuous noise; unlike a repeated movie, it has no loop seam. */
export function drift(time: number, seed: number): number {
  return Math.sin(time * 0.83 + seed) * 0.55 + Math.sin(time * 1.37 + seed * 2.7) * 0.3
    + Math.sin(time * 0.37 + seed * 1.3) * 0.15;
}

export function bloodPhase(time: number, seed: number) {
  const period = 2.4 + randomAt(seed) * 3.6;
  const elapsed = time + randomAt(seed + 7) * period;
  const phase = (elapsed % period) / period;
  const growth = Math.min(1, phase / 0.79);
  const falling = phase >= 0.79 && phase < 0.94;
  const flight = Math.max(0, Math.min(1, (phase - 0.79) / 0.15));
  return {
    period, phase, growth, cycle: Math.floor(elapsed / period),
    // Neck thins before pinch-off; the remnant retracts after detachment.
    neck: phase < 0.63 ? 1 : phase < 0.79 ? 1 - (phase - 0.63) / 0.16 * 0.92 : 0,
    falling, flight,
    fallDistance: flight * flight,
    remnant: phase < 0.79 ? 1 : Math.max(0.13, 1 - flight * 2),
  };
}

export interface BoltPoint { x: number; y: number }
/** Different geometry every discharge, including its branches. */
export function boltPoints(width: number, height: number, seed: number): BoltPoint[] {
  return Array.from({ length: 13 }, (_, index) => ({
    x: width * index / 12,
    y: height * (0.5 + (randomAt(seed + index * 3) - 0.5) * (index === 0 || index === 12 ? 0.1 : 0.75)),
  }));
}
