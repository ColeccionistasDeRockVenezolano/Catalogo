// CRV · Componentes visuales de los efectos.
//
// Todo lo que se anima aquí está presupuestado: si el dispositivo es de gama
// baja o ya hay demasiados efectos en pantalla, la misma pieza se pinta
// estática. Ningún efecto usa GIF ni descarga una imagen por mensaje.
import { useEffect, useRef, useState } from "react";
import type { ChatEffect, ChatUser } from "../../../../src/chat/protocol";
import {
  avatarGradient, costOf, initials, layerStyle, manifestOf, shouldHide, textLayer,
  useAnimationSlot, type EffectLayer, type Quality,
} from "../../lib/chatEffects";

// ── Partículas (un solo canvas por capa, nunca uno por mensaje) ────────────
interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; life: number; maxLife: number;
  color: string; spin: number; angle: number;
}

function makeParticles(layer: EffectLayer, quality: Quality): Particle[] {
  const colors = layer.colors ?? ["#ffffff"];
  const hardLimit = quality === "medium" ? 14 : 28;
  const count = Math.max(1, Math.min(layer.count ?? 16, hardLimit));
  const speed = layer.speed ?? 1;
  const preset = layer.preset;
  return Array.from({ length: count }, (_, index) => {
    const color = colors[index % colors.length] ?? "#ffffff";
    switch (preset) {
      case "confetti":
        return { x: Math.random(), y: -Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.00018, vy: 0.00012 + Math.random() * 0.00018, size: 3 + Math.random() * 5, life: 0, maxLife: 1, color, spin: Math.random() * 0.2, angle: Math.random() * Math.PI };
      case "embers":
        return { x: Math.random(), y: 0.8 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.00012, vy: -(0.00008 + Math.random() * 0.00016), size: 1.5 + Math.random() * 3, life: 0, maxLife: 1, color, spin: 0, angle: 0 };
      case "stardust":
        return { x: 0.5, y: 0.5, vx: (Math.random() - 0.5) * 0.0012, vy: (Math.random() - 0.5) * 0.0012, size: 1 + Math.random() * 3, life: 0, maxLife: 0.7 + Math.random() * 0.6, color, spin: 0, angle: 0 };
      case "crowd":
        return { x: Math.random(), y: 1 + Math.random() * 0.2, vx: (Math.random() - 0.5) * 0.00008, vy: -(0.00016 + Math.random() * 0.00022), size: 2 + Math.random() * 4, life: 0, maxLife: 1, color, spin: 0, angle: 0 };
      default:
        return { x: Math.random(), y: Math.random(), vx: 0, vy: 0, size: 3, life: 0, maxLife: 1, color, spin: 0, angle: 0 };
    }
  }).map((particle) => ({ ...particle, vx: particle.vx * speed, vy: particle.vy * speed }));
}

export function CanvasParticles({ layer, quality, className }: {
  layer: EffectLayer; quality: Quality; className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || quality === "low") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const particles = makeParticles(layer, quality);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let frame = 0;
    let previous = performance.now();

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();

    const draw = (now: number): void => {
      const delta = Math.min(64, now - previous);
      previous = now;
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.life += delta / 1000;
        particle.angle += particle.spin;
        if (layer.preset === "stardust") {
          const alpha = Math.max(0, 1 - particle.life / particle.maxLife);
          context.globalAlpha = alpha;
        } else {
          context.globalAlpha = 0.85;
        }
        context.fillStyle = particle.color;
        if (layer.preset === "confetti") {
          context.save();
          context.translate(particle.x * width, particle.y * height);
          context.rotate(particle.angle);
          context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
          context.restore();
        } else {
          context.beginPath();
          context.arc(particle.x * width, particle.y * height, particle.size * dpr, 0, Math.PI * 2);
          context.fill();
        }
        if (particle.y > 1.4 || particle.y < -0.4 || particle.x < -0.3 || particle.x > 1.3) {
          particle.y = layer.preset === "embers" ? 1.1 : -0.1;
          particle.x = Math.random();
        }
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    const onVisibility = (): void => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        previous = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
    };
  }, [layer, quality]);

  if (quality === "low") return null;
  return <canvas ref={canvasRef} className={className ?? "crv-particles"} aria-hidden="true" />;
}

// ── Marcos SVG ─────────────────────────────────────────────────────────────
function SvgFrame({ layer }: { layer: EffectLayer }) {
  const orbit = layer.preset === "orbit";
  return (
    <svg className="crv-frame-svg" viewBox="0 0 100 100" aria-hidden="true" style={layerStyle(layer)}>
      {orbit ? (
        <>
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--fx-1)" strokeWidth="2" strokeDasharray="10 8" className="crv-orbit" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--fx-2)" strokeWidth="1.5" strokeDasharray="2 10" className="crv-orbit crv-orbit-reverse" />
        </>
      ) : (
        <rect x="4" y="4" width="92" height="92" rx="18" fill="none" stroke="var(--fx-1)" strokeWidth="3" strokeDasharray="14 6" className="crv-dash" />
      )}
    </svg>
  );
}

