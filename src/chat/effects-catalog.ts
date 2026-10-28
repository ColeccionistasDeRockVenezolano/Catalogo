// CRV · Catálogo de efectos del chat (effects-as-data).
//
// Un efecto no es código: es un manifiesto con capas, disparadores y coste.
// El cliente implementa un puñado de presets (src/chat no conoce el DOM) y el
// catálogo crece añadiendo entradas aquí, sin tocar el renderer. Los efectos
// son propios de CRV: no se copian nombres ni assets de otras plataformas.
import { z } from "zod";

export const EFFECT_KINDS = [
  "name", "frame", "entry", "message", "action", "sticker", "background", "ambient",
] as const;
export type EffectKind = typeof EFFECT_KINDS[number];

/** Presets que el renderer del navegador sabe pintar. */
export const EFFECT_PRESETS = [
  "glow", "gradient", "neon", "fire", "ice", "gold", "blood", "plasma",
  "vinyl", "eq", "spotlight", "smoke", "flash", "scratch", "curtain",
  "sticker", "stage", "garage", "pulse", "frame", "orbit",
  "confetti", "embers", "stardust", "crowd",
] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color hex de 6 dígitos");

export const effectLayerSchema = z.object({
  /** css: barato; svg: máscaras/bordes; canvas: partículas. */
  type: z.enum(["css", "svg", "canvas"]),
  preset: z.enum(EFFECT_PRESETS),
  colors: z.array(hexColor).min(1).max(5).optional(),
  /** 0 suave … 1 máximo; el renderer lo traduce a opacidad/amplitud. */
  intensity: z.number().min(0).max(1).optional(),
  /** Multiplicador de velocidad; 1 = el del preset. */
  speed: z.number().min(0.1).max(4).optional(),
  opacity: z.number().min(0).max(1).optional(),
  blend: z.enum(["normal", "screen", "overlay", "multiply", "plus-lighter"]).optional(),
  /** Partículas por instancia (canvas). */
  count: z.number().int().min(1).max(80).optional(),
  /** La capa usa datos del catálogo (portada del día, radio). */
  dataSource: z.enum(["catalog_cover"]).optional(),
});

export type EffectLayer = z.infer<typeof effectLayerSchema>;

