// CRV · Motor de shaders del nombre.
//
// Un solo contexto WebGL (fuera del DOM) para todos los nombres. Cada nombre
// tiene un <canvas> 2D pegado a su texto; en cada fotograma del reloj común
// el motor pinta el shader del nombre en el contexto compartido y lo copia a
// ese lienzo. Así el efecto se mueve con el scroll, respeta el orden de capas
// y los recortes de la página, y nunca hay un contexto WebGL por mensaje.
//
// - El campo del texto (`textField.ts`) se calcula una vez por nombre y se
//   reutiliza para todos los mensajes del mismo autor.
// - Solo anima lo que tiene hueco del presupuesto y está en pantalla. El
//   resto se queda con un fotograma fijo pintado una vez: también se ve bien.
// - Calidad baja y «reducir movimiento»: fotograma fijo.
// - Sin WebGL (o si el contexto se pierde) queda el texto con un color sólido.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EffectLayer, Quality } from "../../lib/chatEffects";
import { subscribeFrame } from "../../lib/chatMotion";
import { buildTextField } from "../../lib/textField";
import { NAME_SHADER_VERTEX, nameShaderSource, shaderPadding } from "../../lib/nameShaders";

type Mode = "live" | "still";

interface Emitter {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layer: EffectLayer;
  mode: Mode;
  seed: number;
  quality: Quality;
  field: FieldEntry | null;
  dirty: boolean;
  painted: boolean;
  width: number;
  height: number;
  em: number;
  box: [number, number, number, number];
  onReady: (ready: boolean) => void;
}

interface FieldEntry {
  key: string;
  texture: WebGLTexture;
  users: number;
  range: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const UNIFORMS = ["u_field", "u_res", "u_em", "u_range", "u_time", "u_seed", "u_intensity", "u_speed", "u_col", "u_box"];
/** Fotograma elegido para la versión fija: ya hay gotas y llamas formadas. */
const STILL_TIME = 2.6;

const emitters = new Set<Emitter>();
const fields = new Map<string, FieldEntry>();
const programs = new Map<string, Program | null>();
let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let quad: WebGLBuffer | null = null;
let failed = false;
let unsubscribe: (() => void) | null = null;
let lastPaint = 0;
const startedAt = typeof performance !== "undefined" ? performance.now() : 0;

function context(): WebGLRenderingContext | null {
  if (gl || failed || typeof document === "undefined") return gl;
  glCanvas = document.createElement("canvas");
  glCanvas.width = 256;
  glCanvas.height = 128;
  const next = glCanvas.getContext("webgl", {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: true, powerPreference: "low-power",
  });
  if (!next) {
    failed = true;
    return null;
  }
  glCanvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    // Sin contexto se vuelve al texto normal; no se reintenta en esta visita.
    failed = true;
    gl = null;
    fields.clear();
    programs.clear();
    for (const emitter of emitters) {
      emitter.field = null;
      emitter.onReady(false);
    }
  });
  gl = next;
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  return gl;
}

function compile(g: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = g.createShader(type);
  if (!shader) return null;
  g.shaderSource(shader, source);
  g.compileShader(shader);
  if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console -- un shader roto debe poder diagnosticarse
    console.error("[chat] shader de nombre", g.getShaderInfoLog(shader));
    g.deleteShader(shader);
    return null;
  }
  return shader;
}

