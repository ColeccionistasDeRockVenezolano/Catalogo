// CRV · Catálogo de efectos del chat (effects-as-data).
//
// Un efecto no es código: es un manifiesto con capas, disparadores y coste.
// El cliente implementa un puñado de renderers (texto por letra, sprites SVG,
// marcos, partículas) y el catálogo crece añadiendo entradas aquí.
//
// Ingeniería inversa de referencia (xat, medido 2026-10-28): sus «powers» son
// sprites pixel-art animados de 30-74 px y 5,8 s en loop (calavera, zorro,
// carita que aplaude, letra con arcoíris), más fondos estáticos. Nosotros
// hacemos lo mismo pero vectorial: sprites SVG propios (1-2 KB), texto
// animado por letra y partículas en canvas. Cero assets copiados.
import { z } from "zod";
import { FONT_SPECS } from "./fonts.js";

export const EFFECT_KINDS = [
  "name", "frame", "entry", "message", "action", "sticker", "background", "ambient", "name_font",
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
  // Marcos y aros
  "frame", "orbit", "ring", "pulse-ring",
  // Fondos de sala
  "stage", "garage", "fog", "spotlight", "flash", "curtain", "smoke",
  // Partículas
  "confetti", "embers", "stardust", "crowd", "sparks", "notes", "hearts",
  "rain", "fireworks", "bubbles",
] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color hex de 6 dígitos");

export const effectLayerSchema = z.object({
  /** css: texto/barato; svg: marcos; canvas: partículas; sprite: mascota. */
  type: z.enum(["css", "svg", "canvas", "sprite"]),
  preset: z.enum(EFFECT_PRESETS),
  /** Solo sprites: a la izquierda/derecha del nombre o encima del avatar. */
  position: z.enum(["left", "right", "over", "behind"]).optional(),
  colors: z.array(hexColor).min(1).max(5).optional(),
  intensity: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.1).max(4).optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.enum(["normal", "screen", "overlay", "multiply", "plus-lighter"]).optional(),
  count: z.number().int().min(1).max(80).optional(),
  dataSource: z.enum(["catalog_cover"]).optional(),
});

export type EffectLayer = z.infer<typeof effectLayerSchema>;

