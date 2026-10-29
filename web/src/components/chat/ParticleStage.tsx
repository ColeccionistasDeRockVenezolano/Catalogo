// CRV · Escenario de partículas del chat: un canvas para toda la página.
//
// Antes las capas de partículas de nombres, marcos y fondos se ignoraban
// porque un canvas por nombre multiplicaba el coste. Aquí hay uno solo, fijo
// sobre la sala, y cada efecto registra un «emisor» ligado a su elemento: el
// escenario lee dónde está (cada 120 ms, no en cada fotograma), genera las
// partículas en ese sitio y las pinta todas en una pasada del reloj común.
//
// - origin "letters": las partículas nacen de las propias letras (`.crv-ch`).
// - Solo emite lo que tiene hueco de animación y está en pantalla.
// - Con una hoja abierta, solo emite lo que está dentro de la hoja.
// - Sin emisores ni partículas vivas, el escenario se desuscribe del reloj.
import { useEffect, useRef, type RefObject } from "react";
import type { EffectLayer, Quality } from "../../lib/chatEffects";
import { subscribeFrame } from "../../lib/chatMotion";

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number;
  color: string; kind: string; angle: number; spin: number; seed: number;
  clip?: DOMRect;
}

interface Emitter {
  element: Element;
  layer: EffectLayer;
  /** Partículas por segundo. */
  rate: number;
  carry: number;
  rect: DOMRect | null;
  letters: DOMRect[];
  measuredAt: number;
}

const MAX_PARTICLES: Record<Quality, number> = { low: 0, reduced: 0, medium: 180, high: 360 };

let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
let dpr = 1;
let maxParticles = 180;
let unsubscribe: (() => void) | null = null;
const emitters = new Set<Emitter>();
const particles: Particle[] = [];

function resize(): void {
  if (!canvas) return;
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
}

