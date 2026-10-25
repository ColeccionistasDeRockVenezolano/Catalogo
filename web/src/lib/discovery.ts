import { useCallback, useEffect, useMemo, useState } from "react";
import { CATALOG_DATA_CHANGED_EVENT, discoveryApi } from "./api";
import type { CatalogSearchExample } from "./catalogSearchExamples";
import { dailyRandom, type DailyCycle } from "../../../src/shared/daily-cycle";
import { useDailyCycle } from "./DailyCycleContext";
export const DISCOVERY_FALLBACK = "Busca artistas, bandas, álbumes o canciones";
export interface DiscoveryResponse {
  dailyCycle?: DailyCycle;
  enabled: boolean; intervalMs: number; refreshMs: number; fallback: string; groupPolicy: string[];
  metrics?: { enabled: boolean; visibleMs: number; attributionMs: number };
  suggestions: { id: number; name: string; group: string; priority: number; validUntil: string | null; metricTicket?: string }[];
}
/** Turnos por grupo y permutación ponderada por prioridad editorial.
 * Todos los artistas aparecen una vez por vuelta: la prioridad adelanta,
 * no excluye ni expresa popularidad. */
export function discoveryExamples(data: DiscoveryResponse, random = dailyRandom(data.dailyCycle?.date ?? "", "discovery")): CatalogSearchExample[] {
  if (!data.enabled) return [];
  const unique = [...new Map(data.suggestions.map(s => [s.id, s])).values()];
  const groups = new Map<string, typeof unique>();
  const scored = unique.map(s => ({ s, score: -Math.log(Math.max(Number.EPSILON, random())) / s.priority }));
  scored.sort((a,b) => a.score-b.score);
  for (const { s } of scored) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  const policy = [...data.groupPolicy, ...[...groups.keys()].filter(g => !data.groupPolicy.includes(g))];
  const result: CatalogSearchExample[] = [];
  while ([...groups.values()].some(g => g.length)) for (const group of policy) {
    const s = groups.get(group)?.shift();
    if (s) result.push({ key: `artist-${s.id}`, label: s.name, category: "Artista", ...(s.metricTicket ? { metricTicket: s.metricTicket } : {}) });
  }
  return result;
}
export function useDiscoveryExamples(active: boolean) {
  const { cycle: dailyCycle, now: serverNow } = useDailyCycle();
  const date = dailyCycle?.date;
  const [data, setData] = useState<DiscoveryResponse>();
  const [order, setOrder] = useState<CatalogSearchExample[]>([]);
  const [now, setNow] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  useEffect(() => {
    if (!active || !date) return;
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: number | undefined;
    async function refresh() {
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const timeout = window.setTimeout(() => requestController.abort(), 8000);
      try {
        const result = await discoveryApi.suggestions(requestController.signal, date);
        if (disposed || controller !== requestController) return;
        setData(result); setExpiresAt(performance.now() + result.refreshMs); setNow(serverNow() ?? 0);
        // Una vuelta conserva su orden entre renovaciones; admite cambios de nombre.
        setOrder(() => {
          const next = discoveryExamples(result);
          return next;
        });
      } catch {
        if (!disposed && controller === requestController) { setData(undefined); setOrder([]); setExpiresAt(0); }
      } finally {
        window.clearTimeout(timeout);
        if (!disposed && controller === requestController) timer = window.setTimeout(() => { void refresh(); }, 10000);
      }
    }
    function revalidate() { if (!document.hidden) { setExpiresAt(0); void refresh(); } }
    void refresh();
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const clock = window.setInterval(() => setNow(serverNow() ?? 0), 1000);
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); window.clearInterval(clock);
      window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [active, date, serverNow]);
  const eligibleKeys = data?.suggestions.filter(s => !s.validUntil || Date.parse(s.validUntil)>now).map(s => `artist-${s.id}`).join(",") ?? "";
  const fresh = active && Boolean(date) && data?.dailyCycle?.date === date && performance.now() < expiresAt;
  const options = useMemo(() => {
    const eligible = new Set(eligibleKeys.split(","));
    return fresh ? order.filter(e => eligible.has(e.key)) : [];
  }, [fresh, order, eligibleKeys]);
  const cycle = useCallback((firstKey?: string) => {
    if (!data) return;
    const next = discoveryExamples(data);
    // La rotación acaba de mostrar la primera fila de la siguiente vuelta.
    // Anclarla conserva una visita por artista al recorrer el orden renovado.
    setOrder([...next.filter(e => e.key === firstKey), ...next.filter(e => e.key !== firstKey)]);
  }, [data]);
  return { options, intervalMs: data?.intervalMs ?? 5000, cycle, metricsEnabled: fresh && Boolean(data?.metrics?.enabled) };
}
