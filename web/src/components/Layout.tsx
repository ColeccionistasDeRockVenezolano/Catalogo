import { useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Books, CalendarStar, ChatCircle, House, Radio, UserCircle, type Icon } from "@phosphor-icons/react";
import { ADMIN_AREA, OperatorPill } from "./OperatorSettings";
import { SessionChangesHost, useSessionChangesContext } from "./ChangeFeedback";
import { useOperator } from "../lib/OperatorContext";
import { CatalogTabs } from "./CatalogTabs";
import { CatalogMenu } from "./CatalogMenu";
import { NavbarSearch } from "./NavbarSearch";
import { ScrollManager } from "./ScrollManager";
import { MOBILE_QUERY, TopbarToolsContext } from "./TopbarTools";
import { useMediaQuery } from "../lib/useMediaQuery";
import { SiteFooter } from "./SiteFooter";

interface NavItem { to: string; label: string; end?: boolean; icon: Icon; area?: RegExp }

// Historial y Administrar viven en el menú de la cuenta (OperatorPill); en
// móvil, en la página «Cuenta», último destino de la barra inferior.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: "/", label: "Home", end: true, icon: House },
  // Artistas, Discos, Personas y Organizaciones, con sus fichas y lo que cuelga de ellas.
  { to: "/artistas", label: "Catálogo", icon: Books, area: /^\/(artistas|discos|personas|organizaciones|lugares|series)(\/|$)/u },
  { to: "/efemerides", label: "Efemérides", icon: CalendarStar },
  { to: "/radio", label: "Radio", icon: Radio },
  { to: "/chat", label: "Chat", icon: ChatCircle, area: /^\/chat(\/|$)/u },
];

const CATALOG_LIST = /^\/(artistas|discos|personas|organizaciones)\/?$/u;

/** Móvil: la cuenta es un destino más de la barra inferior y abre su página. */
function AccountNavLink() {
  const { pathname } = useLocation();
  const { user } = useOperator();
  const pending = useSessionChangesContext()?.pending ?? 0;
  const initial = user ? user.name.trim().charAt(0).toUpperCase() || "?" : null;
  const label = `Cuenta${user ? ` de ${user.name}` : ""}${pending ? ` (${pending} cambios sin deshacer)` : ""}`;
  return (
    <NavLink to="/cuenta" aria-label={label}
      className={({ isActive }) => `nav-account${isActive || ADMIN_AREA.test(pathname) ? " active" : ""}`}>
      <span className="nav-account__icon" aria-hidden="true">
        {initial ? <span className="nav-account__avatar">{initial}</span> : <UserCircle className="nav-icon" weight="bold" />}
        {pending ? <span className="nav-account__count">{pending > 9 ? "9+" : pending}</span> : null}
      </span>
      <span className="nav-label">Cuenta</span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { isAdmin } = useOperator();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const topbarTools = useMemo(() => ({ slot: toolsSlot, setSearching }), [toolsSlot]);
  const hasGallery = /^\/(artistas(?:\/\d+)?|personas|discos|organizaciones)\/?$/.test(pathname);
  return (
    <SessionChangesHost enabled={isAdmin}><TopbarToolsContext.Provider value={topbarTools}>
      <ScrollManager />
      <header className={`topbar${searching ? " topbar--searching" : ""}`}>
        <div className="container topbar-row">
          <NavLink to="/" className="brand" aria-label="Coleccionistas de Rock Venezolano, inicio">
            <span className="brand-logo" aria-hidden="true">
              <img src={`${import.meta.env.BASE_URL}crv-logo.jpg`} alt="" width="160" height="160" />
            </span>
            <span className="brand-text" aria-hidden="true">
              <strong>Coleccionistas</strong>
              <span>de Rock Venezolano</span>
            </span>
          </NavLink>
          <nav className="main-nav" aria-label="Principal">
            {NAV_ITEMS.map((item) => item.area && !isMobile ? <CatalogMenu key={item.to} active={item.area.test(pathname)} /> : (
              <NavLink key={item.to} to={item.to} aria-label={item.label} {...(item.end === undefined ? {} : { end: item.end })} className={({ isActive }) => `${item.to === "/" ? "nav-home " : ""}${isActive || item.area?.test(pathname) ? "active" : ""}`}>
                {/* Iconos solo en la barra inferior del móvil: en escritorio, solo texto. */}
                {isMobile ? <item.icon className="nav-icon" aria-hidden="true" weight="bold" /> : null}
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
            {isMobile ? <AccountNavLink /> : null}
          </nav>
          {/* Móvil: la lupa y los filtros de la lista del catálogo abierta (MobileCatalogTools), a la derecha. */}
          <div className="topbar-tools-slot" ref={setToolsSlot} />
          {/* El Home ya tiene el buscador grande. */}
          {!isMobile && pathname !== "/" ? <NavbarSearch /> : null}
          {isMobile ? null : (
            <div className="topbar-actions">
              <OperatorPill />
            </div>
          )}
        </div>
      </header>
      <main>
        <div className={`container${hasGallery ? " container--gallery" : ""}`}>
          {/* Fuera del Suspense de la página: las pestañas no parpadean al cambiar de entidad. */}
          {CATALOG_LIST.test(pathname) ? <CatalogTabs /> : null}
          {children}
        </div>
      </main>
      <SiteFooter />
    </TopbarToolsContext.Provider></SessionChangesHost>
  );
}
