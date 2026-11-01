// CRV · Murciélagos del nombre (efecto NOX «bats»).
//
// Port del jquery-halloween-bats que pasó Brian: sprite de 4 fotogramas y
// vuelo por inercia (velocidad deseada hacia un objetivo que cambia solo,
// suavizada con «flickering»), no una trayectoria dibujada de antemano.
//
//   original                     aquí
//   setInterval(move, 40)    →   reloj compartido del chat (`subscribeFrame`)
//   speed 20 px/tick         →   px por segundo equivalentes
//   flickering 20            →   constante de suavizado en ms
//   Math.random() > .95      →   reposicionamiento ~1,5 veces por segundo
//   setInterval(animate,200) →   avance de fotograma cada 200 ms
//
// El área de vuelo se recorta al viewport: en móvil el nombre está pegado al
// borde y, sin ese recorte, los murciélagos salían de la pantalla. Un escolta
// patrulla la esquina superior derecha en un óvalo; el primer hover suelta el
// enjambre (sale y se queda volando alrededor) y el segundo lo llama de
// vuelta: cada murciélago regresa a su letra y se apaga.
import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { subscribeFrame } from "../../lib/chatMotion";
import type { Quality } from "../../lib/chatEffects";

const SPRITE_FRAMES = 4;
const FRAME_MS = 200;
const FLICKER_MS = 700;
const RETARGET_RATE = 2.1;
const LEAVE_MS = 260;
const SCREEN_MARGIN = 8;

interface Region {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Bat {
  el: HTMLSpanElement;
  width: number;
  height: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  homeX: number;
  homeY: number;
  speed: number;
  frame: number;
  clock: number;
  homing: boolean;
  leavingAt: number | null;
}

interface World {
  host: HTMLSpanElement;
  label: HTMLSpanElement;
  layer: HTMLSpanElement;
  bounds: Region;
  escort: Bat;
  escortBounds: Region;
  escortOrbit: { cx: number; cy: number; rx: number; ry: number; theta: number };
  bats: Bat[];
  phase: "in" | "out" | "moving";
  boundsAt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Caja de vuelo alrededor del nombre, recortada al viewport: un nombre junto
 * al borde izquierdo no puede lanzar murciélagos fuera de la pantalla.
 */
function regionFor(host: HTMLSpanElement): Region {
  const rect = host.getBoundingClientRect();
  const padX = clamp(rect.width * 0.6, 34, 110);
  const padTop = clamp(rect.width * 0.18, 18, 34);
  const padBottom = clamp(rect.width * 0.2, 20, 44);
  const minX = Math.max(-padX, SCREEN_MARGIN - rect.left);
  const maxX = Math.min(rect.width + padX, window.innerWidth - SCREEN_MARGIN - rect.left);
  const minY = Math.max(-padTop, SCREEN_MARGIN - rect.top);
  const maxY = Math.min(rect.height + padBottom, window.innerHeight - SCREEN_MARGIN - rect.top);
  return { minX, maxX: Math.max(maxX, minX + 80), minY, maxY: Math.max(maxY, minY + 44) };
}

/** Óvalo del escolta sobre la esquina superior derecha, también dentro de pantalla. */
function orbitFor(host: HTMLSpanElement): { bounds: Region; orbit: World["escortOrbit"] } {
  const rect = host.getBoundingClientRect();
  const rx = 26;
  const ry = 16;
  const cx = Math.min(rect.width + 4, window.innerWidth - SCREEN_MARGIN - rect.left - rx - 12);
  const cy = Math.max(SCREEN_MARGIN - rect.top + ry + 12, -rect.height - ry - 4);
  const bounds: Region = {
    minX: cx - rx - 14,
    maxX: cx + rx + 14,
    minY: cy - ry - 12,
    maxY: cy + ry + 12,
  };
  return { bounds, orbit: { cx, cy, rx, ry, theta: Math.random() * Math.PI * 2 } };
}

function lineBoxes(label: HTMLElement, host: HTMLElement): Array<{ left: number; top: number; width: number; height: number }> {
  const box = host.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(label);
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 2 && rect.height > 2)
    .map((rect) => ({ left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height }));
  return rects.length ? rects : [{ left: 0, top: 0, width: Math.max(8, box.width), height: Math.max(8, box.height) }];
}

function batSize(width: number): { width: number; height: number } {
  const w = Math.round(width);
  return { width: w, height: Math.round(w * 20 / 35) };
}

function createBat(width: number): HTMLSpanElement {
  const size = batSize(width);
  const el = document.createElement("span");
  el.className = "nox-bat";
  el.setAttribute("aria-hidden", "true");
  el.style.width = `${size.width}px`;
  el.style.height = `${size.height}px`;
  // El sprite es una tira de 4 fotogramas de 35 × 20.
  el.style.backgroundSize = `${size.width}px ${size.height * SPRITE_FRAMES}px`;
  el.style.backgroundPosition = "0 0";
  return el;
}

function randomPoint(region: Region, width: number, height: number): { x: number; y: number } {
  const spanX = Math.max(1, region.maxX - region.minX - width);
  const spanY = Math.max(1, region.maxY - region.minY - height);
  return { x: region.minX + Math.random() * spanX, y: region.minY + Math.random() * spanY };
}

/** Inercia del original: acelera hacia el objetivo y se frena al acercarse. */
function steer(bat: Bat, region: Region, dt: number, retarget: boolean): void {
  if (retarget && !bat.homing && Math.random() < 1 - Math.exp(-RETARGET_RATE * dt / 1000)) {
    const point = randomPoint(region, bat.width, bat.height);
    bat.tx = point.x;
    bat.ty = point.y;
  }
  const dx = bat.tx - bat.x;
  const dy = bat.ty - bat.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const k = 1 - Math.exp(-dt / FLICKER_MS);
  bat.vx += (bat.speed * (dx / length) - bat.vx) * k;
  bat.vy += (bat.speed * (dy / length) - bat.vy) * k;
  bat.x += bat.vx * dt / 1000;
  bat.y += bat.vy * dt / 1000;
  // Rebote suave en el borde: el original se quedaba pegado al límite.
  if (bat.x < region.minX) { bat.x = region.minX; bat.vx = Math.abs(bat.vx) * 0.45; }
  if (bat.x > region.maxX - bat.width) { bat.x = region.maxX - bat.width; bat.vx = -Math.abs(bat.vx) * 0.45; }
  if (bat.y < region.minY) { bat.y = region.minY; bat.vy = Math.abs(bat.vy) * 0.45; }
  if (bat.y > region.maxY - bat.height) { bat.y = region.maxY - bat.height; bat.vy = -Math.abs(bat.vy) * 0.45; }
}

function paint(bat: Bat): void {
  bat.el.style.transform = `translate3d(${bat.x.toFixed(1)}px,${bat.y.toFixed(1)}px,0)`;
  bat.el.style.backgroundPositionY = `${-bat.frame * bat.height}px`;
}

function advanceFrame(bat: Bat, dt: number): void {
  bat.clock += dt;
  if (bat.clock < FRAME_MS) return;
  bat.clock %= FRAME_MS;
  bat.frame = (bat.frame + 1) % SPRITE_FRAMES;
  bat.el.style.backgroundPositionY = `${-bat.frame * bat.height}px`;
}

/** Ref del nombre, ref de las letras, capa del enjambre y disparador del vuelo. */
export function useBatSwarm(quality: Quality) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const worldRef = useRef<World | null>(null);