export const effectManifestSchema = z.object({
  version: z.literal(1),
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
  if (value.layers.length === 0 && !value.font) {
    context.addIssue({ code: "custom", message: "Un efecto necesita capas o una fuente" });
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

function effect(input: CatalogEffect): CatalogEffect {
  effectManifestSchema.parse(input.manifest);
  return input;
}

const ROJO = "#e50914";
const AMBAR = "#ffb02e";
const VIOLETA = "#b185e3";
const TEAL = "#2ec4b6";
const AZUL = "#60a5fa";

const text = (preset: EffectPreset, colors: string[], extra: Partial<EffectLayer> = {}): EffectLayer =>
  ({ type: "css", preset, colors, ...extra });
const sprite = (preset: EffectPreset, position: "left" | "right" | "over" = "left"): EffectLayer =>
  ({ type: "sprite", preset, position });
const svg = (preset: EffectPreset, colors: string[]): EffectLayer => ({ type: "svg", preset, colors });
const canvas = (preset: EffectPreset, colors: string[], count: number): EffectLayer =>
  ({ type: "canvas", preset, colors, count });

const FONT_PRICES: Readonly<Record<string, number>> = {
  "versalitas": 120,
  "cursiva-script": 160,
  "letras-circulo": 200,
  "boxed-black": 220,
  "lower-upper-light": 180,
  "math-monospace": 200,
  "math-serif-italic": 220,
  "math-double-struck": 240,
  "coptic-standard": 260,
  "lilia": 280,
  "tai-le-curly": 300,
  "math-script-bold": 320,
  "math-fraktur-bold": 340,
  "black-panther": 400,
};

export const EFFECT_CATALOG: readonly CatalogEffect[] = [
  // ── Nombre ───────────────────────────────────────────────────────────────
  effect({
    code: "vinilo", name: "Vinilo", kind: "name", sort: 10,
    description: "Un vinilo con cara gira junto a tu nombre y lleva tu portada del día.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [sprite("vinyl-face"), text("gradient", ["#1a1a1a", "#f5f5f5", ROJO], { speed: 0.5 })] },
  }),
  effect({
    code: "aguja", name: "Aguja", kind: "name", sort: 20,
    description: "El nombre tiembla como un surco rayado y suelta chispas.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("scratch", ["#ffffff", ROJO]), canvas("sparks", [AMBAR, ROJO], 8)] },
  }),
  effect({
    code: "ampli", name: "Amplificador", kind: "name", sort: 30,
    description: "Un ampli con ojos se enciende al ritmo de tu nombre.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [sprite("amp-face"), text("glow", [AMBAR, ROJO], { intensity: 0.7 })] },
  }),
  effect({
    code: "distorsion", name: "Distorsión", kind: "name", sort: 40,
    description: "Glitch RGB por letra: dos copias desplazadas y una que tiembla.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [text("glitch", [ROJO, TEAL]), text("plasma", [ROJO, VIOLETA], { opacity: 0.25 })] },
  }),
  effect({
    code: "neon", name: "Neón", kind: "name", sort: 50,
    description: "Tubo de neón con parpadeo de bar y onda lenta.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("neon", [TEAL, VIOLETA]), text("wave", [TEAL], { opacity: 0.55, speed: 0.7 })] },
  }),
  effect({
    code: "cassette", name: "Cassette", kind: "name", sort: 60,
    description: "Un casete con ojos rebobina mientras tu nombre pasa de moda.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [sprite("cassette-face", "right"), text("gradient", ["#3a3a3a", "#d9d9d9", "#3a3a3a"], { speed: 0.4 })] },
  }),
  effect({
    code: "eco", name: "Eco", kind: "name", sort: 70,
    description: "Cada letra sale y vuelve, como un delay de cinta.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("bounce", [TEAL, AZUL])] },
  }),
  effect({
    code: "fuego", name: "Fuego", kind: "name", sort: 80,
    description: "Llamas letra a letra y brasas que suben.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 5, reducedMotion: "static",
      layers: [sprite("flame-face"), text("fire-letters", [ROJO, AMBAR, "#ff6b1a"]), canvas("embers", [AMBAR, ROJO], 10)] },
  }),
  effect({
    code: "hielo", name: "Hielo", kind: "name", sort: 90,
    description: "Cristal frío con brillo que recorre el nombre.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("ice", ["#8fd8ff", "#e8fbff", "#4aa3c7"])] },
  }),
  effect({
    code: "oro", name: "Oro", kind: "name", sort: 100,
    description: "Baño metálico con destellos para nombres de colección.",
    priceCoins: 400, priceCredits: 40, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("gold", ["#8a5a00", "#ffd76a", "#fff3c4", "#b47a00"]), canvas("stardust", ["#fff3c4", "#ffd76a"], 8)] },
  }),
  effect({
    code: "sangre", name: "Sangre", kind: "name", sort: 110,
    description: "Rojo profundo que gotea letra a letra.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("blood", ["#7a0008", ROJO, "#3a0004"])] },
  }),
  effect({
    code: "plasma", name: "Plasma", kind: "name", sort: 120,
    description: "Degradado vivo que nunca repite color.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [text("plasma", [ROJO, VIOLETA, TEAL, AMBAR])] },
  }),
  effect({
    code: "rockero", name: "Rockero", kind: "name", sort: 130,
    description: "Calavera con gafas de sol y llamas a los lados.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [sprite("skull-rocker"), text("glow", [ROJO, AMBAR], { intensity: 0.6 })] },
  }),
  effect({
    code: "guitarra", name: "Guitarra", kind: "name", sort: 140,
    description: "Una guitarra se agita y suelta chispas al hablar.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always", "on_message"], cost: 4, reducedMotion: "static",
      layers: [sprite("guitar", "right"), text("pulse", [AMBAR, ROJO])] },
  }),
  effect({
    code: "cuernos", name: "Cuernos", kind: "name", sort: 150,
    description: "Mano de rock que se levanta cada pocos segundos.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [sprite("hand-rock", "right"), text("gold", ["#8a5a00", "#ffd76a", "#fff3c4"])] },
  }),
  effect({
    code: "murcielago", name: "Murciélago", kind: "name", sort: 160,
    description: "Un murciélago aletea sobre el nombre en penumbra.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [sprite("bat", "over"), text("blood", ["#5a0010", VIOLETA, "#1a0006"])] },
  }),
  effect({
    code: "micro", name: "Micrófono", kind: "name", sort: 170,
    description: "Micrófono con ondas de sonido que siguen el texto.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [sprite("mic"), text("eq", [VIOLETA, TEAL])] },
  }),
  effect({
    code: "bateria", name: "Batería", kind: "name", sort: 180,
    description: "Redoblante que golpea al ritmo y hace saltar las letras.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [sprite("drum", "right"), text("bounce", [AMBAR, "#ffffff"]), canvas("notes", [AMBAR, TEAL], 6)] },
  }),
  effect({
    code: "corazon-rock", name: "Corazón rock", kind: "name", sort: 190,
    description: "Corazón con cuernos que late fuerte.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [sprite("heart-horns"), text("pulse", [ROJO, "#ff6b8a"]), canvas("hearts", ["#ff6b8a", ROJO], 5)] },
  }),
  effect({
    code: "ovni", name: "Ovni vinilo", kind: "name", sort: 200,
    description: "Un vinilo volador con haz de luz abduce tu nombre.",
    priceCoins: 420, priceCredits: 42, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 5, reducedMotion: "static",
      layers: [sprite("ufo-vinyl", "over"), text("rainbow", [TEAL, VIOLETA, AMBAR])] },
  }),
  effect({
    code: "onda", name: "Onda", kind: "name", sort: 210,
    description: "Las letras suben y bajan en cadena, como una ola.",
    priceCoins: 180, priceCredits: 18, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [text("wave", [TEAL, AZUL])] },
  }),
  effect({
    code: "arcoiris", name: "Arcoíris", kind: "name", sort: 220,
    description: "El gradiente recorre cada letra sin repetir color.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("rainbow", ["#ff5f6d", "#ffc371", "#4ade80", "#60a5fa", VIOLETA])] },
  }),
  effect({
    code: "dispersion", name: "Dispersión", kind: "name", sort: 230,
    description: "Las letras se separan y vuelven a su sitio.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("scatter", [AMBAR, ROJO])] },
  }),
  effect({
    code: "maquina", name: "Máquina de escribir", kind: "name", sort: 240,
    description: "El nombre se escribe letra a letra, en bucle.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [text("typewriter", ["#e8e8e8", "#9a9a9a"])] },
  }),
  effect({
    code: "temblor", name: "Temblor", kind: "name", sort: 250,
    description: "Vibración de escenario, letra a letra.",
    priceCoins: 160, priceCredits: 16, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [text("jitter", ["#ffffff", ROJO])] },
  }),
  effect({
    code: "descifrado", name: "Descifrado", kind: "name", sort: 260,
    description: "Tu nombre se resuelve desde glifos aleatorios, como un hackeo de película.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("decrypted", ["#e8e8e8", "#7dffb0"])] },
  }),
  effect({
    code: "glitch-rgb", name: "Glitch RGB", kind: "name", sort: 270,
    description: "Tres capas con cortes por franjas y sombras roja y cian.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("rb-glitch", ["#ffffff", "#ff003c", "#00e5ff"])] },
  }),
  effect({
    code: "warp", name: "Warp", kind: "name", sort: 280,
    description: "Deformación líquida con bordes cromáticos, como un cristal.",
    priceCoins: 400, priceCredits: 40, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [text("warp", ["#ff4d4d", "#4da6ff"])] },
  }),
  effect({
    code: "foco-real", name: "Foco real", kind: "name", sort: 290,
    description: "Una palabra nítida con marco de esquinas; el resto se desenfoca.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("rb-focus", ["#8b5cf6", "#c4b5fd"])] },
  }),
  effect({
    code: "fuzzy", name: "Fuzzy", kind: "name", sort: 300,
    description: "Borde mordido y vibración de señal analógica.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [text("rb-fuzzy", ["#ffffff", "#b0b0b0"])] },
  }),

  // ── Marco de avatar ──────────────────────────────────────────────────────
  effect({
    code: "primera-edicion", name: "Primera edición", kind: "frame", sort: 10,
    description: "Marco dorado permanente para coleccionistas verificados.",
    priceCoins: 900, priceCredits: 90, durationDays: null,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("frame", ["#ffd76a", "#8a5a00"]), canvas("stardust", ["#fff3c4", "#ffd76a"], 6)] },
  }),
  effect({
    code: "backstage", name: "Backstage", kind: "frame", sort: 20,
    description: "Pase VIP con cinta de acceso.",
    priceCoins: 480, priceCredits: 48, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("frame", [AMBAR, "#1a1a1a"])] },
  }),
  effect({
    code: "tour", name: "Tour", kind: "frame", sort: 30,
    description: "Luces de gira orbitando el avatar.",
    priceCoins: 420, priceCredits: 42, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [svg("orbit", [ROJO, AMBAR, TEAL])] },
  }),
  effect({
    code: "rareza", name: "Rareza", kind: "frame", sort: 40,
    description: "El marco brilla según la portada del día.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("pulse-ring", [VIOLETA, TEAL]), text("pulse", [VIOLETA], { dataSource: "catalog_cover" })] },
  }),
  effect({
    code: "rayado", name: "Rayado", kind: "frame", sort: 50,
    description: "Vinilo usado: surcos y marcas de aguja.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [svg("ring", ["#9a9a9a", "#2a2a2a"])] },
  }),
  effect({
    code: "cuero", name: "Cuero", kind: "frame", sort: 60,
    description: "Marco de chaqueta de cuero con costura.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [svg("frame", ["#5a3a24", "#c9a227"])] },
  }),
  effect({
    code: "marco-neon", name: "Marco neón", kind: "frame", sort: 70,
    description: "Aro de neón que respira alrededor del avatar.",
    priceCoins: 360, priceCredits: 36, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("pulse-ring", [TEAL, VIOLETA])] },
  }),

  // ── Entrada ──────────────────────────────────────────────────────────────
  effect({
    code: "telon", name: "Telón", kind: "entry", sort: 10,
    description: "Se abre el telón cuando entras a la sala.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 4, durationMs: 1500, reducedMotion: "hide",
      layers: [{ type: "css", preset: "curtain", colors: [ROJO, "#1a0002"] }] },
  }),
  effect({
    code: "flash", name: "Flash", kind: "entry", sort: 20,
    description: "Destello de cámara al aparecer.",
    priceCoins: 150, priceCredits: 15, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 2, durationMs: 800, reducedMotion: "hide",
      layers: [{ type: "css", preset: "flash", colors: ["#ffffff"] }] },
  }),
  effect({
    code: "humo", name: "Humo", kind: "entry", sort: 30,
    description: "Entras entre humo de escenario.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 3, durationMs: 1600, reducedMotion: "hide",
      layers: [{ type: "css", preset: "smoke", colors: ["#d8d8d8", "#5a5a5a"] }] },
  }),
  effect({
    code: "spotlight", name: "Spotlight", kind: "entry", sort: 40,
    description: "Un foco te sigue al entrar.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 3, durationMs: 1600, reducedMotion: "static",
      layers: [{ type: "css", preset: "spotlight", colors: ["#fff6d8", "#000000"] }] },
  }),
  effect({
    code: "entrada-chispas", name: "Chispas", kind: "entry", sort: 50,
    description: "Explosión de chispas al cruzar la puerta.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 4, durationMs: 1400, reducedMotion: "hide",
      layers: [canvas("sparks", [AMBAR, "#ffffff", ROJO], 24)] },
  }),
  effect({
    code: "entrada-fuegos", name: "Fuegos artificiales", kind: "entry", sort: 60,
    description: "Cohetes que estallan sobre la sala.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 5, durationMs: 2000, reducedMotion: "hide",
      layers: [canvas("fireworks", [ROJO, AMBAR, TEAL, VIOLETA], 26)] },
  }),

  // ── Mensaje ──────────────────────────────────────────────────────────────
  effect({
    code: "scratch-msg", name: "Scratch", kind: "message", sort: 10,
    description: "El mensaje entra con un rayón de vinilo.",
    priceCoins: 120, priceCredits: 12, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [text("scratch", ["#ffffff", ROJO])] },
  }),
  effect({
    code: "stardust", name: "Stardust", kind: "message", sort: 20,
    description: "Polvo de estrellas al enviar.",
    priceCoins: 180, priceCredits: 18, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 4, durationMs: 1200, reducedMotion: "hide",
      layers: [canvas("stardust", [AMBAR, "#ffffff", VIOLETA], 24)] },
  }),
  effect({
    code: "giro", name: "Giro", kind: "message", sort: 30,
    description: "El mensaje da una vuelta 3D antes de posarse.",
    priceCoins: 160, priceCredits: 16, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 3, durationMs: 700, reducedMotion: "static",
      layers: [text("spin3d", [TEAL, AZUL])] },
  }),
  effect({
    code: "reverb", name: "Reverb", kind: "message", sort: 40,
    description: "Ondas de sonido detrás del texto.",
    priceCoins: 160, priceCredits: 16, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 3, durationMs: 900, reducedMotion: "static",
      layers: [text("eq", [VIOLETA, TEAL])] },
  }),
  effect({
    code: "notas", name: "Notas", kind: "message", sort: 50,
    description: "Notas musicales que salen del mensaje.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 4, durationMs: 1500, reducedMotion: "hide",
      layers: [canvas("notes", [AMBAR, TEAL, "#ffffff"], 12)] },
  }),
  effect({
    code: "corazones", name: "Corazones", kind: "message", sort: 60,
    description: "Corazones que suben al enviar.",
    priceCoins: 180, priceCredits: 18, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 4, durationMs: 1500, reducedMotion: "hide",
      layers: [canvas("hearts", ["#ff6b8a", ROJO, "#ffb3c1"], 12)] },
  }),

  // ── Acciones de sala ─────────────────────────────────────────────────────
  effect({
    code: "pogo", name: "Pogo", kind: "action", sort: 10,
    description: "Salta con la sala: acción colectiva.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 3, durationMs: 1400, reducedMotion: "static",
      layers: [canvas("crowd", [ROJO, AMBAR], 18)] },
  }),
  effect({
    code: "crowd", name: "Crowd", kind: "action", sort: 20,
    description: "Manos y luces de público.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 4, durationMs: 1600, reducedMotion: "hide",
      layers: [canvas("crowd", [AMBAR, "#ffffff", TEAL], 26)] },
  }),
  effect({
    code: "choque", name: "Choque de vinilos", kind: "action", sort: 30,
    description: "Estrellas y chispas como dos discos chocando.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 4, durationMs: 1200, reducedMotion: "hide",
      layers: [canvas("sparks", [AMBAR, "#ffffff", ROJO], 28), sprite("vinyl-face", "over")] },
  }),
  effect({
    code: "aplausos", name: "Aplausos", kind: "action", sort: 40,
    description: "La sala aplaude con luces.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 3, durationMs: 1300, reducedMotion: "hide",
      layers: [canvas("fireworks", [AMBAR, "#ffffff"], 18)] },
  }),

  // ── Stickers ─────────────────────────────────────────────────────────────
  effect({
    code: "vinilo-sticker", name: "Vinilo sticker", kind: "sticker", sort: 10,
    description: "Un disco pegado al mensaje.",
    priceCoins: 80, priceCredits: 8, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 600, reducedMotion: "static",
      layers: [sprite("vinyl-face", "right")] },
  }),
  effect({
    code: "cassette-sticker", name: "Cassette sticker", kind: "sticker", sort: 20,
    description: "Cinta grabada a mano.",
    priceCoins: 80, priceCredits: 8, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 600, reducedMotion: "static",
      layers: [sprite("cassette-face", "right")] },
  }),
  effect({
    code: "calaca-sticker", name: "Calaca sticker", kind: "sticker", sort: 30,
    description: "Calavera rockera para acompañar el mensaje.",
    priceCoins: 100, priceCredits: 10, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [sprite("skull-rocker", "right")] },
  }),

  // ── Fondo de sala ────────────────────────────────────────────────────────
  effect({
    code: "escenario", name: "Escenario", kind: "background", sort: 10,
    description: "Fondo de concierto con luces que barren.",
    priceCoins: 700, priceCredits: 70, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 5, reducedMotion: "static",
      layers: [{ type: "css", preset: "stage", colors: ["#12000a", ROJO, VIOLETA], speed: 0.4 }, canvas("sparks", [AMBAR], 6)] },
  }),
  effect({
    code: "garage", name: "Garaje", kind: "background", sort: 20,
    description: "Pared de ladrillo y luz de bombillo.",
    priceCoins: 500, priceCredits: 50, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "garage", colors: ["#1a1410", "#3a2a1e", AMBAR] }] },
  }),
  effect({
    code: "niebla", name: "Niebla", kind: "background", sort: 30,
    description: "Niebla baja que se mueve despacio.",
    priceCoins: 420, priceCredits: 42, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [{ type: "css", preset: "fog", colors: ["#9aa0aa", "#2a2a33"] }] },
  }),
  effect({
    code: "luces", name: "Luces de gira", kind: "background", sort: 40,
    description: "Haces de luz que recorren la sala.",
    priceCoins: 600, priceCredits: 60, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 5, reducedMotion: "static",
      layers: [{ type: "css", preset: "spotlight", colors: ["#fff6d8", "#2b0a12"], speed: 0.5 }] },
  }),

  // ── Ambiente ─────────────────────────────────────────────────────────────
  effect({
    code: "brasas", name: "Brasas", kind: "ambient", sort: 10,
    description: "Chispas que suben por la sala.",
    priceCoins: 350, priceCredits: 35, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [canvas("embers", [AMBAR, ROJO, "#ff6b1a"], 18)] },
  }),
  effect({
    code: "confeti-vinilo", name: "Confeti de vinilo", kind: "ambient", sort: 20,
    description: "Discos diminutos cayendo de fiesta.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [canvas("confetti", ["#111111", "#f5f5f5", ROJO, AMBAR], 20)] },
  }),
  effect({
    code: "lluvia", name: "Lluvia", kind: "ambient", sort: 30,
    description: "Lluvia fina con relámpagos lejanos.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [canvas("rain", ["#8fd8ff", "#ffffff"], 28)] },
  }),
  effect({
    code: "burbujas", name: "Burbujas", kind: "ambient", sort: 40,
    description: "Burbujas que flotan y estallan.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "hide",
      layers: [canvas("bubbles", [TEAL, AZUL, "#ffffff"], 16)] },
  }),
  effect({
    code: "chispas", name: "Chispas", kind: "ambient", sort: 50,
    description: "Chispas eléctricas alrededor.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [canvas("sparks", [AMBAR, "#ffffff"], 14)] },
  }),

  // ── Fuentes del nombre ──────────────────────────────────────────────────
  // El estilo real vive en src/chat/fonts.ts; aquí solo se pone a la venta.
  ...FONT_SPECS.map((spec, index): CatalogEffect => {
    const price = FONT_PRICES[spec.code] ?? 200;
    return {
      code: spec.code, name: spec.name, kind: "name_font", sort: 10 + index,
      description: spec.note,
      priceCoins: price, priceCredits: Math.round(price / 10), durationDays: 30,
      manifest: {
        version: 1, triggers: ["always"], layers: [], font: { code: spec.code },
        cost: 1, reducedMotion: "static",
      },
    };
  }),
];

export const EFFECTS_BY_CODE: ReadonlyMap<string, CatalogEffect> =
  new Map(EFFECT_CATALOG.map((item) => [item.code, item]));

/** Un efecto de nombre/fondo puede ir equipado; los de disparo no. */
export function isEquippable(kind: EffectKind): boolean {
  return kind === "name" || kind === "frame" || kind === "background" || kind === "ambient" || kind === "name_font";
}
