import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, CATALOG_DATA_CHANGED_EVENT } from "./api";
import { clearCatalogReadCache } from "./catalogReadCache";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  /** El error original (ApiError incluida) para quien necesite sus detalles, p. ej. `movedTo`. */
  errorValue: unknown;
  reload: () => void;
}

/**
 * Carga de datos de solo lectura con estados loading/empty/error (FASE 8).
 * `deps` sigue la convención de useEffect: cambia la lista, se recarga.
 */
export function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [errorValue, setErrorValue] = useState<unknown>();
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  // Cancelar en el navegador no detiene la consulta en el servidor: si llega
  // un aviso de datos nuevos con una lectura en curso, se espera a que termine
  // y se lee una sola vez más, en vez de encimar consultas (cola de imágenes,
  // 2026-11-08: 100 decisiones encimaban cientos de lecturas de minutos).
  const inFlight = useRef(false);
  const stale = useRef(false);
  const loadRef = useRef<() => void>(() => undefined);

  const load = useCallback(() => {
    const current = ++generation.current;
    inFlight.current = true;
    stale.current = false;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setError(undefined);
    setErrorValue(undefined);
    const settle = () => {
      inFlight.current = false;
      if (stale.current) { stale.current = false; loadRef.current(); }
    };
    fetcher(nextController.signal).then(
      (result) => { if (current === generation.current) { setData(result); setLoading(false); settle(); } },
      (err: unknown) => {
        if (nextController.signal.aborted) return;
        if (current !== generation.current) return;
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la información.");
        setErrorValue(err);
        setLoading(false);
        settle();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  loadRef.current = load;
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => controller.current?.abort(), []);
  // Tras deshacer o rehacer un cambio, lo abierto se vuelve a leer: la ficha
  // restaurada reaparece y la retirada da su 404 sin recargar la página.
  useEffect(() => {
    const changed = () => { if (inFlight.current) stale.current = true; else load(); };
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, changed);
    return () => window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, changed);
  }, [load]);
  useEffect(() => {
    const changeSession = () => { setData(undefined); load(); };
    window.addEventListener("crv-session-changed", changeSession);
    return () => window.removeEventListener("crv-session-changed", changeSession);
  }, [load]);

  const reload = useCallback(() => { clearCatalogReadCache(); load(); }, [load]);
  return { data, loading, error, errorValue, reload };
}
