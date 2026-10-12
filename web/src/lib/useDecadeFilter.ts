import { useSearchParams } from "react-router-dom";

export type DecadeSelection = number | "without-year" | "before-1950" | null;

export function parseDecade(value: string | null): DecadeSelection {
  if (value === "antes-1950") return "before-1950";
  if (value === "sin-anio") return "without-year";
  if (!value || !/^\d{4}$/.test(value)) return null;
  const decade = Number(value);
  return decade >= 1900 && decade <= 2100 && decade % 10 === 0 ? decade : null;
}

export const decadeLabel = (value: Exclude<DecadeSelection, null>) =>
  value === "before-1950" ? "Antes de 1950" : value === "without-year" ? "Sin año" : `${value}–${value + 9}`;

export function useDecadeFilter(key = "decada", pageKey = "offset") {
  const [params, setParams] = useSearchParams();
  const selection = parseDecade(params.get(key));
  function select(value: DecadeSelection) {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value === null) next.delete(key);
      else next.set(key, value === "before-1950" ? "antes-1950" : value === "without-year" ? "sin-anio" : String(value));
      next.delete(pageKey);
      return next;
    });
  }
  const apiParams = selection === "before-1950" ? { beforeYear: 1950 } : selection === "without-year" ? { withoutYear: true } :
    selection === null ? {} : { decade: selection };
  return { selection, select, apiParams };
}
