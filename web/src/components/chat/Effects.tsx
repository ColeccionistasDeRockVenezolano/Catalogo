import { StyledName } from "./StyledName";
// CRV · Componentes visuales de los efectos.
//
// Texto, objetos realistas en atlas WebP compartido, coreografías, partículas,
// materiales procedurales y escenas. Los objetos no se descargan por mensaje:
// todos reutilizan una textura, con variante compacta para móvil/gama baja.
//
// Todo pasa por el presupuesto por visibilidad de `useMotionSlot`: en gama
// baja se pinta la versión estática, con «reducir movimiento» la suave, y
// lo que sale de la pantalla suelta su hueco y pausa su CSS.
import { useEffect, useRef, useState } from "react";
import type { ChatEffect, ChatUser } from "../../../../src/chat/protocol";
import {
  avatarGradient, costOf, initials, layerStyle, manifestOf, nameFontCode, particleLayers,
  shouldHide, spriteLayers, textLayers, RB_PRESETS, SPLIT_PRESETS, type EffectLayer, type Quality,
} from "../../lib/chatEffects";
import { subscribeFrame, useMotionSlot } from "../../lib/chatMotion";
import { materialPreset } from "../../lib/chatMaterials";
import { useMaterialEmitter } from "./MaterialStage";
import { RealisticSprite } from "./RealisticSprite";
import { SmokeClouds } from "./SmokeClouds";
import { RbText } from "./TextEffects";
import { burstFrom, useParticleEmitter } from "./ParticleStage";
import {
  applyTextTransform, applyUnicodeFont, fontStyleFor, isPerLetterFont,
} from "../../../../src/chat/fonts";

// ── Texturas realistas compartidas (un atlas, también para stickers) ─────
const SPRITES: Record<string, () => React.ReactElement> = Object.fromEntries(
  ["vinyl-face", "cassette-face", "amp-face", "skull-rocker", "flame-face", "guitar",
    "hand-rock", "bat", "mic", "drum", "heart-horns", "ufo-vinyl"].map((preset) =>
    [preset, () => <RealisticSprite preset={preset} />]),
);

function SpriteBadge({ layer, quality }: { layer: EffectLayer; quality: Quality }) {
  const Sprite = SPRITES[layer.preset];
  if (!Sprite) return null;
  // Un sprite es un SVG con CSS: se pinta siempre, también en gama baja
  // (allí sin animación). El presupuesto se reserva para lo caro.
  return (
    <span
      className={`crv-sprite crv-sprite-${layer.position ?? "left"}${quality === "low" ? " is-static" : quality === "reduced" ? " is-soft" : ""}`}
      style={layerStyle(layer)}
      aria-hidden="true"
    >
      <Sprite />
    </span>
  );
}

/** Sticker enviado: el sprite en grande, con su entrada. */
export function StickerArt({ effect, quality }: { effect: ChatEffect; quality: Quality }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const slot = useMotionSlot(ref, 1, false, quality);
  const layer = spriteLayers(manifestOf(effect))[0];
  const Sprite = layer ? SPRITES[layer.preset] : null;
  if (!layer || !Sprite) return null;
  return (
    <span
      ref={ref}
      className={`crv-sticker-art${slot.visible ? "" : " is-offscreen"}${quality === "low" ? " is-static" : quality === "reduced" ? " is-soft" : ""}`}
      style={layerStyle(layer)}
      role="img"
      aria-label={effect.name}
    >
      <Sprite />
    </span>
  );
}

// ── Partículas en un canvas propio (ambiente de la sala) ───────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number; size: number; life: number; maxLife: number;
  color: string; angle: number; spin: number; kind: string;
}

const SHAPES: Record<string, string[]> = {
  sparks: ["dot"], notes: ["note"], hearts: ["heart"], rain: ["line"],
  fireworks: ["dot"], bubbles: ["bubble"], confetti: ["rect"], embers: ["dot"],
  stardust: ["dot"], crowd: ["dot"], flames: ["dot"], snow: ["dot"],
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
      case "snow":
        return { ...base, x: Math.random(), y: -Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.0002, vy: 0.0002 + Math.random() * 0.0003, size: 1 + Math.random() * 2 };
      case "crowd":
        return { ...base, x: Math.random(), y: 1.05, vx: (Math.random() - 0.5) * 0.0003, vy: -(0.0005 + Math.random() * 0.0009), size: 2 + Math.random() * 3 };
      case "stardust":
        return { ...base, x: 0.5, y: 0.5, vx: (Math.random() - 0.5) * 0.0016, vy: (Math.random() - 0.5) * 0.0016, size: 1 + Math.random() * 2.6, maxLife: 0.5 + Math.random() * 0.7 };
      default: // embers, flames
        return { ...base, x: Math.random(), y: 0.9 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.0004, vy: -(0.0004 + Math.random() * 0.0007), size: 1.2 + Math.random() * 2.6 };
    }
  }).map((particle) => ({ ...particle, vx: particle.vx * speed, vy: particle.vy * speed }));
}

