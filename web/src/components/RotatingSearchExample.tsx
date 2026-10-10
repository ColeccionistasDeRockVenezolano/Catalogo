import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CatalogSearchExample } from "../lib/catalogSearchExamples";

/** Comparte el mismo ritmo y la misma transición entre todos los buscadores. */
export function useRotatingSearchExample(examples: CatalogSearchExample[], value: string, onAccept: (value: string) => void, onCycle?: (firstKey?: string) => void, intervalMs = 3500) {
  const cycleRef = useRef(onCycle);
  cycleRef.current = onCycle;
  const [visible, setVisible] = useState(!document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [index, setIndex] = useState(0);
  const [outgoing, setOutgoing] = useState<CatalogSearchExample | null>(null);
  const [currentKey, setCurrentKey] = useState<string | undefined>(examples[0]?.key);
  const [skipped, setSkipped] = useState(false);
  const [paused, setPaused] = useState(false);
  const eligibleCurrent = examples.find(e => e.key === currentKey);
  const showExample = !value && eligibleCurrent !== undefined && !skipped;

  useEffect(() => { setSkipped(false); }, [value]);

  // Retener solo el ID durante la revalidación; jamás mostrar datos fuera de la selección vigente.
  useEffect(() => {
    if (!examples.length) { setOutgoing(null); return; }
    if (!examples.some(e => e.key === currentKey)) {
      setOutgoing(null); setCurrentKey(examples[0]?.key); setIndex(0);
    }
  }, [currentKey, examples]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!showExample || !visible || paused || reducedMotion || examples.length < 2) {
      setOutgoing(null);
      return;
    }
    const timer = window.setTimeout(() => {
      let nextIndex = (examples.findIndex(e => e.key === currentKey) + 1) % examples.length;
      for (let step = 0; step < examples.length && examples[nextIndex].label === eligibleCurrent!.label; step++) {
        nextIndex = (nextIndex + 1) % examples.length;
      }
      setOutgoing(eligibleCurrent!);
      setCurrentKey(examples[nextIndex]?.key);
      setIndex(nextIndex);
      if (nextIndex === 0) cycleRef.current?.(examples[nextIndex]?.key);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [showExample, visible, reducedMotion, examples, currentKey, eligibleCurrent, index, intervalMs, paused]);

  useEffect(() => {
    if (!outgoing) return;
    const timer = window.setTimeout(() => setOutgoing(null), 200);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  function acceptOnTab(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showExample) {
      setSkipped(true);
      return;
    }
    if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
      || event.nativeEvent.isComposing || !showExample) return;
    event.preventDefault();
    onAccept(eligibleCurrent!.label);
  }

  function accept() {
    if (showExample) onAccept(eligibleCurrent!.label);
  }

  return { current: showExample ? eligibleCurrent : undefined, outgoing: showExample && outgoing && examples.some(e => e.key === outgoing.key) ? outgoing : null, paused, togglePause: () => setPaused(p => !p), skip: () => { setSkipped(true); setOutgoing(null); }, acceptOnTab, accept, resetOnFocus: () => setSkipped(false) };
}

export function RotatingSearchExample({ current, outgoing, accept, metricRef }: {
  current: CatalogSearchExample | undefined;
  outgoing: CatalogSearchExample | null;
  accept: () => void;
  metricRef?: (node: HTMLElement | null) => void;
}) {
  if (!current) return null;
  const text = (option: CatalogSearchExample) => `${option.category}: ${option.label}`;
  return <>
  <span className="catalog-search-example" aria-live="off" ref={metricRef}>
    {outgoing ? <span key={`out-${outgoing.key}`} aria-hidden="true" className="catalog-search-example__text catalog-search-example__text--out">{text(outgoing)}</span> : null}
    <span key={current.key} className={`catalog-search-example__text${outgoing ? " catalog-search-example__text--in" : ""}`}>{text(current)}</span>
  </span>
  <button type="button" className="catalog-search-example__accept"
    aria-label={`Usar recomendación: ${current.label}`} title={`Usar ${current.label}`}
    onMouseDown={event => event.preventDefault()} onClick={accept}>Usar</button>
  </>;
}
