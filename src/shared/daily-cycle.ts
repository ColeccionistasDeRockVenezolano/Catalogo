/** Única definición del día editorial, compartida por la API y la web. */
export const DAILY_TIME_ZONE = "America/Caracas";
export const DAY_MS = 86_400_000;
export interface DailyCycle {
  date: string;
  day: number;
  timeZone: string;
  startsAt: string;
  changesAt: string;
}
export interface DailyClock extends DailyCycle { serverNow: string }

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAILY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAILY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function dailyDate(now = new Date()): string { return dateFormat.format(now); }
export function dayNumber(date: string): number { return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS); }

function midnight(date: string): string {
  const utc = Date.parse(`${date}T00:00:00Z`);
  // Consultar la zona, sin duplicar un desfase UTC fijo en la web o la API.
  const probe = new Date(utc + DAY_MS / 2);
  const parts = Object.fromEntries(partsFormat.formatToParts(probe).map(part => [part.type, part.value]));
  const local = Date.parse(`${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}Z`);
  return new Date(utc - (local - probe.getTime())).toISOString();
}

export function dailyCycleForDate(date: string): DailyCycle {
  const day = dayNumber(date);
  if (!Number.isFinite(day) || new Date(day * DAY_MS).toISOString().slice(0, 10) !== date) throw new Error("Fecha diaria inválida");
  const tomorrow = new Date((day + 1) * DAY_MS).toISOString().slice(0, 10);
  return { date, day, timeZone: DAILY_TIME_ZONE, startsAt: midnight(date), changesAt: midnight(tomorrow) };
}
export function dailyCycleAt(now = new Date()): DailyCycle { return dailyCycleForDate(dailyDate(now)); }

/** Rotación sin repetir el elemento de ayer mientras haya más de uno. */
export function dailyIndex(date: string, size: number): number {
  return size > 0 ? ((dayNumber(date) % size) + size) % size : 0;
}

/** Aleatoriedad reproducible por día y superficie, independiente de la sesión. */
export function dailyRandom(date: string, scope: string): () => number {
  let state = 2166136261;
  for (const char of `${date}:${scope}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
