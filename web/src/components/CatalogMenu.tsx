import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CaretDown } from "@phosphor-icons/react";
import { catalogApi, CATALOG_DATA_CHANGED_EVENT, type CatalogOverview } from "../lib/api";
import { CATALOG_ENTITIES } from "./CatalogTabs";
import { formatCount } from "./ListFilters";

const decadeName = (decade: number) => `Años ${decade < 2000 ? String(decade).slice(2) : decade}`;

/**
 * «Catálogo» en la barra de escritorio: abre un menú con las cuatro entidades,
 * sus totales y atajos a listas filtradas. Se abre al pasar el ratón o con un
 * clic/toque; Escape, un clic fuera o cambiar de página lo cierran.
 */
export function CatalogMenu({ active }: { active: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CatalogOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef(0);
  // Abierto al pasar el ratón: se cierra al salir y un clic lo fija en vez de cerrarlo.
  const byHover = useRef(false);
  const { key } = useLocation();

  function prefetch() {
    setFailed(false);
    catalogApi.overview(AbortSignal.timeout(10_000)).then(setData, () => setFailed(true));
  }

  useEffect(() => { setOpen(false); }, [key]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    const invalidate = () => { setData(null); if (open) prefetch(); };
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, invalidate);
    return () => window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, invalidate);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    prefetch();
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={rootRef} className={`nav-menu${open ? " is-open" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(hoverTimer.current);
        prefetch();
        if (!open) { byHover.current = true; setOpen(true); }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" || !byHover.current) return;
        hoverTimer.current = window.setTimeout(() => setOpen(false), 160);
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={triggerRef} type="button" className={`nav-menu__trigger${active ? " active" : ""}`} aria-label="Catálogo"
        aria-expanded={open} aria-controls={id}
        onClick={() => {
          if (open && byHover.current) { byHover.current = false; return; }
          byHover.current = false;
          setOpen(!open);
        }}>
        <span className="nav-label">Catálogo</span>
        <CaretDown className="nav-menu__caret" size={12} weight="bold" aria-hidden="true" />
      </button>
      <div id={id} className="mega" hidden={!open}>
        <ul className="mega__entities" aria-label="Entidades del catálogo">
          {CATALOG_ENTITIES.map((entity) => (
            <li key={entity.to}>
              <Link to={entity.to} className="mega__entity">
                <span className="mega__entity-icon" aria-hidden="true"><entity.icon size={20} weight="bold" /></span>
                <span className="mega__entity-text"><strong>{entity.label}</strong><small>{entity.hint}</small></span>
                <span className="mega__entity-count">{data ? formatCount(data.totals[entity.to] ?? 0) : !failed && <span className="mega__skeleton" aria-hidden="true" />}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mega__side">
          {failed ? <div role="status">
            <p>No se pudieron cargar los datos del catálogo.</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={prefetch}>Reintentar</button>
          </div> : <>
          <h3 className="mega__heading">Artistas por género</h3>
          <div className="mega__tags">
            {data ? data.genres.map((genre) => <Link key={genre.slug} to={`/artistas?genero=${encodeURIComponent(genre.slug)}`}>{genre.name}</Link>)
              : Array.from({ length: 6 }, (_, index) => <span key={index} className="mega__skeleton mega__skeleton--tag" aria-hidden="true" />)}
          </div>
          <h3 className="mega__heading">Discos por década</h3>
          <div className="mega__tags">
            {data ? data.decades.map((decade) => <Link key={decade} to={`/discos?decada=${decade}`}>{decadeName(decade)}</Link>)
              : Array.from({ length: 5 }, (_, index) => <span key={index} className="mega__skeleton mega__skeleton--tag" aria-hidden="true" />)}
          </div>
          </>}
        </div>
      </div>
    </div>
  );
}