/** Un canvas por capa a pantalla completa (ambiente). Dibuja con el reloj común. */
export function CanvasParticles({ layer, quality, className }: {
  layer: EffectLayer; quality: Quality; className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const still = quality === "low" || quality === "reduced";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || still) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const particles = makeParticles(layer, quality);
    const dpr = Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.5);

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

    const draw = (_now: number, delta: number): void => {
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
        const falling = layer.preset === "rain" || layer.preset === "confetti" || layer.preset === "snow";
        const respawn = falling
          ? particle.y > 1.4
          : layer.preset === "sparks" || layer.preset === "fireworks" || layer.preset === "stardust"
            ? particle.life > particle.maxLife
            : particle.y < -0.4 || particle.y > 1.5 || particle.x < -0.3 || particle.x > 1.3;
        if (respawn) {
          particle.life = 0;
          particle.maxLife = 0.5 + Math.random();
          if (falling) {
            particle.y = -0.1;
            particle.x = Math.random();
          } else if (layer.preset === "sparks" || layer.preset === "fireworks" || layer.preset === "stardust") {
            particle.x = layer.preset === "stardust" ? 0.5 : Math.random();
            particle.y = layer.preset === "stardust" ? 0.5 : 0.15 + Math.random() * 0.4;
            particle.vx = (Math.random() - 0.5) * 0.0024;
            particle.vy = (Math.random() - 0.5) * 0.0024;
          } else {
            particle.x = Math.random();
            particle.y = 1.05;
          }
        }
      }
      context.globalAlpha = 1;
    };
    const stop = subscribeFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
    };
  }, [layer, quality, still]);

  if (still) return null;
  return <canvas ref={canvasRef} className={className ?? "crv-particles"} aria-hidden="true" />;
}

// ── Marcos SVG ─────────────────────────────────────────────────────────────
const FIRE_TONGUES = Array.from({ length: 12 }, (_, index) => index * 30);
const EQ_BARS = Array.from({ length: 20 }, (_, index) => index * 18);

/** Aro dentado para la electricidad: radio que salta entre dos valores. */
function jaggedRing(radius: number, jitter: number, points: number, seed: number): string {
  const parts: string[] = [];
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const r = radius + (((index * 7 + seed) % 5) - 2) * (jitter / 2);
    parts.push(`${index === 0 ? "M" : "L"}${(50 + r * Math.cos(angle)).toFixed(1)} ${(50 + r * Math.sin(angle)).toFixed(1)}`);
  }
  return `${parts.join(" ")} Z`;
}

function SvgFrame({ layer }: { layer: EffectLayer }) {
  const preset = layer.preset;
  if (preset === "vinyl-spin") {
    return <span className="crv-frame-svg crv-frame-behind crv-vinyl-spin" style={layerStyle(layer)}><RealisticSprite preset="vinyl-face" /></span>;
  }

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
      ) : preset === "fire-ring" ? (
        <>
          <circle cx="50" cy="50" r="43" fill="none" stroke="var(--fx-1)" strokeWidth="3" opacity=".9" />
          <g className="crv-fire-ring">
            {FIRE_TONGUES.map((angle, index) => (
              <g key={angle} transform={`rotate(${angle} 50 50)`}>
                <path
                  className="crv-tongue"
                  style={{ "--k": index } as React.CSSProperties}
                  d="M50 1 C55 6 56 9 53 12 C52 9 50 9 50 12 C48 9 46 10 47 12 C44 9 45 6 50 1 Z"
                  fill={index % 2 ? "var(--fx-2)" : "var(--fx-3)"}
                />
              </g>
            ))}
          </g>
        </>
      ) : preset === "electric-ring" ? (
        <g className="crv-electric">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--fx-1)" strokeWidth="1" opacity=".35" />
          <path className="crv-bolt-a" d={jaggedRing(45, 5, 28, 1)} fill="none" stroke="var(--fx-2)" strokeWidth="1.8" strokeLinejoin="round" />
          <path className="crv-bolt-b" d={jaggedRing(45, 6, 24, 3)} fill="none" stroke="var(--fx-1)" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      ) : preset === "eq-radial" ? (
        <g>
          {EQ_BARS.map((angle, index) => (
            <g key={angle} transform={`rotate(${angle} 50 50)`}>
              <rect
                className="crv-eq-bar"
                style={{ "--k": index } as React.CSSProperties}
                x="48.6" y="0.5" width="2.8" height="8" rx="1.2"
                fill={index % 3 === 0 ? "var(--fx-1)" : index % 3 === 1 ? "var(--fx-2)" : "var(--fx-3)"}
              />
            </g>
          ))}
        </g>
      ) : (
        <rect x="4" y="4" width="92" height="92" rx="18" fill="none" stroke="var(--fx-1)" strokeWidth="3" strokeDasharray="14 6" className="crv-dash" />
      )}
    </svg>
  );
}

