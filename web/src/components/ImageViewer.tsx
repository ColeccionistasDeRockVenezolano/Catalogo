import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, ArrowsInSimple, ArrowSquareOut, CaretLeft, CaretRight, ImagesSquare, MagnifyingGlassMinus, MagnifyingGlassPlus, SidebarSimple, TextAlignLeft, X } from "@phosphor-icons/react";
import { mediaImage } from "../lib/media";
import { warmImage } from "../lib/preloadImage";
import "../styles/image-viewer.css";

interface Point { x: number; y: number; }
interface View extends Point { zoom: number; }
const FIT: View = { zoom: 1, x: 0, y: 0 };

/** Visor de fotografías y portadas; el diálogo nativo gestiona foco e inercia del fondo. */
export function ImageViewer({ src, title, description, date, location, category, navigation, collectionTitle, onClose }: {
  src: string; title: string; description?: string | null; date?: string | null;
  location?: string | null; category?: string | null; onClose: () => void;
  collectionTitle?: string;
  navigation?: { index: number; items: Array<{ src: string; title: string }>; onSelect: (index: number) => void } | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const helpId = useId();
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"collection" | "photo">("collection");
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>(FIT);
  const current = useRef<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const pointers = useRef(new Map<number, Point>());
  const swipe = useRef<{ point: Point; time: number; zoom: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);
  const thumbnails = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const caption = useRef<HTMLDetailsElement>(null);
  const gesture = useRef<{ view: View; center: Point; distance: number } | null>(null);
  const fitScale = natural.width && size.width ? Math.min((size.width - 32) / natural.width, (size.height - 32) / natural.height, 1) : 0;
  const fitted = { width: natural.width * fitScale, height: natural.height * fitScale };
  const maxZoom = Math.max(8, fitScale ? 1 / fitScale : 8);
  const geometry = useRef({ ...fitted, stageWidth: size.width, stageHeight: size.height, maxZoom });
  geometry.current = { ...fitted, stageWidth: size.width, stageHeight: size.height, maxZoom };
  const ready = natural.width > 0 && fitScale > 0 && !failed;
  const canNavigate = !!navigation && navigation.items.length > 1;
  function cancelTap() {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null; lastTap.current = null;
  }
  function navigate(direction: number) {
    cancelTap();
    if (!navigation || !canNavigate) return;
    navigation.onSelect((navigation.index + direction + navigation.items.length) % navigation.items.length);
  }
  function openPanel(tab: typeof panelTab) { cancelTap(); setPanelTab(tab); setPanelOpen(true); }
  function togglePanel() { cancelTap(); setPanelOpen((open) => !open); }

  const update = useCallback((next: View) => {
    const box = geometry.current;
    const zoom = Math.min(box.maxZoom, Math.max(1, next.zoom));
    const limitX = Math.max(0, (box.width * zoom - box.stageWidth) / 2);
    const limitY = Math.max(0, (box.height * zoom - box.stageHeight) / 2);
    const value = { zoom, x: Math.min(limitX, Math.max(-limitX, next.x)), y: Math.min(limitY, Math.max(-limitY, next.y)) };
    current.current = value;
    setView(value);
  }, []);
  const zoomTo = useCallback((zoom: number, anchor: Point = { x: 0, y: 0 }) => {
    const before = current.current;
    const bounded = Math.max(1, Math.min(geometry.current.maxZoom, zoom));
    const ratio = bounded / before.zoom;
    update({ zoom: bounded, x: anchor.x - (anchor.x - before.x) * ratio, y: anchor.y - (anchor.y - before.y) * ratio });
  }, [update]);

  useLayoutEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const hadModal = document.body.classList.contains("has-modal");
    document.body.style.overflow = "hidden";
    document.body.classList.add("has-modal");
    node.showModal();
    node.querySelector<HTMLButtonElement>(".image-viewer__close")?.focus();
    return () => { cancelTap(); node.close(); document.body.style.overflow = overflow; if (!hadModal) document.body.classList.remove("has-modal"); previous?.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const node = stage.current!;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { update(current.current); }, [size.width, size.height, natural.width, natural.height, update]);
  useLayoutEffect(() => {
    setNatural({ width: 0, height: 0 }); setFailed(false); update(FIT);
    cancelTap();
    pointers.current.clear(); gesture.current = null; swipe.current = null; setDragging(false);
    if (caption.current) { caption.current.open = false; caption.current.scrollTop = 0; }
    panel.current?.querySelector<HTMLElement>(".image-viewer__photo-info")?.scrollTo(0, 0);
  }, [src, update]);
  // La anterior y la siguiente ya descargadas: al pasar de foto no queda el visor en blanco.
  const neighbors = navigation && navigation.items.length > 1 ? [-1, 1].map(step => navigation.items[(navigation.index + step + navigation.items.length) % navigation.items.length]?.src) : [];
  const [previousSrc, nextSrc] = neighbors;
  useEffect(() => {
    if (!ready) return;
    warmImage(nextSrc ? { src: nextSrc } : null);
    warmImage(previousSrc ? { src: previousSrc } : null);
  }, [ready, previousSrc, nextSrc]);
  useEffect(() => {
    if (!panelOpen) return;
    const rail = thumbnails.current;
    const selected = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (rail && selected) rail.scrollTo({ top: rail.scrollTop + selected.getBoundingClientRect().top - rail.getBoundingClientRect().top - rail.clientHeight / 2 + selected.offsetHeight / 2 });
  }, [navigation?.index, panelOpen, panelTab]);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    node.toggleAttribute("inert", !panelOpen);
    if (panelOpen) node.removeAttribute("aria-hidden"); else node.setAttribute("aria-hidden", "true");
  }, [panelOpen]);
  useEffect(() => {
    const node = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!geometry.current.width) return;
      const rect = node.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomTo(current.current.zoom * Math.exp(-delta * .002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [zoomTo]);

  const beginGesture = () => {
    const points = [...pointers.current.values()];
    if (!points[0]) { gesture.current = null; setDragging(false); return; }
    const center = points[1] ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
    gesture.current = { view: current.current, center, distance: points[1] ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0 };
    setDragging(true);
  };
  const pointOf = (event: ReactPointerEvent) => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };
  const release = (event: ReactPointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (start && event.type === "pointerup") {
      const end = pointOf(event), dx = end.x - start.point.x, dy = end.y - start.point.y;
      if (start.zoom <= 1.001 && current.current.zoom <= 1.001 && Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - start.time < 800) navigate(dx < 0 ? 1 : -1);
      else if (Math.hypot(dx, dy) < 10 && performance.now() - start.time < 400) {
        const previous = lastTap.current;
        if (previous && performance.now() - previous.time < 280 && Math.hypot(end.x - previous.point.x, end.y - previous.point.y) < 32) {
          cancelTap(); zoomTo(current.current.zoom > 1.001 ? 1 : Math.max(2, 1 / fitScale), end);
        } else {
          cancelTap(); lastTap.current = { point: end, time: performance.now() };
          if (canNavigate && current.current.zoom <= 1.001) tapTimer.current = setTimeout(() => navigate(end.x < 0 ? -1 : 1), 280);
        }
      }
    }
    if (!pointers.current.delete(event.pointerId)) return;
    beginGesture();
  };

  const tools = <div className="image-viewer__tools" role="group" aria-label="Controles de zoom">
    <button type="button" disabled={!ready || view.zoom <= 1.001} onClick={() => zoomTo(view.zoom / 1.3)} aria-label="Reducir zoom" title="Reducir (−)"><MagnifyingGlassMinus size={21} aria-hidden="true" /></button>
    <output aria-label="Nivel de zoom">{ready ? `${Math.round(fitScale * view.zoom * 100)}%` : "—"}</output>
    <button type="button" disabled={!ready || view.zoom >= maxZoom} onClick={() => zoomTo(view.zoom * 1.3)} aria-label="Aumentar zoom" title="Aumentar (+)"><MagnifyingGlassPlus size={21} aria-hidden="true" /></button>
    <span className="image-viewer__divider" />
    <button type="button" disabled={!ready} onClick={() => update(FIT)} aria-label="Ajustar a la pantalla" title="Ajustar a la pantalla (0)"><ArrowsInSimple size={20} aria-hidden="true" /><span>Ajustar</span></button>
    <button type="button" className="image-viewer__actual-size" disabled={!ready} onClick={() => zoomTo(1 / fitScale)} aria-label="Tamaño real (100%)" title="Tamaño real (1)">100%</button>
    {!navigation ? <a href={src} target="_blank" rel="noreferrer noopener" aria-label="Abrir imagen original en una nueva pestaña" title="Abrir original"><ArrowSquareOut size={20} aria-hidden="true" /></a> : null}
  </div>;

  return createPortal(
    <dialog ref={dialog} className={`image-viewer${navigation ? " image-viewer--light-table" : ""}`} aria-labelledby={titleId} aria-describedby={helpId}
      onCancel={(event) => { event.preventDefault(); close.current(); }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')].filter(node => node.tabIndex >= 0 && node.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = event.key;
        if (canNavigate && (key === "ArrowLeft" || key === "ArrowRight")) { event.preventDefault(); navigate(key === "ArrowRight" ? 1 : -1); return; }
        if (canNavigate && (key === "Home" || key === "End")) { event.preventDefault(); navigation?.onSelect(key === "Home" ? 0 : navigation.items.length - 1); return; }
        if (!ready) return;
        if (["+", "=", "-", "0", "1", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) event.preventDefault();
        if (key === "+" || key === "=") zoomTo(current.current.zoom * 1.3);
        if (key === "-") zoomTo(current.current.zoom / 1.3);
        if (key === "0") update(FIT);
        if (key === "1" && fitScale) zoomTo(1 / fitScale);
        if (key.startsWith("Arrow")) update({ ...current.current, x: current.current.x + (key === "ArrowLeft" ? 60 : key === "ArrowRight" ? -60 : 0), y: current.current.y + (key === "ArrowUp" ? 60 : key === "ArrowDown" ? -60 : 0) });
      }}>
      <header className="image-viewer__header">{navigation ? <span className="image-viewer__brand" aria-hidden="true">CRV<span>.</span></span> : null}<div className="image-viewer__heading"><h2 id={titleId}>{navigation ? collectionTitle || "Galería del artista" : title}</h2>{navigation ? <span>Galería del artista</span> : null}</div><button type="button" className="image-viewer__close" onClick={() => close.current()} aria-label="Cerrar visor de imagen" title="Cerrar (Esc)"><X size={24} aria-hidden="true" /></button></header>
      <div className="image-viewer__body"><div className="image-viewer__main">
      {navigation ? <div className="image-viewer__toolbar"><span role="status" aria-live="polite">Foto {navigation.index + 1} de {navigation.items.length}</span>{tools}</div> : null}
      <div className="image-viewer__canvas">
      <div ref={stage} className={`image-viewer__stage${ready && view.zoom > 1 ? " is-zoomed" : ""}${dragging ? " is-dragging" : ""}`}
        onPointerDown={(event) => { if (!ready || event.button !== 0) return; event.preventDefault(); if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; } event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, pointOf(event)); swipe.current = pointers.current.size === 1 ? { point: pointOf(event), time: performance.now(), zoom: current.current.zoom } : null; if (pointers.current.size > 1) cancelTap(); beginGesture(); }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId) || !gesture.current) return;
          pointers.current.set(event.pointerId, pointOf(event));
          const points = [...pointers.current.values()];
          const start = gesture.current;
          if (points[1] && start.distance) {
            const center = { x: (points[0]!.x + points[1].x) / 2, y: (points[0]!.y + points[1].y) / 2 };
            const distance = Math.hypot(points[1].x - points[0]!.x, points[1].y - points[0]!.y);
            const zoom = Math.max(1, Math.min(maxZoom, start.view.zoom * distance / start.distance));
            const ratio = zoom / start.view.zoom;
            update({ zoom, x: center.x - (start.center.x - start.view.x) * ratio, y: center.y - (start.center.y - start.view.y) * ratio });
          } else if (points[0]) update({ ...start.view, x: start.view.x + points[0].x - start.center.x, y: start.view.y + points[0].y - start.center.y });
        }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
        {!failed ? <img key={`${src}:${retry}`} src={src} alt={title} draggable={false}
          className={ready ? "is-ready" : undefined} style={{ width: fitted.width, height: fitted.height, transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
          onLoad={(event) => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFailed(false); }} onError={() => setFailed(true)} /> : null}
        {failed ? <div className="image-viewer__message" role="alert"><p>No se pudo cargar la imagen.</p><button type="button" onClick={() => { dialog.current?.querySelector<HTMLButtonElement>(".image-viewer__close")?.focus(); setFailed(false); setNatural({ width: 0, height: 0 }); update(FIT); setRetry((value) => value + 1); }}><ArrowClockwise size={18} />Reintentar</button></div> : !ready ? <p className="image-viewer__message" role="status">Cargando imagen…</p> : null}
      </div>
      </div>
      {navigation ? <div className="image-viewer__photo-bar"><h3>{title}</h3><div className="image-viewer__photo-actions"><button type="button" data-open-panel="collection" aria-controls={panelId} aria-expanded={panelOpen && panelTab === "collection"} onClick={() => openPanel("collection")}><ImagesSquare size={18} aria-hidden="true" />Colección <span>{navigation.items.length}</span></button><button type="button" data-open-panel="photo" aria-controls={panelId} aria-expanded={panelOpen && panelTab === "photo"} onClick={() => openPanel("photo")}><TextAlignLeft size={18} aria-hidden="true" />Sobre la foto</button></div>{canNavigate ? <div className="image-viewer__navigation"><button type="button" aria-label="Foto anterior" title="Foto anterior (←)" onClick={() => navigate(-1)}><CaretLeft size={24} /></button><button type="button" aria-label="Foto siguiente" title="Foto siguiente (→)" onClick={() => navigate(1)}><CaretRight size={24} /></button></div> : null}</div> : null}
      </div>
      {navigation ? <aside ref={panel} id={panelId} className={`image-viewer__panel image-viewer__panel--${panelTab}`} data-collapsed={panelOpen ? undefined : ""} aria-label="Archivo de imágenes"><div className="image-viewer__panel-top"><div role="tablist" aria-label="Explorar el archivo" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const next = event.key === "Home" ? "collection" : event.key === "End" ? "photo" : panelTab === "collection" ? "photo" : "collection";
        setPanelTab(next); dialog.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${panelId}-${next}-tab`)}`)?.focus();
      }}>{([ ["collection", "Colección"], ["photo", "Sobre la foto"] ] as const).map(([key, label]) => <button type="button" role="tab" key={key} id={`${panelId}-${key}-tab`} aria-selected={panelTab === key} aria-controls={`${panelId}-${key}`} tabIndex={panelTab === key ? 0 : -1} onClick={() => setPanelTab(key)}>{label}</button>)}</div></div>
        {panelTab === "collection" ? <div className="image-viewer__collection" role="tabpanel" id={`${panelId}-collection`} aria-labelledby={`${panelId}-collection-tab`}><div className="image-viewer__collection-heading"><h3>El archivo<span>.</span></h3><p>{navigation.items.length} {navigation.items.length === 1 ? "imagen" : "imágenes"}</p></div><nav ref={thumbnails} className="image-viewer__contacts" aria-label="Fotos de la galería" style={{ "--contact-rows": Math.min(4, Math.ceil(navigation.items.length / 2)) } as CSSProperties}>{navigation.items.map((item, index) => <button type="button" key={`${index}:${item.src}`} aria-label={`Ver foto ${index + 1}: ${item.title}`} aria-current={index === navigation.index ? "true" : undefined} onClick={() => { cancelTap(); navigation.onSelect(index); }}><img {...mediaImage(item.src, 160)} alt="" loading="lazy" /><span><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong></span></button>)}</nav></div> : <div className="image-viewer__photo-info" role="tabpanel" tabIndex={0} id={`${panelId}-photo`} aria-labelledby={`${panelId}-photo-tab`}><h3>{title}</h3>{category || date || location ? <dl>{category ? <div><dt>Categoría</dt><dd>{category}</dd></div> : null}{date ? <div><dt>Fecha</dt><dd><time dateTime={date}>{date.split("-").reverse().join("/")}</time></dd></div> : null}{location ? <div><dt>Lugar</dt><dd>{location}</dd></div> : null}</dl> : null}{description ? <p>{description}</p> : <p className="image-viewer__no-description">Esta foto aún no tiene una descripción registrada.</p>}<a href={src} target="_blank" rel="noreferrer noopener">Abrir imagen original<ArrowSquareOut size={19} aria-hidden="true" /></a></div>}
      </aside> : null}
      {navigation ? <button type="button" className="image-viewer__fold" onClick={togglePanel} aria-expanded={panelOpen} aria-controls={panelId} aria-label={panelOpen ? "Plegar el panel del archivo" : "Desplegar el panel del archivo"} title={panelOpen ? "Plegar panel" : "Desplegar panel"}><SidebarSimple size={20} aria-hidden="true" /><span>{panelOpen ? "Plegar" : "Archivo"}</span></button> : null}
      </div>
      <footer className="image-viewer__footer">
        {!navigation && (description || date || location || category) ? <details ref={caption} className="image-viewer__caption"><summary>Sobre la imagen</summary><div className="image-viewer__caption-body">
          {description ? <p>{description}</p> : null}
          <div>{category ? <span>{category}</span> : null}{date ? <time dateTime={date}>{date.split("-").reverse().join("/")}</time> : null}{location ? <span>{location}</span> : null}</div>
        </div></details> : null}
        {!navigation ? tools : null}
        <p id={helpId}>{canNavigate ? <>Toca a la derecha para avanzar y a la izquierda para volver<span className="image-viewer__desktop-help"> · ← → Cambiar foto · Rueda o pellizco para zoom · Doble toque para ampliar · Esc para cerrar</span></> : "Rueda o pellizco para zoom · Doble toque para ampliar · Esc para cerrar"}</p>
      </footer>
    </dialog>, document.body,
  );
}
