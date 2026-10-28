// CRV · Efectos de texto inspirados en React Bits (reactbits.dev).
//
// Reimplementados desde cero para el chat: mismos comportamientos, sin
// dependencias (motion/ogl fuera) y con presupuesto de animación. React Bits
// es MIT; aquí no se copia código, se replica el efecto.
//
//   decrypted  → glifos aleatorios que se resuelven letra a letra.
//   rb-glitch  → tres capas con clip-path por franjas y sombras RGB.
//   warp       → deformación líquida + aberración cromática (filtro SVG).
//   rb-focus   → palabras que se enfocan en secuencia con marco de esquinas.
//   rb-fuzzy   → borde mordido y vibración (filtro SVG de grano).
import { useEffect, useId, useMemo, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&@!?<>/\\=+*~^";

/** Filtros globales: se montan una vez en la página, no uno por nombre. */
export function EffectFilters() {
  return (
    <svg className="crv-fx-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="crv-warp-filter" x="-15%" y="-25%" width="130%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.016 0.034" numOctaves="2" seed="4" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="4.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="crv-fuzzy-filter" x="-12%" y="-20%" width="124%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="2" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

function useTick(active: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return tick;
}

/** Decrypted Text: el texto se resuelve desde glifos aleatorios. */
function Decrypted({ text, animate }: { text: string; animate: boolean }) {
  const chars = useMemo(() => [...text], [text]);
  const tick = useTick(animate, 45);
  // 26 ticks para resolver, 90 de descanso, y vuelve a empezar.
  const phase = animate ? tick % 130 : 130;
  const visible = Math.min(chars.length, Math.floor((Math.min(phase, 34) / 34) * chars.length));
  return (
    <span className="crv-rb-decrypted" aria-label={text}>
      {chars.map((char, index) => {
        if (char === " ") return <span key={index}> </span>;
        if (index < visible) return <span key={index}>{char}</span>;
        return (
          <span key={index} className="is-scrambled">
            {GLYPHS[(tick * 7 + index * 17) % GLYPHS.length]}
          </span>
        );
      })}
    </span>
  );
}

/** Glitch Text: base blanca con capas roja y cian recortadas en franjas. */
function Glitch({ text }: { text: string }) {
  return <span className="crv-rb-glitch" data-text={text}>{text}</span>;
}

/** Warp Text: deformación líquida y bordes cromáticos. */
function Warp({ text }: { text: string }) {
  return <span className="crv-rb-warp" data-text={text}>{text}</span>;
}

/** Fuzzy Text: borde mordido y vibración continua. */
function Fuzzy({ text }: { text: string }) {
  return <span className="crv-rb-fuzzy">{text}</span>;
}

/** True Focus: una palabra nítida con marco, el resto desenfocadas. */
function Focus({ text, animate }: { text: string; animate: boolean }) {
  const words = useMemo(() => text.split(/\s+/u).filter(Boolean), [text]);
  const [index, setIndex] = useState(0);
  const id = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  useEffect(() => {
    if (!animate || words.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % words.length), 1900);
    return () => window.clearInterval(timer);
  }, [animate, words.length]);
  if (words.length < 2) {
    // Un solo nombre: el marco lo recorre entero y late.
    return (
      <span className="crv-rb-focus" data-single="true">
        <span className="crv-rb-focus-word is-focused">{text}</span>
      </span>
    );
  }
  return (
    <span className="crv-rb-focus">
      {words.map((word, wordIndex) => (
        <span
          key={`${id}-${wordIndex}`}
          className={`crv-rb-focus-word${wordIndex === index ? " is-focused" : ""}`}
        >
          {word}
        </span>
      ))}
    </span>
  );
}

export function RbText({ preset, text, animate }: {
  preset: string; text: string; animate: boolean;
}) {
  switch (preset) {
    case "decrypted": return <Decrypted text={text} animate={animate} />;
    case "rb-glitch": return <Glitch text={text} />;
    case "warp": return <Warp text={text} />;
    case "rb-fuzzy": return <Fuzzy text={text} />;
    case "rb-focus": return <Focus text={text} animate={animate} />;
    default: return <>{text}</>;
  }
}
