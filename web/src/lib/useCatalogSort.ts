import { useSearchParams } from "react-router-dom";

export type CatalogSortValue = "name" | "name_desc" | "year_desc" | "year_asc";

export function useCatalogSort() {
  const [params, setParams] = useSearchParams();
  const value = params.get("orden");
  const sort: CatalogSortValue = value === "name_desc" || value === "year_desc" || value === "year_asc" ? value : "name";
  function selectSort(next: CatalogSortValue) {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next === "name") updated.delete("orden"); else updated.set("orden", next);
      updated.delete("offset");
      return updated;
    });
  }
  return { sort, selectSort };
}
