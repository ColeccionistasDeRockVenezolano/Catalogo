import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

interface Point { x: number; y: number; }
interface Drag { pointer: number; start: Point; origin: Point; moved: boolean; }
type DockSide = "left" | "right";

/**
 * El reproductor se arrastra libremente y, al soltarlo, se imanta al lateral
 * más cercano. El iframe nunca se remonta, así que no pierde la reproducción.
 */
export function useFloatingVideo(panel: RefObject<HTMLElement>, active: boolean) {
  const [expanded, setExpanded] = useState(false);
  const [side, setSide] = useState<DockSide>("right");
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const point = useRef<Point | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef<HTMLButtonElement | null>(null);
  const previousRect = useRef<{ rect: DOMRect; animate: boolean } | null>(null);
  const animation = useRef<Animation | null>(null);

  const bounds = useCallback(() => {
    const element = panel.current!;
    const viewport = window.visualViewport;
    const style = getComputedStyle(element);
    const edge = 12;
    const left = (viewport?.offsetLeft ?? 0) + edge + (parseFloat(style.getPropertyValue("--video-safe-left")) || 0);
    const top = (viewport?.offsetTop ?? 0) + edge + (parseFloat(style.getPropertyValue("--video-safe-top")) || 0);
    const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - edge - (parseFloat(style.getPropertyValue("--video-safe-right")) || 0);
    let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - edge - (parseFloat(style.getPropertyValue("--video-safe-bottom")) || 0);
    const nav = document.querySelector<HTMLElement>(".main-nav");
    if (nav && getComputedStyle(nav).position === "fixed") bottom = Math.min(bottom, nav.getBoundingClientRect().top - edge);
    element.style.maxHeight = `${Math.max(44, bottom - top)}px`;
    return { left, top, right: Math.max(left, right - element.offsetWidth), bottom: Math.max(top, bottom - element.offsetHeight) };
  }, [panel]);

  const dockedPoint = useCallback((nextSide = side) => {
    const limit = bounds();
    return { x: nextSide === "left" ? limit.left : limit.right, y: limit.bottom };
  }, [bounds, side]);

  const move = useCallback((next: Point) => {
    const limit = bounds();
    const value = { x: Math.min(limit.right, Math.max(limit.left, next.x)), y: Math.min(limit.bottom, Math.max(limit.top, next.y)) };
    point.current = value;
    setPosition(value);
    return value;
  }, [bounds]);

  const snap = useCallback((nextSide: DockSide, y = point.current?.y) => {
    const limit = bounds();
    setSide(nextSide);
    return move({ x: nextSide === "left" ? limit.left : limit.right, y: y ?? limit.bottom });
  }, [bounds, move]);

  function resize(open: boolean, animate = true) {
    if (open === expanded) return;
    const rect = panel.current?.getBoundingClientRect();
    if (rect) previousRect.current = { rect, animate };
    animation.current?.cancel();
    setExpanded(open);
  }

  useLayoutEffect(() => {
    if (!active || !panel.current) {
      setExpanded(false);
      setPinned(false);
      setSide("right");
      setPosition(null);
      point.current = null;
      drag.current = null;
      setDragging(false);
      previousRect.current = null;
      animation.current?.cancel();
      return;
    }
    const element = panel.current;
    const measure = () => {
      const old = previousRect.current;
      previousRect.current = null;
      let target = point.current ?? dockedPoint();
      if (old) {
        // Mantiene visible el punto de agarre al cambiar entre compacto y ampliado.
        target = { x: old.rect.x + (side === "right" ? old.rect.width - element.offsetWidth : 0), y: old.rect.y + (old.rect.y + old.rect.height > window.innerHeight / 2 ? old.rect.height - element.offsetHeight : 0) };
      }
      target = move(target);
      if (old?.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        animation.current = element.animate([
          { transform: `translate3d(${old.rect.x}px, ${old.rect.y}px, 0) scale(${old.rect.width / element.offsetWidth}, ${old.rect.height / element.offsetHeight})` },
          { transform: `translate3d(${target.x}px, ${target.y}px, 0)` },
        ], { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      animation.current?.cancel();
      element.style.removeProperty("max-height");
    };
  }, [active, expanded, panel, bounds, dockedPoint, move, side]);

  // Un vistazo ampliado no debe quedarse ocupando la pantalla por accidente.
  // La chincheta convierte explícitamente ese tamaño en una preferencia temporal.
  useEffect(() => {
    if (!active || !expanded || pinned) return;
    const minimizeOutside = (event: globalThis.PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      resize(false, true);
    };
    document.addEventListener("pointerdown", minimizeOutside, true);
    return () => document.removeEventListener("pointerdown", minimizeOutside, true);
  }, [active, expanded, pinned, panel]);

  const gestures = {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (!event.isPrimary || event.button !== 0 || !active) return;
      animation.current?.cancel();
      suppressClick.current = null;
      drag.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: point.current ?? dockedPoint(), moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.start.x;
      const dy = event.clientY - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) < 6) return;
      current.moved = true;
      suppressClick.current = event.currentTarget;
      setDragging(true);
      move({ x: current.origin.x + dx, y: current.origin.y + dy });
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (!current.moved) return;
      const viewport = window.visualViewport;
      const middle = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) / 2;
      snap(event.clientX < middle ? "left" : "right");
    },
    onPointerCancel() { drag.current = null; suppressClick.current = null; setDragging(false); },
    onLostPointerCapture() { drag.current = null; setDragging(false); },
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      const direction = directions[event.key];
      if (!direction || !active) return;
      event.preventDefault();
      animation.current?.cancel();
      const origin = point.current ?? dockedPoint();
      const step = event.shiftKey ? 48 : 16;
      move({ x: origin.x + direction.x * step, y: origin.y + direction.y * step });
    },
  };

  return { expanded, pinned, dragging, resize, gestures,
    togglePinned: () => setPinned(value => !value),
    style: position ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` } : undefined,
    onClickCapture(event: React.MouseEvent) {
      const target = suppressClick.current;
      suppressClick.current = null;
      if (target && event.detail !== 0 && event.target instanceof Node && target.contains(event.target)) {
        event.preventDefault(); event.stopPropagation();
      }
    },
  };
}