function ensureRunning(): void {
  if (unsubscribe || !context) return;
  unsubscribe = subscribeFrame(frame);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

/** Vida media por preset: decide cuántas por segundo para sostener `count`. */
const AVERAGE_LIFE: Record<string, number> = {
  embers: 1.2, flames: 0.7, sparks: 0.5, snow: 1.6, notes: 1.3, stardust: 0.9,
  hearts: 1.5, confetti: 2, fireworks: 1, crowd: 1.4, bubbles: 1.6, rain: 0.8,
};

function spawn(layer: EffectLayer, x: number, y: number, burst = false, clip?: DOMRect): void {
  if (particles.length >= maxParticles) return;
  const colors = layer.colors?.length ? layer.colors : ["#ffffff"];
  const color = pick(colors, "#ffffff");
  const speed = layer.speed ?? 1;
  const base = { x, y, life: 0, color, angle: Math.random() * Math.PI * 2, spin: rand(-4, 4), seed: Math.random() * 10 };
  let particle: Particle;
  switch (layer.preset) {
    case "flames":
      particle = { ...base, kind: "flame", vx: rand(-8, 8), vy: rand(-48, -26), maxLife: rand(0.45, 0.85), size: rand(2.6, 5.2) };
      break;
    case "sparks": {
      const angle = burst ? Math.random() * Math.PI * 2 : rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const velocity = burst ? rand(90, 220) : rand(50, 120);
      particle = { ...base, kind: "spark", vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, maxLife: rand(0.3, 0.7), size: rand(0.9, 1.8) };
      break;
    }
    case "fireworks": {
      const angle = Math.random() * Math.PI * 2;
      const velocity = rand(70, 190);
      particle = { ...base, kind: "firework", vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, maxLife: rand(0.7, 1.3), size: rand(1.2, 2.4) };
      break;
    }
    case "snow":
      particle = { ...base, kind: "snow", vx: rand(-6, 6), vy: rand(14, 30), maxLife: rand(1.2, 2.1), size: rand(1.1, 2.4) };
      break;
    case "notes":
      particle = { ...base, kind: "note", vx: rand(-10, 10), vy: rand(-36, -20), maxLife: rand(1, 1.6), size: rand(9, 13) };
      break;
    case "hearts":
      particle = { ...base, kind: "heart", vx: rand(-10, 10), vy: rand(-36, -20), maxLife: rand(1.2, 1.8), size: rand(5, 8) };
      break;
    case "stardust":
      particle = { ...base, kind: "star", vx: rand(-14, 14), vy: rand(-14, 8), maxLife: rand(0.6, 1.2), size: rand(0.8, 1.8) };
      break;
    case "confetti":
      particle = { ...base, kind: "rect", vx: rand(-70, 70), vy: rand(110, 250), maxLife: rand(1.6, 2.4), size: rand(4, 7) };
      break;
    case "crowd":
    case "bubbles":
      particle = { ...base, kind: "dot", vx: rand(-10, 10), vy: rand(-60, -30), maxLife: rand(1, 1.6), size: rand(1.4, 2.6) };
      break;
    default: // embers
      particle = { ...base, kind: "dot", vx: rand(-12, 12), vy: rand(-60, -28), maxLife: rand(0.8, 1.6), size: rand(0.9, 2.2) };
  }
  particle.vx *= speed;
  particle.vy *= speed;
  if (clip) particle.clip = clip;
  particles.push(particle);
}

function measure(emitter: Emitter, now: number): void {
  if (now - emitter.measuredAt < 120) return;
  emitter.measuredAt = now;
  emitter.rect = emitter.element.isConnected ? emitter.element.getBoundingClientRect() : null;
  if (emitter.layer.origin === "letters") {
    emitter.letters = [...emitter.element.querySelectorAll(".crv-ch")].map((letter) => letter.getBoundingClientRect());
  }
}

function emitFrom(emitter: Emitter, delta: number, sheet: Element | null, now: number): void {
  if (sheet && !sheet.contains(emitter.element)) return;
  measure(emitter, now);
  const rect = emitter.rect;
  if (!rect || rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) return;
  emitter.carry += emitter.rate * (delta / 1000);
  while (emitter.carry >= 1) {
    emitter.carry -= 1;
    const letter = emitter.letters.length > 0 ? pick(emitter.letters, rect) : null;
    const box = letter ?? rect;
    const preset = emitter.layer.preset;
    const x = rand(box.left, box.right);
    // Fuego, notas y brasas nacen arriba de la letra; la nieve, abajo; el
    // resto, en cualquier punto del elemento.
    const y = preset === "snow" ? rand(box.top + box.height * 0.6, box.bottom)
      : preset === "flames" || preset === "notes" || preset === "embers" ? rand(box.top, box.top + box.height * 0.45)
        : rand(box.top, box.bottom);
    spawn(emitter.layer, x, y);
  }
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + size * 0.3);
  ctx.bezierCurveTo(x - size / 2, y + size * 0.6, x, y + size * 0.85, x, y + size);
  ctx.bezierCurveTo(x, y + size * 0.85, x + size / 2, y + size * 0.6, x + size / 2, y + size * 0.3);
  ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + size * 0.3);
  ctx.fill();
}

