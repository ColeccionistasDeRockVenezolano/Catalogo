// CRV · Componentes visuales de los efectos.
//
// Tres familias, todas vectoriales (cero GIF, cero imágenes por mensaje):
//   1. Texto animado por letra (wave, bounce, glitch, typewriter…).
//   2. Sprites SVG propios (vinilo con cara, casete, calavera, guitarra…).
//   3. Partículas en un único canvas por capa (chispas, notas, corazones…).
//
// Todo pasa por el presupuesto de `useAnimationSlot`: en gama baja se pinta la
// versión estática y el chat sigue a 60 fps.
import { useEffect, useRef, useState } from "react";
import type { ChatEffect, ChatUser } from "../../../../src/chat/protocol";
import {
  avatarGradient, costOf, initials, layerStyle, manifestOf, nameFontCode, shouldHide, spriteLayers,
  textLayers, useAnimationSlot, SPLIT_PRESETS, type EffectLayer, type Quality,
} from "../../lib/chatEffects";
import {
  applyTextTransform, applyUnicodeFont, fontStyleFor, isPerLetterFont,
} from "../../../../src/chat/fonts";

// ── Sprites SVG (propios de CRV) ───────────────────────────────────────────
function VinylFace() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#0b0b0b" stroke="#2e2e2e" strokeWidth="2" />
      <circle cx="32" cy="32" r="25" fill="none" stroke="#242424" strokeWidth="2" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#242424" strokeWidth="2" />
      <circle cx="32" cy="32" r="12" fill="var(--fx-1)" />
      <circle cx="32" cy="32" r="2.2" fill="#0b0b0b" />
      <g className="crv-blink">
        <circle cx="27" cy="30" r="2.8" fill="#fff" />
        <circle cx="37" cy="30" r="2.8" fill="#fff" />
        <circle cx="27.6" cy="30.4" r="1.3" fill="#111" />
        <circle cx="37.6" cy="30.4" r="1.3" fill="#111" />
      </g>
      <path d="M26 37 Q32 42 38 37" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path className="crv-shine" d="M14 14 A25 25 0 0 1 28 7" stroke="#fff" strokeWidth="3" fill="none" opacity=".35" strokeLinecap="round" />
    </svg>
  );
}

function CassetteFace() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <rect x="4" y="12" width="56" height="40" rx="6" fill="#232323" stroke="#3a3a3a" strokeWidth="2" />
      <rect x="10" y="18" width="44" height="16" rx="3" fill="#0f0f0f" />
      <g className="crv-reel">
        <circle cx="22" cy="26" r="6" fill="var(--fx-1)" />
        <circle cx="22" cy="26" r="2" fill="#0f0f0f" />
      </g>
      <g className="crv-reel crv-reel-reverse">
        <circle cx="42" cy="26" r="6" fill="var(--fx-1)" />
        <circle cx="42" cy="26" r="2" fill="#0f0f0f" />
      </g>
      <g className="crv-blink">
        <circle cx="26" cy="42" r="2.4" fill="#fff" />
        <circle cx="38" cy="42" r="2.4" fill="#fff" />
        <circle cx="26.5" cy="42.4" r="1.1" fill="#111" />
        <circle cx="38.5" cy="42.4" r="1.1" fill="#111" />
      </g>
      <path d="M29 47 L35 47" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AmpFace() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <rect x="8" y="10" width="48" height="44" rx="5" fill="#171717" stroke="#3a3a3a" strokeWidth="2" />
      <rect x="13" y="15" width="38" height="24" rx="3" fill="#0c0c0c" />
      {[20, 28, 36, 44].map((x) => [21, 27, 33].map((y) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="#2b2b2b" />
      )))}
      <g className="crv-blink">
        <circle cx="26" cy="24" r="2.6" fill="#fff" />
        <circle cx="38" cy="24" r="2.6" fill="#fff" />
        <circle cx="26.6" cy="24.4" r="1.2" fill="#111" />
        <circle cx="38.6" cy="24.4" r="1.2" fill="#111" />
      </g>
      <path d="M27 30 Q32 34 37 30" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="49" cy="45" r="4" fill="var(--fx-2)" className="crv-knob" />
      <circle cx="17" cy="45" r="2" fill="var(--fx-1)" className="crv-led" />
      <circle cx="24" cy="45" r="2" fill="var(--fx-1)" className="crv-led crv-led-2" />
    </svg>
  );
}

