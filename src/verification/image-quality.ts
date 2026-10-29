import sharp, { type Metadata } from "sharp";

/**
 * Deterministic inspection of a downloaded image: natural size, integrity, sharpness,
 * effective resolution (an enlarged thumbnail must not pass as high quality) and a
 * perceptual fingerprint to group variants of the same picture. No model, no network.
 */
export interface ImageInspection {
  ok: boolean;
  error: string | null;
  format: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Width that still carries detail; well below `width` means an upscaled copy. */
  effectiveWidth: number | null;
  upscaled: boolean;
  /** Variance of the Laplacian on a grey copy of at most 512 px; low values are blurry. */
  sharpness: number | null;
  /** 64-bit difference hash as 16 hex characters. */
  fingerprint: string | null;
  quality: "high" | "medium" | "low" | "failed";
  reasons: string[];
}
const MIN_HIGH = 1000, MIN_MEDIUM = 500, BLURRY = 60;
const failed = (bytes: number, error: string): ImageInspection => ({
  ok: false, error, format: null, bytes, width: null, height: null, effectiveWidth: null,
  upscaled: false, sharpness: null, fingerprint: null, quality: "failed", reasons: [error],
});
async function grey(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image).greyscale().resize(width, height, { fit: "fill" }).raw().toBuffer();
}
async function fingerprint(image: Buffer): Promise<string> {
  const pixels = await grey(image, 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}
/** Variance of the 4-neighbour Laplacian of a grey copy at the given size. */
async function laplacian(image: Buffer, width: number, height: number): Promise<number> {
  const w = Math.max(16, Math.round(width)), h = Math.max(16, Math.round(height));
  const g = await grey(image, w, h);
  let sum = 0, squares = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const v = g[(y - 1) * w + x]! + g[(y + 1) * w + x]! + g[y * w + x - 1]! + g[y * w + x + 1]! - 4 * g[y * w + x]!;
    sum += v; squares += v * v; n++;
  }
  return squares / n - (sum / n) ** 2;
}
const SCALES = [1, 0.71, 0.5, 0.35, 0.25, 0.18, 0.125, 0.09];
/**
 * Real detail keeps the Laplacian comparable when the picture is halved; an enlarged copy
 * gains several times more, because halving only removes interpolation. The effective
 * width is the largest scale whose detail survives halving (ratio calibrated on catalog
 * covers: genuine 0.4–1.6, four-times enlargements about 0.1).
 */
async function effectiveWidth(image: Buffer, width: number, height: number): Promise<number> {
  const start = Math.min(1, 2048 / Math.max(width, height));
  const sizes = SCALES.map((f) => [width * start * f, height * start * f] as const);
  const values = await Promise.all(sizes.map(([w, h]) => laplacian(image, w, h)));
  for (let i = 0; i + 2 < values.length; i++)
    if (values[i]! >= 0.3 * values[i + 2]!) return Math.round(width * start * SCALES[i]!);
  return Math.round(width * start * SCALES[SCALES.length - 3]!);
}
export async function inspectImage(input: Uint8Array): Promise<ImageInspection> {
  const image = Buffer.from(input);
  if (!image.length) return failed(0, "Descarga vacía");
  let metadata: Metadata;
  try {
    metadata = await sharp(image).metadata();
    // Decoding the whole raster catches truncated downloads that headers alone hide.
    await sharp(image, { failOn: "truncated" }).raw().toBuffer();
  } catch (error) {
    return failed(image.length, `Imagen ilegible o incompleta: ${error instanceof Error ? error.message : String(error)}`);
  }
  const width = metadata.autoOrient?.width ?? metadata.width, height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height) return failed(image.length, "Imagen sin dimensiones");
  const scale = Math.min(1, 512 / Math.max(width, height));
  const [sharpness, effective, print] = await Promise.all([laplacian(image, width * scale, height * scale), effectiveWidth(image, width, height), fingerprint(image)]);
  const upscaled = effective <= width * 0.5;
  const reasons: string[] = [];
  const usable = Math.min(effective, Math.round(effective * height / width));
  if (upscaled) reasons.push(`Ampliada: conserva detalle de unos ${effective} px de ancho aunque mide ${width}`);
  if (sharpness < BLURRY) reasons.push("Desenfocada o con poco detalle");
  if (usable < MIN_MEDIUM) reasons.push(`Resolución útil baja (${usable} px en el lado menor)`);
  const quality = usable >= MIN_HIGH && sharpness >= BLURRY ? "high" : usable >= MIN_MEDIUM && sharpness >= BLURRY / 2 ? "medium" : "low";
  return { ok: true, error: null, format: metadata.format ?? null, bytes: image.length, width, height, effectiveWidth: effective, upscaled, sharpness: Math.round(sharpness), fingerprint: print, quality, reasons };
}
export function fingerprintDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (diff) { count += Number(diff & 1n); diff >>= 1n; }
  return count;
}
const rank = { high: 3, medium: 2, low: 1, failed: 0 } as const;
/**
 * Groups variants of the same picture (crops of a few pixels, recompressions, resizes)
 * and orders each group best first. Failed downloads never lead a group.
 */
