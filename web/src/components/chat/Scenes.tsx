// CRV · Escenas a pantalla completa: acciones de sala y entradas.
//
// Pogo con público saltando, choque de vinilos con chispas, aplausos con
// confeti y el telón que se abre con el nombre en grande. Duran 1,5-2,5 s,
// se ponen en cola (nunca dos a la vez) y solo se disparan para mensajes y
// entradas nuevos, no al cargar el historial.
//
// Las mismas escenas se reproducen dentro del probador de la tienda
// (`scope="stage"`), recortadas a su caja.
//
// Todo el movimiento es WAAPI sobre transform/opacity; las chispas y el
// confeti salen del escenario de partículas compartido. Con «reducir
// movimiento» queda un rótulo que aparece y se funde; en gama baja, el
// rótulo quieto.
import { useEffect, useRef } from "react";
import type { ChatEffect } from "../../../../src/chat/protocol";
import {
  layerStyle, manifestOf, particleLayers, sceneLayer, type EffectLayer, type Quality,
} from "../../lib/chatEffects";
import { RealisticSprite } from "./RealisticSprite";
import { SmokeClouds } from "./SmokeClouds";
import { burstAt } from "./ParticleStage";

export interface SceneRequest {
  id: string;
  effect: ChatEffect;
  /** Quien la lanza: se muestra en el rótulo. */
  who: string;
  /** El nombre en grande (entradas) ya pintado con su efecto. */
  nameNode?: React.ReactNode;
  label: string;
}

type Scope = "screen" | "stage";

function durationOf(effect: ChatEffect): number {
  const ms = manifestOf(effect)?.durationMs ?? 2000;
  return Math.min(2500, Math.max(1500, ms));
}

/** Reproduce la primera escena de la cola y avisa al terminar. */
export function SceneLayer({ queue, quality, scope = "screen", onDone }: {
  queue: SceneRequest[]; quality: Quality; scope?: Scope; onDone: (id: string) => void;
}) {
  const current = queue[0] ?? null;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!current) return;
    const ms = quality === "low" ? 1500 : durationOf(current.effect);
    const timer = window.setTimeout(() => doneRef.current(current.id), ms);
    return () => window.clearTimeout(timer);
  }, [current, quality]);
  if (!current) return null;
  return <Scene key={current.id} request={current} quality={quality} scope={scope} />;
}

function describe(effect: ChatEffect, quality: Quality) {
  const manifest = manifestOf(effect);
  const layer = sceneLayer(manifest);
  return {
    layer,
    css: manifest?.layers.find((item) => item.type === "css") ?? null,
    particles: particleLayers(manifest),
    duration: durationOf(effect),
    live: quality === "medium" || quality === "high",
    preset: layer?.preset ?? (effect.kind === "entry" ? "entry-generic" : "action-generic"),
  };
}

