import { useId } from "react";
import type { CatalogSortValue } from "../lib/useCatalogSort";

export function CatalogSort({ kind, value, onChange }: {
  kind: "artist" | "album";
  value: CatalogSortValue;
  onChange: (value: CatalogSortValue) => void;
}) {
  const id = useId();
  const name = kind === "artist" ? "Nombre" : "Título";
  return (
    <div className="catalog-sort">
      <label htmlFor={id}>Ordenar por</label>
      <select id={id} className="filter-input" value={value} onChange={(event) => onChange(event.target.value as CatalogSortValue)}>
        <option value="name">{name}: A–Z</option>
        <option value="name_desc">{name}: Z–A</option>
        <option value="year_desc">{kind === "artist" ? "Formación: más reciente" : "Más recientes"}</option>
        <option value="year_asc">{kind === "artist" ? "Formación: más antigua" : "Más antiguos"}</option>
      </select>
    </div>
  );
}