function SkullRocker() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <g className="crv-flames">
        <path d="M12 48 Q8 38 14 30 Q16 40 22 44 Z" fill="var(--fx-2)" opacity=".8" />
        <path d="M52 48 Q56 38 50 30 Q48 40 42 44 Z" fill="var(--fx-2)" opacity=".8" />
      </g>
      <path d="M32 8 C18 8 12 18 12 30 C12 42 20 46 20 52 L44 52 C44 46 52 42 52 30 C52 18 46 8 32 8 Z" fill="#f2f2f2" />
      <path d="M15 26 L49 26 L47 33 L17 33 Z" fill="var(--fx-1)" />
      <path d="M19 26 Q24 30 30 26" stroke="#111" strokeWidth="2.4" fill="none" />
      <path d="M34 26 Q40 30 45 26" stroke="#111" strokeWidth="2.4" fill="none" />
      <path d="M28 42 L36 42 L35 52 L29 52 Z" fill="#111" />
      <path d="M22 46 L26 46 M38 46 L42 46" stroke="#111" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FlameFace() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <path className="crv-flame" d="M32 4 C40 16 50 20 48 36 C46 50 38 58 32 58 C26 58 18 50 16 36 C14 22 24 16 32 4 Z" fill="var(--fx-1)" />
      <path d="M32 20 C36 28 42 30 40 40 C38 48 34 52 32 52 C30 52 26 48 24 40 C22 30 28 28 32 20 Z" fill="var(--fx-2)" opacity=".9" />
      <g className="crv-blink">
        <circle cx="27" cy="40" r="2.4" fill="#fff" />
        <circle cx="37" cy="40" r="2.4" fill="#fff" />
        <circle cx="27.5" cy="40.4" r="1.1" fill="#111" />
        <circle cx="37.5" cy="40.4" r="1.1" fill="#111" />
      </g>
      <path d="M28 46 Q32 49 36 46" stroke="#3a1500" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Guitar() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <g className="crv-shake">
        <path d="M40 8 L46 12 L30 36 L25 33 Z" fill="#8a5a2b" />
        <path d="M18 34 C10 40 10 52 20 56 C30 60 38 52 34 44 C42 44 46 34 38 30 C32 27 24 28 18 34 Z" fill="var(--fx-1)" stroke="#1a1a1a" strokeWidth="2" />
        <circle cx="27" cy="43" r="5" fill="#1a1a1a" />
        <path d="M41 9 L47 13" stroke="#d9d9d9" strokeWidth="2" />
        <path d="M20 34 L42 10" stroke="#e8e8e8" strokeWidth="0.8" opacity=".7" />
      </g>
      <g className="crv-sparks-mini">
        <path d="M48 22 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2 z" fill="var(--fx-2)" />
      </g>
    </svg>
  );
}

function HandRock() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <g className="crv-rock">
        <path d="M24 56 L24 30 L28 26 L31 30 L31 44 L34 20 L38 18 L40 24 L38 44 L42 26 L46 26 L46 34 L44 50 L40 56 Z" fill="var(--fx-1)" stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M22 40 C16 40 14 46 18 50 L24 54" fill="var(--fx-1)" stroke="#1a1a1a" strokeWidth="2" />
      </g>
      <circle cx="52" cy="16" r="2" fill="var(--fx-2)" className="crv-blink" />
      <circle cx="12" cy="20" r="1.6" fill="var(--fx-2)" className="crv-blink" />
    </svg>
  );
}

function Bat() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <g className="crv-flap">
        <path d="M32 30 C24 18 12 16 4 22 C10 26 12 32 10 38 C18 34 26 34 32 38 Z" fill="var(--fx-1)" />
        <path d="M32 30 C40 18 52 16 60 22 C54 26 52 32 54 38 C46 34 38 34 32 38 Z" fill="var(--fx-1)" />
      </g>
      <ellipse cx="32" cy="34" rx="7" ry="9" fill="#1a0a14" />
      <circle cx="29" cy="32" r="1.8" fill="var(--fx-2)" />
      <circle cx="35" cy="32" r="1.8" fill="var(--fx-2)" />
      <path d="M30 25 L28 18 M34 25 L36 18" stroke="#1a0a14" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Mic() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <rect x="24" y="6" width="16" height="26" rx="8" fill="#2a2a2a" stroke="#4a4a4a" strokeWidth="2" />
      {[12, 17, 22, 27].map((y) => <path key={y} d={`M26 ${y} L38 ${y}`} stroke="#5a5a5a" strokeWidth="1.4" />)}
      <path d="M20 28 Q32 40 44 28" stroke="#4a4a4a" strokeWidth="2.4" fill="none" />
      <path d="M32 38 L32 50 M24 54 L40 54" stroke="#4a4a4a" strokeWidth="3" strokeLinecap="round" />
      <g className="crv-waves">
        <path d="M48 18 Q54 26 48 34" stroke="var(--fx-1)" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M53 14 Q61 26 53 38" stroke="var(--fx-2)" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".7" />
      </g>
    </svg>
  );
}

