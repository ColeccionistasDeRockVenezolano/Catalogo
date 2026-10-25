import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { siteAppearanceApi } from "./api";
import type { CatalogTheme, SiteAppearance } from "../../../src/shared/site-appearance";

interface AppearanceContext {
  appearance: SiteAppearance | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (theme: CatalogTheme) => Promise<void>;
}
const Context = createContext<AppearanceContext | null>(null);

export function SiteAppearanceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [appearance, setAppearance] = useState<SiteAppearance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const writing = useRef(false);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const current = ++version.current;
    try {
      const value = await siteAppearanceApi.get();
      if (current === version.current) { setAppearance(value); setError(null); }
    } catch (reason) {
      if (current === version.current) setError(reason instanceof Error ? reason.message : "No se pudo cargar el tema del sitio.");
    } finally { if (current === version.current) setLoading(false); }
  }, []);
  const save = useCallback(async (theme: CatalogTheme) => {
    if (writing.current) return;
    writing.current = true;
    ++version.current;
    setSaving(true);
    try {
      const value = await siteAppearanceApi.update(theme);
      setAppearance(value);
      setError(null);
      setLoading(false);
    } finally { writing.current = false; setSaving(false); }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { ++version.current; };
  }, [pathname, refresh]);
  useEffect(() => {
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(wake, 60_000);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [refresh]);
  // Se aplica antes de pintar la ruta: Home y sus portales mantienen los tokens originales.
  useLayoutEffect(() => {
    document.documentElement.dataset.catalogTheme = pathname === "/" ? "current" : appearance?.catalogTheme ?? "current";
    return () => { delete document.documentElement.dataset.catalogTheme; };
  }, [pathname, appearance?.catalogTheme]);

  return <Context.Provider value={{ appearance, loading, saving, error, refresh, save }}>{children}</Context.Provider>;
}
export function useSiteAppearance() {
  const context = useContext(Context);
  if (!context) throw new Error("useSiteAppearance requiere SiteAppearanceProvider");
  return context;
}
