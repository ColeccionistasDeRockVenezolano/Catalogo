// CRV · Piezas puestas a mano en la emisión (2026-11-11, pedido de Brian).
//
// Como en cualquier radio: se elige una pieza del catálogo y suena en cuanto
// termina la que está al aire. La programación no se rebaraja ni se reordena:
// el reloj del ciclo se detiene mientras suena la pieza puesta y, al acabar,
// la emisión sigue exactamente en la pieza que tocaba. Todos los oyentes oyen
// lo mismo porque el motor sigue siendo determinista: la hora de cada pieza
// puesta queda fijada al crearla y guardada en el estado del dueño.
//
// Archivo: `<estado>.inserts.json`. Lo escriben solo el dueño de la emisión y su
// herramienta de operación; el motor lo relee cuando cambia su fecha.
import crypto from "node:crypto";
import fs from "node:fs";

export interface RadioInsert {
  id: string;
  videoId: string;
  startSeconds: number;
  durationSeconds: number;
  /** Hora real en que empieza a sonar (fin del tramo que estaba al aire). */
  startsAtMs: number;
  /** Tramo que ocupa: duración menos el cruce con la pieza siguiente. */
  slotMs: number;
  requestedAtMs: number;
  requestedBy: string | null;
  /** Copia de la pieza al ponerla: título, artista… si luego sale del catálogo. */
  item: { title: string; artist: string | null; album: string; year: number | null; trackNumber: number };
}

export interface RadioInsertsFile {
  version: 1;
  /** Tiempo de piezas puestas ya resumido (las que acabaron hace más de un día). */
  foldedMs: number;
  inserts: RadioInsert[];
}

const FOLD_AFTER_MS = 24 * 3600_000;
export const MAX_PENDING_INSERTS = 10;

export const insertEndMs = (insert: RadioInsert): number => insert.startsAtMs + insert.slotMs;

const empty = (): RadioInsertsFile => ({ version: 1, foldedMs: 0, inserts: [] });

function isInsert(value: unknown): value is RadioInsert {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw["id"] === "string" && typeof raw["videoId"] === "string"
    && [raw["startSeconds"], raw["durationSeconds"], raw["startsAtMs"], raw["slotMs"], raw["requestedAtMs"]].every((n) => typeof n === "number" && Number.isFinite(n))
    && Number(raw["slotMs"]) > 0 && Boolean(raw["item"]) && typeof (raw["item"] as Record<string, unknown>)["title"] === "string";
}

export function parseInsertsFile(raw: unknown): RadioInsertsFile {
  if (!raw || typeof raw !== "object") return empty();
  const value = raw as Record<string, unknown>;
  const folded = typeof value["foldedMs"] === "number" && Number.isFinite(value["foldedMs"]) && value["foldedMs"] >= 0 ? value["foldedMs"] : 0;
  const inserts = (Array.isArray(value["inserts"]) ? value["inserts"] : []).filter(isInsert)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  return { version: 1, foldedMs: folded, inserts };
}

export interface RadioInsertsStore {
  /** Estado actual (releído si el archivo cambió). */
  read(): RadioInsertsFile;
  write(next: RadioInsertsFile): void;
}

export function createRadioInsertsStore(filePath: string): RadioInsertsStore {
  let cache: { mtimeMs: number; data: RadioInsertsFile } | null = null;
  const mtimeOf = (): number => { try { return fs.statSync(filePath).mtimeMs; } catch { return -1; } };
  return {
    read() {
      const mtimeMs = mtimeOf();
      if (cache && cache.mtimeMs === mtimeMs) return cache.data;
      let data = empty();
      if (mtimeMs >= 0) {
        try { data = parseInsertsFile(JSON.parse(fs.readFileSync(filePath, "utf8"))); } catch { data = empty(); }
      }
      cache = { mtimeMs, data };
      return data;
    },
    write(next) {
      const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, filePath);
      cache = null;
    },
  };
}

/** Lo que el reloj del ciclo lleva retrasado a esta hora por piezas puestas ya terminadas. */
export function insertOffsetMs(file: RadioInsertsFile, nowMs: number): number {
  let offset = file.foldedMs;
  for (const insert of file.inserts) if (insertEndMs(insert) <= nowMs) offset += insert.slotMs;
  return offset;
}

export function playingInsert(file: RadioInsertsFile, nowMs: number): RadioInsert | null {
  return file.inserts.find((insert) => insert.startsAtMs <= nowMs && nowMs < insertEndMs(insert)) ?? null;
}

export function pendingInserts(file: RadioInsertsFile, nowMs: number): RadioInsert[] {
  return file.inserts.filter((insert) => insert.startsAtMs > nowMs);
}

/** Resume en `foldedMs` las piezas que acabaron hace más de un día. */
export function foldOldInserts(file: RadioInsertsFile, nowMs: number): RadioInsertsFile {
  const old = file.inserts.filter((insert) => insertEndMs(insert) <= nowMs - FOLD_AFTER_MS);
  if (old.length === 0) return file;
  return {
    version: 1,
    foldedMs: file.foldedMs + old.reduce((sum, insert) => sum + insert.slotMs, 0),
    inserts: file.inserts.filter((insert) => !old.includes(insert)),
  };
}
