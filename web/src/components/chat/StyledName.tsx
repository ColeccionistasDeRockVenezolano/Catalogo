import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { angleVector, NAME_STYLE_FAMILIES, nameGradientGeometry, nameStyleBounds, type NameStyle } from "../../../../src/chat/name-style";
import { useMotionSlot } from "../../lib/chatMotion";
import type { Quality } from "../../lib/chatEffects";
import "../../styles/name-editor.css";

const NO_DROP = "drop-shadow(0 0 0 transparent)";

export function StyledName({ name, style: config, quality, priority = 1.5 }: {
  name: string; style: NameStyle; quality: Quality; priority?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const slot = useMotionSlot(ref, 2, config.animation !== "none", quality, priority);
  const animate = slot.granted && slot.visible && (quality === "medium" || quality === "high");
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => setSize((old) => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      return old.width === next.width && old.height === next.height ? old : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bounds = nameStyleBounds(size.width, size.height, config);
  const shadow = angleVector(config.shadowAngle, config.shadowDistance);
  const motion = angleVector(config.motionAngle, config.amplitude);
  const gradient = nameGradientGeometry(config);
  const shadowValue = `${shadow.x}px ${shadow.y}px ${config.shadowBlur}px ${config.shadowColor}`;
  const variables = {
    fontFamily: NAME_STYLE_FAMILIES[config.family], fontSize: config.size,
    fontWeight: config.weight, fontStyle: config.italic ? "italic" : "normal", letterSpacing: config.tracking,
    "--ns-color": config.colors[0],
    "--ns-c0": config.colors[0], "--ns-c1": config.colors[1], "--ns-c2": config.colors[2],
    "--ns-angle": `${config.gradientAngle}deg`, "--ns-center": `${gradient.center}%`, "--ns-period": gradient.period,
    "--ns-outline": `${config.outlineWidth}px ${config.outlineColor}`,
    // Con degradado, text-shadow se pinta encima del color recortado: va como filtro.
    "--ns-shadow": config.shadow && !config.gradient ? shadowValue : "none",
    "--ns-drop": config.shadow && config.gradient ? `drop-shadow(${shadowValue})` : NO_DROP,
    "--ns-duration": `${config.duration}s`, "--ns-direction": config.direction,
    "--ns-stagger": `${config.stagger}s`, "--ns-rotation": `${config.rotation}deg`,
    "--ns-glyph-rotation": `${config.glyphRotation}deg`,
    "--ns-x": `${motion.x}px`, "--ns-y": `${motion.y}px`,
    width: size.width ? bounds.width : undefined, height: size.height ? bounds.height : undefined,
  } as CSSProperties;
  return <span ref={ref} className={`crv-styled-name${animate ? " is-live" : ""}`} style={variables} aria-label={`${config.prefix}${name}${config.suffix}`}>
    <span ref={text} className={`ns-text${config.glyphRotation % 180 !== 0 || config.animation === "spin" ? " ns-turned-glyphs" : ""}`} data-animation={config.animation} data-gradient={config.gradient} aria-hidden="true">
      {Array.from(`${config.prefix}${name}${config.suffix}`).map((char, index) => <span key={index} className="ns-glyph-box"><span className="ns-glyph" style={{ "--i": index, "--ns-offset": `${index * gradient.letterShift}%` } as CSSProperties}>{char === " " ? "\u00a0" : char}</span></span>)}
    </span>
  </span>;
}
