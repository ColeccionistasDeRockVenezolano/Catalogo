// CRV · Encuadre de fotos locales por sus rostros (scripts/image-focus.py).
//
// La portada recorta la foto del artista del día en recuadros de proporciones
// distintas; la web coloca a la vista la caja de rostros que se calcula aquí.
// El resultado se guarda en memoria por archivo, tamaño y fecha: si la foto
// cambia se vuelve a calcular. Mientras el detector trabaja, o si falla, la
// foto se muestra con el encuadre por defecto de la hoja de estilos.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCAL_MEDIA = /^\/(?:crv\/)?media\//u;
/** Lo que espera la portada antes de responder sin encuadre; el cálculo sigue y sirve a la próxima visita. */
const WAIT_MS = 1500;
const DETECT_TIMEOUT_MS = 20_000;
/** Un fallo se reintenta pasado este tiempo, no en cada visita. */
const FAILURE_TTL_MS = 10 * 60_000;

/** Caja que reúne los rostros, en fracciones (0–1) del ancho y alto de la imagen. */
export interface ImageFocus { x: number; y: number; width: number; height: number }

type Detect = (files: string[]) => Promise<Map<string, ImageFocus | null>>;
type Entry = { key: string; focus: Promise<ImageFocus | null>; failedAt?: number };

const cache = new Map<string, Entry>();

/** Ruta del archivo de una foto local (/crv/media/… o /media/…); null para externas o rutas que escapan. */
export function localMediaFile(url: string, mediaRoot = path.resolve("web/public/media")): string | null {
  if (!LOCAL_MEDIA.test(url)) return null;
  const relative = decodeURIComponent(url.replace(LOCAL_MEDIA, "").split(/[?#]/u)[0]!);
  const file = path.resolve(mediaRoot, relative);
  return file.startsWith(mediaRoot + path.sep) ? file : null;
}

async function detectWithPython(files: string[]): Promise<Map<string, ImageFocus | null>> {
  const { stdout } = await execFileAsync("python3", ["scripts/image-focus.py", ...files], { timeout: DETECT_TIMEOUT_MS });
  const result = new Map<string, ImageFocus | null>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { path: string; focus?: ImageFocus | null; error?: string };
    if (!row.error) result.set(row.path, row.focus ?? null);
  }
  return result;
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then((value) => resolve(value), () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
}

/**
 * Encuadre de cada foto local de `urls`. Devuelve null para fotos externas,
 * sin rostros fiables o todavía en cálculo pasado `waitMs`.
 */
export async function imageFocus(
  urls: Array<string | null>,
  options: { mediaRoot?: string; detect?: Detect; waitMs?: number } = {},
): Promise<Map<string, ImageFocus | null>> {
  const detect = options.detect ?? detectWithPython;
  const pending = new Map<string, { file: string; key: string }>();
  const entries = new Map<string, Entry>();
  await Promise.all([...new Set(urls)].map(async (url) => {
    const file = url ? localMediaFile(url, options.mediaRoot) : null;
    if (!url || !file) return;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return;
    const key = `${info.size}:${info.mtimeMs}`;
    const cached = cache.get(file);
    const stale = cached?.failedAt !== undefined && Date.now() - cached.failedAt > FAILURE_TTL_MS;
    if (cached && cached.key === key && !stale) entries.set(url, cached);
    else pending.set(url, { file, key });
  }));
  if (pending.size) {
    const batch = detect([...new Set([...pending.values()].map(item => item.file))]);
    for (const [url, { file, key }] of pending) {
      const entry: Entry = { key, focus: batch.then(found => found.get(file) ?? null) };
      entry.focus.catch(() => { entry.failedAt = Date.now(); });
      // Un archivo que no se pudo analizar se marca como fallo y se reintenta más tarde.
      void batch.then(found => { if (!found.has(file)) entry.failedAt = Date.now(); }, () => undefined);
      cache.set(file, entry);
      entries.set(url, entry);
    }
  }
  const result = new Map<string, ImageFocus | null>();
  await Promise.all([...entries].map(async ([url, entry]) => {
    const focus = await settleWithin(entry.focus.catch(() => null), options.waitMs ?? WAIT_MS);
    result.set(url, focus ?? null);
  }));
  return result;
}

/** Solo para pruebas. */
export function clearImageFocusCache(): void {
  cache.clear();
}