// ── Nombre con efecto ──────────────────────────────────────────────────────
export function ProductBadge({ effect, quality }: { effect: ChatEffect | null; quality: Quality }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const badge = effect?.kind === "badge" ? manifestOf(effect)?.badge : null;
  const slot = useMotionSlot(rootRef, 1, Boolean(badge?.animated), quality, 1.5);
  const animate = slot.granted && slot.visible && (quality === "medium" || quality === "high");
  const src = badge?.animated && !animate ? badge.staticImageUrl : badge?.imageUrl;
  return <span ref={rootRef} className="crv-product-badge">
    {src ? <img src={src} alt={effect?.name ?? "Placa"} title={effect?.name} width={28} height={28} loading="lazy" decoding="async" /> : null}
  </span>;
}

export function EffectName({ badge = null, ...props }: Parameters<typeof EffectNameText>[0] & { badge?: ChatEffect | null }) {
  return <span className="crv-named-user">
    <EffectNameText {...props} />
    {badge ? <ProductBadge effect={badge} quality={props.quality} /> : null}
  </span>;
}

function EffectNameText({ name, effect, font, quality, className, priority }: {
  name: string; effect: ChatEffect | null; font?: ChatEffect | null;
  cover: string | null; quality: Quality; className?: string;
  /** 2 en el probador de la tienda: siempre anima. */
  priority?: number;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const manifest = manifestOf(effect);
  const layers = textLayers(manifest);
  const particles = particleLayers(manifest);
  const fontCode = nameFontCode(font);
  const base = fontCode ? applyTextTransform(name, fontCode) : name;
  const display = fontCode ? applyUnicodeFont(base, fontCode) : base;
  const perLetter = isPerLetterFont(fontCode);
  const fontStyle = fontCode ? fontStyleFor(fontCode) : {};
  const primary = layers[0];
  const material = manifest?.layers.find((layer) => layer.type === "material")
    ?? (primary && materialPreset(primary.preset) ? primary : null);
  const materialCode = materialPreset(material?.preset);
  const rbPreset = primary && RB_PRESETS.has(primary.preset) ? primary.preset : null;
  // El descifrado y el foco animan con dos intervalos baratos: no gastan
  // presupuesto. Este se reserva para texto por letra, coreografías y
  // partículas, que son los que multiplican trabajo con muchos mensajes.
  const heavy = Boolean(material) || Boolean(primary && SPLIT_PRESETS.has(primary.preset)) || particles.length > 0;
  const slot = useMotionSlot(rootRef, Math.max(1, costOf(effect)), heavy, quality, priority ?? 1.5);
  const hidden = shouldHide(effect, quality);
  const live = slot.granted && (quality === "medium" || quality === "high");
  // Las partículas de nombres solo con hueco y en pantalla; nunca en «reducir movimiento».
  useParticleEmitter(rootRef, hidden || material ? [] : particles, live && slot.visible);
  useMaterialEmitter(rootRef, material, "name", live && slot.visible && !hidden);

  if (manifest?.nameStyle && !hidden) return <StyledName name={display} style={manifest.nameStyle} quality={quality} priority={priority ?? 1.5} />;

  if ((layers.length === 0 && !fontCode && !material) || hidden) {
    return <span ref={rootRef} className={className}>{name}</span>;
  }

  const extras = layers.slice(1).map((layer) => `fx-${layer.preset}`).join(" ");
  const split = perLetter || (!material && primary ? SPLIT_PRESETS.has(primary.preset) : false);
  const still = quality === "low" || (heavy && !slot.granted);
  const chars = [...display];

  return (
    <span
      ref={rootRef}
      className={[
        "crv-name",
        materialCode ? `crv-material crv-material-${materialCode}` : "",
        fontCode ? `crv-f-${fontCode}` : "",
        primary ? `fx-${primary.preset}` : "",
        extras,
        still ? "is-static" : "",
        quality === "reduced" ? "is-soft" : "",
        slot.visible ? "" : "is-offscreen",
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={{ ...fontStyle, ...((material ?? primary) ? layerStyle((material ?? primary)!) : {}) } as React.CSSProperties}
      aria-label={name}
    >
      {rbPreset ? (
        <RbText preset={rbPreset} text={display} animate={!still && slot.visible && quality !== "reduced"} />
      ) : split || particles.some((layer) => layer.origin === "letters") ? (
        <span className="crv-letters" aria-hidden="true">
          {chars.map((char, index) => (
            <span key={`${char}-${index}`} className="crv-ch" style={{ "--i": index } as React.CSSProperties}>
              {char === " " ? " " : char}
            </span>
          ))}
        </span>
      ) : (
        <span className="crv-name-text">{display}</span>
      )}
    </span>
  );
}

// ── Avatar con marco ───────────────────────────────────────────────────────
export function ChatAvatar({ user, frame, quality, size = 36, priority }: {
  user: Pick<ChatUser, "displayName" | "avatarSeed">; frame: ChatEffect | null; quality: Quality; size?: number;
  priority?: number;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const manifest = manifestOf(frame);
  const svg = manifest?.layers.find((layer) => layer.type === "svg") ?? null;
  const css = manifest?.layers.find((layer) => layer.type === "css") ?? null;
  const sprite = manifest?.layers.find((layer) => layer.type === "sprite") ?? null;
  const particles = particleLayers(manifest);
  const material = manifest?.layers.find((layer) => layer.type === "material")
    ?? (svg && materialPreset(svg.preset) ? svg : null);
  const materialCode = materialPreset(material?.preset);
  const hidden = shouldHide(frame, quality);
  // Los marcos vivos (fuego, electricidad, vinilo, ecualizador) son CSS de
  // compositor: también piden hueco para no sumar decenas a la vez.
  const heavy = Boolean(material) || particles.length > 0 || Boolean(svg && ["fire-ring", "electric-ring", "vinyl-spin", "eq-radial"].includes(svg.preset));
  const slot = useMotionSlot(rootRef, Math.max(1, manifest?.cost ?? 0), heavy, quality, priority);
  const still = quality === "low" || (heavy && !slot.granted);
  const live = slot.granted && (quality === "medium" || quality === "high");
  useParticleEmitter(rootRef, hidden || material ? [] : particles, live && slot.visible);
  useMaterialEmitter(rootRef, material, "avatar", live && slot.visible && !hidden);
  return (
    <span
      ref={rootRef}
      className={[
        "crv-avatar",
        materialCode ? `crv-material crv-material-${materialCode}` : "",
        css ? `fx-${css.preset}` : "",
        svg ? `crv-frame-${svg.preset}` : "",
        still ? "is-static" : "",
        quality === "reduced" ? "is-soft" : "",
        slot.visible ? "" : "is-offscreen",
      ].filter(Boolean).join(" ")}
      style={{ width: size, height: size, background: avatarGradient(user.avatarSeed), ...((material ?? css) ? layerStyle((material ?? css)!) : {}) }}
      aria-hidden="true"
    >
      <span className="crv-avatar-initials">{initials(user.displayName)}</span>
      {svg && !material && !hidden ? <SvgFrame layer={svg} /> : null}
      {sprite && !hidden ? (
        <span className="crv-avatar-sprite"><SpriteBadge layer={{ ...sprite, position: "over" }} quality={quality} /></span>
      ) : null}
    </span>
  );
}

// ── Fondo y ambiente de la sala ────────────────────────────────────────────
/** Fondo: su capa CSS y, si la trae, su capa de partículas (antes ignorada). */
export function RoomBackdrop({ effect, quality, contained }: {
  effect: ChatEffect | null; quality: Quality;
  /** Dentro del probador: ocupa su caja en vez de la sala. */
  contained?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const manifest = manifestOf(effect);
  const layer = manifest?.layers.find((item) => item.type === "css") ?? null;
  const canvas = manifest?.layers.find((item) => item.type === "canvas") ?? null;
  const slot = useMotionSlot(rootRef, Math.max(1, manifest?.cost ?? 0), Boolean(canvas) || layer?.preset === "fog", quality, contained ? 2 : 0);
  if (!layer || shouldHide(effect, quality)) return null;
  return (
    <div ref={rootRef} className="crv-backdrop-group">
      <div
        className={`crv-backdrop fx-${layer.preset}${slot.visible ? "" : " is-offscreen"}${quality === "low" ? " is-static" : quality === "reduced" ? " is-soft" : ""}`}
        style={layerStyle(layer)}
        aria-hidden="true"
      >{layer.preset === "fog" ? <SmokeClouds quality={quality} active={slot.granted && slot.visible} /> : null}</div>
      {canvas && slot.granted ? <CanvasParticles layer={canvas} quality={quality} className="crv-ambient crv-backdrop-particles" /> : null}
    </div>
  );
}

export function RoomAmbient({ effect, quality, contained }: {
  effect: ChatEffect | null; quality: Quality; contained?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const manifest = manifestOf(effect);
  const canvas = manifest?.layers.find((layer) => layer.type === "canvas") ?? null;
  const slot = useMotionSlot(rootRef, Math.max(1, manifest?.cost ?? 0), Boolean(canvas), quality, contained ? 2 : 0);
  if (!canvas || shouldHide(effect, quality)) return null;
  return <div ref={rootRef} className="crv-ambient-group">
    {slot.granted ? <CanvasParticles layer={canvas} quality={quality} className="crv-ambient" /> : null}
  </div>;
}

// ── Efecto de un mensaje ───────────────────────────────────────────────────
/**
 * Se dispara una vez al llegar el mensaje. Las partículas salen por el
 * escenario común (nada de un canvas por mensaje); el texto puede llevar la
 * clase del preset durante `durationMs`.
 */
export function MessageBurst({ effect, quality, fresh, priority = 1 }: {
  effect: ChatEffect | null; quality: Quality;
  /** Solo los mensajes nuevos estallan; el historial no. */
  fresh: boolean; priority?: number;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const manifest = manifestOf(effect);
  const sprites = spriteLayers(manifest);
  const [active, setActive] = useState(fresh);
  const consumed = useRef(false);
  const slot = useMotionSlot(anchorRef, manifest?.cost ?? 1, active && Boolean(manifest), quality, priority);
  const live = active && fresh && slot.granted && slot.visible && (quality === "medium" || quality === "high") && !shouldHide(effect, quality);
  useEffect(() => {
    const timer = window.setTimeout(() => setActive(false), manifest?.durationMs ?? 1800);
    return () => window.clearTimeout(timer);
  }, [manifest?.durationMs]);
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!live || !anchor || !manifest || consumed.current) return;
    consumed.current = true;
    for (const layer of manifest.layers) {
      if (layer.type === "canvas") burstFrom(anchor, layer, Math.min(28, layer.count ?? 16));
    }
    // Solo al montar: un mensaje estalla una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  if (!fresh || !active || !manifest) return null;
  return (
    <span className="crv-burst-anchor" ref={anchorRef} aria-hidden="true">
      {live ? sprites.map((layer, index) => (
        <span className={`crv-burst-sprite crv-sprite-${layer.position ?? "right"}`} key={`s-${index}`}>
          <SpriteBadge layer={layer} quality={quality} />
        </span>
      )) : null}
    </span>
  );
}

/** El efecto de texto se acaba y deja libre el presupuesto del mensaje. */
export function BurstText({ effect, quality, fresh, children, priority = 1 }: {
  effect: ChatEffect | null; quality: Quality; fresh: boolean; children: React.ReactNode; priority?: number;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const manifest = manifestOf(effect);
  const css = manifest?.layers.find((layer) => layer.type === "css");
  const material = manifest?.layers.find((layer) => layer.type === "material") ?? null;
  const materialCode = materialPreset(material?.preset);
  const [active, setActive] = useState(fresh);
  const slot = useMotionSlot(ref, manifest?.cost ?? 1, active && Boolean(css || material), quality, priority);
  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(() => setActive(false), manifest?.durationMs ?? 1800);
    return () => window.clearTimeout(timer);
  }, [fresh, manifest?.durationMs]);
  const moving = active && slot.granted && (quality === "medium" || quality === "high");
  useMaterialEmitter(ref, material, "bubble", moving && slot.visible);
  return <p ref={ref} className={[
    materialCode ? `crv-message-text crv-material crv-material-${materialCode}` : "",
    moving && css ? `crv-message-text fx-msg-${css.preset}` : "",
    !moving ? "is-static" : "",
  ].filter(Boolean).join(" ") || undefined}
    style={material ? layerStyle(material) : moving && css ? layerStyle(css) : undefined}>{children}</p>;
}