function Drum() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <ellipse cx="32" cy="24" rx="22" ry="8" fill="#e8e8e8" stroke="#1a1a1a" strokeWidth="2" />
      <path d="M10 24 L10 44 C10 49 20 53 32 53 C44 53 54 49 54 44 L54 24" fill="var(--fx-1)" stroke="#1a1a1a" strokeWidth="2" />
      <path d="M14 34 L50 34 M14 42 L50 42" stroke="#1a1a1a" strokeWidth="1.6" opacity=".5" />
      <g className="crv-stick">
        <path d="M18 6 L30 20" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="crv-stick crv-stick-2">
        <path d="M46 6 L34 20" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function HeartHorns() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <path d="M12 16 L4 4 L18 10 Z" fill="var(--fx-2)" />
      <path d="M52 16 L60 4 L46 10 Z" fill="var(--fx-2)" />
      <path className="crv-beat" d="M32 56 C14 42 6 32 10 22 C14 12 26 12 32 22 C38 12 50 12 54 22 C58 32 50 42 32 56 Z" fill="var(--fx-1)" />
      <g className="crv-blink">
        <circle cx="25" cy="30" r="2.2" fill="#fff" />
        <circle cx="39" cy="30" r="2.2" fill="#fff" />
        <circle cx="25.4" cy="30.4" r="1" fill="#111" />
        <circle cx="39.4" cy="30.4" r="1" fill="#111" />
      </g>
    </svg>
  );
}

function UfoVinyl() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <ellipse className="crv-beam" cx="32" cy="44" rx="16" ry="14" fill="var(--fx-2)" opacity=".22" />
      <ellipse cx="32" cy="26" rx="26" ry="8" fill="#2a2a2a" stroke="#5a5a5a" strokeWidth="2" />
      <path d="M22 24 C22 12 42 12 42 24 Z" fill="var(--fx-1)" opacity=".9" />
      <circle cx="14" cy="27" r="2" fill="var(--fx-2)" className="crv-blink" />
      <circle cx="32" cy="29" r="2" fill="var(--fx-2)" className="crv-blink" />
      <circle cx="50" cy="27" r="2" fill="var(--fx-2)" className="crv-blink" />
    </svg>
  );
}

const SPRITES: Record<string, () => React.ReactElement> = {
  "vinyl-face": VinylFace,
  "cassette-face": CassetteFace,
  "amp-face": AmpFace,
  "skull-rocker": SkullRocker,
  "flame-face": FlameFace,
  "guitar": Guitar,
  "hand-rock": HandRock,
  "bat": Bat,
  "mic": Mic,
  "drum": Drum,
  "heart-horns": HeartHorns,
  "ufo-vinyl": UfoVinyl,
};

function SpriteBadge({ layer, quality }: { layer: EffectLayer; quality: Quality }) {
  const Sprite = SPRITES[layer.preset];
  if (!Sprite) return null;
  // Un sprite es un SVG con CSS: se pinta siempre, también en gama baja
  // (allí sin animación). El presupuesto se reserva para partículas.
  return (
    <span
      className={`crv-sprite crv-sprite-${layer.position ?? "left"}${quality === "low" ? " is-static" : ""}`}
      style={layerStyle(layer)}
      aria-hidden="true"
    >
      <Sprite />
    </span>
  );
}

// ── Partículas: un canvas por capa, nunca uno por mensaje ──────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; life: number; maxLife: number;
  color: string; angle: number; spin: number; kind: string;
}

const SHAPES: Record<string, string[]> = {
  sparks: ["dot"], notes: ["note"], hearts: ["heart"], rain: ["line"],
  fireworks: ["dot"], bubbles: ["bubble"], confetti: ["rect"], embers: ["dot"],
  stardust: ["dot"], crowd: ["dot"],
};

