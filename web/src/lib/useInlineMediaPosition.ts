import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Position a persistent player over its page slot without moving the iframe DOM. */
export function useInlineMediaPosition(panel: RefObject<HTMLElement>, slot: HTMLElement | undefined, enabled: boolean) {
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!slot || !enabled || !panel.current) return;
    const element = panel.current;
    const previousHeight = slot.style.height;
    let frame = 0;
    const measure = () => {
      const rect = slot.getBoundingClientRect();
      setPosition({ top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
      slot.style.height = `${element.getBoundingClientRect().height}px`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(slot); observer.observe(element); observer.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); slot.style.height = previousHeight; };
  }, [slot, enabled, panel]);
  return position;
}
