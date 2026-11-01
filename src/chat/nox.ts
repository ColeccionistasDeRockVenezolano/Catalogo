import { z } from "zod";
import type { CatalogEffect } from "./effects-catalog.js";

/** Colección nueva autorizada por Brian: NOX_chat_demo.html (2026-10-29). */
export const NOX_PRESETS = ["blood", "smoke", "matrix", "neon", "rainbow", "fire", "ice", "gold", "cosmic", "glitch", "electric", "bats"] as const;
export const noxSchema = z.object({
  preset: z.enum(NOX_PRESETS),
  bloodfall: z.enum(["classic", "enhanced"]).default("enhanced"),
});
export type NoxStyle = z.infer<typeof noxSchema>;
export const NOX_EFFECTS = [
  { id: "blood", name: "Bloodfall", description: "Sangre líquida con goteo animado", price: 900, rarity: "legendary" },
  { id: "smoke", name: "Phantom Smoke", description: "Humo volumétrico que asciende", price: 640, rarity: "epic" },
  { id: "matrix", name: "Matrix.exe", description: "Código digital verde y pulsos", price: 720, rarity: "epic" },
  { id: "neon", name: "Neon Pulse", description: "Luz eléctrica rosa y violeta", price: 340, rarity: "common" },
  { id: "rainbow", name: "Prismatic", description: "Arcoíris fluido de colores", price: 520, rarity: "rare" },
  { id: "fire", name: "Inferno", description: "Metal ardiente y llamas", price: 800, rarity: "epic" },
  { id: "ice", name: "Frostbite", description: "Hielo cristalino azulado", price: 600, rarity: "rare" },
  { id: "gold", name: "Midas", description: "Oro brillante con reflejos", price: 1200, rarity: "legendary" },
  { id: "cosmic", name: "Nebula", description: "Energía violeta del cosmos", price: 980, rarity: "legendary" },
  { id: "glitch", name: "Data Corrupt", description: "Interferencia digital RGB", price: 680, rarity: "epic" },
  { id: "electric", name: "Voltage", description: "Descargas de luz azul", price: 840, rarity: "epic" },
  // Solo nombre: el enjambre sale del texto al pasar el puntero y regresa.
  { id: "bats", name: "Murciélagos", description: "El nombre suelta un enjambre que vuela y regresa", price: 760, rarity: "epic", kinds: ["name"] },
] as const;

const NOX_KINDS = ["name", "frame", "bubble"] as const;

/** Recetas del editor; no reintroduce ni siembra el catálogo retirado. */
export const NOX_PRODUCTS: readonly CatalogEffect[] = NOX_EFFECTS.flatMap(effect => {
  const kinds: readonly (typeof NOX_KINDS)[number][] = "kinds" in effect ? effect.kinds : NOX_KINDS;
  return kinds.map((kind, index) => ({
    code: `nox-${effect.id}-${kind}`, name: `${effect.name}${kind === "frame" ? " · Marco" : kind === "bubble" ? " · Burbuja" : ""}`,
    kind, description: effect.description,
    manifest: { version: 1 as const, nox: { preset: effect.id, bloodfall: "enhanced" as const }, layers: [], triggers: ["always" as const], cost: kind === "name" ? 2 : 1, reducedMotion: "static" as const },
    // El demo solo fija monedas. El editor permite ajustar ambas tarifas antes de publicar.
    priceCoins: effect.price, priceCredits: effect.price, durationDays: null, sort: 200 + NOX_PRESETS.indexOf(effect.id) * 3 + index,
  }));
});
