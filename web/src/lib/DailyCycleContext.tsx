import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { dailyClockApi } from "./api";
import { dailyCycleAt, type DailyCycle } from "../../../src/shared/daily-cycle";

interface ClockState { cycle: DailyCycle | undefined; error: string | undefined; retry: () => void; now: () => number | undefined }
const DailyCycleContext = createContext<ClockState | undefined>(undefined);

/** Un único reloj del servidor y un único temporizador de cambio para toda la aplicación. */
export function DailyCycleProvider({ children }: { children: ReactNode }) {
  const [cycle, setCycle] = useState<DailyCycle>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const clockAnchor = useRef<{ server: number; monotonic: number }>();
  const now = useCallback(() => clockAnchor.current ? clockAnchor.current.server + performance.now() - clockAnchor.current.monotonic : undefined, []);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let retryTimer: number | undefined;
    let anchor: { server: number; monotonic: number } | undefined;

    function schedule() {
      if (!anchor || disposed) return;
      window.clearTimeout(timer);
      // performance.now evita que un reloj local adelantado cambie las recomendaciones.
      const now = anchor.server + performance.now() - anchor.monotonic;
      const current = dailyCycleAt(new Date(now));
      setCycle(previous => previous?.date === current.date ? previous : current);
      timer = window.setTimeout(() => {
        schedule();
        void synchronize();
      }, Math.max(1, Date.parse(current.changesAt) - now));
    }

    async function synchronize() {
      controller?.abort();
      window.clearTimeout(retryTimer);
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 8000);
      const started = performance.now();
      try {
        const clock = await dailyClockApi.get(request.signal);
        if (disposed || controller !== request) return;
        anchor = { server: Date.parse(clock.serverNow) + (performance.now() - started) / 2, monotonic: performance.now() };
        clockAnchor.current = anchor;
        setError(undefined);
        schedule();
      } catch {
        if (disposed || controller !== request) return;
        setError("No se pudo sincronizar la selección del día.");
        retryTimer = window.setTimeout(() => { void synchronize(); }, 10_000);
      } finally { window.clearTimeout(timeout); }
    }
    function resume() { if (!document.hidden) { schedule(); void synchronize(); } }
    void synchronize();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [revision]);

  return <DailyCycleContext.Provider value={{ cycle, error, retry, now }}>{children}</DailyCycleContext.Provider>;
}

export function useDailyCycle(): ClockState {
  const clock = useContext(DailyCycleContext);
  if (!clock) throw new Error("useDailyCycle requiere DailyCycleProvider");
  return clock;
}
