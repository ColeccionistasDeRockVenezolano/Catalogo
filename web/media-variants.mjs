// CRV · copias optimizadas de las imágenes del catálogo (portadas, fotos, logos).
//
// `/crv/media/album/123.jpg?w=320` sirve una copia WebP de 320 px como máximo,
// generada por el optimizador de BrandForge (estilo TinyPNG: la calidad se
// busca por imagen midiendo el parecido con el original, no es fija). Los
// originales de web/public/media NO se tocan y el manifiesto sigue intacto.
//
// Lo comparten el gateway (server.mjs, genera bajo demanda) y el script de
// pregeneración (scripts/media-variants.mjs). Reglas:
// - Solo los anchos de MEDIA_WIDTHS: un ?w= arbitrario no puede llenar el
//   disco ni ocupar la CPU.
// - Una copia vale mientras sea más nueva que su original; si el original se
//   reemplaza, se regenera sola.
// - Si el optimizador no está o falla, se sirve el original: el sitio público
//   no depende de BrandForge para funcionar.
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

/** Anchos que se sirven optimizados (web/src/lib/media.ts usa los mismos). */
export const MEDIA_WIDTHS = Object.freeze([160, 320, 640, 1200]);
/** Formatos de origen que el optimizador sabe leer. */
export const OPTIMIZABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

export const mediaRoot = path.join(directory, "public", "media");
export const variantsRoot = process.env.CRV_MEDIA_VARIANTS ?? path.join(directory, ".media-variants");
export const optimizerCommand = process.env.CRV_MEDIA_OPTIMIZER
  ?? path.join(os.homedir(), "apps", "brandforge", "optimize.sh");

/** `album/123.jpg` + 320 → `<variantsRoot>/w320/album/123.jpg.webp`. */
export function variantPath(relativeToMedia, width) {
  return path.join(variantsRoot, `w${width}`, `${relativeToMedia}.webp`);
}

export async function optimizerAvailable() {
  try {
    await access(optimizerCommand, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pasa un lote de órdenes {src, dst, max_side} al modo `--batch` de BrandForge
 * con prioridad baja. `onResult` recibe cada resultado según termina; la
 * promesa se resuelve siempre (nunca rechaza) con las órdenes sin respuesta.
 */
export function runOptimizer(orders, { jobs = 2, timeoutMs = 15 * 60_000, onResult = () => {} } = {}) {
  return new Promise((resolve) => {
    const unanswered = new Map(orders.map((order) => [order.dst, order]));
    let child;
    try {
      child = spawn("nice", ["-n", "15", optimizerCommand, "--batch", "-j", String(jobs)], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ unanswered: [...unanswered.values()], error });
      return;
    }
    let buffered = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line);
          unanswered.delete(result.dst);
          onResult(result);
        } catch { /* una línea rota no tumba el lote */ }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { if (stderr.length < 4000) stderr += chunk; });
    child.stdin.on("error", () => {}); // EPIPE si el proceso muere antes de leer
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ unanswered: [...unanswered.values()], error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const error = code === 0 ? null : new Error(`optimizador terminó con código ${code}: ${stderr.trim().slice(-300)}`);
      resolve({ unanswered: [...unanswered.values()], error });
    });
    child.stdin.end(orders.map((order) => JSON.stringify({ to: "webp", ...order })).join("\n") + "\n");
  });
}
