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
    "--ns-smoke-color": config.smokeColor, "--ns-smoke-blur": `${config.smokeBlur}px`,
    "--ns-smoke-opacity": config.smokeOpacity, "--ns-smoke-rise": `${config.smokeRise}px`,
    "--ns-smoke-bottom": `${config.smokeBottom}%`, "--ns-smoke-blend": config.smokeBlend,
    // Ghost conserva su color histórico; NickLab usa el tercer color sin degradado.
    "--ns-color": config.colors[config.animation === "smoke" ? 0 : 2],
    "--ns-shadow-color": config.shadowColor,
    "--ns-group-shadow": `drop-shadow(${Number(shadow.x.toFixed(6))}px ${Number(shadow.y.toFixed(6))}px ${config.shadowBlur * .55}px ${config.shadowColor})`,
    "--ns-glyph-shadow": `drop-shadow(0 0 ${config.shadowBlur * .38}px ${config.shadowColor})`,
    "--ns-fill": config.gradient ? `linear-gradient(${config.gradientAngle}deg, ${config.colors[0]} 0%, ${config.colors[1]} ${config.colorStop}%, ${config.colors[2]} 85%, ${config.colors[0]} 100%)` : "none",
    "--ns-outline": `${config.outlineWidth}px ${config.outlineColor}`,
    "--ns-duration": `${config.duration}s`, "--ns-direction": config.direction,
    "--ns-stagger": `${config.stagger}s`, "--ns-rotation": `${config.rotation}deg`,
    "--ns-glyph-rotation": `${config.glyphRotation}deg`,
    "--ns-x": `${motion.x}px`, "--ns-y": `${motion.y}px`,
    "--ns-from-x": `${(50 - flow.x).toFixed(2)}%`, "--ns-from-y": `${(50 - flow.y).toFixed(2)}%`,
    "--ns-to-x": `${(50 + flow.x).toFixed(2)}%`, "--ns-to-y": `${(50 + flow.y).toFixed(2)}%`,
    width: size.width ? bounds.width : undefined, height: size.height ? bounds.height : undefined,
  } as CSSProperties;
  return <span ref={ref} className={`crv-styled-name${animate ? " is-live" : ""}`} style={variables} aria-label={`${config.prefix}${name}${config.suffix}`}>
    <span ref={text} className={`ns-text${config.glyphRotation % 180 !== 0 || config.animation === "spin" ? " ns-turned-glyphs" : ""}`} data-animation={config.animation} data-gradient={config.gradient} data-shadow={config.shadow} aria-hidden="true">
      {config.prefix ? <span className="ns-symbol">{config.prefix}</span> : null}
      <span className="ns-glyphs">{Array.from(name).map((char, index) => <span key={index} className="ns-glyph-box"><span className="ns-glyph" style={{ "--i": index } as CSSProperties}>{char}</span></span>)}</span>
      {config.suffix ? <span className="ns-symbol">{config.suffix}</span> : null}
      {config.animation === "smoke" ? Array.from({ length: config.smokeCount }, (_, index) => <i key={index} className="ns-smoke-puff" aria-hidden="true" style={{
          "--x": `${config.smokeCount === 1 ? 50 : 7 + index * 84 / (config.smokeCount - 1)}%`,
          "--s": `${config.smokeSize + (index % 4) * config.smokeSizeStep}px`,
          animationDelay: `${Number((index * config.stagger).toFixed(3))}s`,
        } as CSSProperties} />) : null}
    </span>
  </span>;
}
