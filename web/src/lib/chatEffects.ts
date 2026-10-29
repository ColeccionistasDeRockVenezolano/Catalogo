// CRV · Motor de efectos del chat en el navegador.
//
// El servidor manda manifiestos; aquí se decide CÓMO se pintan y CUÁNDO no.
// La regla del móvil: un efecto que cuesta un frame no se pinta. El
// presupuesto se reparte por nivel de calidad del dispositivo y los efectos
// que no consiguen hueco se degradan a su versión estática (marco y color),
// que sigue viéndose bien. El reloj y el reparto por visibilidad viven en
// `chatMotion.ts`.
//
// «reduced» es el nivel de quien pidió reducir movimiento: no es gama baja.
// Recibe la versión suave de cada efecto (fundidos de opacidad, sin saltos,
// giros ni partículas) en vez de la estática.
import { useEffect, useState } from "react";
import type { ChatEffect, ChatUser } from "../../../src/chat/protocol";

export type Quality = "low" | "reduced" | "medium" | "high";
export type LayerType = "css" | "svg" | "canvas" | "sprite" | "choreo" | "scene" | "material" | "shader";
export type { EquippedSlot as EffectSlot } from "../../../src/chat/slots";
import type { EquippedSlot as EffectSlot } from "../../../src/chat/slots";

export interface EffectLayer {
  type: LayerType;
  preset: string;
  /** Solo sprites: junto al nombre o encima del avatar. */
  position?: "left" | "right" | "over" | "behind";
  colors?: string[];
  intensity?: number;
  speed?: number;
  opacity?: number;
  blend?: string;
  count?: number;
  dataSource?: "catalog_cover";
  /** Partículas: del elemento entero o de cada letra. */
  origin?: "element" | "letters";
}

export interface EffectManifest {
  version: number;
  triggers: string[];
  layers: EffectLayer[];
  font?: { code: string };
  reducedMotion: "static" | "hide";
  cost: number;
  durationMs?: number;
  sound?: string;
  interactive?: boolean;
}

const TEXT_PRESETS = new Set([
  "wave", "rainbow", "bounce", "spin3d", "glitch", "scatter", "typewriter",
  "jitter", "fire-letters", "neon", "glow", "gold", "ice", "blood", "plasma",
  "gradient", "pulse", "scratch", "eq", "sticker", "vinyl",
  "decrypted", "rb-glitch", "warp", "rb-focus", "rb-fuzzy",
]);

/** Efectos de React Bits: se pintan con un componente propio, no por CSS. */
export const RB_PRESETS = new Set(["decrypted", "rb-glitch", "warp", "rb-focus", "rb-fuzzy"]);

/** Presets que se pintan letra a letra (el resto, sobre el texto completo). */
export const SPLIT_PRESETS = new Set([
  "wave", "rainbow", "bounce", "spin3d", "glitch", "scatter", "typewriter", "jitter", "fire-letters",
]);

export const SPRITE_PRESETS = new Set([
  "vinyl-face", "cassette-face", "amp-face", "skull-rocker", "flame-face",
  "guitar", "hand-rock", "bat", "mic", "drum", "heart-horns", "ufo-vinyl", "drumsticks", "rockerito",
]);

/** Coreografías del nombre: un personaje que mueve las letras (WAAPI). */
export const CHOREO_PRESETS = new Set([
  "bat-orbit", "drumsticks", "ufo-abduct", "vinyl-roll", "guitar-wave",
  "skull-headbang", "lightning", "rockerito",
]);

/** Escenas a pantalla completa de acciones y entradas. */
export const SCENE_PRESETS = new Set(["pogo-scene", "clash-scene", "applause-scene", "curtain-scene"]);

/** Marcos vivos con piezas propias (el resto son aros simples). */
export const LIVE_FRAME_PRESETS = new Set(["fire-ring", "electric-ring", "vinyl-spin", "eq-radial"]);

export function detectQuality(): Quality {
  if (typeof window === "undefined") return "low";
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData) return "low";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return (nav.deviceMemory ?? 4) <= 2 ? "low" : "reduced";
  }
  const memory = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (memory <= 2 || cores <= 2) return "low";
  if (window.matchMedia("(max-width: 767px)").matches) return memory >= 4 && cores >= 6 ? "medium" : "low";
  return memory >= 8 && cores >= 8 ? "high" : "medium";
}

/** Calidad reactiva: cambia si el usuario activa «reducir movimiento». */
export function useChatQuality(): Quality {
  const [quality, setQuality] = useState<Quality>(() => detectQuality());
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setQuality(detectQuality());
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return quality;
}

