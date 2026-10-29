// One bounded canvas for ALL material effects. No canvas/context per message,
// no React state per frame, no SVG filters or per-pixel simulation per frame.
import { useEffect, useRef, type RefObject } from "react";
import type { EffectLayer, Quality } from "../../lib/chatEffects";
import { subscribeFrame } from "../../lib/chatMotion";
import { bloodPhase, boltPoints, drift, materialPreset, randomAt, type MaterialPreset, type MaterialTarget } from "../../lib/chatMaterials";

interface Emitter {
  element: Element; layer: EffectLayer; preset: MaterialPreset; target: MaterialTarget;
  seed: number; age: number; rect: DOMRect | null; clip: DOMRect | null; measuredAt: number;
  bolts: ReturnType<typeof boltPoints>; dischargeAt: number; discharge: number;
}
const emitters = new Set<Emitter>();
let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
let unsubscribe: (() => void) | null = null;
let serial = 0;
let resolution = 1;
let quality: Quality = "medium";
let dirty = true;
let lastPaint = 0;
let expensiveFrames = 0;
let throttled = false;
let intervalSum = 0;
let intervalCount = 0;
const textures = new Map<string, HTMLCanvasElement>();
const TAU = Math.PI * 2;

/** Cached volumetric smoke: four octaves, computed only on first use. */
export function smokeTexture(color: string): HTMLCanvasElement {
  const cached = textures.get(color);
  if (cached) return cached;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 64;
  const ctx = tile.getContext("2d")!;
  const pixels = ctx.createImageData(64, 64);
  const rgb = color.match(/[a-f\d]{2}/giu)?.map((v) => parseInt(v, 16)) ?? [30, 25, 40];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const radius = Math.hypot((x - 31.5) / 32, (y - 31.5) / 32);
    let noise = 0;
    for (let octave = 0; octave < 4; octave++) {
      const scale = 16 / 2 ** octave;
      const nx = x / scale; const ny = y / scale;
      const ix = Math.floor(nx); const iy = Math.floor(ny);
      const sx = (nx - ix) ** 2 * (3 - 2 * (nx - ix));
      const sy = (ny - iy) ** 2 * (3 - 2 * (ny - iy));
      const a = randomAt(ix + iy * 97);
      const b = randomAt(ix + 1 + iy * 97);
      const c = randomAt(ix + (iy + 1) * 97);
      const d = randomAt(ix + 1 + (iy + 1) * 97);
      noise += ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy) / 2 ** octave;
    }
    const at = (y * 64 + x) * 4;
    const light = 0.7 + noise * 0.35;
    pixels.data[at] = (rgb[0] ?? 30) * light;
    pixels.data[at + 1] = (rgb[1] ?? 25) * light;
    pixels.data[at + 2] = (rgb[2] ?? 40) * light;
    pixels.data[at + 3] = Math.max(0, 1 - radius) ** 1.6 * Math.min(1, noise) * 235;
  }
  ctx.putImageData(pixels, 0, 0);
  // Only known palette colors are cached, never arbitrary server input.
  if (textures.size < 8) textures.set(color, tile);
  return tile;
}

function resize(): void {
  if (!canvas) return;
  resolution = Math.min(window.devicePixelRatio || 1, quality === "high" ? 1.5 : 1,
    Math.sqrt(2_500_000 / Math.max(1, innerWidth * innerHeight)));
  canvas.width = Math.round(innerWidth * resolution);
  canvas.height = Math.round(innerHeight * resolution);
  dirty = true;
}

function invalidate(): void { dirty = true; }
function ensureRunning(): void {
  if (!unsubscribe && context && emitters.size) unsubscribe = subscribeFrame(frame);
}
function clearAndStop(): void {
  unsubscribe?.(); unsubscribe = null;
  context?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
}

/** The clip follows the scroller or shop; light never leaks over controls. */
function measure(emitter: Emitter, now: number): void {
  if (!dirty && now - emitter.measuredAt < 120) return;
  emitter.measuredAt = now;
  emitter.rect = emitter.element.isConnected ? emitter.element.getBoundingClientRect() : null;
  const parent = emitter.element.closest(".chat-messages, .crv-probador, .chat-effect-preview, .chat-users, .chat-sheet-body");
  emitter.clip = parent?.getBoundingClientRect() ?? null;
}

