import { afterEach, describe, expect, it, vi } from "vitest";

// El reloj se prueba sin montar React ni simular cada fotograma de un efecto.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("reloj compartido del chat", () => {
  async function clock() {
    const callbacks = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("requestAnimationFrame", vi.fn((fn: FrameRequestCallback) => {
      callbacks.set(++sequence, fn); return sequence;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
    const module = await import("../../src/lib/chatMotion");
    const frame = (now: number) => {
      const queued = [...callbacks.values()]; callbacks.clear();
      queued.forEach((fn) => fn(now));
    };
    return { ...module, callbacks, doc, frame };
  }

  it("dos renderers comparten un solo rAF y el último apagado cancela el reloj", async () => {
    const c = await clock();
    const first = vi.fn(); const second = vi.fn();
    const stopFirst = c.subscribeFrame(first); const stopSecond = c.subscribeFrame(second);
    expect(c.callbacks.size).toBe(1);
    c.frame(performance.now() + 17);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    expect(c.callbacks.size).toBe(1);
    stopFirst(); expect(c.clockSubscribers()).toBe(1);
    stopSecond(); expect(c.callbacks.size).toBe(0); expect(c.clockSubscribers()).toBe(0);
  });

  it("cambiar de renderer dentro de un fotograma no crea dos relojes", async () => {
    const c = await clock(); const render = vi.fn(); let stopSecond: (() => void) | undefined;
    const stopFirst = c.subscribeFrame(() => { stopFirst(); stopSecond = c.subscribeFrame(render); });
    c.frame(performance.now() + 17); expect(c.callbacks.size).toBe(1);
    c.frame(performance.now() + 34); expect(render).toHaveBeenCalledTimes(1);
    stopSecond?.(); expect(c.callbacks.size).toBe(0);
  });

  it("suspende una pestaña oculta y limita el salto temporal al volver", async () => {
    const c = await clock(); const render = vi.fn(); const stop = c.subscribeFrame(render);
    c.doc.hidden = true; c.doc.dispatchEvent(new Event("visibilitychange"));
    expect(c.callbacks.size).toBe(0);
    c.doc.hidden = false; c.doc.dispatchEvent(new Event("visibilitychange"));
    expect(c.callbacks.size).toBe(1);
    c.frame(performance.now() + 60_000);
    expect(render.mock.calls[0]?.[1]).toBeLessThanOrEqual(64);
    stop();
  });
});
