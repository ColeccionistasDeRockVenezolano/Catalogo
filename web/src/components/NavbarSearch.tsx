import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { TYPING_DEBOUNCE_MS } from "../lib/useDebouncedQuery";
import { CatalogSearchInput } from "./CatalogSearchInput";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Buscador global de la barra de escritorio: una lupa que se despliega en el
 * campo con sugerencias del catálogo. Enter lleva a los resultados completos
 * del Home. Se abre también con «/» o Ctrl/⌘ K.
 */
export function NavbarSearch() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [q, setQ] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { key } = useLocation();
  const query = value.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(query), TYPING_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useAsync((signal) => q ? searchApi.search(q, undefined, 20, signal) : Promise.resolve(null), [q]);

  // Elegir una sugerencia o ver todos los resultados cambia de página: el campo se recoge.
  useEffect(() => { setOpen(false); setValue(""); }, [key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.body.classList.contains("has-modal")) return;
      const shortcut = (event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey);
      if (shortcut || (event.key === "/" && !isTyping(event.target) && !event.altKey && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
        setOpen(true);
        formRef.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Un clic fuera del campo y de sus sugerencias lo recoge; lo escrito se conserva.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (formRef.current?.contains(target) || (target instanceof Element && target.closest(".catalog-suggestions-positioner"))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    setValue("");
    requestAnimationFrame(() => toggleRef.current?.focus());
  }

  function showAll() {
    if (query) navigate(`/?q=${encodeURIComponent(query)}`);
  }

  if (!open) {
    return (
      <button ref={toggleRef} type="button" className="navbar-search__toggle" onClick={() => setOpen(true)}
        aria-label="Buscar en el catálogo" aria-keyshortcuts="/ Control+K" title="Buscar (/ o Ctrl K)">
        <MagnifyingGlass size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <form ref={formRef} className="navbar-search" role="search" onSubmit={(event) => { event.preventDefault(); showAll(); }}
      onKeyDown={(event) => {
        // El primer Escape cierra las sugerencias; el siguiente, el campo.
        const suggestionsOpen = formRef.current?.querySelector("input")?.getAttribute("aria-expanded") === "true";
        if (event.key === "Escape" && !suggestionsOpen) close();
      }}>
      <MagnifyingGlass className="navbar-search__icon" size={18} aria-hidden="true" />
      <CatalogSearchInput scope="catalog" id="navbar-search" className="filter-input navbar-search__input" autoFocus
        label="Buscar en el catálogo" placeholder="Busca artistas, bandas, álbumes o canciones"
        value={value} onChange={setValue} examplePlacement="none"
        results={results.data ?? null} resultsQuery={q} resultsLoading={results.loading || query !== q} resultsError={results.error}
        onRetryResults={results.reload} onShowAllResults={showAll} />
      <button type="button" className="navbar-search__close" onClick={close} aria-label="Cerrar búsqueda">
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </form>
  );
}