function makeParticles(layer: EffectLayer, quality: Quality): Particle[] {
  const colors = layer.colors ?? ["#ffffff"];
  const hardLimit = quality === "medium" ? 16 : 32;
  const count = Math.max(1, Math.min(layer.count ?? 16, hardLimit));
  const speed = layer.speed ?? 1;
  const preset = layer.preset;
  return Array.from({ length: count }, (_, index) => {
    const color = colors[index % colors.length] ?? "#ffffff";
    const kind = SHAPES[preset]?.[0] ?? "dot";
    const base = { life: 0, maxLife: 1, color, angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.2, kind };
    switch (preset) {
      case "sparks":
        return { ...base, x: 0.5, y: 0.5, vx: (Math.random() - 0.5) * 0.0022, vy: (Math.random() - 0.5) * 0.0022, size: 1 + Math.random() * 2.4, maxLife: 0.6 + Math.random() * 0.8 };
      case "notes":
        return { ...base, x: Math.random(), y: 0.9 + Math.random() * 0.2, vx: (Math.random() - 0.5) * 0.0006, vy: -(0.0004 + Math.random() * 0.0006), size: 10 + Math.random() * 10 };
      case "hearts":
        return { ...base, x: Math.random(), y: 0.95 + Math.random() * 0.15, vx: (Math.random() - 0.5) * 0.0008, vy: -(0.0005 + Math.random() * 0.0008), size: 5 + Math.random() * 6 };
      case "rain":
        return { ...base, x: Math.random(), y: -Math.random() * 0.4, vx: -0.0002, vy: 0.0016 + Math.random() * 0.0012, size: 6 + Math.random() * 12 };
      case "fireworks":
        return { ...base, x: Math.random(), y: 0.15 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.003, vy: (Math.random() - 0.5) * 0.003, size: 1.4 + Math.random() * 2.2, maxLife: 0.5 + Math.random() * 0.9 };
      case "bubbles":
        return { ...base, x: Math.random(), y: 1.05, vx: (Math.random() - 0.5) * 0.0004, vy: -(0.0003 + Math.random() * 0.0005), size: 3 + Math.random() * 7 };
      case "confetti":
        return { ...base, x: Math.random(), y: -Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.0004, vy: 0.0008 + Math.random() * 0.0008, size: 3 + Math.random() * 5 };
      case "crowd":
        return { ...base, x: Math.random(), y: 1.05, vx: (Math.random() - 0.5) * 0.0003, vy: -(0.0005 + Math.random() * 0.0009), size: 2 + Math.random() * 3 };
      case "stardust":
        return { ...base, x: 0.5, y: 0.5, vx: (Math.random() - 0.5) * 0.0016, vy: (Math.random() - 0.5) * 0.0016, size: 1 + Math.random() * 2.6, maxLife: 0.5 + Math.random() * 0.7 };
      default: // embers
        return { ...base, x: Math.random(), y: 0.9 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.0004, vy: -(0.0004 + Math.random() * 0.0007), size: 1.2 + Math.random() * 2.6 };
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

    const drawHeart = (x: number, y: number, size: number): void => {
      context.beginPath();
      context.moveTo(x, y + size * 0.3);
      context.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + size * 0.3);
      context.bezierCurveTo(x - size / 2, y + size * 0.6, x, y + size * 0.85, x, y + size);
      context.bezierCurveTo(x, y + size * 0.85, x + size / 2, y + size * 0.6, x + size / 2, y + size * 0.3);
      context.bezierCurveTo(x + size / 2, y, x, y, x, y + size * 0.3);
      context.fill();
    };

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
        const fade = particle.kind === "bubble" || particle.kind === "heart" || particle.kind === "note"
          ? Math.min(1, 1.2 - particle.life / particle.maxLife)
          : Math.max(0, 1 - particle.life / particle.maxLife);
        context.globalAlpha = Math.max(0, fade);
        context.fillStyle = particle.color;
        context.strokeStyle = particle.color;
        const x = particle.x * width;
        const y = particle.y * height;
        switch (particle.kind) {
          case "note":
            context.font = `${particle.size * dpr}px system-ui, sans-serif`;
            context.fillText("♪", x, y);
            break;
          case "heart":
            drawHeart(x, y, particle.size * dpr);
            break;
          case "line":
            context.lineWidth = 1.4 * dpr;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x - 1.5 * dpr, y + particle.size * dpr);
            context.stroke();
            break;
          case "bubble":
            context.lineWidth = 1.4 * dpr;
            context.beginPath();
            context.arc(x, y, particle.size * dpr, 0, Math.PI * 2);
            context.stroke();
            break;
          case "rect":
            context.save();
            context.translate(x, y);
            context.rotate(particle.angle);
            context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
            context.restore();
            break;
          default:
            context.beginPath();
            context.arc(x, y, particle.size * dpr, 0, Math.PI * 2);
            context.fill();
        }
        const respawn = particle.kind === "rain" || particle.kind === "confetti"
          ? particle.y > 1.4
          : particle.kind === "sparks" || particle.kind === "fireworks" || particle.kind === "stardust"
            ? particle.life > particle.maxLife
            : particle.y < -0.4 || particle.y > 1.5 || particle.x < -0.3 || particle.x > 1.3;
        if (respawn) {
          particle.life = 0;
          particle.maxLife = 0.5 + Math.random();
          if (particle.kind === "spark") particle.color = layer.colors?.[0] ?? "#fff";
          if (particle.kind === "rain" || particle.kind === "confetti") {
            particle.y = -0.1;
            particle.x = Math.random();
          } else if (particle.kind === "sparks" || particle.kind === "fireworks" || particle.kind === "stardust") {
            particle.x = layer.preset === "stardust" ? 0.5 : Math.random();
            particle.y = layer.preset === "stardust" ? 0.5 : 0.15 + Math.random() * 0.4;
            particle.vx = (Math.random() - 0.5) * 0.0024;
            particle.vy = (Math.random() - 0.5) * 0.0024;
          } else {
            particle.x = Math.random();
            particle.y = layer.preset === "embers" || layer.preset === "notes" || layer.preset === "hearts" || layer.preset === "crowd"
              ? 1.05 : Math.random();
          }
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
  const preset = layer.preset;
  return (
    <svg className="crv-frame-svg" viewBox="0 0 100 100" aria-hidden="true" style={layerStyle(layer)}>
      {preset === "orbit" ? (
        <>
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--fx-1)" strokeWidth="2" strokeDasharray="10 8" className="crv-orbit" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--fx-2)" strokeWidth="1.5" strokeDasharray="2 10" className="crv-orbit crv-orbit-reverse" />
        </>
      ) : preset === "pulse-ring" ? (
        <>
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--fx-1)" strokeWidth="2.4" className="crv-ring-pulse" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--fx-2)" strokeWidth="1.2" className="crv-ring-pulse crv-ring-pulse-2" />
        </>
      ) : preset === "ring" ? (
        <>
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--fx-1)" strokeWidth="3" />
          <circle cx="50" cy="50" r="41" fill="none" stroke="var(--fx-2)" strokeWidth="1" strokeDasharray="3 5" className="crv-orbit" />
        </>
      ) : (
        <rect x="4" y="4" width="92" height="92" rx="18" fill="none" stroke="var(--fx-1)" strokeWidth="3" strokeDasharray="14 6" className="crv-dash" />
      )}
    </svg>
  );
}

