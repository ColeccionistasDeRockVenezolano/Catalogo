import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { NoxStyle } from "../../../../src/chat/nox";
import type { Quality } from "../../lib/chatEffects";
import { useMotionSlot } from "../../lib/chatMotion";
import { bloodfallAnchors } from "../../lib/bloodfall";
import { useBatSwarm } from "./BatSwarm";
import "../../styles/nox-effects.css";

function useNoxMotion<T extends HTMLElement = HTMLSpanElement>(quality: Quality, priority: number, cost = 2) {
  const ref = useRef<T>(null);
  const slot = useMotionSlot(ref, cost, true, quality, priority);
  return { ref, still: !slot.granted || !slot.visible || quality === "low" || quality === "reduced" };
}

/** Rasteriza solo al cambiar el texto, su tamaño o la fuente; nunca por fotograma. */
function BloodfallInk({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [drops, setDrops] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      const fontSize = parseFloat(style.fontSize), ratio = 2;
      // El nombre está limitado por el protocolo; acotar también el lienzo defensivamente.
      const width = Math.max(1, Math.min(4096, Math.ceil(box.width * ratio)));
      const height = Math.max(1, Math.ceil(box.height * ratio));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.letterSpacing = style.letterSpacing;
      const metrics = ctx.measureText(name);
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
      const baseline = (box.height - ascent - descent) / 2 + ascent;
      ctx.fillText(name, 0, baseline);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const count = Math.min(7, Math.max(1, Math.ceil(Array.from(name.replace(/\s/gu, "")).length / 2.5)));
      setDrops(bloodfallAnchors(pixels, width, height, count).map((anchor, i) => ({
        x: anchor.x / ratio, y: anchor.y / ratio - 1,
        width: Math.max(2, fontSize * (.14 + i % 3 * .025)), height: fontSize * (.43 + i % 4 * .12),
      })));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener("loadingdone", measure); };
  }, [name]);
  return <><span ref={ref} className="nox-blood-ink">{name}</span>{drops.map((drop, index) => <span key={index} className="nox-drop-anchor" aria-hidden="true" style={{
    left: drop.x, top: drop.y, "--drop-width": `${drop.width}px`, "--drop-height": `${drop.height}px`,
    "--drop-delay": `${-index * .79}s`, "--drop-duration": `${3.6 + index % 3 * .47}s`,
  } as CSSProperties}><i className="nox-liquid" /><i className="nox-bead" /></span>)}</>;
}

interface NoxNameProps {
  name: string; style: NoxStyle; quality: Quality; priority?: number; className?: string; fontStyle?: CSSProperties;
}

/** Murciélagos: sin animación en reposo; el enjambre nace al pasar el puntero. */
function NoxBatsName({ name, quality, className = "", fontStyle }: {
  name: string; quality: Quality; className?: string | undefined; fontStyle?: CSSProperties | undefined;
}) {
  const swarm = useBatSwarm(quality);
  return <span ref={swarm.rootRef} className={`nox-name nox-bats ${className}`} style={fontStyle}
    aria-label={name} onPointerEnter={swarm.onPointerEnter}>
    <span ref={swarm.labelRef} className="nox-bats-label">{name}</span>
    <span ref={swarm.layerRef} className="nox-bats-layer" aria-hidden="true" />
  </span>;
}

function NoxPresetName({ name, style, quality, priority = 1.5, className = "", fontStyle }: NoxNameProps) {
  const motion = useNoxMotion(quality, priority);
  const enhanced = style.preset === "blood" && style.bloodfall !== "classic";
  return <span ref={motion.ref} className={`nox-name nox-${style.preset}${enhanced ? " nox-bloodfall" : ""}${motion.still ? " nox-still" : ""} ${className}`} style={fontStyle} aria-label={name} title={name}>
    {enhanced ? <BloodfallInk name={name} /> : name}
    {!enhanced && style.preset === "blood" ? Array.from({ length: 5 }, (_, i) => <i key={i} className="nox-blood-drip" aria-hidden="true" style={{ "--x": `${11 + i * 18}%`, "--w": `${3 + i % 3 * 1.5}px`, "--h": `${8 + i * 3 % 14}px`, "--delay": `${-i * .61}s` } as CSSProperties} />) : null}
    {style.preset === "smoke" ? Array.from({ length: 7 }, (_, i) => <i key={i} className="nox-smoke-puff" aria-hidden="true" style={{ "--x": `${7 + i * 14}%`, "--s": `${17 + i % 4 * 9}px`, "--delay": `${-i * .6}s` } as CSSProperties} />) : null}
  </span>;
}

export function NoxName(props: NoxNameProps) {
  return props.style.preset === "bats"
    ? <NoxBatsName name={props.name} quality={props.quality} className={props.className} fontStyle={props.fontStyle} />
    : <NoxPresetName {...props} />;
}

export function NoxAvatar({ initial, style, quality, size = 46, priority = 1.5 }: {
  initial: string; style: NoxStyle; quality: Quality; size?: number; priority?: number;
}) {
  const motion = useNoxMotion(quality, priority, 1);
  return <span ref={motion.ref} className={`nox-frame nox-${style.preset}${style.bloodfall !== "classic" ? " nox-enhanced" : ""}${motion.still ? " nox-still" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
    <span className="nox-avatar-core">{initial}</span>
  </span>;
}

export function NoxBubble({ style, quality, children, priority = 1.5 }: {
  style: NoxStyle; quality: Quality; children: ReactNode; priority?: number;
}) {
  const motion = useNoxMotion<HTMLDivElement>(quality, priority, 1);
  return <div ref={motion.ref} className={`nox-bubble nox-${style.preset}${style.bloodfall !== "classic" ? " nox-enhanced" : ""}${motion.still ? " nox-still" : ""}`}><div className="nox-bubble-copy">{children}</div></div>;
}
