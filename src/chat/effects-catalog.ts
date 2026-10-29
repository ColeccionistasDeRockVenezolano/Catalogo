// CRV · Catálogo de efectos del chat (effects-as-data).
//
// Un efecto no es código: es un manifiesto con capas, disparadores y coste.
// El cliente implementa un puñado de renderers (texto por letra, sprites SVG,
// marcos, partículas) y el catálogo crece añadiendo entradas aquí.
//
// Ingeniería inversa de referencia (xat, medido 2026-10-28): sus «powers» son
// sprites pixel-art animados de 30-74 px y 5,8 s en loop (calavera, zorro,
// carita que aplaude, letra con arcoíris), más fondos estáticos. Nosotros
// usamos un atlas WebP original compartido, texto animado, coreografías y
// materiales procedurales. Los sprites no se descargan por mensaje.
import { z } from "zod";
import { isEquippedSlot } from "./slots.js";
import { FONT_SPECS } from "./fonts.js";

/** Motores de shader que pintan el nombre (web/src/lib/nameShaders.ts). */
export const NAME_SHADER_PRESETS = [
  "blood-flow", "fire-burn", "lightning-arc", "neon-tube", "liquid-gold", "frost", "snow-cap",
  "acid", "holo-foil", "galaxy", "vhs-glitch", "plasma-core", "curse-mark", "shadow-smoke",
  "weld", "spectrum", "code-rain", "groove",
] as const;

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
  // Shaders del nombre: el material vive dentro de las letras y sale de ellas
  // (gotas bajo cada letra, llamas encima, nieve sobre los bordes).
  ...NAME_SHADER_PRESETS,
] as const;
export type EffectPreset = typeof EFFECT_PRESETS[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color hex de 6 dígitos");

export const effectLayerSchema = z.object({
  /** css: texto; svg: marcos; canvas: partículas; sprite: objeto;
   * choreo: coreografía; scene: pantalla completa; material: motor procedural;
   * shader: material pintado dentro de las letras del nombre. */
  type: z.enum(["css", "svg", "canvas", "sprite", "choreo", "scene", "material", "shader"]),
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

const MATERIALS: ReadonlyArray<{
  code: string; name: string; preset: EffectPreset; colors: string[]; description: string;
  /** El nombre usa el motor de shader; marco y mensaje siguen en el lienzo de materiales. */
  nameShader: { preset: EffectPreset; colors: string[]; intensity: number; description: string };
}> = [
  { code: "chidori", name: "Chidori · espada eléctrica", preset: "chidori", colors: ["#ecffff", "#bde8f2", "#38b7ee", "#3b84ce", "#2156b5", "#0c1742"], description: "Descargas finas y ramificadas que cambian de trayectoria; núcleo blanco y halo azul.",
    nameShader: { preset: "lightning-arc", colors: ["#ffffff", "#bde8f2", "#38b7ee", "#2156b5", "#0c1742"], intensity: 0.95, description: "Descargas azules que recorren cada letra y saltan de una a otra; el nombre queda cargado de electricidad." } },
  { code: "sello-maldito", name: "Sello maldito", preset: "curse-aura", colors: ["#06070c", "#1e1d2f", "#413856", "#61507d", "#9c5fc7", "#c38af0"], description: "Chakra negro y violeta con humo turbulento, contracción orgánica y púas de obsidiana.",
    nameShader: { preset: "curse-mark", colors: ["#06070c", "#1e1d2f", "#61507d", "#9c5fc7", "#c38af0"], intensity: 0.9, description: "Las marcas del sello se extienden por las letras y sueltan llamas negras y violetas." } },
  { code: "karma-azul", name: "Karma azul", preset: "karma-aura", colors: ["#1d1c39", "#1e3ea9", "#327fe0", "#45ade5", "#78e7ff", "#bcedf3"], description: "Lenguas de chakra cian que nacen, ascienden y se curvan en un flujo continuo.",
    nameShader: { preset: "fire-burn", colors: ["#0c1742", "#1e3ea9", "#327fe0", "#78e7ff", "#e8fbff"], intensity: 0.9, description: "Las letras arden con fuego azul: lenguas de chakra suben desde cada borde." } },
  { code: "entidad-sombras", name: "Entidad de sombras", preset: "shadow-entity", colors: ["#010101", "#080808", "#151717", "#272727", "#3f3b3a", "#e6e8e8"], description: "Humo negro en capas que se arremolinan lentamente; unos ojos blancos se revelan de vez en cuando.",
    nameShader: { preset: "shadow-smoke", colors: ["#010101", "#151717", "#3f3b3a", "#e6e8e8"], intensity: 0.9, description: "Humo negro sale de las letras y se enrosca; a veces unos ojos blancos te miran desde dentro." } },
  { code: "rainbow-pastel", name: "Rainbow pastel", preset: "pastel-rainbow", colors: ["#ffadce", "#fcd6bf", "#fff0ae", "#ddf3b5", "#a3dff2", "#c5a5f2"], description: "Un arcoíris pastel recorre el nombre completo, con contorno blanco, reflejos y destellos suaves.",
    nameShader: { preset: "holo-foil", colors: ["#ffadce", "#fcd6bf", "#fff0ae", "#ddf3b5", "#a3dff2", "#c5a5f2"], intensity: 0.6, description: "Lámina holográfica pastel: el color cambia con la luz y brillan destellos sobre las letras." } },
  { code: "sangre-realista", name: "Sangre realista", preset: "viscous-blood", colors: ["#380006", "#660407", "#8b0609", "#b30a09", "#dc3431", "#f06b64"], description: "Líquido espeso con brillo y volumen: se acumula, estrecha su cuello y cae por gravedad.",
    nameShader: { preset: "blood-flow", colors: ["#1f0003", "#4a0306", "#8b0609", "#c3120f", "#ff6b64"], intensity: 1, description: "La sangre cae desde arriba, empapa cada letra, corre por dentro y gotea; las gotas se estiran, se sueltan y caen." } },
];

/** Six identities, each available for the three requested surfaces. */
const MATERIAL_EFFECTS: CatalogEffect[] = MATERIALS.flatMap((material, index) =>
  (["name", "frame", "message"] as const).map((kind) => effect({
    code: kind === "frame" ? `marco-${material.code}` : kind === "message" ? `mensaje-${material.code}` : material.code,
    name: `${material.name}${kind === "frame" ? " · avatar" : kind === "message" ? " · mensaje" : ""}`,
    kind, description: kind === "name" ? material.nameShader.description : material.description,
    // Same tiers as the existing electric/fire effects, no new currency.
    priceCoins: kind === "message" ? 180 : 480,
    priceCredits: kind === "message" ? 18 : 48, durationDays: 30,
    sort: 400 + index * 10,
    manifest: {
      version: 1, triggers: [kind === "message" ? "on_message" : "always"],
      cost: material.preset === "curse-aura" || material.preset === "shadow-entity" ? 5 : 4,
      reducedMotion: "static",
      ...(kind === "message" ? { durationMs: 6000 } : {}),
      layers: [kind === "name"
        ? { type: "shader", preset: material.nameShader.preset, colors: material.nameShader.colors, intensity: material.nameShader.intensity, speed: 1 }
        : { type: "material", preset: material.preset, colors: material.colors, intensity: 0.85, speed: 1 }],
    },
  })),
);

const text = (preset: EffectPreset, colors: string[], extra: Partial<EffectLayer> = {}): EffectLayer =>
  ({ type: "css", preset, colors, ...extra });
const sprite = (preset: EffectPreset, position: "left" | "right" | "over" = "left"): EffectLayer =>
  ({ type: "sprite", preset, position });
const svg = (preset: EffectPreset, colors: string[]): EffectLayer => ({ type: "svg", preset, colors });
const canvas = (preset: EffectPreset, colors: string[], count: number): EffectLayer =>
  ({ type: "canvas", preset, colors, count });
/** Material pintado dentro de las letras (motor de shader del nombre). */
const shader = (preset: EffectPreset, colors: string[], extra: Partial<EffectLayer> = {}): EffectLayer =>
  ({ type: "shader", preset, colors, ...extra });
const scene = (preset: EffectPreset, colors: string[], extra: Partial<EffectLayer> = {}): EffectLayer =>
  ({ type: "scene", preset, colors, ...extra });

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

/** Placas: [código, nombre, objeto del atlas, precio, descripción, velocidad]. */
const BADGES: ReadonlyArray<readonly [string, string, EffectPreset, number, string, number?]> = [
  ["vinilo", "Vinilo", "vinyl-face", 220, "Un vinilo que gira despacio junto a tu nombre."],
  ["vinilo-rodante", "Vinilo a 45", "vinyl-face", 240, "El vinilo gira a 45 rpm, con más brillo.", 2.2],
  ["cassette", "Cassette", "cassette-face", 200, "Una cinta grabada a mano, con sus carretes."],
  ["ampli", "Amplificador", "amp-face", 220, "Un ampli de válvulas con el piloto encendido."],
  ["guitarra", "Guitarra", "guitar", 280, "Una guitarra sunburst que se mece al ritmo."],
  ["micro", "Micrófono", "mic", 200, "El micrófono de la tarima, listo para cantar."],
  ["bateria", "Redoblante", "drum", 240, "Un redoblante rojo con herrajes cromados."],
  ["baquetas", "Baquetas", "drumsticks", 200, "Dos baquetas cruzadas que marcan el tiempo."],
  ["cuernos", "Cuernos", "hand-rock", 220, "La mano del rock, con muñequera de tachas."],
  ["rockero", "Calavera rockera", "skull-rocker", 280, "Calavera con pañuelo rojo que cabecea."],
  ["murcielago", "Murciélago", "bat", 280, "Un murciélago que aletea a tu lado."],
  ["corazon-rock", "Corazón rock", "heart-horns", 260, "Corazón con cuernos que late."],
  ["llama", "Llama", "flame-face", 240, "Una llama viva que tiembla junto al nombre."],
  ["ovni", "Ovni", "ufo-vinyl", 320, "El ovni de la casa con su haz encendido."],
  ["rockerito", "Rockerito", "rockerito", 360, "Un rockerito con su guitarra, tocando para ti."],
];

export const EFFECT_CATALOG: readonly CatalogEffect[] = [
  ...MATERIAL_EFFECTS,
  // ── Nombre ───────────────────────────────────────────────────────────────
  // Cada efecto es un material que vive DENTRO de las letras y sale de ellas:
  // la sangre corre por los trazos y gotea bajo cada letra, el fuego sube
  // desde los bordes de arriba, la nieve se posa sobre ellos. Los objetos que
  // acompañaban al nombre (vinilo, cassette…) son placas: otra ranura.
  effect({
    code: "sangre", name: "Sangre", kind: "name", sort: 10,
    description: "Sangre espesa corre por dentro de cada letra; se acumula abajo, forma gotas que se estiran y caen.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("blood-flow", ["#2a0004", "#5c0308", "#9a070c", "#d41c1a", "#ff8a80"], { intensity: 0.7 })] },
  }),
  effect({
    code: "fuego", name: "Fuego", kind: "name", sort: 20,
    description: "Las letras arden por dentro como brasas y las llamas suben desde cada borde, con chispas.",
    priceCoins: 400, priceCredits: 40, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("fire-burn", ["#2a0400", "#9a1a04", "#ff5a0a", "#ffb02e", "#fff3c4"], { intensity: 0.85 })] },
  }),
  effect({
    code: "rayo", name: "Rayo", kind: "name", sort: 30,
    description: "Arcos eléctricos recorren el contorno de cada letra y saltan de una a otra con destellos.",
    priceCoins: 440, priceCredits: 44, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("lightning-arc", ["#ffffff", "#fff6a8", "#ffd23f", "#6d5bd0", "#140f2e"], { intensity: 0.75 })] },
  }),
  effect({
    code: "oro", name: "Oro líquido", kind: "name", sort: 40,
    description: "Oro fundido con relieve: los reflejos fluyen por las letras, brillan destellos y caen gotas de metal.",
    priceCoins: 460, priceCredits: 46, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("liquid-gold", ["#3a2200", "#8a5a00", "#d9a21b", "#ffd76a", "#fff6d8"], { intensity: 0.6 })] },
  }),
  effect({
    code: "neon", name: "Neón", kind: "name", sort: 50,
    description: "Tubo de vidrio encendido con núcleo blanco, halo de bar y algún tramo que chisporrotea y se apaga.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("neon-tube", ["#ff2d95", "#ff8cc6", "#ffffff", "#7a0040"], { intensity: 0.8 })] },
  }),
  effect({
    code: "hielo", name: "Hielo", kind: "name", sort: 60,
    description: "Letras de hielo tallado: la escarcha crece desde los bordes, el brillo cruza las facetas y sale vaho frío.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("frost", ["#0b2a44", "#2f7fb3", "#8fd8ff", "#e8fbff", "#ffffff"], { intensity: 0.7 })] },
  }),
  effect({
    code: "nevada", name: "Nevada", kind: "name", sort: 70,
    description: "Nieve que cae y se va posando encima de cada letra, como un concierto en el páramo.",
    priceCoins: 360, priceCredits: 36, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("snow-cap", ["#173450", "#4f8fc0", "#cfefff", "#ffffff"], { intensity: 0.7 })] },
  }),
  effect({
    code: "veneno", name: "Veneno", kind: "name", sort: 80,
    description: "Ácido verde que burbujea dentro de las letras, brilla tóxico y gotea.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("acid", ["#041a06", "#0f5c14", "#39d42f", "#b6ff5c", "#f2ffd8"], { intensity: 0.75 })] },
  }),
  effect({
    code: "arcoiris", name: "Holográfico", kind: "name", sort: 90,
    description: "Lámina holográfica: el arcoíris se mueve con la luz sobre las letras y destella como una tarjeta rara.",
    priceCoins: 400, priceCredits: 40, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("holo-foil", ["#ff5f6d", "#ffc371", "#4ade80", "#60a5fa", "#b185e3", "#ff7ad9"], { intensity: 1 })] },
  }),
  effect({
    code: "galaxia", name: "Galaxia", kind: "name", sort: 100,
    description: "Una nebulosa gira dentro de las letras con estrellas que titilan y pasan despacio.",
    priceCoins: 440, priceCredits: 44, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("galaxy", ["#05030f", "#2b0f5c", "#7a2bbf", "#ff4fa3", "#5fd4ff", "#ffffff"], { intensity: 0.7 })] },
  }),
  effect({
    code: "plasma", name: "Plasma", kind: "name", sort: 110,
    description: "Energía que se arremolina dentro de las letras y escapa por los bordes en filamentos.",
    priceCoins: 380, priceCredits: 38, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("plasma-core", ["#12001f", "#6a00ff", "#ff2bd6", "#ffd1f5", "#ffffff"], { intensity: 0.75 })] },
  }),
  effect({
    code: "glitch-rgb", name: "Glitch RGB", kind: "name", sort: 120,
    description: "Señal rota: el nombre se corta en franjas, se separa en rojo y cian y vuelve a su sitio.",
    priceCoins: 340, priceCredits: 34, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("vhs-glitch", ["#ffffff", "#ff1f4b", "#00e5ff", "#1a1a1a"], { intensity: 0.5 })] },
  }),
  effect({
    code: "distorsion", name: "Distorsión VHS", kind: "name", sort: 130,
    description: "Cinta gastada: pista que se desliza, ruido de nieve, líneas de barrido y cortes de color.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("vhs-glitch", ["#f4f0e6", "#ff3b30", "#2ec4b6", "#101010"], { intensity: 0.95 })] },
  }),
  effect({
    code: "chispazo", name: "Soldadura", kind: "name", sort: 140,
    description: "Un soplete recorre las letras: el metal queda al rojo, se enfría detrás y saltan chispas.",
    priceCoins: 360, priceCredits: 36, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [shader("weld", ["#5b636e", "#b7c0ca", "#ff3d00", "#ffb02e", "#fffbe8"], { intensity: 0.8 })] },
  }),
  effect({
    code: "melodia", name: "Ecualizador", kind: "name", sort: 150,
    description: "Las letras son un ecualizador: barras de LED que suben y bajan al ritmo, con picos que caen.",
    priceCoins: 320, priceCredits: 32, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("spectrum", ["#06140a", "#2ee66b", "#f5e33b", "#ff3b30"], { intensity: 0.8, speed: 1 })] },
  }),
  effect({
    code: "descifrado", name: "Código", kind: "name", sort: 160,
    description: "Lluvia de código verde cae dentro de las letras, con la cabeza de cada columna encendida.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("code-rain", ["#010a03", "#0b5a1c", "#35ff6b", "#d8ffe0"], { intensity: 0.7 })] },
  }),
  effect({
    code: "aguja", name: "Surco de vinilo", kind: "name", sort: 170,
    description: "Letras de vinilo negro con surcos finos; el reflejo gira sobre ellas como el disco en el plato.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [shader("groove", ["#101010", "#3a3a3a", "#d8d8d8", "#ffffff", "#e50914"], { intensity: 0.7 })] },
  }),

  // ── Placas ──────────────────────────────────────────────────────────────
  // Un objeto junto al nombre, en su propia ranura: se lleva a la vez que un
  // efecto de nombre. Los códigos son los que antes se vendían como nombre.
  ...BADGES.map(([code, name, preset, price, description, speed], index): CatalogEffect => effect({
    code, name, kind: "badge", sort: 10 + index * 10, description,
    priceCoins: price, priceCredits: Math.round(price / 10), durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 1, reducedMotion: "static",
      layers: [{ ...sprite(preset), ...(speed ? { speed } : {}) }] },
  })),

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

  effect({
    code: "anillo-fuego", name: "Anillo de fuego", kind: "frame", sort: 80,
    description: "Lenguas de fuego que bailan alrededor del avatar y sueltan brasas.",
    priceCoins: 520, priceCredits: 52, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [svg("fire-ring", [ROJO, AMBAR, "#ff6b1a"]), canvas("embers", [AMBAR, ROJO], 8)] },
  }),
  effect({
    code: "aro-electrico", name: "Aro eléctrico", kind: "frame", sort: 90,
    description: "Descargas que recorren el aro y chisporrotean.",
    priceCoins: 480, priceCredits: 48, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 4, reducedMotion: "static",
      layers: [svg("electric-ring", [AZUL, "#e8fbff"]), canvas("sparks", ["#e8fbff", AZUL], 6)] },
  }),
  effect({
    code: "vinilo-giratorio", name: "Vinilo giratorio", kind: "frame", sort: 100,
    description: "Un vinilo gira detrás de tu avatar como en el plato.",
    priceCoins: 420, priceCredits: 42, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("vinyl-spin", [ROJO, "#f5f5f5"])] },
  }),
  effect({
    code: "ecualizador", name: "Ecualizador radial", kind: "frame", sort: 110,
    description: "Barras de ecualizador que laten alrededor del avatar.",
    priceCoins: 460, priceCredits: 46, durationDays: 30,
    manifest: { version: 1, triggers: ["always"], cost: 3, reducedMotion: "static",
      layers: [svg("eq-radial", [TEAL, VIOLETA, ROJO])] },
  }),

  // ── Entrada ──────────────────────────────────────────────────────────────
  effect({
    code: "telon", name: "Telón", kind: "entry", sort: 10,
    description: "Se abre el telón y tu nombre aparece en grande cuando entras a la sala.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["on_join"], cost: 4, durationMs: 2400, reducedMotion: "static",
      layers: [scene("curtain-scene", [ROJO, "#1a0002", AMBAR])] },
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
    description: "El público salta contigo a pantalla completa.",
    priceCoins: 200, priceCredits: 20, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 3, durationMs: 2200, reducedMotion: "static",
      layers: [scene("pogo-scene", [ROJO, AMBAR, "#1a1a1a"])] },
  }),
  effect({
    code: "crowd", name: "Crowd", kind: "action", sort: 20,
    description: "Manos arriba y luces de público.",
    priceCoins: 240, priceCredits: 24, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 4, durationMs: 2000, reducedMotion: "static",
      layers: [scene("pogo-scene", [AMBAR, TEAL, "#1a1a1a"], { intensity: 0.35 }), canvas("crowd", [AMBAR, "#ffffff", TEAL], 26)] },
  }),
  effect({
    code: "choque", name: "Choque de vinilos", kind: "action", sort: 30,
    description: "Dos vinilos chocan en el centro de la sala y saltan chispas.",
    priceCoins: 300, priceCredits: 30, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 4, durationMs: 1800, reducedMotion: "static",
      layers: [scene("clash-scene", [ROJO, AMBAR, "#ffffff"]), canvas("sparks", [AMBAR, "#ffffff", ROJO], 28)] },
  }),
  effect({
    code: "aplausos", name: "Aplausos", kind: "action", sort: 40,
    description: "La sala aplaude y llueve confeti.",
    priceCoins: 220, priceCredits: 22, durationDays: 30,
    manifest: { version: 1, triggers: ["on_action"], cost: 3, durationMs: 2000, reducedMotion: "static",
      layers: [scene("applause-scene", [AMBAR, ROJO, TEAL]), canvas("confetti", [AMBAR, ROJO, TEAL, "#ffffff"], 40)] },
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

  effect({
    code: "cuernos-sticker", name: "Cuernos sticker", kind: "sticker", sort: 40,
    description: "La mano de rock en grande.",
    priceCoins: 90, priceCredits: 9, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [sprite("hand-rock", "right")] },
  }),
  effect({
    code: "ampli-sticker", name: "Ampli sticker", kind: "sticker", sort: 50,
    description: "Un ampli con ojos que sube el volumen.",
    priceCoins: 90, priceCredits: 9, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [sprite("amp-face", "right")] },
  }),
  effect({
    code: "ovni-sticker", name: "Ovni sticker", kind: "sticker", sort: 60,
    description: "El ovni de la casa, de visita.",
    priceCoins: 120, priceCredits: 12, durationDays: 30,
    manifest: { version: 1, triggers: ["on_message"], cost: 2, durationMs: 700, reducedMotion: "static",
      layers: [sprite("ufo-vinyl", "right")] },
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
  return isEquippedSlot(kind);
}