  useEffect(() => {
    const host = rootRef.current;
    const label = labelRef.current;
    const layer = layerRef.current;
    if (!host || !label || !layer) return undefined;

    const fontSize = Number.parseFloat(getComputedStyle(label).fontSize) || 14;
    const baseSize = batSize(clamp(fontSize * 2.6, 24, 44));
    const baseWidth = baseSize.width;
    const spriteHeight = baseSize.height;
    const animated = quality === "high" || quality === "medium";

    const bounds = regionFor(host);
    const { bounds: escortBounds, orbit: escortOrbit } = orbitFor(host);

    const escortEl = createBat(baseWidth);
    escortEl.classList.add("nox-bat-escort");
    layer.append(escortEl);
    const escortStart = { x: escortOrbit.cx + escortOrbit.rx, y: escortOrbit.cy - escortOrbit.ry };
    const escort: Bat = {
      el: escortEl, width: baseWidth, height: spriteHeight,
      x: escortStart.x, y: escortStart.y, vx: 0, vy: 0,
      tx: escortStart.x, ty: escortStart.y,
      homeX: escortStart.x, homeY: escortStart.y,
      speed: 150,
      frame: Math.floor(Math.random() * SPRITE_FRAMES), clock: 0,
      homing: false, leavingAt: null,
    };
    paint(escort);

    const world: World = {
      host, label, layer, bounds, escort, escortBounds, escortOrbit, bats: [], phase: "in",
      boundsAt: performance.now(),
    };
    worldRef.current = world;

    if (!animated) {
      return () => {
        world.bats.forEach((bat) => bat.el.remove());
        escortEl.remove();
        worldRef.current = null;
      };
    }

    let unsubscribe: (() => void) | null = null;
    const frame = (now: number, delta: number): void => {
      const dt = Math.min(64, delta);
      // La caja se recalcula si el nombre cambia de tamaño o la página se mueve.
      if (now - world.boundsAt > 400) {
        world.bounds = regionFor(host);
        const next = orbitFor(host);
        world.escortBounds = next.bounds;
        world.escortOrbit = { ...next.orbit, theta: world.escortOrbit.theta };
        world.boundsAt = now;
      }

      // El escolta persigue un punto que recorre un óvalo: se le ve volar.
      world.escortOrbit.theta += dt / 1000 * 1.6;
      world.escort.tx = world.escortOrbit.cx + Math.cos(world.escortOrbit.theta) * world.escortOrbit.rx;
      world.escort.ty = world.escortOrbit.cy + Math.sin(world.escortOrbit.theta) * world.escortOrbit.ry;
      steer(world.escort, world.escortBounds, dt, false);
      advanceFrame(world.escort, dt);
      paint(world.escort);

      for (const bat of world.bats) {
        if (bat.leavingAt !== null) continue;
        if (bat.homing) {
          bat.tx = bat.homeX;
          bat.ty = bat.homeY;
          if (Math.hypot(bat.x - bat.homeX, bat.y - bat.homeY) < 9) {
            bat.leavingAt = now;
            bat.el.classList.add("is-leaving");
            continue;
          }
        }
        steer(bat, world.bounds, dt, true);
        advanceFrame(bat, dt);
        paint(bat);
      }
      if (world.bats.some((bat) => bat.leavingAt !== null && now - bat.leavingAt > LEAVE_MS)) {
        world.bats = world.bats.filter((bat) => {
          if (bat.leavingAt !== null && now - bat.leavingAt > LEAVE_MS) {
            bat.el.remove();
            return false;
          }
          return true;
        });
      }
      if (world.phase === "moving" && !world.bats.length) world.phase = "in";
    };

    const start = (): void => { if (!unsubscribe) unsubscribe = subscribeFrame(frame); };
    const stop = (): void => { if (unsubscribe) { unsubscribe(); unsubscribe = null; } };
    start();

    // Fuera de pantalla no se pinta nada: el reloj queda libre para lo visible.
    const observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      });
    observer?.observe(host);

