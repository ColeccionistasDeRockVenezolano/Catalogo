import { NavLink } from "react-router-dom";
import { Buildings, Disc, User, UsersThree, type Icon } from "@phosphor-icons/react";

export const CATALOG_ENTITIES: ReadonlyArray<{ to: string; label: string; short?: string; hint: string; icon: Icon }> = [
  { to: "/artistas", label: "Artistas", hint: "Bandas, solistas y proyectos", icon: UsersThree },
  { to: "/discos", label: "Discos", hint: "Álbumes, EP, sencillos y más", icon: Disc },
  { to: "/personas", label: "Personas", hint: "Músicos, productores y técnicos", icon: User },
  { to: "/organizaciones", label: "Organizaciones", short: "Organiz.", hint: "Sellos, estudios y medios", icon: Buildings },
];

/** Las cuatro entidades del catálogo; «Catálogo» en el navbar abre Artistas. */
export function CatalogTabs() {
  return (
    <nav className="catalog-tabs" aria-label="Catálogo">
      {CATALOG_ENTITIES.map((entity) => (
        <NavLink key={entity.to} to={entity.to} end aria-label={entity.label} className={({ isActive }) => `catalog-tabs__tab${isActive ? " active" : ""}`}>
          <entity.icon className="catalog-tabs__icon" size={18} weight="bold" aria-hidden="true" />
          <span className="catalog-tabs__label">{entity.label}</span>
          <span className="catalog-tabs__label-short" aria-hidden="true">{entity.short ?? entity.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