function frame(now: number, delta: number): void {
  const ctx = context;
  if (!ctx || !canvas) return;
  const sheet = document.querySelector(".chat-sheet");
  for (const emitter of emitters) emitFrom(emitter, delta, sheet, now);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const seconds = delta / 1000;
  let alive = 0;
  for (const particle of particles) {
    particle.life += seconds;
    if (particle.life >= particle.maxLife) continue;
    particles[alive] = particle;
    alive += 1;
    if (particle.kind === "spark") particle.vy += 260 * seconds;
    else if (particle.kind === "rect") particle.vx *= 0.99;
    else if (particle.kind === "firework") particle.vy += 70 * seconds;
    const sway = particle.kind === "snow" || particle.kind === "note" ? Math.sin(particle.life * 3 + particle.seed) * 14 * seconds : 0;
    particle.x += particle.vx * seconds + sway;
    particle.y += particle.vy * seconds;
    particle.angle += particle.spin * seconds;
    const t = particle.life / particle.maxLife;
    const fade = particle.kind === "star" ? Math.sin(t * Math.PI) * (0.6 + 0.4 * Math.sin(particle.life * 18))
      : particle.kind === "note" || particle.kind === "heart" ? Math.min(1, (1 - t) * 1.6)
        : 1 - t;
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.fillStyle = particle.color;
    ctx.strokeStyle = particle.color;
    if (particle.clip) {
      ctx.save(); ctx.beginPath();
      ctx.rect(particle.clip.x, particle.clip.y, particle.clip.width, particle.clip.height); ctx.clip();
    }
    switch (particle.kind) {
      case "flame": {
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (1 - t * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "spark":
        ctx.lineWidth = particle.size;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.03, particle.y - particle.vy * 0.03);
        ctx.stroke();
        break;
      case "note":
        ctx.font = `${particle.size}px system-ui, sans-serif`;
        ctx.fillText(particle.seed > 5 ? "♪" : "♫", particle.x, particle.y);
        break;
      case "heart":
        drawHeart(ctx, particle.x, particle.y, particle.size);
        break;
      case "rect":
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.angle);
        ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        ctx.restore();
        break;
      default:
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
    }
    if (particle.clip) ctx.restore();
  }
  particles.length = alive;
  ctx.globalAlpha = 1;
  if (emitters.size === 0 && particles.length === 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    unsubscribe?.();
    unsubscribe = null;
  }
}

/** Ráfaga suelta en coordenadas de la ventana (rayo, choque de vinilos…). */
export function burstAt(x: number, y: number, layer: EffectLayer, count = layer.count ?? 16, bounds?: DOMRect): void {
  if (!context || maxParticles === 0) return;
  for (let index = 0; index < count; index += 1) {
    if (layer.preset === "confetti") spawn(layer, rand(bounds?.left ?? 0, bounds?.right ?? window.innerWidth), rand((bounds?.top ?? 0) - 25, bounds?.top ?? 0), true, bounds);
    else spawn(layer, x + rand(-4, 4), y + rand(-4, 4), true, bounds);
  }
  ensureRunning();
}

/** Ráfaga repartida por la caja de un elemento (efecto de mensaje). */
export function burstFrom(element: Element, layer: EffectLayer, count = layer.count ?? 16): void {
  if (!context || maxParticles === 0) return;
  const rect = element.getBoundingClientRect();
  for (let index = 0; index < count; index += 1) {
    spawn(layer, rand(rect.left, rect.right), rand(rect.top, rect.bottom), true);
  }
  ensureRunning();
}

/**
 * Emisor continuo ligado a un elemento mientras `active` sea verdadero
 * (normalmente: tiene hueco del presupuesto y está en pantalla).
 */
export function useParticleEmitter(
  ref: RefObject<Element | null>,
  layers: EffectLayer[],
  active: boolean,
): void {
  // Las capas llegan como objetos nuevos en cada render; la clave estable
  // evita registrar y borrar emisores sin parar.
  const key = JSON.stringify(layers);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || !key) return;
    const created = layersRef.current.map((layer): Emitter => ({
      element, layer,
      rate: Math.min(40, (layer.count ?? 10) / (AVERAGE_LIFE[layer.preset] ?? 1.2)),
      carry: Math.random(), rect: null, letters: [], measuredAt: 0,
    }));
    for (const emitter of created) emitters.add(emitter);
    ensureRunning();
    return () => {
      for (const emitter of created) emitters.delete(emitter);
    };
  }, [ref, key, active]);
}

/** El canvas único. Se monta una vez por página de chat. */
export function ParticleStage({ quality }: { quality: Quality }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || MAX_PARTICLES[quality] === 0) return;
    canvas = element;
    context = element.getContext("2d");
    dpr = Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.5);
    maxParticles = MAX_PARTICLES[quality];
    resize();
    window.addEventListener("resize", resize);
    ensureRunning();
    return () => {
      window.removeEventListener("resize", resize);
      unsubscribe?.();
      unsubscribe = null;
      particles.length = 0;
      if (canvas === element) {
        canvas = null;
        context = null;
      }
    };
  }, [quality]);
  if (MAX_PARTICLES[quality] === 0) return null;
  return <canvas ref={ref} className="crv-particle-stage" aria-hidden="true" />;
}