function Scene({ request, quality, scope }: { request: SceneRequest; quality: Quality; scope: Scope }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { layer, css, live, preset } = describe(request.effect, quality);

  useEffect(() => {
    // Se calcula aquí y no fuera: la escena arranca una sola vez por petición.
    const { layer, particles, duration, live, preset } = describe(request.effect, quality);
    const root = rootRef.current;
    if (!root || quality === "low" || typeof root.animate !== "function") return;
    const animations: Animation[] = [];
    const timers: number[] = [];
    const track = (animation: Animation | undefined): void => { if (animation) animations.push(animation); };
    const at = (fraction: number, run: () => void): void => {
      timers.push(window.setTimeout(run, duration * fraction));
    };
    const rect = (): DOMRect => root.getBoundingClientRect();

    // Rótulo: en todos los niveles aparece y se va (opacidad).
    const banner = root.querySelector<HTMLElement>(".crv-scene-banner");
    track(banner?.animate([
      { offset: 0, opacity: 0, transform: live ? "translateY(12px) scale(0.92)" : "none" },
      { offset: 0.14, opacity: 1, transform: "none" },
      { offset: 0.82, opacity: 1, transform: "none" },
      { offset: 1, opacity: 0, transform: live ? "translateY(-6px)" : "none" },
    ], { duration, fill: "both", easing: "ease-out" }));
    if (quality === "reduced") {
      track(root.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration, fill: "both" }));
    }
    if (!live) return () => { for (const animation of animations) animation.cancel(); };

    const shake = (): void => {
      track(root.animate([
        { transform: "none" }, { transform: "translate(-5px, 3px)" }, { transform: "translate(4px, -3px)" },
        { transform: "translate(-2px, 1px)" }, { transform: "none" },
      ], { duration: 260 }));
    };
    const burstCenter = (fallback: EffectLayer, count: number): void => {
      const box = rect();
      burstAt(box.left + box.width / 2, box.top + box.height * 0.45, particles.find((item) => item.preset !== "confetti") ?? fallback, count, scope === "stage" ? box : undefined);
    };

    switch (preset) {
      case "pogo-scene": {
        const calm = (layer?.intensity ?? 0.6) < 0.5;
        root.querySelectorAll<HTMLElement>(".crv-fan").forEach((fan, index) => {
          const height = calm ? 6 + Math.random() * 6 : 22 + Math.random() * 34;
          const beat = calm ? 640 : 380 + Math.random() * 140;
          track(fan.animate([
            { transform: "translateY(0) rotate(0deg)" },
            { transform: `translateY(${-height}px) rotate(${(Math.random() - 0.5) * (calm ? 4 : 18)}deg)`, offset: 0.45, easing: "ease-in" },
            { transform: "translateY(0) rotate(0deg)" },
          ], { duration: beat, iterations: Math.ceil(duration / beat), delay: (index % 4) * 70 + Math.random() * 120, easing: "ease-out" }));
          const arms = fan.querySelector<SVGElement>(".crv-fan-arms");
          track(arms?.animate([
            { transform: "rotate(-10deg)" }, { transform: "rotate(10deg)" }, { transform: "rotate(-10deg)" },
          ], { duration: calm ? 900 : 420, iterations: Infinity }));
        });
        root.querySelectorAll<HTMLElement>(".crv-scene-beam").forEach((beam, index) => {
          track(beam.animate([
            { transform: `rotate(${index ? 24 : -24}deg)`, opacity: 0 },
            { transform: `rotate(${index ? -8 : 8}deg)`, opacity: 0.55, offset: 0.4 },
            { transform: `rotate(${index ? 18 : -18}deg)`, opacity: 0 },
          ], { duration, fill: "both" }));
        });
        if (!calm) at(0.1, shake);
        break;
      }
      case "clash-scene": {
        const [left, right] = [...root.querySelectorAll<HTMLElement>(".crv-clash-disc")];
        const span = rect().width / 2 + 60;
        const hit = 0.42;
        track(left?.animate([
          { offset: 0, transform: `translateX(${-span}px) rotate(-540deg)`, opacity: 1, easing: "cubic-bezier(.5,0,.9,.5)" },
          { offset: hit, transform: "translateX(-38px) rotate(0deg)", opacity: 1, easing: "cubic-bezier(.1,.7,.3,1)" },
          { offset: 0.75, transform: "translateX(-120px) rotate(-120deg)", opacity: 1 },
          { offset: 1, transform: "translateX(-150px) rotate(-150deg)", opacity: 0 },
        ], { duration, fill: "both" }));
        track(right?.animate([
          { offset: 0, transform: `translateX(${span}px) rotate(540deg)`, opacity: 1, easing: "cubic-bezier(.5,0,.9,.5)" },
          { offset: hit, transform: "translateX(38px) rotate(0deg)", opacity: 1, easing: "cubic-bezier(.1,.7,.3,1)" },
          { offset: 0.75, transform: "translateX(120px) rotate(120deg)", opacity: 1 },
          { offset: 1, transform: "translateX(150px) rotate(150deg)", opacity: 0 },
        ], { duration, fill: "both" }));
        const flash = root.querySelector<HTMLElement>(".crv-scene-flash");
        track(flash?.animate([
          { offset: 0, opacity: 0 }, { offset: hit - 0.01, opacity: 0 }, { offset: hit + 0.02, opacity: 0.7 },
          { offset: hit + 0.2, opacity: 0 }, { offset: 1, opacity: 0 },
        ], { duration, fill: "both" }));
        const star = root.querySelector<HTMLElement>(".crv-clash-star");
        track(star?.animate([
          { offset: 0, opacity: 0, transform: "scale(0.2) rotate(0deg)" },
          { offset: hit, opacity: 0, transform: "scale(0.2) rotate(0deg)" },
          { offset: hit + 0.05, opacity: 1, transform: "scale(1.2) rotate(20deg)" },
          { offset: hit + 0.3, opacity: 0, transform: "scale(1.6) rotate(40deg)" },
          { offset: 1, opacity: 0, transform: "scale(1.6) rotate(40deg)" },
        ], { duration, fill: "both" }));
        at(hit, () => {
          shake();
          burstCenter({ type: "canvas", preset: "sparks", colors: ["#ffb02e", "#ffffff", "#e50914"] }, 30);
        });
        break;
      }
      case "applause-scene": {
        const hands = [...root.querySelectorAll<HTMLElement>(".crv-hand")];
        hands.forEach((hand, index) => {
          const sign = index === 0 ? 1 : -1;
          track(hand.animate([
            { transform: `translateX(${sign * -26}px) rotate(${sign * -18}deg)` },
            { transform: `translateX(${sign * -4}px) rotate(${sign * 4}deg)`, offset: 0.5, easing: "ease-in" },
            { transform: `translateX(${sign * -26}px) rotate(${sign * -18}deg)` },
          ], { duration: 300, iterations: Math.floor(duration / 300) - 1, easing: "ease-out" }));
        });
        root.querySelectorAll<HTMLElement>(".crv-clap-ring").forEach((ring) => {
          track(ring.animate([
            { transform: "scale(0.4)", opacity: 0 }, { transform: "scale(0.5)", opacity: 0.8, offset: 0.1 },
            { transform: "scale(1.6)", opacity: 0 },
          ], { duration: 300, iterations: Math.floor(duration / 300) - 1, delay: 150 }));
        });
        const confetti = particles.find((item) => item.preset === "confetti")
          ?? { type: "canvas", preset: "confetti", colors: ["#ffb02e", "#e50914", "#2ec4b6", "#ffffff"], count: 40 };
        const box = rect();
        burstAt(box.left + box.width / 2, box.top, confetti, confetti.count ?? 40, scope === "stage" ? box : undefined);
        break;
      }
      case "curtain-scene": {
        const [left, right] = [...root.querySelectorAll<HTMLElement>(".crv-curtain-half")];
        const open = (sign: number): Keyframe[] => [
          { offset: 0, transform: "translateX(0)" },
          { offset: 0.14, transform: "translateX(0)", easing: "cubic-bezier(.65,0,.35,1)" },
          { offset: 0.55, transform: `translateX(${sign * 102}%)` },
          { offset: 1, transform: `translateX(${sign * 102}%)` },
        ];
        track(left?.animate(open(-1), { duration, fill: "both" }));
        track(right?.animate(open(1), { duration, fill: "both" }));
        const title = root.querySelector<HTMLElement>(".crv-scene-title");
        track(title?.animate([
          { offset: 0, opacity: 0, transform: "scale(0.6)" },
          { offset: 0.22, opacity: 0, transform: "scale(0.6)" },
          { offset: 0.42, opacity: 1, transform: "scale(1.06)", easing: "ease-out" },
          { offset: 0.52, opacity: 1, transform: "scale(1)" },
          { offset: 0.86, opacity: 1, transform: "scale(1)" },
          { offset: 1, opacity: 0, transform: "scale(1.04)" },
        ], { duration, fill: "both" }));
        const spot = root.querySelector<HTMLElement>(".crv-scene-spot");
        track(spot?.animate([
          { offset: 0, opacity: 0 }, { offset: 0.3, opacity: 0 }, { offset: 0.45, opacity: 1 },
          { offset: 0.85, opacity: 1 }, { offset: 1, opacity: 0 },
        ], { duration, fill: "both" }));
        break;
      }
      default: {
        // Entradas sin escena propia: nombre en grande + su capa + ráfaga.
        const title = root.querySelector<HTMLElement>(".crv-scene-title");
        track(title?.animate([
          { offset: 0, opacity: 0, transform: "scale(0.7)" },
          { offset: 0.25, opacity: 1, transform: "scale(1.04)", easing: "ease-out" },
          { offset: 0.35, opacity: 1, transform: "scale(1)" },
          { offset: 0.85, opacity: 1, transform: "scale(1)" },
          { offset: 1, opacity: 0, transform: "scale(1.03)" },
        ], { duration, fill: "both" }));
        for (const item of particles) at(0.15, () => burstCenter(item, item.count ?? 20));
      }
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [request, quality, scope]);

  const style = layerStyle(layer ?? css ?? { type: "css", preset: "flash" });
  const fans = scope === "screen" ? 13 : 7;
  return (
    <div
      ref={rootRef}
      className={`crv-scene crv-scene-${preset} is-${scope}${live ? "" : " is-calm"}`}
      style={style}
      aria-hidden="true"
    >
      {preset === "pogo-scene" ? (
        <>
          <span className="crv-scene-beam" />
          <span className="crv-scene-beam crv-scene-beam-2" />
          <div className="crv-crowd">
            {Array.from({ length: fans }, (_, index) => (
              <span className="crv-fan" key={index} style={{ "--k": index } as React.CSSProperties}>
                <FanSvg tone={index % 3} />
              </span>
            ))}
          </div>
        </>
      ) : null}
      {preset === "clash-scene" ? (
        <>
          <span className="crv-scene-flash" />
          <div className="crv-clash">
            <span className="crv-clash-disc"><DiscSvg /></span>
            <span className="crv-clash-star"><StarSvg /></span>
            <span className="crv-clash-disc"><DiscSvg /></span>
          </div>
        </>
      ) : null}
      {preset === "applause-scene" ? (
        <div className="crv-applause">
          <span className="crv-clap-ring" />
          <span className="crv-hand"><HandSvg /></span>
          <span className="crv-hand crv-hand-right"><HandSvg /></span>
        </div>
      ) : null}
      {preset === "curtain-scene" ? (
        <>
          <span className="crv-scene-spot" />
          <span className="crv-curtain-half"><RealisticSprite preset="curtain" /></span>
          <span className="crv-curtain-half crv-curtain-right"><RealisticSprite preset="curtain" /></span>
        </>
      ) : null}
      {preset === "entry-generic" && css ? <span className={`crv-entry fx-${css.preset}`} style={layerStyle(css)}>{css.preset === "smoke" ? <SmokeClouds quality={quality} /> : null}</span> : null}
      {request.nameNode ? <div className="crv-scene-title">{request.nameNode}</div> : null}
      <p className="crv-scene-banner">{request.label}</p>
    </div>
  );
}

// ── Piezas de las escenas ──────────────────────────────────────────────────
function FanSvg({ tone }: { tone: number }) {
  return <RealisticSprite preset="hand-rock" className={`crv-fan-tone-${tone}`} />;
}

function DiscSvg() { return <RealisticSprite preset="vinyl-face" />; }

function StarSvg() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 2 L60 38 L98 30 L66 54 L86 90 L50 68 L14 90 L34 54 L2 30 L40 38 Z" fill="var(--fx-2)" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function HandSvg() { return <RealisticSprite preset="clap" />; }
