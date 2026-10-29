// CRV · Motor de animación del chat: un reloj y un presupuesto.
//
// 1. Un solo `requestAnimationFrame` para toda la página. Partículas, escenas
//    y cualquier dibujo por fotograma se suscriben aquí; con cero suscriptores
//    el reloj se apaga y con la pestaña oculta se detiene.
// 2. El presupuesto de animaciones caras se reparte solo entre lo que está en
//    pantalla (`IntersectionObserver`). Un nombre que sale por arriba al hacer
//    scroll libera su hueco y el siguiente visible que esperaba lo recibe.
//    Lo que no tiene hueco se pinta en su versión estática.
import { useEffect, useState, type RefObject } from "react";
import type { Quality } from "./chatEffects";

// ── Reloj compartido ───────────────────────────────────────────────────────
export type FrameCallback = (now: number, delta: number) => void;

const subscribers = new Set<FrameCallback>();
let rafId = 0;
let lastTick = 0;
let inTick = false;

function tick(now: number): void {
  rafId = 0;
  inTick = true;
  const delta = Math.min(64, now - lastTick);
  lastTick = now;
  for (const callback of [...subscribers]) {
    try {
      callback(now, delta);
    } catch (error) {
      // Un efecto roto no puede parar el reloj de los demás.
      subscribers.delete(callback);
      // eslint-disable-next-line no-console -- el fallo de un renderer debe ser diagnosticable
      console.error("[chat] efecto retirado del reloj", error);
    }
  }
  inTick = false;
  rafId = subscribers.size > 0 && !document.hidden ? requestAnimationFrame(tick) : 0;
}

function startClock(): void {
  if (inTick || rafId || subscribers.size === 0 || typeof document === "undefined" || document.hidden) return;
  lastTick = performance.now();
  rafId = requestAnimationFrame(tick);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      startClock();
    }
  });
}

export function subscribeFrame(callback: FrameCallback): () => void {
  subscribers.add(callback);
  startClock();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) { cancelAnimationFrame(rafId); rafId = 0; }
  };
}

/** Suscriptores activos (para pruebas y medición). */
export function clockSubscribers(): number {
  return subscribers.size;
}

// ── Presupuesto por visibilidad ────────────────────────────────────────────
/** Animaciones caras simultáneas por nivel. «reduced» solo tiene las suaves. */
export const MOTION_BUDGET: Record<Quality, number> = { low: 0, reduced: 4, medium: 8, high: 16 };

interface Claim {
  /** false: solo se observa la visibilidad (para pausar su CSS fuera de pantalla). */
  wants: boolean;
  cost: number;
  /** 2 = probador de la tienda: siempre recibe hueco. */
  priority: number;
  order: number;
  visible: boolean;
  granted: boolean;
  quality: Quality;
  element: Element | null;
  notify: (granted: boolean) => void;
}

const claims = new Set<Claim>();
const byElement = new Map<Element, Claim>();
let used = 0;
let order = 0;
let scheduled = false;
let observer: IntersectionObserver | null = null;
let motionScope: Element | null = null;

/** Una hoja abierta dedica el presupuesto al contenido de esa hoja. */
export function setMotionScope(element: Element | null): void {
  motionScope = element;
  scheduleRebalance();
}


function budgetFor(quality: Quality): number {
  return MOTION_BUDGET[quality];
}

function rebalance(): void {
  scheduled = false;
  used = 0;
  const ranked = [...claims].sort((a, b) => b.priority - a.priority || a.order - b.order);
  for (const claim of ranked) {
    const visible = claim.visible && !document.hidden
      && (!motionScope || Boolean(claim.element && motionScope.contains(claim.element)));
    const budget = budgetFor(claim.quality);
    const granted = claim.wants && visible && budget > 0
      && (claim.priority >= 2 || used + claim.cost <= budget);
    if (granted) used += claim.cost;
    claim.granted = granted;
    claim.notify(granted);
  }
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", scheduleRebalance);

function scheduleRebalance(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(rebalance);
}

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const claim = byElement.get(entry.target);
      if (!claim || claim.visible === entry.isIntersecting) continue;
      claim.visible = entry.isIntersecting;
    }
    scheduleRebalance();
  }, { rootMargin: "0px" });
  return observer;
}

/** Estado del hueco de un efecto: si anima y si está en pantalla. */
export interface MotionSlot {
  granted: boolean;
  visible: boolean;
}

/**
 * Pide un hueco del presupuesto para el elemento de `ref`. Sin `ref` (fondo o
 * ambiente de la sala) se considera siempre visible.
 */
export function useMotionSlot(
  ref: RefObject<Element | null> | null,
  cost: number,
  enabled: boolean,
  quality: Quality,
  priority = 1,
): MotionSlot {
  const [state, setState] = useState<MotionSlot>({ granted: false, visible: true });

  useEffect(() => {
    const element = ref?.current ?? null;
    const wants = enabled && budgetFor(quality) > 0;
    if (!wants && !element) {
      setState({ granted: false, visible: true });
      return;
    }
    const claim: Claim = {
      element, wants, cost: Math.max(1, cost), priority, order: order += 1, visible: element === null, granted: false, quality,
      notify: (granted) => setState((current) => (
        current.granted === granted && current.visible === (claim.visible && !document.hidden
          && (!motionScope || Boolean(element && motionScope.contains(element)))) ? current : {
          granted, visible: claim.visible && !document.hidden && (!motionScope || Boolean(element && motionScope.contains(element))),
        }
      )),
    };
    if (!wants) setState((current) => (current.granted ? { ...current, granted: false } : current));
    claims.add(claim);
    const io = element ? sharedObserver() : null;
    if (element && io) {
      byElement.set(element, claim);
      io.observe(element);
    } else {
      claim.visible = true;
    }
    scheduleRebalance();
    return () => {
      claims.delete(claim);
      if (element) {
        byElement.delete(element);
        io?.unobserve(element);
      }
      if (claim.granted) used = Math.max(0, used - claim.cost);
      claim.granted = false;
      scheduleRebalance();
    };
  }, [ref, cost, enabled, quality, priority]);

  return state;
}

/** Huecos en uso (para pruebas y medición en el navegador). */
export function motionUsage(): { used: number; claims: number; granted: number } {
  return { used, claims: claims.size, granted: [...claims].filter((claim) => claim.granted).length };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)["__crvMotion"] = { motionUsage, clockSubscribers };
}