function protectContent(ctx: CanvasRenderingContext2D, e: Emitter): void {
  const r = e.rect!;
  const pad = e.preset === "shadow-entity" ? 25 : 22;
  ctx.beginPath();
  ctx.rect(-pad, -pad, r.width + pad * 2, r.height + pad * 2);
  // A hole protects the whole avatar image / nickname / message content.
  const inset = e.target === "avatar" ? 1 : 0;
  if (e.target === "avatar") ctx.roundRect(inset, inset, r.width - inset * 2, r.height - inset * 2, r.width / 2);
  else ctx.rect(inset, inset, Math.max(0, r.width - inset * 2), Math.max(0, r.height - inset * 2));
  ctx.clip("evenodd");
}

function smoke(ctx: CanvasRenderingContext2D, e: Emitter, time: number): void {
  const r = e.rect!; const cursed = e.preset === "curse-aura";
  const count = quality === "high" ? 19 : 12;
  for (let i = 0; i < count; i++) {
    const seed = e.seed + i * 11.3;
    const period = (cursed ? 3 : 4) + randomAt(seed) * 3;
    const t = ((time + randomAt(seed + 4) * period) % period) / period;
    const angle = randomAt(seed + 1) * TAU;
    const side = e.target === "avatar";
    const x = side ? r.width / 2 + Math.cos(angle) * (r.width * 0.44 + t * 11)
      : randomAt(seed + 2) * r.width + drift(time * 0.6, seed) * 7;
    const y = side ? r.height / 2 + Math.sin(angle) * (r.height * 0.45 + t * 12) - t * 7
      : r.height * 0.6 - t * 23;
    const size = 17 + randomAt(seed + 3) * 18 + Math.sin(t * Math.PI) * 12;
    ctx.globalAlpha = Math.sin(t * Math.PI) * (cursed ? 1 : 0.95) * (e.layer.intensity ?? 0.85);
    ctx.save(); ctx.translate(x, y); ctx.rotate(drift(time * 0.5, seed) * 0.6);
    ctx.drawImage(smokeTexture(cursed ? (i % 3 === 0 ? "#9c5fc7" : "#61507d") : (i % 3 === 0 ? "#3f3b3a" : "#080808")), -size / 2, -size / 2, size, size * 1.2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (cursed) {
    // Jagged obsidian outgrowths, distinct from upward blue flames.
    for (let i = 0; i < 5; i++) {
      const a = i * 1.37 + e.seed; const reach = 4 + (drift(time * 0.75, i) + 1) * 3;
      const x = r.width / 2 + Math.cos(a) * (r.width / 2 + 1);
      const y = r.height / 2 + Math.sin(a) * (r.height / 2 + 1);
      ctx.fillStyle = "#1e1d2f"; ctx.strokeStyle = "#9c5fc7"; ctx.lineWidth = 0.55;
      ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach); ctx.lineTo(x + 2, y + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  } else {
    // A rare presence in the smoke, with a gradual reveal; never on the photo.
    const cycle = (time + e.seed) % 12.7;
    if (cycle > 10.8 && cycle < 11.35) {
      ctx.globalAlpha = Math.sin((cycle - 10.8) / 0.55 * Math.PI) * 0.9;
      ctx.fillStyle = "#e6e8e8";
      const x = r.width * 0.72; const y = -8;
      ctx.beginPath(); ctx.ellipse(x - 4, y, 2.1, 0.8, -0.15, 0, TAU); ctx.ellipse(x + 4, y, 2.1, 0.8, 0.15, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

function flames(ctx: CanvasRenderingContext2D, e: Emitter, time: number): void {
  const r = e.rect!; const blue = e.preset === "karma-aura";
  const count = quality === "high" ? 15 : 10;
  for (let i = 0; i < count; i++) {
    const seed = e.seed + i * 7.31;
    const life = 2 + randomAt(seed) * 1.1;
    const t = ((time + randomAt(seed + 1) * life) % life) / life;
    const angle = i / count * TAU;
    const half = Math.ceil(count / 2);
    const x = e.target === "avatar" ? r.width / 2 + Math.cos(angle) * r.width * 0.49
      : e.target === "bubble" ? (i < half ? -1 : r.width + 1) : i / (count - 1) * r.width;
    // Anchor on the OUTER edge: starting inside the protected text rectangle
    // would clip almost the entire flame and leave only occasional tips.
    const y = e.target === "avatar" ? r.height / 2 + Math.sin(angle) * r.height * 0.49
      : e.target === "bubble" ? (i % half + 1) / half * r.height : 1;
    const height = (8 + randomAt(seed + 2) * 15) * Math.sin(t * Math.PI);
    const curl = drift(time * 1.2, seed) * 8;
    const width = 3.3 + randomAt(seed + 3) * 3;
    const gradient = ctx.createLinearGradient(x, y + 3, x + curl, y - height);
    gradient.addColorStop(0, blue ? "#bcedf3" : "#fff1ae");
    gradient.addColorStop(0.35, blue ? "#45ade5" : "#ffb02e");
    gradient.addColorStop(0.7, blue ? "#1e3ea9aa" : "#e53e0caa");
    gradient.addColorStop(1, blue ? "#1d1c3900" : "#66040700");
    ctx.globalAlpha = (0.6 + Math.sin(time * 1.37) * 0.12) * (e.layer.intensity ?? 1);
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(x - width, y + 2);
    ctx.bezierCurveTo(x - width * 1.5, y - height * 0.4, x + curl - width, y - height * 0.7, x + curl, y - height);
    ctx.bezierCurveTo(x + curl * 0.6, y - height * 0.35, x + width * 1.4, y - height * 0.5, x + width, y + 2);
    ctx.closePath(); ctx.fill();
    if (i % 3 === 0) {
      ctx.fillStyle = blue ? "#78e7ff" : "#ffd76a";
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.8;
      ctx.beginPath(); ctx.ellipse(x + curl, y - height - t * 8, 0.7, 1.7, curl * 0.05, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function electricity(ctx: CanvasRenderingContext2D, e: Emitter, time: number): void {
  const r = e.rect!;
  if (time >= e.dischargeAt) {
    e.discharge += 1;
    e.dischargeAt = time + 0.06 + randomAt(e.seed + e.discharge) * 0.1;
    e.bolts = boltPoints(r.width + 12, 12, e.seed + e.discharge * 71);
  }
  // A moving blade for text, short independent arcs for the circular avatar.
  const arc = e.target === "avatar";
  const sweep = (time % 1.8) / 1.8;
  for (let stroke = 0; stroke < 3; stroke++) {
    ctx.beginPath();
    e.bolts.forEach((point, index) => {
      const a = point.x / (r.width + 12) * Math.PI * 0.95 + time * 2.7 + e.seed;
      const x = arc ? r.width / 2 + Math.cos(a) * (r.width / 2 + 3 + (point.y - 6) * 0.4) : point.x - 6;
      const y = arc ? r.height / 2 + Math.sin(a) * (r.height / 2 + 3 + (point.y - 6) * 0.4) : point.y - 11 + Math.sin(sweep * TAU) * 2;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      if (index % 3 === 1) { ctx.lineTo(x + (randomAt(index + e.discharge) - 0.5) * 15, y - 5 - randomAt(index) * 8); ctx.moveTo(x, y); }
    });
    ctx.strokeStyle = stroke === 0 ? "#2156b5" : stroke === 1 ? "#38b7ee" : "#ecffff";
    ctx.lineWidth = stroke === 0 ? 5 : stroke === 1 ? 2.1 : 0.65;
    ctx.globalAlpha = stroke === 0 ? 0.15 : stroke === 1 ? 0.55 : 0.85;
    ctx.lineJoin = "round"; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function blood(ctx: CanvasRenderingContext2D, e: Emitter, time: number): void {
  const r = e.rect!;
  const count = e.target === "avatar" ? 5 : Math.min(9, Math.max(3, Math.floor(r.width / 19)));
  const y = e.target === "name" ? r.height - 1 : 0;
  // A convex meniscus feeds every drip. Specular highlight adds volume.
  const film = ctx.createLinearGradient(0, y - 2, 0, y + 5);
  film.addColorStop(0, "#380006"); film.addColorStop(0.4, "#b30a09"); film.addColorStop(1, "#660407");
  ctx.fillStyle = film;
  ctx.beginPath(); ctx.moveTo(0, y - 1); ctx.bezierCurveTo(r.width * 0.3, y + 3, r.width * 0.7, y - 3, r.width, y); ctx.lineTo(r.width, y + 2); ctx.bezierCurveTo(r.width * 0.7, y + 1, r.width * 0.3, y + 5, 0, y + 2); ctx.fill();
  for (let i = 0; i < count; i++) {
    const seed = e.seed + i * 9.17;
    const state = bloodPhase(time, seed);
    const x = (i + 0.3 + randomAt(seed + 2) * 0.4) / count * r.width;
    const head = 1.7 + randomAt(seed + 3 + state.cycle * 19) * 1.7;
    const length = (5 + randomAt(seed + 4 + state.cycle * 19) * 13) * state.growth;
    const neck = Math.max(0.15, head * 0.52 * state.neck);
    const shading = ctx.createLinearGradient(x - head, y, x + head, y);
    shading.addColorStop(0, "#380006"); shading.addColorStop(0.42, "#b30a09"); shading.addColorStop(0.6, "#dc3431"); shading.addColorStop(1, "#660407");
    ctx.fillStyle = shading;
    const attached = state.phase < 0.79;
    const end = attached ? length : 3 * state.remnant;
    ctx.beginPath(); ctx.moveTo(x - head, y);
    ctx.bezierCurveTo(x - neck, y + 2, x - neck, y + end - head, x - head * (attached ? 0.85 : 0.35), y + end);
    ctx.bezierCurveTo(x - head, y + end + head * 1.8, x + head, y + end + head * 1.8, x + head * (attached ? 0.85 : 0.35), y + end);
    ctx.bezierCurveTo(x + neck, y + end - head, x + neck, y + 2, x + head, y); ctx.closePath(); ctx.fill();
    if (state.falling) {
      ctx.globalAlpha = 1 - state.flight;
      const fallY = y + length + state.fallDistance * 22;
      ctx.beginPath(); ctx.ellipse(x, fallY, head, head * (1.1 + state.flight * 0.5), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f06b64"; ctx.beginPath(); ctx.ellipse(x - head * 0.35, fallY - head * 0.2, 0.4, head * 0.55, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else if (attached) {
      ctx.strokeStyle = "#f06b64"; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(x - head * 0.35, y + end); ctx.lineTo(x - head * 0.35, y + end + head * 0.6); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}

function pastel(ctx: CanvasRenderingContext2D, e: Emitter, time: number): void {
  const r = e.rect!;
  const colors = ["#ffadce", "#fcd6bf", "#fff0ae", "#ddf3b5", "#a3dff2", "#c5a5f2"];
  if (e.target !== "name") {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU + time * 0.12;
      ctx.strokeStyle = colors[i % 6]!; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.width / 2, r.height / 2, r.width / 2 + 3, r.height / 2 + 3, 0, a, a + 0.24); ctx.stroke();
    }
  }
  for (let i = 0; i < 5; i++) {
    const seed = e.seed + i * 11; const phase = ((time + randomAt(seed) * 4) % 3.7) / 3.7;
    const x = randomAt(seed + 1) * r.width; const y = -4 - phase * 8;
    const size = Math.sin(phase * Math.PI) * 2.3;
    ctx.globalAlpha = Math.sin(phase * Math.PI); ctx.fillStyle = colors[i]!;
    ctx.beginPath(); ctx.moveTo(x, y - size); ctx.quadraticCurveTo(x + 0.4, y - 0.4, x + size, y); ctx.quadraticCurveTo(x + 0.4, y + 0.4, x, y + size); ctx.quadraticCurveTo(x - 0.4, y + 0.4, x - size, y); ctx.quadraticCurveTo(x - 0.4, y - 0.4, x, y - size); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const heartTime = (time + e.seed) % 6.8;
  if (heartTime < 2.2) {
    const x = r.width + 5; const y = r.height / 2 - heartTime * 5;
    ctx.globalAlpha = Math.sin(heartTime / 2.2 * Math.PI) * .8;
    ctx.fillStyle = "#ffadce";
    ctx.beginPath(); ctx.moveTo(x, y + 2.5); ctx.bezierCurveTo(x - 6, y - 1, x - 3, y - 5, x, y - 2); ctx.bezierCurveTo(x + 3, y - 5, x + 6, y - 1, x, y + 2.5); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function frame(now: number, delta: number): void {
  const ctx = context;
  if (!ctx || !canvas) return;
  intervalSum += delta; intervalCount++;
  if (intervalCount >= 60) {
    if (intervalSum / intervalCount > 20.5) throttled = true;
    intervalSum = 0; intervalCount = 0;
  }
  for (const e of emitters) e.age += delta / 1000;
  const frameTime = quality === "high" && !throttled ? 1000 / 60 : 1000 / 30;
  if (now - lastPaint < frameTime - 1) return;
  lastPaint = now;
  const started = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  const sheet = document.querySelector(".chat-sheet");
  // Even previews cannot bypass a hard material limit.
  let drawn = 0;
  for (const e of emitters) {
    if (drawn >= (quality === "high" ? 6 : 3)) break;
    if (sheet && !sheet.contains(e.element)) continue;
    measure(e, now);
    const r = e.rect;
    if (!r || r.width < 1 || r.bottom < 0 || r.top > innerHeight) continue;
    drawn++;
    ctx.save();
    if (e.clip) { ctx.beginPath(); ctx.rect(e.clip.x, e.clip.y, e.clip.width, e.clip.height); ctx.clip(); }
    ctx.translate(r.x, r.y); protectContent(ctx, e);
    const time = e.age * (e.layer.speed ?? 1);
    if (e.preset === "curse-aura" || e.preset === "shadow-entity") smoke(ctx, e, time);
    else if (e.preset === "karma-aura" || e.preset === "fire") flames(ctx, e, time);
    else if (e.preset === "chidori") electricity(ctx, e, time);
    else if (e.preset === "viscous-blood") blood(ctx, e, time);
    else pastel(ctx, e, time);
    ctx.restore();
  }
  dirty = false;
  if (performance.now() - started > 6) expensiveFrames++; else expensiveFrames = Math.max(0, expensiveFrames - 1);
  if (expensiveFrames >= 8) throttled = true;
}

export function useMaterialEmitter(ref: RefObject<Element | null>, layer: EffectLayer | null, target: MaterialTarget, active: boolean): void {
  const key = JSON.stringify(layer);
  const layerRef = useRef(layer); layerRef.current = layer;
  useEffect(() => {
    const element = ref.current; const value = layerRef.current;
    const preset = materialPreset(value?.preset);
    if (!active || !element || !value || !preset) return;
    const e: Emitter = { element, layer: value, preset, target, seed: ++serial * 13.73, age: 0, rect: null, clip: null, measuredAt: 0, bolts: [], dischargeAt: 0, discharge: 0 };
    emitters.add(e); dirty = true; ensureRunning();
    return () => { emitters.delete(e); dirty = true; if (!emitters.size) clearAndStop(); };
  }, [ref, key, target, active]);
}

export function MaterialStage({ quality: nextQuality }: { quality: Quality }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || (nextQuality !== "medium" && nextQuality !== "high")) return;
    canvas = element; context = element.getContext("2d"); quality = nextQuality;
    expensiveFrames = 0; throttled = false; lastPaint = 0; intervalSum = 0; intervalCount = 0;
    resize(); ensureRunning();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", invalidate, true);
    return () => {
      window.removeEventListener("resize", resize); window.removeEventListener("scroll", invalidate, true);
      clearAndStop(); canvas = null; context = null;
    };
  }, [nextQuality]);
  if (nextQuality !== "medium" && nextQuality !== "high") return null;
  return <canvas ref={ref} className="crv-material-stage" aria-hidden="true" />;
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)["__crvMaterials"] = {
    usage: () => ({ emitters: emitters.size, textures: textures.size, canvases: canvas ? 1 : 0, pixelRatio: resolution, throttled }),
  };
}
