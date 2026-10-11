/** Calendar precision is data; year/month values never become invented days. */
export interface DatePoint {
  kind: "point";
  year: number;
  month: number | null;
  day: number | null;
  precision: "year" | "month" | "day";
  approximate: boolean;
}

export interface DateInterval {
  kind: "interval";
  from: DatePoint | null;
  to: DatePoint | null;
}

export type DateValue = DatePoint | DateInterval;

export function daysInMonth(year: number, month: number): number {
  return month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parsePoint(input: string): DatePoint {
  const match = /^(~)?(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(input);
  if (!match) throw new Error("fecha: usa AAAA, AAAA-MM o AAAA-MM-DD; ~ indica aproximación");
  const year = Number(match[2]), month = match[3] === undefined ? null : Number(match[3]);
  const day = match[4] === undefined ? null : Number(match[4]);
  if (year < 1 || year > 9999 || (month !== null && (month < 1 || month > 12))
    || (day !== null && (month === null || day < 1 || day > daysInMonth(year, month)))) {
    throw new Error("fecha fuera del calendario válido");
  }
  return { kind: "point", year, month, day, precision: day !== null ? "day" : month !== null ? "month" : "year", approximate: match[1] !== undefined };
}

/** Validation bounds describe possible dates; they are never stored as facts. */
function lowerBound(point: DatePoint): number {
  return point.year * 10_000 + (point.month ?? 1) * 100 + (point.day ?? 1);
}
function upperBound(point: DatePoint): number {
  const month = point.month ?? 12;
  return point.year * 10_000 + month * 100 + (point.day ?? daysInMonth(point.year, month));
}

/** Slash separates interval endpoints; one endpoint can remain unknown. */
export function parseDateValue(input: string): DateValue {
  const parts = input.trim().split("/").map(part => part.trim());
  if (parts.length === 1) return parsePoint(parts[0]!);
  if (parts.length !== 2 || parts.every(part => !part)) throw new Error("intervalo: usa inicio/fin y al menos un extremo conocido");
  const from = parts[0] ? parsePoint(parts[0]) : null, to = parts[1] ? parsePoint(parts[1]) : null;
  if (from && to && !from.approximate && !to.approximate && lowerBound(from) > upperBound(to)) {
    throw new Error("intervalo de fechas invertido");
  }
  return { kind: "interval", from, to };
}

export function dateValueText(value: DateValue): string {
  if (value.kind === "interval") return `${value.from ? dateValueText(value.from) : ""}/${value.to ? dateValueText(value.to) : ""}`;
  const padded = (number: number, width: number) => String(number).padStart(width, "0");
  return `${value.approximate ? "~" : ""}${padded(value.year, 4)}${value.month === null ? "" : `-${padded(value.month, 2)}`}${value.day === null ? "" : `-${padded(value.day, 2)}`}`;
}

/** Compatibility projection for a DATE column; absence of a day stays NULL. */
export function exactDateProjection(value: DateValue | null): string | null {
  return value?.kind === "point" && value.precision === "day" && !value.approximate ? dateValueText(value) : null;
}

/** A scalar birth/death year is usable only for a non-approximate point. */
export function exactYear(value: DateValue | null): number | null {
  return value?.kind === "point" && !value.approximate ? value.year : null;
}

/** Do not assert an ordering when precision overlaps or either date is approximate. */
export function definitelyBefore(left: DateValue, right: DateValue): boolean {
  const end = left.kind === "point" ? left : left.to, start = right.kind === "point" ? right : right.from;
  return !!end && !!start && !end.approximate && !start.approximate && upperBound(end) < lowerBound(start);
}

/** Unknown, approximate and interval dates do not assert a single chronological year. */
export function dateYear(input: string | null): number | null {
  if (!input) return null;
  try { return exactYear(parseDateValue(input)); } catch { return null; }
}