export function groupVariants<T extends { inspection: ImageInspection }>(items: T[], threshold = 10): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const print = item.inspection.fingerprint;
    const group = print ? groups.find((g) => g[0]!.inspection.fingerprint && fingerprintDistance(g[0]!.inspection.fingerprint!, print) <= threshold) : undefined;
    if (group) group.push(item); else groups.push([item]);
  }
  const score = (i: ImageInspection) => [rank[i.quality], i.upscaled ? 0 : 1, (i.effectiveWidth ?? 0) * (i.height ?? 0) / Math.max(1, i.width ?? 1), i.sharpness ?? 0];
  for (const group of groups) group.sort((a, b) => {
    const x = score(a.inspection), y = score(b.inspection);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
    return 0;
  });
  return groups;
}

export type ImageUse = "cover" | "back_cover" | "portrait" | "group" | "live" | "poster" | "irrelevant" | "unknown";
export interface ImageUseInput {
  url: string;
  /** Alt text, caption or the quoted "Imagen:" line from the page: what documents the picture itself. */
  context: string;
  /** Source, campaign and page address: words there hint at a use but do not describe this picture. */
  locator?: string;
  target: "album" | "artist" | "person";
  width?: number | null;
  height?: number | null;
  decorative?: boolean;
}
const usePatterns: Array<[ImageUse, RegExp]> = [
  ["back_cover", /contraportada|contra portada|back ?cover|reverso|parte trasera|\btrasera\b|\bback\b/u],
  ["poster", /afiche|cartel|poster|flyer|volante|\bentradas?\b|ticket/u],
  ["live", /en vivo|en directo|concierto|\blive\b|tarima|escenario|\bshow\b|festival/u],
  ["cover", /portada|caratula|\bcover\b|artwork|front|album art|\bdisco\b|\/discos?\/|\/albums?\//u],
  ["group", /\bbanda\b|\bgrupo\b|integrantes|band ?photo|press ?photo|foto promocional|promo/u],
  ["portrait", /retrato|portrait|perfil|profile|foto de|avatar|headshot|\/cantantes\/|\/people\//u],
];
/**
 * Use of an image from its documented context and shape. Text wins over shape; a square
 * picture of an album is a cover only when nothing says otherwise. Ambiguous cases stay
 * "unknown" for inspection instead of being guessed.
 */
export function classifyImageUse(input: ImageUseInput): { use: ImageUse; reasons: string[] } {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const address = decodeURIComponent(input.url.replace(/%(?![0-9a-f]{2})/giu, "%25"));
  const { width, height } = input;
  const aspect = width && height ? width / height : null;
  if (input.decorative) return { use: "irrelevant", reasons: ["Recurso decorativo de la página (logo, icono o miniatura de interfaz)"] };
  if (aspect && (aspect > 3 || aspect < 1 / 3)) return { use: "irrelevant", reasons: ["Proporción de banner o franja"] };
  // Size is a quality problem, not a use: an old thumbnail still shows a band, a cover or a stage
  // (and the reading tells a placeholder silhouette apart); it just cannot lead the record.
  const small = width && height && Math.min(width, height) < 120 ? [`${TOO_SMALL} (${width}×${height}): no sirve como imagen principal`] : [];
  // Album titles often say "En vivo" or "Concierto": on an album, cover wording comes first.
  const order = input.target === "album" ? [...usePatterns].sort(([a], [b]) => Number(b === "back_cover") * 2 + Number(b === "cover") - (Number(a === "back_cover") * 2 + Number(a === "cover"))) : usePatterns;
  const context = fold(input.context);
  const text = `${context} ${fold(`${input.locator ?? ""} ${address}`)}`;
  for (const [use, pattern] of order) {
    if (!pattern.test(text)) continue;
    // Words about the band on an album page usually describe the cover's subject, not a press photo.
    if (use === "group" && input.target === "album") continue;
    if ((use === "portrait" || use === "group") && input.target === "album" && /portada|cover|caratula/u.test(text)) continue;
    return { use, reasons: [pattern.test(context) ? `El contexto lo describe como ${useLabels[use]}` : `${LOCATED} ${useLabels[use]}`, ...small] };
  }
  if (input.target === "album" && aspect && Math.abs(aspect - 1) <= 0.06) return { use: "cover", reasons: ["Imagen cuadrada asociada a un disco", ...small] };
  if (input.target !== "album" && aspect && aspect < 0.95) return { use: "portrait", reasons: ["Imagen vertical asociada a una persona o artista", ...small] };
  if (input.target === "artist" && aspect && aspect > 1.2) return { use: "group", reasons: ["Imagen horizontal asociada a un artista", ...small] };
  return { use: "unknown", reasons: ["El contexto no indica el uso; requiere inspección", ...small] };
}
/** Prefix of the note on a picture below the size that can lead a record. */
export const TOO_SMALL = "Demasiado pequeña";
/** Prefix of a use read from the address, source or campaign name rather than from the picture's own context. */
export const LOCATED = "La dirección o la fuente la señalan como";
export const useLabels: Record<ImageUse, string> = {
  cover: "portada", back_cover: "contraportada", portrait: "retrato", group: "foto de grupo", live: "foto en vivo",
  poster: "afiche", irrelevant: "recurso irrelevante", unknown: "uso sin determinar",
};
/** Whether a use can stand as the record's principal image. */
export const principalUse = (target: "album" | "artist" | "person", use: ImageUse) =>
  target === "album" ? use === "cover" : use === "portrait" || use === "group";
