import { useEffect, useRef, useState } from "react";
import { discoveryApi } from "./api";
import type { CatalogSearchExample } from "./catalogSearchExamples";

// Solo memoria de esta pestaña. Sin cookies analíticas, localStorage, query,
// referrer, IP, user-agent ni identificadores de cuenta en los eventos.
let clientId: string | undefined;
const client = () => clientId ??= crypto.randomUUID();
type Handle = { example: CatalogSearchExample; receipt: Promise<string | undefined> };
type Attribution = { key: string; label: string; expires: number; search: boolean; visit: boolean; chain: Promise<string | undefined> };
let attribution: Attribution | undefined;
export function clearDiscoveryAttribution() { attribution = undefined; }
const normalize = (value: string) => value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

function impression(example: CatalogSearchExample): Handle {
  const receipt = discoveryApi.event({ id: crypto.randomUUID(), client: client(), kind: "impression", token: example.metricTicket!, visibleMs: 1000 })
    .then(result => result.receipt).catch(() => undefined);
  return { example, receipt };
}
function acceptance(handle: Handle) {
  const current: Attribution = { key: handle.example.key, label: handle.example.label, expires: Date.now()+900000, search: false, visit: false,
    chain: handle.receipt.then(async token => {
      if (!token) return;
      const result = await discoveryApi.event({ id: crypto.randomUUID(), client: client(), kind: "acceptance", token });
      return ["recorded","deduplicated"].includes(result.status) ? token : undefined;
    }).catch(() => undefined) };
  attribution = current;
}
/** Una búsqueda por aceptación: consulta exacta y resultados cargados;
 * editarla elimina atribución, sin registrar el texto. */
export function recordDiscoverySearch(query: string) {
  const current = attribution;
  if (!current || current.expires <= Date.now()) { clearDiscoveryAttribution(); return; }
  if (normalize(query) !== normalize(current.label)) { clearDiscoveryAttribution(); return; }
  if (current.search) return;
  current.search = true;
  current.chain = current.chain.then(async token => {
    if (!token) return;
    const result = await discoveryApi.event({ id: crypto.randomUUID(), client: client(), kind: "search", token });
    return ["recorded","deduplicated"].includes(result.status) ? token : undefined;
  }).catch(() => undefined);
}
export function recordDiscoveryVisit(artistId: number) {
  const current = attribution;
  if (!current || !current.search || current.visit || current.expires <= Date.now() || current.key !== `artist-${artistId}`) return;
  current.visit = true;
  current.chain = current.chain.then(async token => {
    if (!token) return;
    await discoveryApi.event({ id: crypto.randomUUID(), client: client(), kind: "visit", token });
    return token;
  }).catch(() => undefined);
}

export function useVisibleDiscoveryMetric(example: CatalogSearchExample | undefined, enabled: boolean) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const latest = useRef(example); latest.current = example;
  const handle = useRef<Handle>();
  const key = example?.key;
  useEffect(() => {
    handle.current = undefined;
    if (!enabled || !node || !key || !latest.current?.metricTicket || !globalThis.IntersectionObserver || !crypto.randomUUID) return;
    let intersection = false, recorded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inViewport = () => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      const width = Math.max(0,Math.min(rect.right,innerWidth)-Math.max(rect.left,0));
      const height = Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0));
      return rect.width>0 && rect.height>0 && width*height/(rect.width*rect.height)>=0.5
        && style.visibility==="visible" && style.display!=="none" && Number(style.opacity)>0;
    };
    const update = () => {
      clearTimeout(timer);
      if (recorded || document.hidden || !intersection || !inViewport()) return;
      timer = setTimeout(() => {
        const candidate = latest.current;
        if (!document.hidden && intersection && inViewport() && candidate?.key === key && candidate.metricTicket) {
          recorded = true; handle.current = impression(candidate);
        }
      }, 1000);
    };
    const observer = new IntersectionObserver(entries => {
      intersection = Boolean(entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.5); update();
    }, { threshold: [0,0.5,1] });
    observer.observe(node);
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", update); handle.current = undefined; };
  }, [node,key,enabled]);
  return { ref: setNode, accept: () => { if (enabled && !document.hidden && handle.current && handle.current.example.key === key) acceptance(handle.current); } };
}

export function useDiscoverySearchMetric(query: string, resultsReady: boolean, enabled: boolean) {
  useEffect(() => {
    if (!enabled) { clearDiscoveryAttribution(); return; }
    if (attribution && normalize(query) !== normalize(attribution.label)) { clearDiscoveryAttribution(); return; }
    if (!resultsReady || !query) return;
    const search = () => { if (!document.hidden) recordDiscoverySearch(query); };
    search(); document.addEventListener("visibilitychange",search);
    return () => document.removeEventListener("visibilitychange",search);
  }, [query,resultsReady,enabled]);
}
export function useDiscoveryVisitMetric(artistId: number, loaded: boolean, enabled: boolean) {
  useEffect(() => {
    if (!enabled) { clearDiscoveryAttribution(); return; }
    if (!loaded) return;
    const visit = () => { if (!document.hidden) recordDiscoveryVisit(artistId); };
    visit(); document.addEventListener("visibilitychange",visit);
    return () => document.removeEventListener("visibilitychange",visit);
  }, [artistId,loaded,enabled]);
}
