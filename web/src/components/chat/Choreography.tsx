// CRV · Nombres con coreografía: un personaje que interactúa con las letras.
//
// Murciélago en órbita, baquetas que aplastan letras, ovni que abduce una,
// vinilo que rueda debajo, rasgueo que lanza una onda, calavera que hace
// headbang, rayo con chispas y un rockerito que camina sobre el nombre.
//
// Todo con Web Animations API y solo `transform`/`opacity`: el compositor
// mueve las capas y el hilo principal no repinta. Las posiciones de las
// letras se miden una vez (y al cambiar el ancho) con offsetLeft; después
// cada coreografía es un juego de keyframes. Las cíclicas usan una sola
// duración para todas las piezas, así personaje y letras nunca se desfasan.
//
// Sin hueco del presupuesto el personaje descansa junto al nombre (estático);
// con «reducir movimiento» además respira con un fundido suave.
import { useEffect, useRef } from "react";
import type { EffectLayer } from "../../lib/chatEffects";
import { RealisticSprite } from "./RealisticSprite";
import { burstAt } from "./ParticleStage";

export type ChoreoMode = "live" | "soft" | "rest";

// ── Personajes (SVG propios) ───────────────────────────────────────────────
function BoltActor() {
  return (
    <svg viewBox="0 0 24 40" aria-hidden="true">
      <path d="M14 0 L4 20 L11 20 L7 40 L20 15 L13 15 L18 0 Z" fill="var(--fx-1)" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

const ACTORS: Record<string, () => React.ReactElement> = {
  "bat-orbit": () => <RealisticSprite preset="bat" />,
  "drumsticks": () => <RealisticSprite preset="drumsticks" />,
  "ufo-abduct": () => <RealisticSprite preset="ufo-vinyl" />,
  "vinyl-roll": () => <RealisticSprite preset="vinyl-face" />,
  "guitar-wave": () => <RealisticSprite preset="guitar" />,
  "skull-headbang": () => <RealisticSprite preset="skull-rocker" />,
  "lightning": BoltActor,
  "rockerito": () => <RealisticSprite preset="rockerito" />,
};

/** Tamaño del personaje en px (cuadrado salvo el rayo y el rockerito). */
const ACTOR_SIZE: Record<string, [number, number]> = {
  "bat-orbit": [22, 14], "drumsticks": [20, 20], "ufo-abduct": [28, 28], "vinyl-roll": [13, 13],
  "guitar-wave": [20, 20], "skull-headbang": [18, 18], "lightning": [12, 20], "rockerito": [13, 16],
};

// ── Utilidades de keyframes ────────────────────────────────────────────────
interface Stage {
  container: HTMLElement;
  actor: HTMLElement;
  flash: HTMLElement | null;
  letters: HTMLElement[];
  /** Centro horizontal de cada letra, relativo al contenedor. */
  xs: number[];
  width: number;
  height: number;
  layer: EffectLayer;
  speed: number;
  track: (animation: Animation) => Animation;
  alive: () => boolean;
}

/** Un «golpe» en `t` (0-1) dentro de un ciclo: neutro → pico → neutro. */
function pulse(t: number, peak: string, before = 0.05, after = 0.07): Keyframe[] {
  const at = Math.min(0.97, Math.max(0.03, t));
  const start = Math.max(0.001, at - before);
  const end = Math.min(0.999, at + after);
  return [
    { offset: 0, transform: "none" },
    { offset: start, transform: "none" },
    { offset: at, transform: peak },
    { offset: end, transform: "none" },
    { offset: 1, transform: "none" },
  ];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Letras «reales» (sin espacios) para elegir objetivos. */
function solidIndexes(stage: Stage): number[] {
  const indexes = stage.letters.map((letter, index) => (letter.textContent?.trim() ? index : -1)).filter((index) => index >= 0);
  return indexes.length > 0 ? indexes : [0];
}

function centerIn(actorSize: [number, number], x: number, y: number): string {
  return `translate(${(x - actorSize[0] / 2).toFixed(1)}px, ${(y - actorSize[1] / 2).toFixed(1)}px)`;
}

// ── Coreografías ───────────────────────────────────────────────────────────
type Choreo = (stage: Stage) => void | Promise<void>;

const batOrbit: Choreo = (stage) => {
  const size = ACTOR_SIZE["bat-orbit"]!;
  const duration = 3400 / stage.speed;
  const cx = stage.width / 2;
  const cy = stage.height / 2;
  const rx = stage.width / 2 + 14;
  const ry = stage.height / 2 + 9;
  const steps = 28;
  const frames: Keyframe[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angle = t * Math.PI * 2;
    const front = Math.sin(angle);
    frames.push({
      offset: t,
      transform: `${centerIn(size, cx + rx * Math.cos(angle), cy + ry * front)} scale(${(0.78 + 0.26 * front).toFixed(3)})`,
      opacity: front > 0 ? 1 : 0.55,
    });
  }
  stage.track(stage.actor.animate(frames, { duration, iterations: Infinity }));
  // Pasa por delante (mitad inferior) de derecha a izquierda: cada letra se
  // aparta hacia arriba cuando el murciélago la roza.
  stage.letters.forEach((letter, index) => {
    const cosine = Math.min(1, Math.max(-1, ((stage.xs[index] ?? 0) - cx) / rx));
    const t = Math.acos(cosine) / (Math.PI * 2);
    stage.track(letter.animate(pulse(t, "translateY(-4px) rotate(-7deg)", 0.04, 0.08), { duration, iterations: Infinity }));
  });
};

const drumsticks: Choreo = (stage) => {
  const size = ACTOR_SIZE["drumsticks"]!;
  const solid = solidIndexes(stage);
  const hits = solid.length <= 10 ? solid : Array.from({ length: 10 }, (_, k) => solid[Math.round((k * (solid.length - 1)) / 9)] ?? 0);
  const beat = 300 / stage.speed;
  const duration = hits.length * beat + 1000 / stage.speed;
  const frames: Keyframe[] = [];
  const at = (ms: number): number => Math.min(0.999, ms / duration);
  hits.forEach((letterIndex, k) => {
    const x = stage.xs[letterIndex] ?? 0;
    frames.push({ offset: at(k * beat), transform: `${centerIn(size, x + 2, -10)} rotate(-28deg)`, opacity: 1 });
    frames.push({ offset: at(k * beat + beat * 0.45), transform: `${centerIn(size, x + 2, -4)} rotate(10deg)`, opacity: 1, easing: "ease-out" });
    frames.push({ offset: at(k * beat + beat * 0.8), transform: `${centerIn(size, x + 2, -10)} rotate(-22deg)`, opacity: 1 });
  });
  const first = stage.xs[hits[0] ?? 0] ?? 0;
  const lastX = stage.xs[hits[hits.length - 1] ?? 0] ?? 0;
  frames.push({ offset: at(hits.length * beat + 200), transform: `${centerIn(size, lastX + 6, -16)} rotate(-30deg)`, opacity: 0 });
  frames.push({ offset: 0.995, transform: `${centerIn(size, first + 2, -10)} rotate(-28deg)`, opacity: 0 });
  frames.push({ offset: 1, transform: `${centerIn(size, first + 2, -10)} rotate(-28deg)`, opacity: 1 });
  frames.sort((a, b) => Number(a.offset) - Number(b.offset));
  stage.track(stage.actor.animate(frames, { duration, iterations: Infinity }));
  hits.forEach((letterIndex, k) => {
    const letter = stage.letters[letterIndex];
    if (!letter) return;
    const t = (k * beat + beat * 0.5) / duration;
    stage.track(letter.animate(pulse(t, "translateY(2px) scale(1.28, 0.62)", (beat * 0.25) / duration, (beat * 0.55) / duration), {
      duration, iterations: Infinity,
    }));
  });
};

const ufoAbduct: Choreo = async (stage) => {
  const size = ACTOR_SIZE["ufo-abduct"]!;
  const beam = stage.actor.querySelector<SVGElement>(".crv-ufo-beam");
  const solid = solidIndexes(stage);
  while (stage.alive()) {
    const target = solid[Math.floor(Math.random() * solid.length)] ?? 0;
    const x = stage.xs[target] ?? 0;
    const letter = stage.letters[target];
    const duration = 3600 / stage.speed;
    const hover = centerIn(size, x, -20);
    const ufo = stage.actor.animate([
      { offset: 0, transform: `${centerIn(size, -24, -30)} rotate(-8deg)`, opacity: 0 },
      { offset: 0.14, transform: `${centerIn(size, x, -22)} rotate(4deg)`, opacity: 1, easing: "ease-out" },
      { offset: 0.2, transform: `${hover} rotate(0deg)`, opacity: 1 },
      { offset: 0.7, transform: `${hover} rotate(0deg)`, opacity: 1, easing: "ease-in" },
      { offset: 0.86, transform: `${centerIn(size, stage.width + 26, -34)} rotate(10deg)`, opacity: 1 },
      { offset: 1, transform: `${centerIn(size, stage.width + 30, -34)} rotate(10deg)`, opacity: 0 },
    ], { duration });
    stage.track(ufo);
    if (beam) {
      stage.track(beam.animate([
        { offset: 0, opacity: 0 }, { offset: 0.24, opacity: 0 }, { offset: 0.3, opacity: 0.75 },
        { offset: 0.62, opacity: 0.75 }, { offset: 0.67, opacity: 0 }, { offset: 1, opacity: 0 },
      ], { duration }));
    }
    if (letter) {
      stage.track(letter.animate([
        { offset: 0, transform: "none", opacity: 1 },
        { offset: 0.3, transform: "none", opacity: 1 },
        { offset: 0.47, transform: "translateY(-15px) scale(0.68) rotate(-16deg)", opacity: 0.85 },
        { offset: 0.6, transform: "translateY(-17px) scale(0.68) rotate(12deg)", opacity: 0.85 },
        { offset: 0.67, transform: "translateY(-15px) scale(0.75) rotate(0deg)", opacity: 1, easing: "cubic-bezier(.55,0,1,.45)" },
        { offset: 0.76, transform: "translateY(0) scale(1.1, 0.85)", opacity: 1 },
        { offset: 0.82, transform: "translateY(-4px) scale(1)", opacity: 1, easing: "ease-in" },
        { offset: 0.88, transform: "none", opacity: 1 },
        { offset: 1, transform: "none", opacity: 1 },
      ], { duration }));
      for (const neighbour of [target - 1, target + 1]) {
        const other = stage.letters[neighbour];
        if (other) stage.track(other.animate(pulse(0.79, "translateY(-3px)", 0.03, 0.05), { duration }));
      }
    }
    await ufo.finished.catch(() => undefined);
    if (!stage.alive()) return;
    await sleep(600 + Math.random() * 1000);
  }
};

const vinylRoll: Choreo = (stage) => {
  const size = ACTOR_SIZE["vinyl-roll"]!;
  const duration = Math.max(2400, stage.width * 26) / stage.speed;
  const y = stage.height + size[1] / 2 - 1;
  const travel = stage.width + 24;
  const turns = (travel / (Math.PI * size[0])) * 360;
  stage.track(stage.actor.animate([
    { offset: 0, transform: `${centerIn(size, -12, y)} rotate(0deg)`, opacity: 0 },
    { offset: 0.05, transform: `${centerIn(size, -12 + travel * 0.05 / 0.94, y)} rotate(${(turns * 0.05 / 0.94).toFixed(0)}deg)`, opacity: 1 },
    { offset: 0.94, transform: `${centerIn(size, stage.width + 12, y)} rotate(${turns.toFixed(0)}deg)`, opacity: 1 },
    { offset: 1, transform: `${centerIn(size, stage.width + 12, y)} rotate(${turns.toFixed(0)}deg)`, opacity: 0 },
  ], { duration, iterations: Infinity }));
  stage.letters.forEach((letter, index) => {
    const t = (0.94 * ((stage.xs[index] ?? 0) + 12)) / travel;
    stage.track(letter.animate(pulse(t, "translateY(-6px) rotate(4deg)", 0.035, 0.06), { duration, iterations: Infinity }));
  });
};

const guitarWave: Choreo = (stage) => {
  const size = ACTOR_SIZE["guitar-wave"]!;
  const duration = 2400 / stage.speed;
  const base = centerIn(size, 10, stage.height / 2);
  stage.track(stage.actor.animate([
    { offset: 0, transform: `${base} rotate(0deg)` },
    { offset: 0.05, transform: `${base} rotate(-20deg)` },
    { offset: 0.09, transform: `${base} rotate(16deg)` },
    { offset: 0.13, transform: `${base} rotate(-8deg)` },
    { offset: 0.2, transform: `${base} rotate(0deg)` },
    { offset: 1, transform: `${base} rotate(0deg)` },
  ], { duration, iterations: Infinity }));
  if (stage.flash) {
    stage.track(stage.flash.animate([
      { offset: 0, transform: `translate(${10 - 12}px, ${stage.height / 2 - 12}px) scale(0.2)`, opacity: 0 },
      { offset: 0.08, transform: `translate(${10 - 12}px, ${stage.height / 2 - 12}px) scale(0.4)`, opacity: 0.9 },
      { offset: 0.5, transform: `translate(${10 - 12}px, ${stage.height / 2 - 12}px) scale(2.6)`, opacity: 0 },
      { offset: 1, transform: `translate(${10 - 12}px, ${stage.height / 2 - 12}px) scale(2.6)`, opacity: 0 },
    ], { duration, iterations: Infinity }));
  }
  const count = Math.max(1, stage.letters.length - 1);
  stage.letters.forEach((letter, index) => {
    const t = 0.1 + 0.5 * (index / count);
    stage.track(letter.animate(pulse(t, "translateY(-6px) scale(1.08)", 0.06, 0.08), { duration, iterations: Infinity }));
  });
};

const skullHeadbang: Choreo = (stage) => {
  const size = ACTOR_SIZE["skull-headbang"]!;
  const duration = 760 / stage.speed;
  const base = centerIn(size, 10, stage.height / 2);
  stage.track(stage.actor.animate([
    { offset: 0, transform: `${base} rotate(-6deg)` },
    { offset: 0.38, transform: `${base} translateY(3px) rotate(20deg)`, easing: "cubic-bezier(.2,.8,.3,1)" },
    { offset: 1, transform: `${base} rotate(-6deg)` },
  ], { duration, iterations: Infinity, easing: "ease-in" }));
  stage.letters.forEach((letter, index) => {
    stage.track(letter.animate([
      { offset: 0, transform: "none" },
      { offset: 0.38, transform: "translateY(2px) rotate(7deg)" },
      { offset: 1, transform: "none" },
    ], { duration, iterations: Infinity, delay: 70 + index * 32 }));
  });
};

const lightning: Choreo = async (stage) => {
  const size = ACTOR_SIZE["lightning"]!;
  const solid = solidIndexes(stage);
  const colors = stage.layer.colors ?? ["#fff6a8", "#60a5fa"];
  while (stage.alive()) {
    const target = solid[Math.floor(Math.random() * solid.length)] ?? 0;
    const x = stage.xs[target] ?? 0;
    const duration = 700;
    const at = `${centerIn(size, x, -8)}`;
    const bolt = stage.actor.animate([
      { offset: 0, transform: `${at} scaleY(0)`, opacity: 0 },
      { offset: 0.1, transform: `${at} scaleY(1)`, opacity: 1 },
      { offset: 0.2, transform: `${at} scaleY(1)`, opacity: 0.25 },
      { offset: 0.3, transform: `${at} scaleY(1)`, opacity: 1 },
      { offset: 0.55, transform: `${at} scaleY(1)`, opacity: 0 },
      { offset: 1, transform: `${at} scaleY(1)`, opacity: 0 },
    ], { duration });
    stage.track(bolt);
    if (stage.flash) {
      const flashAt = `translate(${x - 12}px, ${stage.height / 2 - 12}px)`;
      stage.track(stage.flash.animate([
        { offset: 0, transform: `${flashAt} scale(0.4)`, opacity: 0 },
        { offset: 0.12, transform: `${flashAt} scale(1)`, opacity: 1 },
        { offset: 0.5, transform: `${flashAt} scale(1.5)`, opacity: 0 },
        { offset: 1, transform: `${flashAt} scale(1.5)`, opacity: 0 },
      ], { duration }));
    }
    const letter = stage.letters[target];
    if (letter) {
      stage.track(letter.animate([
        { offset: 0, transform: "none" },
        { offset: 0.1, transform: "none" },
        { offset: 0.14, transform: "translateY(1px) scale(1.4)" },
        { offset: 0.3, transform: "scale(0.9) rotate(-4deg)" },
        { offset: 0.5, transform: "none" },
        { offset: 1, transform: "none" },
      ], { duration }));
      window.setTimeout(() => {
        if (!stage.alive() || !letter.isConnected) return;
        const rect = letter.getBoundingClientRect();
        burstAt(rect.left + rect.width / 2, rect.top + 2, { type: "canvas", preset: "sparks", colors }, 10);
      }, 80);
    }
    await bolt.finished.catch(() => undefined);
    if (!stage.alive()) return;
    await sleep(1300 + Math.random() * 1300);
  }
};

const rockerito: Choreo = (stage) => {
  const size = ACTOR_SIZE["rockerito"]!;
  const duration = Math.max(3200, stage.width * 90) / stage.speed;
  const startX = 2;
  const endX = Math.max(startX + 10, stage.width - 4);
  const y = -size[1] / 2 + 3;
  const steps = Math.max(6, Math.round((endX - startX) / 6));
  const frames: Keyframe[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const bob = index % 2 === 0 ? 0 : -2;
    frames.push({ offset: t * 0.48, transform: `${centerIn(size, startX + (endX - startX) * t, y + bob)} scaleX(1)` });
  }
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const bob = index % 2 === 0 ? 0 : -2;
    frames.push({ offset: 0.52 + t * 0.48, transform: `${centerIn(size, endX - (endX - startX) * t, y + bob)} scaleX(-1)` });
  }
  stage.track(stage.actor.animate(frames, { duration, iterations: Infinity }));
  // Cada letra cede bajo el pie dos veces por vuelta (ida y vuelta).
  stage.letters.forEach((letter, index) => {
    const share = Math.min(1, Math.max(0, ((stage.xs[index] ?? 0) - startX) / (endX - startX)));
    const there = share * 0.48;
    const back = 0.52 + (1 - share) * 0.48;
    const dip = "translateY(2px) scaleY(0.88)";
    const frames2: Keyframe[] = [
      { offset: 0, transform: "none" },
      { offset: Math.max(0.001, there - 0.02), transform: "none" },
      { offset: Math.max(0.002, there), transform: dip },
      { offset: Math.min(0.49, there + 0.03), transform: "none" },
      { offset: Math.max(0.5, back - 0.02), transform: "none" },
      { offset: Math.min(0.998, back), transform: dip },
      { offset: 0.999, transform: "none" },
      { offset: 1, transform: "none" },
    ];
    stage.track(letter.animate(frames2, { duration, iterations: Infinity }));
  });
};

const CHOREOS: Record<string, Choreo> = {
  "bat-orbit": batOrbit,
  "drumsticks": drumsticks,
  "ufo-abduct": ufoAbduct,
  "vinyl-roll": vinylRoll,
  "guitar-wave": guitarWave,
  "skull-headbang": skullHeadbang,
  "lightning": lightning,
  "rockerito": rockerito,
};

// ── Componente ─────────────────────────────────────────────────────────────
export function NameChoreo({ layer, text, mode, style }: {
  layer: EffectLayer;
  text: string;
  mode: ChoreoMode;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const actorRef = useRef<HTMLSpanElement | null>(null);
  const flashRef = useRef<HTMLSpanElement | null>(null);
  const Actor = ACTORS[layer.preset];
  const chars = [...text];
  // Las capas llegan como objetos nuevos al recomprar o equipar: la clave
  // estable evita reiniciar la coreografía en cada render.
  const layerKey = JSON.stringify(layer);
  const layerRef = useRef(layer);
  layerRef.current = layer;

  useEffect(() => {
    const container = containerRef.current;
    const actor = actorRef.current;
    const layer = layerRef.current;
    const choreo = CHOREOS[layer.preset];
    if (mode !== "live" || !container || !actor || !choreo || typeof actor.animate !== "function") return;
    let alive = true;
    const animations = new Set<Animation>();
    let lastWidth = -1;

    const start = (): void => {
      for (const animation of animations) animation.cancel();
      animations.clear();
      const letters = [...container.querySelectorAll<HTMLElement>(".crv-ch")];
      const width = container.offsetWidth;
      lastWidth = width;
      if (width === 0 || letters.length === 0) return;
      const generation = { alive: true };
      currentGeneration.alive = false;
      currentGeneration = generation;
      const result = choreo({
        container, actor, flash: flashRef.current, letters,
        xs: letters.map((letter) => letter.getBoundingClientRect().left - container.getBoundingClientRect().left + letter.offsetWidth / 2),
        width, height: letters[0]?.offsetHeight ?? 18, layer, speed: layer.speed ?? 1,
        track: (animation) => {
          animations.add(animation);
          void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
          return animation;
        },
        alive: () => alive && generation.alive,
      });
      if (result instanceof Promise) void result.catch(() => undefined);
    };
    let currentGeneration = { alive: true };
    start();
    // Una fuente web que termina de cargar o un cambio de ancho mueve las
    // letras: se vuelven a medir y la coreografía arranca con las posiciones nuevas.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (container.offsetWidth !== lastWidth) start();
    });
    resize?.observe(container);
    return () => {
      alive = false;
      currentGeneration.alive = false;
      resize?.disconnect();
      for (const animation of animations) animation.cancel();
    };
  }, [layerKey, mode, text]);

  return (
    <span
      ref={containerRef}
      className={`crv-choreo crv-choreo-${layer.preset} is-${mode}`}
    >
      <span className="crv-letters" aria-hidden="true">
        {chars.map((char, index) => (
          <span key={`${char}-${index}`} className="crv-ch" style={{ "--i": index } as React.CSSProperties}>
            {char === " " ? " " : char}
          </span>
        ))}
      </span>
      <span ref={flashRef} className="crv-choreo-flash" style={style} aria-hidden="true" />
      {Actor ? (
        <span ref={actorRef} className="crv-actor" style={style} aria-hidden="true"><Actor /></span>
      ) : null}
    </span>
  );
}