    return () => {
      stop();
      observer?.disconnect();
      world.bats.forEach((bat) => bat.el.remove());
      escortEl.remove();
      worldRef.current = null;
    };
  }, [quality]);

  const onPointerEnter = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    const world = worldRef.current;
    if (!world || event.pointerType === "touch") return;
    if (quality !== "high" && quality !== "medium") return;
    if (world.phase === "moving") return;

    if (world.phase === "in") {
      const fontSize = Number.parseFloat(getComputedStyle(world.label).fontSize) || 14;
      world.bounds = regionFor(world.host);
      world.boundsAt = performance.now();
      const boxes = lineBoxes(world.label, world.host);
      const totalWidth = boxes.reduce((sum, box) => sum + box.width, 0);
      // Un murciélago cada ~2 caracteres de ancho: nunca 3 o 4.
      const total = clamp(Math.ceil(totalWidth / Math.max(24, fontSize * 2.1)), 5, 14);
      const baseSize = batSize(clamp(fontSize * 2.6, 24, 44));
      const speed = clamp(world.bounds.maxX - world.bounds.minX, 110, 220);

      for (let index = 0; index < total; index += 1) {
        const box = boxes[index % boxes.length] ?? boxes[0]!;
        const size = batSize(baseSize.width * (0.82 + Math.random() * 0.4));
        const { width, height } = size;
        const el = createBat(width);
        const homeX = box.left + (0.1 + Math.random() * 0.8) * box.width - width / 2;
        const homeY = box.top + (0.25 + Math.random() * 0.5) * box.height - height / 2;
        el.style.transform = `translate3d(${homeX}px,${homeY}px,0)`;
        el.style.backgroundPositionY = "0";
        world.layer.append(el);
        const point = randomPoint(world.bounds, width, height);
        world.bats.push({
          el, width, height,
          x: homeX, y: homeY, vx: 0, vy: 0,
          tx: point.x, ty: point.y,
          homeX, homeY,
          speed: speed * (0.85 + Math.random() * 0.35),
          frame: Math.floor(Math.random() * SPRITE_FRAMES), clock: 0,
          homing: false, leavingAt: null,
        });
      }
      world.phase = "out";
      return;
    }

    // Segundo hover: vuelven a su letra y se apagan.
    world.phase = "moving";
    for (const bat of world.bats) {
      if (bat.leavingAt === null) bat.homing = true;
    }
  }, [quality]);

  return { rootRef, labelRef, layerRef, onPointerEnter };
}
