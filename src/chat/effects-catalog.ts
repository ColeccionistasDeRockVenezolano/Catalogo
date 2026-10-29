// CRV · Contrato de efectos del chat y catálogo de semillas vacío.
// Los nuevos manifiestos se publican en chat.effects desde administración.
import { z } from "zod";
import { nameStyleSchema } from "./name-style.js";
import { isEquippedSlot } from "./slots.js";

export const EFFECT_KINDS = [
  "name", "frame", "entry", "message", "action", "sticker", "background", "ambient", "name_font", "badge",
] as const;
export type EffectKind = typeof EFFECT_KINDS[number];

/** Presets que el renderer del navegador sabe pintar. */
export const EFFECT_PRESETS = [
  // Texto (se aplica al nombre, por letra cuando el preset lo pide)
  "wave", "rainbow", "bounce", "spin3d", "glitch", "scatter", "typewriter",
  "jitter", "fire-letters", "neon", "glow", "gold", "ice", "blood", "plasma",
  "gradient", "pulse", "scratch", "eq", "sticker", "vinyl",
  // Efectos de React Bits (reimplementados): descifrado, glitch RGB, warp,
  // foco por palabra y fuzzy.
  "decrypted", "rb-glitch", "warp", "rb-focus", "rb-fuzzy",
  // Sprites SVG animados (mascotas y objetos de CRV)
  "vinyl-face", "cassette-face", "amp-face", "skull-rocker", "flame-face",
  "guitar", "hand-rock", "bat", "mic", "drum", "heart-horns", "ufo-vinyl",
  // Marcos y aros (los cuatro últimos, vivos: fuego, electricidad, vinilo
  // detrás del avatar y ecualizador radial)
  "frame", "orbit", "ring", "pulse-ring", "fire-ring", "electric-ring", "vinyl-spin", "eq-radial",
  // Fondos de sala
  "stage", "garage", "fog", "spotlight", "flash", "curtain", "smoke",
  // Partículas
  "confetti", "embers", "stardust", "crowd", "sparks", "notes", "hearts",
  "rain", "fireworks", "bubbles", "flames", "snow",
  // Coreografías del nombre: un personaje que interactúa con las letras
  // (WAAPI, solo transform/opacity).
  "bat-orbit", "drumsticks", "ufo-abduct", "vinyl-roll", "guitar-wave",
  "skull-headbang", "lightning", "rockerito",
  // Escenas a pantalla completa (acciones y entradas)
  "pogo-scene", "clash-scene", "applause-scene", "curtain-scene",
  // Materiales procedurales: motores distintos sobre un lienzo compartido.
  "chidori", "curse-aura", "karma-aura", "shadow-entity", "pastel-rainbow", "viscous-blood",
] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color hex de 6 dígitos");

export const effectLayerSchema = z.object({
  /** css: texto; svg: marcos; canvas: partículas; sprite: objeto;
   * choreo: coreografía; scene: pantalla completa; material: motor procedural. */
  type: z.enum(["css", "svg", "canvas", "sprite", "choreo", "scene", "material"]),
  preset: z.enum(EFFECT_PRESETS),
  /** Solo sprites: a la izquierda/derecha del nombre o encima del avatar. */
  position: z.enum(["left", "right", "over", "behind"]).optional(),
  colors: z.array(hexColor).min(1).max(6).optional(),
  intensity: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.1).max(4).optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.enum(["normal", "screen", "overlay", "multiply", "plus-lighter"]).optional(),
  count: z.number().int().min(1).max(80).optional(),
  dataSource: z.enum(["catalog_cover"]).optional(),
  /** Solo partículas: de todo el elemento o de cada letra del nombre. */
  origin: z.enum(["element", "letters"]).optional(),
});

export type EffectLayer = z.infer<typeof effectLayerSchema>;

const badgeImageSchema = z.string().max(2048).refine(
  (value) => /^\/(?!\/)/u.test(value) || /^https:\/\//u.test(value),
  "Usa una imagen local o una URL HTTPS",
);

export const badgeSchema = z.object({
  imageUrl: badgeImageSchema,
  animated: z.boolean().default(false),
  staticImageUrl: badgeImageSchema.optional(),
}).superRefine((value, context) => {
  if (value.animated && !value.staticImageUrl) {
    context.addIssue({ code: "custom", path: ["staticImageUrl"], message: "La placa animada necesita una imagen estática" });
  }
});

export const effectManifestSchema = z.object({
  version: z.literal(1),
  badge: badgeSchema.optional(),
  nameStyle: nameStyleSchema.optional(),
  triggers: z.array(z.enum(["always", "on_message", "on_join", "on_action", "on_hover"]))
    .min(1).max(4),
  layers: z.array(effectLayerSchema).max(5),
  /** Fuente del nombre: el catálogo real vive en src/chat/fonts.ts. */
  font: z.object({ code: z.string().min(2).max(40) }).optional(),
  durationMs: z.number().int().min(200).max(15_000).optional(),
  sound: z.string().max(40).optional(),
  reducedMotion: z.enum(["static", "hide"]).default("static"),
  cost: z.number().int().min(1).max(10),
  interactive: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.layers.length === 0 && !value.font && !value.badge && !value.nameStyle) {
    context.addIssue({ code: "custom", message: "Un producto necesita capas, una fuente o una placa" });
  }
});

/** El nombre solo modifica sus letras; las placas ocupan su propia ranura. */
export const effectProductSchema = z.object({
  kind: z.enum(EFFECT_KINDS),
  manifest: effectManifestSchema,
}).superRefine(({ kind, manifest }, context) => {
  const invalid = (message: string): void => context.addIssue({ code: "custom", path: ["manifest"], message });
  if (manifest.nameStyle && kind !== "name") invalid("El estilo de nombre pertenece a un producto de nombre");
  if (kind === "badge") {
    if (!manifest.badge || manifest.layers.length > 0 || manifest.font) invalid("Una placa requiere su imagen, sin efectos de nombre");
  } else if (manifest.badge) invalid("Las placas son un producto independiente");
  if (kind === "name" && (manifest.font || manifest.layers.some((layer) => !["css", "canvas", "material"].includes(layer.type)))) {
    invalid("El nombre solo admite efectos sobre el texto; los adornos van en Placas");
  }
});

export type EffectManifest = z.infer<typeof effectManifestSchema>;

export interface CatalogEffect {
  readonly code: string;
  readonly name: string;
  readonly kind: EffectKind;
  readonly description: string;
  readonly manifest: EffectManifest;
  readonly priceCoins: number;
  readonly priceCredits: number;
  readonly durationDays: number | null;
  readonly sort: number;
}

// La tienda empieza vacía. Los nuevos efectos se publican desde administración.
export const EFFECT_CATALOG: readonly CatalogEffect[] = [];

export const EFFECTS_BY_CODE: ReadonlyMap<string, CatalogEffect> =
  new Map(EFFECT_CATALOG.map((item) => [item.code, item]));

/** Un efecto de nombre/fondo puede ir equipado; los de disparo no. */
export function isEquippable(kind: EffectKind): boolean {
  return isEquippedSlot(kind);
}

/** Datos del producto compartidos por importación, formulario y API. */
export const effectPublicationSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/u),
  name: z.string().trim().min(2).max(40),
  kind: z.enum(EFFECT_KINDS),
  description: z.string().trim().max(160).default(""),
  manifest: effectManifestSchema,
  priceCoins: z.number().int().min(0).max(100_000).default(0),
  priceCredits: z.number().int().min(0).max(100_000).default(0),
  durationDays: z.number().int().min(1).max(3650).nullable().default(null),
  sort: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
});
