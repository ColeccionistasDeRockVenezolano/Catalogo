import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { angleVector, NAME_STYLE_FAMILIES, nameStyleBounds, type NameStyle } from "../../../../src/chat/name-style";
import { useMotionSlot } from "../../lib/chatMotion";
import type { Quality } from "../../lib/chatEffects";
import "../../styles/name-editor.css";

export function StyledName({ name, style: config, quality, priority = 1.5 }: {
  name: string; style: NameStyle; quality: Quality; priority?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const slot = useMotionSlot(ref, 2, true, quality, priority);
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
  const flow = angleVector(config.motionAngle, 50);
  const variables = {
    fontFamily: NAME_STYLE_FAMILIES[config.family], fontSize: config.size,
    fontWeight: config.weight, fontStyle: config.italic ? "italic" : "normal", letterSpacing: config.tracking,
    "--ns-color": config.colors[0],
    "--ns-fill": config.gradient ? `linear-gradient(${config.gradientAngle}deg, ${config.colors[0]}, ${config.colors[1]} ${config.colorStop}%, ${config.colors[2]})` : "none",
    "--ns-outline": `${config.outlineWidth}px ${config.outlineColor}`,
    "--ns-shadow": config.shadow ? `${shadow.x}px ${shadow.y}px ${config.shadowBlur}px ${config.shadowColor}` : "0 0 0 transparent",
    "--ns-duration": `${config.duration}s`, "--ns-direction": config.direction,
    "--ns-stagger": `${config.stagger}s`, "--ns-rotation": `${config.rotation}deg`,
    "--ns-glyph-rotation": `${config.glyphRotation}deg`,
    "--ns-x": `${motion.x}px`, "--ns-y": `${motion.y}px`,
    "--ns-from-x": `${50 - flow.x}%`, "--ns-from-y": `${50 - flow.y}%`,
    "--ns-to-x": `${50 + flow.x}%`, "--ns-to-y": `${50 + flow.y}%`,
    width: size.width ? bounds.width : undefined, height: size.height ? bounds.height : undefined,
  } as CSSProperties;
  return <span ref={ref} className={`crv-styled-name${animate ? " is-live" : ""}`} style={variables} aria-label={`${config.prefix}${name}${config.suffix}`}>
    <span ref={text} className={`ns-text${config.glyphRotation % 180 !== 0 || config.animation === "spin" ? " ns-turned-glyphs" : ""}`} data-animation={config.animation} data-gradient={config.gradient} aria-hidden="true">
      {Array.from(`${config.prefix}${name}${config.suffix}`).map((char, index) => <span key={index} className="ns-glyph-box"><span className="ns-glyph" style={{ "--i": index } as CSSProperties}>{char === " " ? "\u00a0" : char}</span></span>)}
    </span>
  </span>;
}
