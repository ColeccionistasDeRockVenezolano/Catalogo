import { z } from "zod";

const color = z.string().regex(/^#[\da-f]{6}$/iu);
const angle = z.number().finite().min(0).max(360);
/** Valores acotados: el editor y el renderer comparten el mismo contrato. */
export const nameStyleSchema = z.object({
  family: z.enum(["sans", "serif", "script", "mono"]).default("sans"),
  size: z.number().min(10).max(40).default(18),
  weight: z.number().int().min(100).max(900).default(700),
  italic: z.boolean().default(false),
  tracking: z.number().min(-1.5).max(6).default(0),
  colors: z.array(color).length(3).default(["#e4383a", "#680d10", "#fff1ab"]),
  gradient: z.boolean().default(true),
  gradientAngle: angle.default(90),
  colorStop: z.number().min(0).max(100).default(45),
  outlineColor: color.default("#000000"),
  outlineWidth: z.number().min(0).max(2).default(0),
  shadow: z.boolean().default(true),
  shadowColor: color.default("#680d10"),
  shadowBlur: z.number().min(0).max(12).default(3),
  shadowAngle: angle.default(180),
  shadowDistance: z.number().min(0).max(8).default(1),
  animation: z.enum(["none", "wave", "flow", "float", "pulse", "sparkle", "spin"]).default("wave"),
  duration: z.number().min(0.3).max(20).default(3),
  direction: z.enum(["normal", "reverse", "alternate", "alternate-reverse"]).default("alternate"),
  motionAngle: angle.default(0),
  amplitude: z.number().min(0).max(12).default(3),
  stagger: z.number().min(-1).max(1).default(-0.13),
  rotation: angle.default(0),
  glyphRotation: angle.default(0),
  prefix: z.string().max(12).default(""),
  suffix: z.string().max(12).default(""),
});
export type NameStyle = z.infer<typeof nameStyleSchema>;
export const DEFAULT_NAME_STYLE = nameStyleSchema.parse({});
export const NAME_STYLE_FAMILIES = {
  sans: 'Inter, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  script: '"Brush Script MT", "Segoe Script", cursive',
  mono: '"JetBrains Mono", monospace',
};
export function angleVector(degrees: number, distance: number) {
  const radians = degrees * Math.PI / 180;
  return { x: Math.sin(radians) * distance, y: -Math.cos(radians) * distance };
}
/** Animaciones que hacen recorrer el degradado a lo largo de su propio eje. */
export const FLOWING_NAME_ANIMATIONS: ReadonlySet<NameStyle["animation"]> = new Set(["wave", "flow", "sparkle"]);
/**
 * Geometría del degradado. Un periodo repite inicio → centro → final (85 %) →
 * inicio, así el recorrido se repite sin salto. Si el color fluye, cada letra
 * muestra un tramo del periodo (2,3 veces su caja); si no, el periodo cabe en
 * la letra y se ven los tres colores. En «flow», cada letra se desplaza lo que
 * avanza sobre el eje para que el color sea continuo a lo largo del nombre.
 */
export function nameGradientGeometry(style: NameStyle) {
  const radians = style.gradientAngle * Math.PI / 180;
  const along = (0.6 + style.tracking / style.size) * Math.sin(radians);
  const line = Math.abs(along) + Math.abs(1.45 * Math.cos(radians));
  return {
    period: FLOWING_NAME_ANIMATIONS.has(style.animation) ? 2.3 : 1 / 0.85,
    center: Math.min(style.colorStop, 85),
    letterShift: style.animation === "flow" && line > 0 ? -100 * along / line : 0,
  };
}
/** Huella real del nombre: giro, movimiento y sombra tienen espacio propio. */
export function nameStyleBounds(width: number, height: number, style: NameStyle) {
  const radians = style.rotation * Math.PI / 180;
  const pad = (style.shadow ? style.shadowBlur * 2 + style.shadowDistance : 0) + style.outlineWidth + style.amplitude + 2;
  return { width: Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)) + pad * 2),
    height: Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)) + pad * 2) };
}
export const NAME_STYLE_REFERENCES = [
  // Como en la captura: el degradado sube de abajo arriba (0°) y el color lo recorre.
  { code: "loby", name: "Loby", sample: "ℓσв𝓎", description: "Negro y rojo que suben por cada letra", style: nameStyleSchema.parse({ family: "sans", size: 17, italic: true, tracking: -0.7, colors: ["#080507", "#680d10", "#e4383a"], gradientAngle: 0, shadowColor: "#510608", outlineColor: "#2b0809", outlineWidth: 0.25, duration: 2.15, stagger: -0.22 }) },
  { code: "bunnita", name: "Bunnita", sample: "Bunnita", description: "Rosa y oro en ola suave", style: nameStyleSchema.parse({ family: "serif", size: 19, italic: true, tracking: -0.15, colors: ["#db64a3", "#fff1ab", "#ffa4d7"], gradientAngle: 0, shadowColor: "#874269", shadowBlur: 2, outlineColor: "#f6f2e6", outlineWidth: 0.4, duration: 3.6, prefix: "˙ ", suffix: " °" }) },
  { code: "enana", name: "Enana", sample: "∥[Enana♥]∥", description: "Fucsia con destellos por letra", style: nameStyleSchema.parse({ family: "script", size: 18, italic: true, tracking: -0.45, colors: ["#c42767", "#ff6fa6", "#fff1f8"], gradientAngle: 0, shadowColor: "#ff56a1", shadowBlur: 5, outlineColor: "#ffe2ed", outlineWidth: 0.5, duration: 2.4, stagger: -0.12, animation: "sparkle", prefix: "♀ " }) },
] as const;
