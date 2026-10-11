// CRV · Formato de valores compartido por las fichas y los modales: el valor
// compacto de las previsualizaciones de fusión y las fechas de vida (las usan
// la ficha de la persona y la del proyecto solista, que muestra las de su
// titular).
import { parseDateValue, type DatePoint, type DateValue } from "../../../src/catalog/date-value";

export function formatMergeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function datePointText(point: DatePoint): string {
  const year = String(point.year).padStart(4, "0");
  const text = point.month === null ? year : `${point.day === null ? "" : `${point.day} de `}${MONTHS[point.month - 1]} de ${year}`;
  return `${text}${point.approximate ? " (aprox.)" : ""}`;
}
function parsedDate(value: string | null): DateValue | null {
  if (!value) return null;
  try { return parseDateValue(value); } catch { return null; }
}

/** Display the known precision; invalid legacy text remains visible as received. */
export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = parsedDate(value);
  if (!parsed) return value;
  if (parsed.kind === "point") return datePointText(parsed);
  if (!parsed.from) return `Hasta ${datePointText(parsed.to!)}`;
  if (!parsed.to) return `Desde ${datePointText(parsed.from)}`;
  return `Entre ${datePointText(parsed.from)} y ${datePointText(parsed.to)}`;
}

/** Años cumplidos entre el nacimiento y el fallecimiento (o hoy); null si falta una fecha completa. */
export function ageText(birth: string | null, death: string | null): string | null {
  const parse = (value: string | null) => {
    const point = parsedDate(value);
    return point?.kind === "point" && point.precision === "day" && !point.approximate
      ? { y: point.year, m: point.month!, d: point.day! } : null;
  };
  const from = parse(birth);
  if (!from) return null;
  const now = new Date();
  const knownDeath = parse(death);
  if (death && !knownDeath) return null;
  const to = knownDeath ?? { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const years = to.y - from.y - (to.m < from.m || (to.m === from.m && to.d < from.d) ? 1 : 0);
  return years >= 0 && years < 130 ? `${years} años` : null;
}