function programFor(preset: string): Program | null {
  const g = context();
  if (!g) return null;
  if (programs.has(preset)) return programs.get(preset) ?? null;
  const source = nameShaderSource(preset);
  const vertex = compile(g, g.VERTEX_SHADER, NAME_SHADER_VERTEX);
  const fragment = source ? compile(g, g.FRAGMENT_SHADER, source) : null;
  if (!vertex || !fragment) {
    programs.set(preset, null);
    return null;
  }
  const program = g.createProgram()!;
  g.attachShader(program, vertex);
  g.attachShader(program, fragment);
  g.bindAttribLocation(program, 0, "a_pos");
  g.linkProgram(program);
  if (!g.getProgramParameter(program, g.LINK_STATUS)) {
    programs.set(preset, null);
    return null;
  }
  const uniforms: Program["uniforms"] = {};
  for (const name of UNIFORMS) uniforms[name] = g.getUniformLocation(program, name);
  const entry = { program, uniforms };
  programs.set(preset, entry);
  return entry;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function colorsOf(layer: EffectLayer): Float32Array {
  const colors = layer.colors?.length ? layer.colors : ["#e50914", "#ffb02e", "#ffffff"];
  const out = new Float32Array(18);
  for (let index = 0; index < 6; index += 1) {
    const hex = colors[Math.min(index, colors.length - 1)] ?? "#ffffff";
    out.set(hexToRgb(/^#[0-9a-f]{6}$/iu.test(hex) ? hex : "#ffffff"), index * 3);
  }
  return out;
}

function pixelRatio(quality: Quality): number {
  const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(device, quality === "high" ? 2 : 1.5);
}

/** Mide el texto, rasteriza su forma y prepara (o reutiliza) su campo. */
function layout(emitter: Emitter): boolean {
  const g = context();
  if (!g) return false;
  const host = emitter.host;
  const cssWidth = host.offsetWidth;
  const cssHeight = host.offsetHeight;
  const text = host.textContent ?? "";
  if (!cssWidth || !cssHeight || !text.trim()) return false;
  const style = getComputedStyle(host);
  const fontSize = Number.parseFloat(style.fontSize) || 14;
  const pad = shaderPadding(emitter.layer.preset);
  const dpr = pixelRatio(emitter.quality);
  const padX = Math.ceil(pad.side * fontSize);
  const padTop = Math.ceil(pad.top * fontSize);
  const padBottom = Math.ceil(pad.bottom * fontSize);
  const width = Math.max(1, Math.round((cssWidth + padX * 2) * dpr));
  const height = Math.max(1, Math.round((cssHeight + padTop + padBottom) * dpr));

  emitter.canvas.style.left = `${-padX}px`;
  emitter.canvas.style.top = `${-padTop}px`;
  emitter.canvas.style.width = `${cssWidth + padX * 2}px`;
  emitter.canvas.style.height = `${cssHeight + padTop + padBottom}px`;
  if (emitter.canvas.width !== width) emitter.canvas.width = width;
  if (emitter.canvas.height !== height) emitter.canvas.height = height;
  emitter.width = width;
  emitter.height = height;
  emitter.em = fontSize * dpr;
  emitter.box = [padX * dpr, padTop * dpr, (padX + cssWidth) * dpr, (padTop + cssHeight) * dpr];

  const font = `${style.fontStyle} ${style.fontVariant === "small-caps" ? "small-caps " : ""}${style.fontWeight} ${fontSize * dpr}px ${style.fontFamily}`;
  const key = `${font}|${style.letterSpacing}|${text}|${width}x${height}`;
  if (emitter.field?.key === key) return true;
  release(emitter);
  let entry = fields.get(key);
  if (!entry) {
    const raster = document.createElement("canvas");
    raster.width = width;
    raster.height = height;
    const ctx = raster.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.font = font;
    const spacing = Number.parseFloat(style.letterSpacing);
    if (Number.isFinite(spacing) && "letterSpacing" in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing * dpr}px`;
    }
    const metrics = ctx.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent || fontSize * dpr * 0.8;
    const descent = metrics.fontBoundingBoxDescent || fontSize * dpr * 0.2;
    const baseline = padTop * dpr + (cssHeight * dpr - (ascent + descent)) / 2 + ascent;
    // El ancho del DOM manda: así el shader cae justo sobre el texto real.
    const scaleX = metrics.width > 0 ? (cssWidth * dpr) / metrics.width : 1;
    ctx.setTransform(scaleX, 0, 0, 1, padX * dpr, 0);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, 0, baseline);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const coverage = new Uint8Array(width * height);
    for (let index = 0; index < coverage.length; index += 1) coverage[index] = pixels[index * 4 + 3]!;
    const range = Math.max(6, fontSize * dpr * 0.5);
    const data = buildTextField(coverage, width, height, range);
    const texture = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, texture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, data);
    entry = { key, texture, users: 0, range };
    fields.set(key, entry);
  }
  entry.users += 1;
  emitter.field = entry;
  return true;
}

function release(emitter: Emitter): void {
  const entry = emitter.field;
  emitter.field = null;
  if (!entry) return;
  entry.users -= 1;
  if (entry.users <= 0) {
    fields.delete(entry.key);
    gl?.deleteTexture(entry.texture);
  }
}

function paint(emitter: Emitter, time: number): boolean {
  const g = context();
  const program = programFor(emitter.layer.preset);
  if (!g || !glCanvas || !program || !emitter.field) return false;
  const { width, height } = emitter;
  if (glCanvas.width < width || glCanvas.height < height) {
    glCanvas.width = Math.max(glCanvas.width, width);
    glCanvas.height = Math.max(glCanvas.height, height);
  }
  g.viewport(0, 0, width, height);
  g.useProgram(program.program);
  g.bindBuffer(g.ARRAY_BUFFER, quad);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.activeTexture(g.TEXTURE0);
  g.bindTexture(g.TEXTURE_2D, emitter.field.texture);
  const u = program.uniforms;
  g.uniform1i(u["u_field"]!, 0);
  g.uniform2f(u["u_res"]!, width, height);
  g.uniform1f(u["u_em"]!, emitter.em);
  g.uniform1f(u["u_range"]!, emitter.field.range);
  g.uniform1f(u["u_time"]!, time);
  g.uniform1f(u["u_seed"]!, emitter.seed);
  g.uniform1f(u["u_intensity"]!, emitter.layer.intensity ?? 0.7);
  g.uniform1f(u["u_speed"]!, emitter.layer.speed ?? 1);
  g.uniform3fv(u["u_col"]!, colorsOf(emitter.layer));
  g.uniform4f(u["u_box"]!, ...emitter.box);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  emitter.ctx.clearRect(0, 0, width, height);
  // El origen de WebGL está abajo: la región pintada es la franja inferior.
  emitter.ctx.drawImage(glCanvas, 0, glCanvas.height - height, width, height, 0, 0, width, height);
  return true;
}

function frame(now: number): void {
  if (failed) {
    stop();
    return;
  }
  // Media: 30 Hz. Alta: lo que dé el reloj.
  const live = [...emitters].some((emitter) => emitter.mode === "live");
  const highOnly = [...emitters].every((emitter) => emitter.quality === "high");
  const throttled = !highOnly && now - lastPaint < 31;
  const time = (now - startedAt) / 1000;
  for (const emitter of emitters) {
    if (emitter.dirty || !emitter.field) {
      if (!layout(emitter)) continue;
      emitter.dirty = false;
      emitter.painted = false;
    }
    if (emitter.mode === "live" && throttled) continue;
    if (emitter.mode === "still" && emitter.painted) continue;
    const ok = paint(emitter, emitter.mode === "live" ? time : STILL_TIME + emitter.seed * 0.37);
    if (ok && !emitter.painted) emitter.onReady(true);
    emitter.painted = ok;
  }
  if (!throttled) lastPaint = now;
  // Con todo pintado y nada vivo, el motor suelta el reloj.
  if (!live && [...emitters].every((emitter) => emitter.painted)) stop();
}

function stop(): void {
  unsubscribe?.();
  unsubscribe = null;
}

function wake(): void {
  if (!unsubscribe && !failed && emitters.size > 0) unsubscribe = subscribeFrame(frame);
}

if (typeof document !== "undefined") {
  // Las fuentes web cambian las medidas del texto: se rehacen los campos.
  void document.fonts?.ready.then(() => {
    for (const emitter of emitters) emitter.dirty = true;
    wake();
  });
}

function seedOf(text: string): number {
  let hash = 7;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  return (hash % 97) / 9.7;
}

/** ¿Hay WebGL? Se pregunta una vez; sin él, el nombre usa su color sólido. */
export function shadersAvailable(): boolean {
  return Boolean(context());
}

/**
 * Texto del nombre con su shader. `live`: anima; si no, fotograma fijo.
 * El texto real sigue en el DOM (seleccionable y legible para lectores de
 * pantalla); cuando el lienzo está listo se vuelve transparente.
 */
export function ShaderText({ text, layer, live, quality }: {
  text: string; layer: EffectLayer; live: boolean; quality: Quality;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emitterRef = useRef<Emitter | null>(null);
  const [ready, setReady] = useState(false);
  // La capa llega recreada en cada render: el emisor depende de su contenido.
  const layerKey = JSON.stringify(layer);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const mode: Mode = live && quality !== "low" && quality !== "reduced" ? "live" : "still";

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!host || !canvas || !ctx || !context()) return;
    const emitter: Emitter = {
      host, canvas, ctx, layer: layerRef.current, mode, quality, seed: seedOf(text), field: null, dirty: true, painted: false,
      width: 0, height: 0, em: 14, box: [0, 0, 0, 0], onReady: setReady,
    };
    emitterRef.current = emitter;
    emitters.add(emitter);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      emitter.dirty = true;
      wake();
    });
    observer?.observe(host);
    wake();
    return () => {
      observer?.disconnect();
      emitters.delete(emitter);
      release(emitter);
      emitterRef.current = null;
    };
    // El texto y la capa rehacen el emisor; el modo se actualiza abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, layerKey, quality]);

  useEffect(() => {
    const emitter = emitterRef.current;
    if (!emitter || emitter.mode === mode) return;
    // Al pausarse (fuera de pantalla, sin hueco) conserva el último fotograma.
    emitter.mode = mode;
    wake();
  }, [mode]);

  return (
    <span ref={hostRef} className={`crv-shader-text${ready ? " is-ready" : ""}`}>
      {text}
      <canvas ref={canvasRef} className="crv-shader-canvas" aria-hidden="true" />
    </span>
  );
}

/** Para pruebas y medición en el navegador. */
export function shaderStats(): { emitters: number; fields: number; live: number } {
  return { emitters: emitters.size, fields: fields.size, live: [...emitters].filter((emitter) => emitter.mode === "live").length };
}