// ── Nombre con efecto ──────────────────────────────────────────────────────
export function EffectName({ name, effect, font, cover, quality, className }: {
  name: string; effect: ChatEffect | null; font?: ChatEffect | null;
  cover: string | null; quality: Quality; className?: string;
}) {
  const manifest = manifestOf(effect);
  const layers = textLayers(manifest);
  const sprites = spriteLayers(manifest);
  const fontCode = nameFontCode(font);
  const base = fontCode ? applyTextTransform(name, fontCode) : name;
  const display = fontCode ? applyUnicodeFont(base, fontCode) : base;
  const perLetter = isPerLetterFont(fontCode);
  const fontStyle = fontCode ? fontStyleFor(fontCode) : {};
  const primary = layers[0];
  // Solo el texto por letra y las partículas consumen presupuesto; un sprite
  // o un glow son CSS barato y deben verse siempre.
  const heavy = Boolean(primary && SPLIT_PRESETS.has(primary.preset))
    || Boolean(manifest?.layers.some((layer) => layer.type === "canvas"));
  const slot = useAnimationSlot(Math.max(1, costOf(effect)), heavy, quality);
  if (layers.length === 0 && sprites.length === 0 && !fontCode) return <span className={className}>{name}</span>;
  if (shouldHide(effect, quality)) return <span className={className}>{name}</span>;

  const extras = layers.slice(1).map((layer) => `fx-${layer.preset}`).join(" ");
  const split = perLetter || (primary ? SPLIT_PRESETS.has(primary.preset) : false);
  const still = quality === "low" || (heavy && !slot);
  const chars = [...display];

  return (
    <span
      className={[
        "crv-name",
        fontCode ? `crv-f-${fontCode}` : "",
        primary ? `fx-${primary.preset}` : "",
        extras,
        still ? "is-static" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={{ ...fontStyle, ...(primary ? layerStyle(primary) : {}) } as React.CSSProperties}
      aria-label={name}
    >
      {sprites.filter((layer) => (layer.position ?? "left") === "left").map((layer, index) => (
        <SpriteBadge key={`l-${layer.preset}-${index}`} layer={layer} quality={quality} />
      ))}
      {primary?.preset === "vinyl" && cover ? (
        <img className="crv-vinyl" src={cover} alt="" loading="lazy" decoding="async" />
      ) : null}
      {split ? (
        <span className="crv-letters" aria-hidden="true">
          {chars.map((char, index) => (
            <span key={`${char}-${index}`} className="crv-ch" style={{ "--i": index } as React.CSSProperties}>
              {char === " " ? "\u00a0" : char}
            </span>
          ))}
        </span>
      ) : (
        <span className="crv-name-text">{display}</span>
      )}
      {sprites.filter((layer) => (layer.position ?? "left") === "right").map((layer, index) => (
        <SpriteBadge key={`r-${layer.preset}-${index}`} layer={layer} quality={quality} />
      ))}
      {sprites.filter((layer) => layer.position === "over").map((layer, index) => (
        <span className="crv-sprite-over" key={`o-${layer.preset}-${index}`}>
          <SpriteBadge layer={layer} quality={quality} />
        </span>
      ))}
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
  const sprite = manifest?.layers.find((layer) => layer.type === "sprite") ?? null;
  const heavy = Boolean(manifest?.layers.some((layer) => layer.type === "canvas"));
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), heavy, quality);
  const still = quality === "low" || (heavy && !slot);
  return (
    <span
      className={`crv-avatar${css ? ` fx-${css.preset}${still ? " is-static" : ""}` : ""}`}
      style={{ width: size, height: size, background: avatarGradient(user.avatarSeed), ...(css ? layerStyle(css) : {}) }}
      aria-hidden="true"
    >
      <span className="crv-avatar-initials">{initials(user.displayName)}</span>
      {svg && !shouldHide(frame, quality) ? <SvgFrame layer={svg} /> : null}
      {sprite && !shouldHide(frame, quality) ? (
        <span className="crv-avatar-sprite"><SpriteBadge layer={{ ...sprite, position: "over" }} quality={quality} /></span>
      ) : null}
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

// ── Efecto de entrada ──────────────────────────────────────────────────────
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

function useAlive(ms: number): boolean {
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    setAlive(true);
    const timer = window.setTimeout(() => setAlive(false), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return alive;
}

// ── Efecto de un mensaje ───────────────────────────────────────────────────
export function MessageBurst({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const manifest = manifestOf(effect);
  const layers = manifest?.layers ?? [];
  const slot = useAnimationSlot(Math.max(1, manifest?.cost ?? 0), layers.length > 0, quality);
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setAlive(false), manifest?.durationMs ?? 900);
    return () => window.clearTimeout(timer);
  }, [manifest?.durationMs]);
  if (layers.length === 0 || !slot || !alive || shouldHide(effect, quality)) return null;
  return (
    <>
      {layers.map((layer, index) => layer.type === "canvas" ? (
        <span className={`crv-burst fx-${layer.preset}`} style={layerStyle(layer)} key={`c-${index}`} aria-hidden="true">
          <CanvasParticles layer={layer} quality={quality} />
        </span>
      ) : layer.type === "sprite" ? (
        <span className={`crv-burst-sprite crv-sprite-${layer.position ?? "right"}`} key={`s-${index}`} aria-hidden="true">
          <SpriteBadge layer={layer} quality={quality} />
        </span>
      ) : null)}
    </>
  );
}