// ── Nombre con efecto ──────────────────────────────────────────────────────
export function EffectName({ name, effect, cover, quality, className }: {
  name: string; effect: ChatEffect | null; cover: string | null; quality: Quality; className?: string;
}) {
  const manifest = manifestOf(effect);
  const layer = textLayer(manifest);
  const slot = useAnimationSlot(Math.max(1, costOf(effect)), Boolean(layer), quality);
  if (!layer || shouldHide(effect, quality)) return <span className={className}>{name}</span>;
  const staticOnly = !slot;
  return (
    <span
      className={`crv-name fx-${layer.preset}${staticOnly ? " is-static" : ""}${className ? ` ${className}` : ""}`}
      style={layerStyle(layer)}
    >
      {layer.preset === "vinyl" && cover ? (
        <img className="crv-vinyl" src={cover} alt="" loading="lazy" decoding="async" />
      ) : null}
      <span className="crv-name-text">{name}</span>
    </span>
  );
}

// ── Avatar con marco ───────────────────────────────────────────────────────
export function ChatAvatar({ user, frame, quality, size = 36 }: {
  user: Pick<ChatUser, "displayName" | "avatarSeed">; frame: ChatEffect | null; quality: Quality; size?: number;
}) {
  const manifest = manifestOf(frame);
  const svg = manifest?.layers.find((layer) => layer.type === "svg") ?? null;
  const css = manifest?.layers.find((layer) => layer.type === "css") ?? null;
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), Boolean(manifest), quality);
  const still = !slot;
  return (
    <span
      className={`crv-avatar${css ? ` fx-${css.preset}${still ? " is-static" : ""}` : ""}`}
      style={{ width: size, height: size, background: avatarGradient(user.avatarSeed), ...(css ? layerStyle(css) : {}) }}
      aria-hidden="true"
    >
      <span className="crv-avatar-initials">{initials(user.displayName)}</span>
      {svg && !shouldHide(frame, quality) ? <SvgFrame layer={svg} /> : null}
    </span>
  );
}

// ── Fondo y ambiente de la sala ────────────────────────────────────────────
export function RoomBackdrop({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const manifest = manifestOf(effect);
  const layer = manifest?.layers.find((item) => item.type === "css") ?? null;
  if (!layer || shouldHide(effect, quality)) return null;
  return <div className={`crv-backdrop fx-${layer.preset}${quality === "low" ? " is-static" : ""}`} style={layerStyle(layer)} aria-hidden="true" />;
}

export function RoomAmbient({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const manifest = manifestOf(effect);
  const canvas = manifest?.layers.find((layer) => layer.type === "canvas") ?? null;
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), Boolean(canvas), quality);
  if (!canvas || !slot || shouldHide(effect, quality)) return null;
  return <CanvasParticles layer={canvas} quality={quality} className="crv-ambient" />;
}

// ── Efecto de entrada (una vez al entrar) ──────────────────────────────────
export function EntryBurst({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const manifest = manifestOf(effect);
  const layer = manifest?.layers[0] ?? null;
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), Boolean(layer), quality);
  const alive = useAlive(manifest?.durationMs ?? 1400);
  if (!layer || !slot || !alive || shouldHide(effect, quality)) return null;
  return (
    <div className={`crv-entry fx-${layer.preset}`} style={layerStyle(layer)} aria-hidden="true">
      {layer.type === "canvas" ? <CanvasParticles layer={layer} quality={quality} /> : null}
    </div>
  );
}

/** Verdadero durante `ms` y luego falso; se reinicia si cambia la duración. */
function useAlive(ms: number): boolean {
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    setAlive(true);
    const timer = window.setTimeout(() => setAlive(false), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return alive;
}

// ── Efecto de un mensaje (se apaga solo) ───────────────────────────────────
export function MessageBurst({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const manifest = manifestOf(effect);
  const layer = manifest?.layers[0] ?? null;
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), Boolean(layer), quality);
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setAlive(false), manifest?.durationMs ?? 900);
    return () => window.clearTimeout(timer);
  }, [manifest?.durationMs]);
  if (!layer || !slot || !alive || shouldHide(effect, quality)) return null;
  return (
    <span className={`crv-burst fx-${layer.preset}`} style={layerStyle(layer)} aria-hidden="true">
      {layer.type === "canvas" ? <CanvasParticles layer={layer} quality={quality} /> : null}
    </span>
  );
}