export const effectManifestSchema = z.object({
  version: z.literal(1),
  triggers: z.array(z.enum(["always", "on_message", "on_join", "on_action", "on_hover"]))
    .min(1).max(4),
  layers: z.array(effectLayerSchema).min(1).max(4),
  /** Cuánto dura un efecto de disparo; los `always` lo ignoran. */
  durationMs: z.number().int().min(200).max(15_000).optional(),
  sound: z.string().max(40).optional(),
  /** Con prefers-reduced-motion: degradar a estático o no pintar. */
  reducedMotion: z.enum(["static", "hide"]).default("static"),
  /** Coste estimado 1-10; el renderer lo usa para el presupuesto móvil. */
  cost: z.number().int().min(1).max(10),
  /** Interactivo = responde a hover/toque (premium). */
  interactive: z.boolean().optional(),
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
  /** null = permanente; por defecto 30 días (alquiler, como el resto del mercado). */
  readonly durationDays: number | null;
  readonly sort: number;
}

function effect(input: CatalogEffect): CatalogEffect {
  // Falla en el arranque, no en el navegador: un manifiesto inválido no llega
  // a la base de datos.
  effectManifestSchema.parse(input.manifest);
  return input;
}

const ROJO = "#e50914";
const AMBAR = "#ffb02e";
const VIOLETA = "#b185e3";
const TEAL = "#2ec4b6";

export const EFFECT_CATALOG: readonly CatalogEffect[] = [
  // ── Nombre (name) ────────────────────────────────────────────────────────
  effect({
    code: "vinilo", name: "Vinilo", kind: "name", sort: 10,
    description: "Tu portada del día gira detrás del nombre.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [{ type: "css", preset: "vinyl", dataSource: "catalog_cover", intensity: 0.8 }],
    },
  }),
  effect({
    code: "aguja", name: "Aguja", kind: "name", sort: 20,
    description: "El nombre se raya como un disco viejo al hablar.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always", "on_message"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "scratch", intensity: 0.6 }],
    },
  }),
  effect({
    code: "ampli", name: "Amplificador", kind: "name", sort: 30,
    description: "Glow cálido que pulsa como un valvular encendido.",
    priceCoins: 180, priceCredits: 18, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [{ type: "css", preset: "glow", colors: [AMBAR, ROJO], intensity: 0.7, speed: 0.6 }],
    },
  }),
  effect({
    code: "distorsion", name: "Distorsión", kind: "name", sort: 40,
    description: "Borde glitcheado, como una guitarra al rojo.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [
        { type: "css", preset: "plasma", colors: [ROJO, VIOLETA, TEAL], intensity: 0.7, speed: 1.2 },
        { type: "css", preset: "scratch", intensity: 0.3, opacity: 0.5 },
      ],
    },
  }),
  effect({
    code: "neon", name: "Neón", kind: "name", sort: 50,
    description: "Tubo de neón con parpadeo de bar.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "neon", colors: [TEAL, VIOLETA], intensity: 0.8 }],
    },
  }),
  effect({
    code: "cassette", name: "Cassette", kind: "name", sort: 60,
    description: "Nombre con textura de cinta magnética.",
    priceCoins: 160, priceCredits: 16, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [{ type: "css", preset: "gradient", colors: ["#3a3a3a", "#d9d9d9", "#3a3a3a"], speed: 0.4 }],
    },
  }),
  effect({
    code: "eco", name: "Eco", kind: "name", sort: 70,
    description: "El nombre deja una estela que se apaga.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "pulse", colors: [TEAL], intensity: 0.5, speed: 0.8 }],
    },
  }),
  effect({
    code: "fuego", name: "Fuego", kind: "name", sort: 80,
    description: "Llama viva en el borde del nombre.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [
        { type: "css", preset: "fire", colors: [ROJO, AMBAR, "#ff6b1a"], intensity: 0.8, speed: 1.1 },
        { type: "css", preset: "glow", colors: [ROJO], intensity: 0.4, opacity: 0.6 },
      ],
    },
  }),
  effect({
    code: "hielo", name: "Hielo", kind: "name", sort: 90,
    description: "Cristal frío con brillo lento.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "ice", colors: ["#8fd8ff", "#e8fbff", "#4aa3c7"], intensity: 0.7, speed: 0.5 }],
    },
  }),
  effect({
    code: "oro", name: "Oro", kind: "name", sort: 100,
    description: "Baño metálico para nombres de colección.",
    priceCoins: 400, priceCredits: 40, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "gold", colors: ["#8a5a00", "#ffd76a", "#fff3c4", "#b47a00"], intensity: 0.8, speed: 0.6 }],
    },
  }),
  effect({
    code: "sangre", name: "Sangre", kind: "name", sort: 110,
    description: "Rojo profundo que gotea despacio.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "blood", colors: ["#7a0008", ROJO, "#3a0004"], intensity: 0.8, speed: 0.5 }],
    },
  }),
  effect({
    code: "plasma", name: "Plasma", kind: "name", sort: 120,
    description: "Degradado vivo que nunca repite color.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [{ type: "css", preset: "plasma", colors: [ROJO, VIOLETA, TEAL, AMBAR], intensity: 0.8, speed: 0.9 }],
    },
  }),

  // ── Marco de avatar (frame) ──────────────────────────────────────────────
  effect({
    code: "primera-edicion", name: "Primera edición", kind: "frame", sort: 10,
    description: "Marco dorado permanente para coleccionistas verificados.",
    priceCoins: 900, priceCredits: 90, durationDays: null,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "svg", preset: "frame", colors: ["#ffd76a", "#8a5a00"], intensity: 0.9, speed: 0.4 }],
    },
  }),
  effect({
    code: "backstage", name: "Backstage", kind: "frame", sort: 20,
    description: "Pase VIP con cinta de acceso.",
    priceCoins: 480, priceCredits: 48, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "svg", preset: "frame", colors: [AMBAR, "#1a1a1a"], intensity: 0.7 }],
    },
  }),
  effect({
    code: "tour", name: "Tour", kind: "frame", sort: 30,
    description: "Luces de gira alrededor del avatar.",
    priceCoins: 420, priceCredits: 42, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [{ type: "svg", preset: "orbit", colors: [ROJO, AMBAR, TEAL], intensity: 0.8, speed: 0.8 }],
    },
  }),
  effect({
    code: "rareza", name: "Rareza", kind: "frame", sort: 40,
    description: "El marco brilla según la portada del día.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "pulse", colors: [VIOLETA, TEAL], dataSource: "catalog_cover", intensity: 0.6 }],
    },
  }),
  effect({
    code: "rayado", name: "Rayado", kind: "frame", sort: 50,
    description: "Vinilo usado: surcos y marcas de aguja.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [{ type: "css", preset: "scratch", colors: ["#9a9a9a", "#2a2a2a"], intensity: 0.5 }],
    },
  }),
  effect({
    code: "cuero", name: "Cuero", kind: "frame", sort: 60,
    description: "Marco de chaqueta de cuero con costura.",
    priceCoins: 260, priceCredits: 26, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 2, reducedMotion: "static",
      layers: [{ type: "svg", preset: "frame", colors: ["#5a3a24", "#c9a227"], intensity: 0.6 }],
    },
  }),

  // ── Entrada (entry) ──────────────────────────────────────────────────────
  effect({
    code: "telon", name: "Telón", kind: "entry", sort: 10,
    description: "Se abre el telón cuando entras a la sala.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_join"], cost: 4, durationMs: 1400, reducedMotion: "hide",
      layers: [{ type: "css", preset: "curtain", colors: [ROJO, "#1a0002"], intensity: 0.9 }],
    },
  }),
  effect({
    code: "flash", name: "Flash", kind: "entry", sort: 20,
    description: "Destello de cámara al aparecer.",
    priceCoins: 150, priceCredits: 15, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_join"], cost: 2, durationMs: 800, reducedMotion: "hide",
      layers: [{ type: "css", preset: "flash", colors: ["#ffffff"], intensity: 0.7 }],
    },
  }),
  effect({
    code: "humo", name: "Humo", kind: "entry", sort: 30,
    description: "Entras entre humo de escenario.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_join"], cost: 3, durationMs: 1600, reducedMotion: "hide",
      layers: [{ type: "css", preset: "smoke", colors: ["#d8d8d8", "#5a5a5a"], intensity: 0.6 }],
    },
  }),
  effect({
    code: "spotlight", name: "Spotlight", kind: "entry", sort: 40,
    description: "Un foco te sigue al entrar.",
    priceCoins: 280, priceCredits: 28, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_join"], cost: 3, durationMs: 1500, reducedMotion: "static",
      layers: [{ type: "css", preset: "spotlight", colors: ["#fff6d8", "#000000"], intensity: 0.8 }],
    },
  }),

  // ── Mensaje (message) ────────────────────────────────────────────────────
  effect({
    code: "scratch-msg", name: "Scratch", kind: "message", sort: 10,
    description: "El mensaje entra con un rayón de vinilo.",
    priceCoins: 120, priceCredits: 12, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [{ type: "css", preset: "scratch", colors: ["#ffffff", ROJO], intensity: 0.7 }],
    },
  }),
  effect({
    code: "stardust", name: "Stardust", kind: "message", sort: 20,
    description: "Polvo de estrellas al enviar.",
    priceCoins: 180, priceCredits: 18, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 4, durationMs: 1200, reducedMotion: "hide",
      layers: [{ type: "canvas", preset: "stardust", colors: [AMBAR, "#ffffff", VIOLETA], count: 24, intensity: 0.7 }],
    },
  }),
  effect({
    code: "giro", name: "Giro", kind: "message", sort: 30,
    description: "El mensaje da una vuelta antes de posarse.",
    priceCoins: 140, priceCredits: 14, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 2, durationMs: 600, reducedMotion: "static",
      layers: [{ type: "css", preset: "pulse", colors: [TEAL], intensity: 0.6 }],
    },
  }),
  effect({
    code: "reverb", name: "Reverb", kind: "message", sort: 40,
    description: "Ondas de sonido detrás del texto.",
    priceCoins: 160, priceCredits: 16, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 3, durationMs: 900, reducedMotion: "static",
      layers: [{ type: "css", preset: "eq", colors: [VIOLETA, TEAL], intensity: 0.6 }],
    },
  }),

  // ── Acciones de sala (action) ────────────────────────────────────────────
  effect({
    code: "pogo", name: "Pogo", kind: "action", sort: 10,
    description: "Salta con la sala: acción colectiva.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_action"], cost: 3, durationMs: 1200, reducedMotion: "static",
      layers: [{ type: "canvas", preset: "crowd", colors: [ROJO, AMBAR], count: 18, intensity: 0.6 }],
    },
  }),
  effect({
    code: "crowd", name: "Crowd", kind: "action", sort: 20,
    description: "Manos y luces de público.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_action"], cost: 4, durationMs: 1500, reducedMotion: "hide",
      layers: [{ type: "canvas", preset: "crowd", colors: [AMBAR, "#ffffff", TEAL], count: 26, intensity: 0.7 }],
    },
  }),

  // ── Stickers ─────────────────────────────────────────────────────────────
  effect({
    code: "vinilo-sticker", name: "Vinilo sticker", kind: "sticker", sort: 10,
    description: "Un disco pegado al mensaje.",
    priceCoins: 80, priceCredits: 8, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 1, durationMs: 500, reducedMotion: "static",
      layers: [{ type: "css", preset: "sticker", colors: ["#111111", "#f5f5f5"], intensity: 0.6 }],
    },
  }),
  effect({
    code: "cassette-sticker", name: "Cassette sticker", kind: "sticker", sort: 20,
    description: "Cinta grabada a mano.",
    priceCoins: 80, priceCredits: 8, durationDays: 30,
    manifest: {
      version: 1, triggers: ["on_message"], cost: 1, durationMs: 500, reducedMotion: "static",
      layers: [{ type: "css", preset: "sticker", colors: ["#2a2a2a", AMBAR], intensity: 0.6 }],
    },
  }),

  // ── Fondo de sala (background) ───────────────────────────────────────────
  effect({
    code: "escenario", name: "Escenario", kind: "background", sort: 10,
    description: "Fondo de concierto con luces que respiran.",
    priceCoins: 700, priceCredits: 70, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 5, reducedMotion: "static",
      layers: [{ type: "css", preset: "stage", colors: ["#12000a", ROJO, VIOLETA], intensity: 0.7, speed: 0.4 }],
    },
  }),
  effect({
    code: "garage", name: "Garaje", kind: "background", sort: 20,
    description: "Pared de ladrillo y luz de bombillo.",
    priceCoins: 500, priceCredits: 50, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [{ type: "css", preset: "garage", colors: ["#1a1410", "#3a2a1e", AMBAR], intensity: 0.6 }],
    },
  }),

  // ── Ambiente (ambient) ───────────────────────────────────────────────────
  effect({
    code: "brasas", name: "Brasas", kind: "ambient", sort: 10,
    description: "Chispas que suben por la sala.",
    priceCoins: 350, priceCredits: 35, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [{ type: "canvas", preset: "embers", colors: [AMBAR, ROJO, "#ff6b1a"], count: 18, intensity: 0.6, speed: 0.6 }],
    },
  }),
  effect({
    code: "confeti-vinilo", name: "Confeti de vinilo", kind: "ambient", sort: 20,
    description: "Discos diminutos cayendo de fiesta.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: {
      version: 1, triggers: ["always"], cost: 4, reducedMotion: "hide",
      layers: [{ type: "canvas", preset: "confetti", colors: ["#111111", "#f5f5f5", ROJO, AMBAR], count: 20, intensity: 0.6 }],
    },
  }),
];

export const EFFECTS_BY_CODE: ReadonlyMap<string, CatalogEffect> =
  new Map(EFFECT_CATALOG.map((item) => [item.code, item]));

/** Un efecto de nombre/fondo puede ir equipado; los de disparo no. */
export function isEquippable(kind: EffectKind): boolean {
  return kind === "name" || kind === "frame" || kind === "background" || kind === "ambient";
}