export function manifestOf(effect: ChatEffect | null | undefined): EffectManifest | null {
  if (!effect) return null;
  const raw = effect.manifest as Partial<EffectManifest> | undefined;
  if (!raw || !Array.isArray(raw.layers)) return null;
  const layers = raw.layers.filter(isLayer);
  const font = raw.font && typeof raw.font.code === "string" ? { code: raw.font.code } : undefined;
  if (layers.length === 0 && !font) return null;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    triggers: Array.isArray(raw.triggers) ? raw.triggers : ["always"],
    layers,
    ...(font ? { font } : {}),
    reducedMotion: raw.reducedMotion === "hide" ? "hide" : "static",
    cost: typeof raw.cost === "number" ? Math.min(10, Math.max(1, raw.cost)) : 3,
    ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
    ...(typeof raw.interactive === "boolean" ? { interactive: raw.interactive } : {}),
    ...(typeof raw.sound === "string" ? { sound: raw.sound } : {}),
  };
}

/** Código de fuente de un efecto `name_font`. */
export function nameFontCode(effect: ChatEffect | null | undefined): string | null {
  return manifestOf(effect)?.font?.code ?? null;
}

function isLayer(value: unknown): value is EffectLayer {
  if (!value || typeof value !== "object") return false;
  const layer = value as Partial<EffectLayer>;
  return (layer.type === "css" || layer.type === "svg" || layer.type === "canvas" || layer.type === "sprite"
    || layer.type === "choreo" || layer.type === "scene" || layer.type === "material" || layer.type === "shader")
    && typeof layer.preset === "string";
}

export function equippedEffect(
  user: Pick<ChatUser, "equipped"> | null | undefined,
  effects: ChatEffect[],
  slot: EffectSlot,
): ChatEffect | null {
  const code = user?.equipped?.[slot];
  if (!code) return null;
  return effects.find((effect) => effect.code === code) ?? null;
}

export function textLayer(manifest: EffectManifest | null): EffectLayer | null {
  if (!manifest) return null;
  return manifest.layers.find((layer) => layer.type === "css" && TEXT_PRESETS.has(layer.preset)) ?? null;
}

export function textLayers(manifest: EffectManifest | null): EffectLayer[] {
  if (!manifest) return [];
  return manifest.layers.filter((layer) => layer.type === "css" && TEXT_PRESETS.has(layer.preset));
}

export function spriteLayers(manifest: EffectManifest | null): EffectLayer[] {
  if (!manifest) return [];
  return manifest.layers.filter((layer) => layer.type === "sprite" && SPRITE_PRESETS.has(layer.preset));
}

export function choreoLayer(manifest: EffectManifest | null): EffectLayer | null {
  return manifest?.layers.find((layer) => layer.type === "choreo" && CHOREO_PRESETS.has(layer.preset)) ?? null;
}

export function sceneLayer(manifest: EffectManifest | null): EffectLayer | null {
  return manifest?.layers.find((layer) => layer.type === "scene" && SCENE_PRESETS.has(layer.preset)) ?? null;
}

export function particleLayers(manifest: EffectManifest | null): EffectLayer[] {
  return manifest?.layers.filter((layer) => layer.type === "canvas") ?? [];
}

/** Variables CSS que cada preset consume (colores, velocidad, intensidad). */
export function layerStyle(layer: EffectLayer): React.CSSProperties {
  const colors = layer.colors ?? [];
  const style: Record<string, string> = {
    "--fx-1": colors[0] ?? "#e50914",
    "--fx-2": colors[1] ?? colors[0] ?? "#ffb02e",
    "--fx-3": colors[2] ?? colors[1] ?? "#b185e3",
    "--fx-speed": `${layer.speed ?? 1}`,
    "--fx-intensity": `${layer.intensity ?? 0.6}`,
    "--fx-opacity": `${layer.opacity ?? 1}`,
  };
  if (layer.blend) style["mixBlendMode"] = layer.blend;
  return style as React.CSSProperties;
}

export function costOf(effect: ChatEffect | null): number {
  return manifestOf(effect)?.cost ?? 0;
}

/** Degradación: en gama baja, algunos efectos no se pintan. */
export function shouldHide(effect: ChatEffect | null, quality: Quality): boolean {
  const manifest = manifestOf(effect);
  return Boolean(manifest && manifest.reducedMotion === "hide" && quality === "low");
}

// ── Hora y avatar deterministas (sin pedir nada al servidor) ───────────────
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${(hue + 48) % 360} 70% 24%))`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-VE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}
