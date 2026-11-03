// CRV · Motor de radio determinista (Fase 3).
//
// Portado del motor de Herra para que el catálogo pueda calcular la misma
// emisión al mismo segundo. La fuente de verdad sigue siendo el catálogo
// exportado y su configuración (`auth.project_features`, feature `radio`).
// Con `owner` la estación es la dueña de la emisión: barre la disponibilidad y
// guarda sus exclusiones y su respaldo de géneros en `statePath`. Sin `owner`
// no escribe nada ni consulta a YouTube: sigue los archivos que mantiene Herra.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRadioAvailabilityStore, oembedAvailability, type RadioAvailabilityChecker, type RadioAvailabilityStore, type RadioVerdict } from "./availability.js";
import { genrePrimaryKey, type RadioItemGenres } from "./genres.js";
import { radioLog } from "./log.js";
import { genreProgrammingOrder } from "./programming.js";

export type { RadioItemGenres } from "./genres.js";

export interface RadioRegionRestriction { allowed?: string[]; blocked?: string[] }
export interface RadioCatalogItem {
  videoId: string; title: string; artist: string | null; album: string; year: number | null;
  trackNumber: number; startSeconds: number; durationSeconds: number; available: true;
  genres?: RadioItemGenres | null;
  regionRestriction?: RadioRegionRestriction;
  /** Solo en un relleno: la pieza programada que el país del oyente veta. */
  regionSubstituteFor?: { videoId: string; title: string; artist: string | null; album: string; year: number | null };
}
export interface RadioSweeper {
  src: string; durationSeconds: number; overlapSeconds?: number; leadSeconds?: number; everyPieces?: number;
  /** La misma cuña en YouTube: es lo único que puede sonar sin un toque completo del visitante. */
  videoId?: string; videoStartSeconds?: number;
}
export interface RadioStation {
  sweeper?: RadioSweeper;
  crossfadeSeconds?: number;
  catalogPath: string;
  epochMs: number;
  stationName: string;
  /** Dueña de la emisión: barre, verifica avisos y guarda su estado. */
  owner?: boolean;
  /** Base de los archivos de estado del dueño; por defecto, junto al catálogo. */
  statePath?: string;
}
export interface RadioListener { country?: string | null | undefined }
export interface RadioSnapshot {
  phase: "music" | "sweeper";
  sweeper?: RadioSweeper;
  sweeperSlot: boolean;
  sweeperNext: boolean;
  crossfadeSeconds: number;
  station: string;
  sweeperStartedAt?: string;
  queueId: string;
  catalogVersion: string;
  serverTime: string;
  startsAt: string;
  endsAt: string;
  offsetSeconds: number;
  cycle: number;
  position: number;
  total: number;
  current: RadioCatalogItem;
  next: RadioCatalogItem;
  upcoming: RadioCatalogItem[];
  listeners: number;
}

export interface RadioRegionPolicy { homeRegions: string[]; worldwideRegions: number }
const DEFAULT_WORLDWIDE_REGIONS = 100;
const REGION_CODE = /^[A-Z]{2}$/u;
// Códigos que Cloudflare usa sin país real (desconocido y Tor).
const NO_COUNTRY = new Set(["XX", "T1"]);
const SWEEP_FIRST_DELAY_MS = 5_000;
const SWEEP_INTERVAL_MS = 6 * 3600_000;
const STATION_IDLE_MS = 24 * 3600_000;
const SUPPORTED_VERSIONS = new Set<unknown>([2, 3]);
const UPCOMING_COUNT = 6;
const GENRE_COVERAGE_MIN = 0.9;
const COMPILATION_ARTIST = /^(various artists|varios artistas|v\.?\s?a\.?)$/iu;

interface CatalogFile {
  version: number; generatedAt: string; availabilityCheckedAt: string; channelId: string;
  items: RadioCatalogItem[]; regionPolicy?: unknown;
}
interface CatalogFileCache {
  path: string; mtimeMs: number; items: RadioCatalogItem[]; regionPolicy: RadioRegionPolicy;
  regionExcluded: number; availabilityCheckedAt: string;
}
interface CatalogCache {
  file: CatalogFileCache; revision: number; version: string; totalDuration: number;
  items: RadioCatalogItem[];
  /** Último segundo conocido de cada video, para un relleno que siga sobre su pista siguiente. */
  videoEnds: Map<string, number>;
}
interface EngineState {
  file: CatalogFileCache | null;
  rejectedFile: string;
  catalog: CatalogCache | null;
  staleCatalog: { cache: CatalogCache; untilMs: number } | null;
  baseOrders: Map<string, RadioCatalogItem[]>;
  orders: Map<string, RadioCatalogItem[]>;
  availability: RadioAvailabilityStore | null;
  sweepTimer: NodeJS.Timeout | null;
  lastUsedMs: number;
}
const states = new Map<string, EngineState>();
let injectedChecker: RadioAvailabilityChecker | undefined;

function stateKey(station: RadioStation): string {
  return [station.catalogPath, station.epochMs, JSON.stringify(station.sweeper ?? null), crossfadeSeconds(station), Boolean(station.owner), station.statePath ?? ""].join("\n");
}

function stateFor(station: RadioStation): EngineState {
  const key = stateKey(station);
  let state = states.get(key);
  if (!state) {
    state = {
      file: null, rejectedFile: "", catalog: null, staleCatalog: null, baseOrders: new Map(), orders: new Map(),
      availability: null, sweepTimer: null, lastUsedMs: Date.now(),
    };
    states.set(key, state);
  }
  state.lastUsedMs = Date.now();
  return state;
}

function statePathOf(station: RadioStation): string {
  return station.owner && station.statePath ? station.statePath : station.catalogPath;
}

function availabilityOf(state: EngineState, station: RadioStation): RadioAvailabilityStore {
  if (!state.availability) {
    const checker = injectedChecker !== undefined ? injectedChecker : station.owner ? oembedAvailability : null;
    const ownPath = `${statePathOf(station)}.unavailable.json`;
    const sibling = `${station.catalogPath}.unavailable.json`;
    state.availability = createRadioAvailabilityStore({
      filePath: ownPath, checker, writable: Boolean(station.owner),
      ...(ownPath !== sibling ? { seedPath: sibling } : {}),
    });
  }
  return state.availability;
}

function disposeState(key: string, state: EngineState): void {
  if (state.sweepTimer) clearTimeout(state.sweepTimer);
  state.sweepTimer = null;
  if (states.get(key) === state) states.delete(key);
}

// Barrido periódico del dueño: detecta lo que se volvió privado o se borró y
// devuelve lo que se recupera. Una estación que nadie consulta en un día se apaga.
function scheduleSweep(state: EngineState, station: RadioStation): void {
  if (state.sweepTimer || !station.owner || injectedChecker !== undefined) return;
  const key = stateKey(station);
  const plan = (delayMs: number): void => {
    state.sweepTimer = setTimeout(() => {
      if (Date.now() - state.lastUsedMs > STATION_IDLE_MS) { disposeState(key, state); return; }
      const videoIds = state.file ? state.file.items.map((item) => item.videoId) : [];
      availabilityOf(state, station).sweep(videoIds)
        .catch((error: unknown) => {
          radioLog("error", "radio_availability_sweep_failed", { station: station.stationName, message: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => { if (states.get(key) === state) plan(SWEEP_INTERVAL_MS); });
    }, delayMs);
    state.sweepTimer.unref();
  };
  plan(SWEEP_FIRST_DELAY_MS);
}

export function resetRadioEngineForTests(): void {
  for (const [key, state] of [...states]) disposeState(key, state);
  states.clear();
  injectedChecker = undefined;
}

/** Solo pruebas: verificador en lugar de oEmbed; apaga el barrido programado. */
export function setRadioCheckerForTests(checker: RadioAvailabilityChecker | undefined): void {
  injectedChecker = checker;
  for (const state of states.values()) state.availability = null;
}

/** Solo pruebas: barrido inmediato. */
export async function sweepRadioForTests(station: RadioStation, nowMs = Date.now()): Promise<void> {
  const state = stateFor(station);
  const file = readCatalogFile(state, station);
  await availabilityOf(state, station).sweep(file ? file.items.map((item) => item.videoId) : [], nowMs);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/gu, " ");
  return clean && clean.length <= max ? clean : null;
}

function parseGenreRef(value: unknown): { slug?: string; name?: string; family?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = cleanText(raw["name"], 80);
  const slug = cleanText(raw["slug"], 80);
  if (!name && !slug) return null;
  const family = cleanText(raw["family"], 60);
  return {
    ...(slug ? { slug } : {}),
    ...(name ? { name } : {}),
    ...(family ? { family } : {}),
  };
}

function parseGenres(value: unknown): RadioItemGenres | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const primaryGenre = parseGenreRef(raw["primaryGenre"]);
  const secondaryGenres: Array<{ slug?: string; name?: string; family?: string }> = [];
  for (const entry of Array.isArray(raw["secondaryGenres"]) ? raw["secondaryGenres"] : []) {
    const ref = parseGenreRef(entry);
    if (ref && !secondaryGenres.some((existing) => existing.slug === ref.slug)) secondaryGenres.push(ref);
  }
  if (!primaryGenre && secondaryGenres.length === 0) return null;
  const families: string[] = [];
  for (const entry of Array.isArray(raw["families"]) ? raw["families"] : []) {
    const family = typeof entry === "string" ? cleanText(entry, 60) : parseGenreRef(entry)?.name ?? null;
    if (family && !families.includes(family)) families.push(family);
  }
  return {
    ...(primaryGenre ? { primaryGenre } : {}),
    secondaryGenres,
    families,
    ...(cleanText(raw["genreOrigin"], 40) ? { genreOrigin: cleanText(raw["genreOrigin"], 40) } : {}),
    ...(cleanText(raw["genreStatus"], 40) ? { genreStatus: cleanText(raw["genreStatus"], 40) } : {}),
  };
}

function parseRegionList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const code = entry.trim().toUpperCase();
    if (REGION_CODE.test(code)) codes.add(code);
  }
  return [...codes].sort();
}

function parseRegionRestriction(value: unknown): RadioRegionRestriction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowed = parseRegionList(raw["allowed"]);
  const blocked = parseRegionList(raw["blocked"]);
  if (!allowed && (!blocked || blocked.length === 0)) return null;
  return { ...(allowed ? { allowed } : {}), ...(blocked && blocked.length ? { blocked } : {}) };
}

export function parseRegionPolicy(value: unknown): RadioRegionPolicy {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const homeRegions = (parseRegionList(raw["homeRegions"]) ?? []).slice(0, 20);
  const worldwide = Number(raw["worldwideRegions"]);
  return {
    homeRegions,
    worldwideRegions: Number.isInteger(worldwide) && worldwide >= 1 && worldwide <= 300 ? worldwide : DEFAULT_WORLDWIDE_REGIONS,
  };
}

export function normalizeListenerCountry(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return REGION_CODE.test(code) && !NO_COUNTRY.has(code) ? code : null;
}

export function regionBlocks(item: { regionRestriction?: RadioRegionRestriction }, country: string): boolean {
  const restriction = item.regionRestriction;
  if (!restriction) return false;
  if (restriction.allowed && !restriction.allowed.includes(country)) return true;
  return Boolean(restriction.blocked?.includes(country));
}

function regionExcludesFromStation(item: { regionRestriction?: RadioRegionRestriction }, policy: RadioRegionPolicy): boolean {
  const restriction = item.regionRestriction;
  if (!restriction) return false;
  if (policy.homeRegions.some((country) => regionBlocks(item, country))) return true;
  if (restriction.allowed) return restriction.allowed.length < policy.worldwideRegions;
  return (restriction.blocked?.length ?? 0) >= policy.worldwideRegions;
}

function parseItem(value: unknown): RadioCatalogItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const videoId = cleanText(raw["videoId"], 11);
  const title = cleanText(raw["title"], 300);
  const album = cleanText(raw["album"], 240) ?? title;
  const artist = raw["artist"] === null ? null : cleanText(raw["artist"], 180);
  const durationSeconds = Number(raw["durationSeconds"]);
  const startSeconds = Number(raw["startSeconds"]);
  const trackNumber = Number(raw["trackNumber"]);
  const year = raw["year"] === null ? null : Number(raw["year"]);
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/u.test(videoId) || !title || !album) return null;
  if (raw["available"] !== true) return null;
  if (!Number.isInteger(startSeconds) || startSeconds < 0 || startSeconds > 6 * 3600) return null;
  if (!Number.isInteger(trackNumber) || trackNumber < 1 || trackNumber > 1000) return null;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 30 * 60) return null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return null;
  const regionRestriction = parseRegionRestriction(raw["regionRestriction"]);
  const genres = parseGenres(raw["genres"]);
  return {
    videoId, title, artist, album, year, trackNumber, startSeconds, durationSeconds, available: true,
    ...(genres ? { genres } : {}),
    ...(regionRestriction ? { regionRestriction } : {}),
  };
}

function parseCatalogFile(filePath: string): { items: RadioCatalogItem[]; availabilityCheckedAt: string; regionPolicy: RadioRegionPolicy; regionExcluded: number } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<CatalogFile>;
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(parseItem)
    .filter((item): item is RadioCatalogItem => Boolean(item))
    .filter((item) => {
      const occurrence = `${item.videoId}:${item.startSeconds}`;
      if (seen.has(occurrence)) return false;
      seen.add(occurrence);
      return true;
    });
  const checkedAt = Date.parse(typeof raw.availabilityCheckedAt === "string" ? raw.availabilityCheckedAt : "");
  if (!SUPPORTED_VERSIONS.has(raw.version) || !Number.isFinite(checkedAt) || items.length < 2) {
    throw new Error("se requieren versión 2 o 3, verificación de disponibilidad y al menos dos canciones válidas");
  }
  const regionPolicy = parseRegionPolicy(raw.regionPolicy);
  const airable = items.filter((item) => !regionExcludesFromStation(item, regionPolicy));
  if (airable.length < 2) throw new Error("la política regional deja menos de dos canciones");
  return { items: airable, availabilityCheckedAt: String(raw.availabilityCheckedAt), regionPolicy, regionExcluded: items.length - airable.length };
}

function readGenreBackup(filePath: string): Map<string, RadioItemGenres> | null {
  let raw: { videos?: Record<string, unknown> };
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as typeof raw; } catch { return null; }
  const map = new Map<string, RadioItemGenres>();
  for (const [videoId, genres] of Object.entries(raw.videos ?? {})) {
    const parsed = parseGenres(genres);
    if (parsed && videoId) map.set(videoId, parsed);
  }
  return map;
}

function writeGenreBackup(target: string, items: readonly RadioCatalogItem[]): void {
  const videos: Record<string, RadioItemGenres> = {};
  for (const item of items) if (item.genres && genrePrimaryKey(item.genres)) videos[item.videoId] = item.genres;
  if (Object.keys(videos).length === 0) return;
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ savedAt: new Date().toISOString(), videos }), "utf8");
    fs.renameSync(temporary, target);
  } catch (error) {
    radioLog("error", "radio_genres_backup_failed", { target, message: error instanceof Error ? error.message : String(error) });
    fs.rmSync(temporary, { force: true });
  }
}

// Rellena los géneros que falten desde el último mapa conocido. El dueño lo
// mantiene al día en su propio archivo; quien no lo es solo lee.
function applyGenreBackup(station: RadioStation, items: readonly RadioCatalogItem[]): RadioCatalogItem[] {
  const ownPath = `${statePathOf(station)}.genres.json`;
  const backup = readGenreBackup(ownPath) ?? readGenreBackup(`${station.catalogPath}.genres.json`) ?? new Map<string, RadioItemGenres>();
  const merged = items.map((item) => {
    if (genrePrimaryKey(item.genres)) return item;
    const saved = backup.get(item.videoId);
    return saved ? { ...item, genres: saved } : item;
  });
  if (station.owner) {
    const classified = merged.filter((item) => genrePrimaryKey(item.genres));
    // Una re-anotación debe ganarle al respaldo viejo.
    const complete = backup.size === classified.length && classified.every((item) => {
      const saved = backup.get(item.videoId);
      return Boolean(saved) && genrePrimaryKey(saved) === genrePrimaryKey(item.genres);
    });
    if (!complete) writeGenreBackup(ownPath, merged);
  }
  return merged;
}

function effectiveCatalogItems(items: readonly RadioCatalogItem[]): RadioCatalogItem[] {
  const classified = items.filter((item) => genrePrimaryKey(item.genres));
  const unclassified = items.length - classified.length;
  if (unclassified === 0) return items.slice();
  const covered = classified.length >= 2 && classified.length / items.length >= GENRE_COVERAGE_MIN;
  return covered ? classified : items.slice();
}

export function sweeperLead(station: RadioStation): number {
  return station.sweeper ? station.sweeper.leadSeconds ?? 0 : 0;
}

function sweeperEvery(station: RadioStation): number {
  const every = station.sweeper?.everyPieces ?? 1;
  return Number.isInteger(every) && every >= 1 ? every : 1;
}

export function sweeperClosesSlot(station: RadioStation, position: number): boolean {
  if (!station.sweeper) return false;
  return (position + 1) % sweeperEvery(station) === 0;
}

function sweeperGap(station: RadioStation): number {
  if (!station.sweeper) return 0;
  const solo = station.sweeper.durationSeconds - sweeperLead(station) - (station.sweeper.overlapSeconds ?? 0);
  return Math.max(0, solo);
}

export function crossfadeSeconds(station: RadioStation): number {
  const value = station.crossfadeSeconds ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function slotSeconds(station: RadioStation, item: { durationSeconds: number }, position: number): number {
  const closes = sweeperClosesSlot(station, position);
  const cross = closes ? 0 : crossfadeSeconds(station);
  return Math.max(0.5, item.durationSeconds - cross) + (closes ? sweeperGap(station) : 0);
}

function readCatalogFile(state: EngineState, station: RadioStation): CatalogFileCache | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(station.catalogPath); } catch { state.file = null; return null; }
  if (state.file?.path === station.catalogPath && state.file.mtimeMs === stat.mtimeMs) return state.file;
  const fileKey = `${station.catalogPath}:${stat.mtimeMs}`;
  if (state.rejectedFile === fileKey) return null;
  try {
    state.file = { path: station.catalogPath, mtimeMs: stat.mtimeMs, ...parseCatalogFile(station.catalogPath) };
    state.rejectedFile = "";
    return state.file;
  } catch (error) {
    radioLog("error", "radio_catalog_invalid", { station: station.stationName, message: error instanceof Error ? error.message : String(error) });
    state.file = null;
    state.rejectedFile = fileKey;
    return null;
  }
}

function loadCatalog(state: EngineState, station: RadioStation, nowMs: number): CatalogCache | null {
  const file = readCatalogFile(state, station);
  if (!file) {
    state.catalog = null;
    return null;
  }
  scheduleSweep(state, station);
  const store = availabilityOf(state, station);
  const revision = store.revision();
  if (state.catalog?.file === file && state.catalog.revision === revision) return state.catalog;
  const playable = file.items.filter((item) => !store.isExcluded(item.videoId));
  const items = effectiveCatalogItems(applyGenreBackup(station, playable));
  if (items.length < 2) {
    radioLog("error", "radio_catalog_exhausted", { station: station.stationName, items: items.length });
    state.catalog = null;
    return null;
  }
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(items.map((item) => [item.videoId, item.startSeconds, item.durationSeconds])))
    .digest("hex").slice(0, 16);
  const previous = state.catalog;
  const videoEnds = new Map<string, number>();
  for (const item of file.items) {
    const end = item.startSeconds + item.durationSeconds;
    if (end > (videoEnds.get(item.videoId) ?? 0)) videoEnds.set(item.videoId, end);
  }
  state.catalog = {
    file, revision, version: digest, items, videoEnds,
    totalDuration: items.reduce((sum, item, index) => sum + slotSeconds(station, item, index), 0),
  };
  // Un catálogo nuevo no corta la pieza en curso: la versión anterior sirve hasta
  // que esa pieza termina. Si lo que suena es un video retirado, el relevo es inmediato.
  if (previous && previous.version !== digest && !state.staleCatalog) {
    const located = locate(state, station, previous, nowMs);
    const item = located.order[located.position]!;
    const endsAtMs = located.startsAtMs + slotSeconds(station, item, located.position) * 1000;
    if (endsAtMs > nowMs && !store.isExcluded(item.videoId)) {
      state.staleCatalog = { cache: previous, untilMs: endsAtMs };
    }
  }
  return state.catalog;
}

function activeCatalog(state: EngineState, station: RadioStation, nowMs: number): CatalogCache | null {
  const fresh = loadCatalog(state, station, nowMs);
  const stale = state.staleCatalog;
  if (stale) {
    const located = locate(state, station, stale.cache, nowMs);
    const keep = nowMs < stale.untilMs
      && (!fresh || fresh.version !== stale.cache.version)
      && !availabilityOf(state, station).isExcluded(located.order[located.position]!.videoId);
    if (keep) return stale.cache;
    state.staleCatalog = null;
  }
  return fresh;
}

function cycleSeed(catalog: CatalogCache, cycle: number): number {
  return crypto.createHash("sha256").update(`${catalog.version}:${cycle}`).digest().readUInt32LE(0) || 0x9e3779b9;
}

function shuffledOrder(catalog: CatalogCache, cycle: number): RadioCatalogItem[] {
  let state = cycleSeed(catalog, cycle) >>> 0;
  const order = catalog.items.slice();
  for (let index = order.length - 1; index > 0; index -= 1) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const target = Math.floor(((state >>> 0) / 0x1_0000_0000) * (index + 1));
    [order[index], order[target]] = [order[target]!, order[index]!];
  }
  return order;
}

function sameArtist(a: RadioCatalogItem, b: RadioCatalogItem): boolean {
  if (!a.artist || !b.artist || COMPILATION_ARTIST.test(a.artist)) return false;
  return a.artist.toLocaleLowerCase("es") === b.artist.toLocaleLowerCase("es");
}

function clash(a: RadioCatalogItem, b: RadioCatalogItem, strict: boolean): boolean {
  return a.videoId === b.videoId || (strict && sameArtist(a, b));
}

function spreadRepeats(order: RadioCatalogItem[]): void {
  for (let index = 1; index < order.length; index += 1) {
    for (const strict of [true, false]) {
      const prior = order[index - 1]!;
      const item = order[index]!;
      if (!clash(prior, item, strict)) break;
      let replacement = -1;
      for (let candidate = index + 1; candidate < order.length; candidate += 1) {
        if (!clash(prior, order[candidate]!, strict)) { replacement = candidate; break; }
      }
      if (replacement > 0) {
        [order[index], order[replacement]] = [order[replacement]!, item];
        break;
      }
      const following = order[index + 1];
      if (following && clash(prior, following, strict)) continue;
      let slot = -1;
      for (let candidate = 0; candidate < index - 1; candidate += 1) {
        const left = order[candidate - 1];
        if ((!left || !clash(left, item, strict)) && !clash(item, order[candidate]!, strict)) { slot = candidate; break; }
      }
      if (slot >= 0) {
        order.splice(index, 1);
        order.splice(slot, 0, item);
        break;
      }
    }
  }
}

function openAfter(order: RadioCatalogItem[], last: RadioCatalogItem): void {
  for (const strict of [true, false]) {
    if (!clash(last, order[0]!, strict)) return;
    for (let index = 1; index < order.length - 1; index += 1) {
      const candidate = order[index]!;
      if (clash(last, candidate, strict) || clash(candidate, order[0]!, strict)
        || clash(order[index - 1]!, order[index + 1]!, strict)) continue;
      order.splice(index, 1);
      order.unshift(candidate);
      return;
    }
  }
}

function cycleOrder(catalog: CatalogCache, cycle: number): RadioCatalogItem[] {
  const genres = new Set(catalog.items.map((item) => genrePrimaryKey(item.genres)).filter(Boolean));
  const order = genres.size >= 2
    ? genreProgrammingOrder(catalog.items, cycleSeed(catalog, cycle))
    : shuffledOrder(catalog, cycle);
  spreadRepeats(order);
  return order;
}

function baseOrder(state: EngineState, catalog: CatalogCache, cycle: number): RadioCatalogItem[] {
  const key = `${catalog.version}:${cycle}`;
  const cached = state.baseOrders.get(key);
  if (cached) return cached;
  const order = cycleOrder(catalog, cycle);
  state.baseOrders.set(key, order);
  if (state.baseOrders.size > 6) {
    for (const oldKey of state.baseOrders.keys()) {
      if (oldKey !== key) { state.baseOrders.delete(oldKey); break; }
    }
  }
  return order;
}

function rawOrder(state: EngineState, catalog: CatalogCache, cycle: number): RadioCatalogItem[] {
  const key = `${catalog.version}:${cycle}`;
  const cached = state.orders.get(key);
  if (cached) return cached;
  const order = cycleOrder(catalog, cycle);
  if (cycle > 0) openAfter(order, baseOrder(state, catalog, cycle - 1).at(-1)!);
  state.orders.set(key, order);
  if (state.orders.size > 6) {
    for (const oldKey of state.orders.keys()) {
      if (oldKey !== key) { state.orders.delete(oldKey); break; }
    }
  }
  return order;
}

interface LocatedPiece { cycle: number; position: number; order: RadioCatalogItem[]; startsAtMs: number }

function locate(state: EngineState, station: RadioStation, catalog: CatalogCache, nowMs: number): LocatedPiece {
  const elapsed = nowMs - station.epochMs;
  const cycle = Math.floor(elapsed / (catalog.totalDuration * 1000));
  const cycleStartMs = station.epochMs + cycle * catalog.totalDuration * 1000;
  const withinCycleSeconds = (nowMs - cycleStartMs) / 1000;
  const order = rawOrder(state, catalog, cycle);
  let cursor = 0;
  let position = 0;
  for (let index = 0; index < order.length; index += 1) {
    const slotDuration = slotSeconds(station, order[index]!, index);
    if (withinCycleSeconds < cursor + slotDuration) { position = index; break; }
    cursor += slotDuration;
  }
  return { cycle, position, order, startsAtMs: cycleStartMs + cursor * 1000 };
}

// Relleno para un oyente cuyo país veta la pieza programada. La emisión común no
// cambia: en ese mismo tramo suena otra pieza permitida allí, elegida de forma
// determinista. Prefiere el mismo género y una duración suficiente; si no la hay,
// una que pueda seguir sobre la pista siguiente de su video.
function regionSubstitute(catalog: CatalogCache, original: RadioCatalogItem, country: string, slotKey: string, avoid: ReadonlySet<string>): RadioCatalogItem | null {
  const genre = genrePrimaryKey(original.genres);
  const fits = (item: RadioCatalogItem): boolean => item.durationSeconds >= original.durationSeconds;
  const fitsInVideo = (item: RadioCatalogItem): boolean => (catalog.videoEnds.get(item.videoId) ?? 0) - item.startSeconds >= original.durationSeconds;
  const allowed = catalog.items.filter((item) => !avoid.has(item.videoId) && !regionBlocks(item, country)
    && (!original.artist || !item.artist || !sameArtist(original, item)));
  const tiers = [
    allowed.filter((item) => genre && genrePrimaryKey(item.genres) === genre && fits(item)),
    allowed.filter(fits),
    allowed.filter(fitsInVideo),
  ];
  const pool = tiers.find((tier) => tier.length > 0);
  if (!pool) return null;
  const pick = crypto.createHash("sha256").update(`${catalog.version}:${slotKey}:${country}`).digest().readUInt32LE(0);
  const chosen = pool[pick % pool.length]!;
  return {
    ...chosen,
    // Ocupa exactamente el tramo de la pieza vetada para no mover el reloj.
    durationSeconds: original.durationSeconds,
    regionSubstituteFor: { videoId: original.videoId, title: original.title, artist: original.artist, album: original.album, year: original.year },
  };
}

function forListener(catalog: CatalogCache, item: RadioCatalogItem, country: string | null, slotKey: string, avoid: ReadonlySet<string>): RadioCatalogItem {
  if (!country || !regionBlocks(item, country)) return item;
  return regionSubstitute(catalog, item, country, slotKey, avoid) ?? item;
}

export function radioSnapshot(station: RadioStation, nowMs = Date.now(), listeners = 0, listener: RadioListener = {}): RadioSnapshot | null {
  const state = stateFor(station);
  const catalog = activeCatalog(state, station, nowMs);
  if (!catalog) return null;
  const located = locate(state, station, catalog, nowMs);
  const scheduled = located.order[located.position]!;
  const scheduledUpcoming: Array<{ item: RadioCatalogItem; slotKey: string }> = [];
  let candidateCycle = located.cycle;
  let candidatePosition = located.position + 1;
  while (scheduledUpcoming.length < Math.min(UPCOMING_COUNT, catalog.items.length - 1)) {
    const candidateOrder = candidateCycle === located.cycle ? located.order : rawOrder(state, catalog, candidateCycle);
    if (candidatePosition >= candidateOrder.length) {
      candidateCycle += 1;
      candidatePosition = 0;
      continue;
    }
    scheduledUpcoming.push({ item: candidateOrder[candidatePosition]!, slotKey: `${candidateCycle}:${candidatePosition}` });
    candidatePosition += 1;
  }
  // Un relleno nunca repite algo programado alrededor. Los tiempos se calculan con
  // la pieza programada: el relleno ocupa su mismo tramo.
  const country = normalizeListenerCountry(listener.country);
  const avoid = new Set([scheduled, ...scheduledUpcoming.map((entry) => entry.item)].map((item) => item.videoId));
  const current = forListener(catalog, scheduled, country, `${located.cycle}:${located.position}`, avoid);
  const upcoming = scheduledUpcoming.map((entry) => forListener(catalog, entry.item, country, entry.slotKey, avoid));
  const mediaEndsAtMs = located.startsAtMs + scheduled.durationSeconds * 1000;
  const closes = sweeperClosesSlot(station, located.position);
  const nextCloses = sweeperClosesSlot(station, (located.position + 1) % located.order.length);
  const previousCloses = sweeperClosesSlot(station, (located.position - 1 + located.order.length) % located.order.length);
  const leadMs = sweeperLead(station) * 1000;
  const overlapMs = (station.sweeper?.overlapSeconds ?? 0) * 1000;
  const headSweeperAtMs = mediaEndsAtMs - leadMs;
  const inSweeper = Boolean(closes && nowMs >= mediaEndsAtMs);
  const crossMs = closes ? 0 : crossfadeSeconds(station) * 1000;
  const startsAtMs = inSweeper ? mediaEndsAtMs : located.startsAtMs;
  const endsAtMs = inSweeper ? mediaEndsAtMs + sweeperGap(station) * 1000 : mediaEndsAtMs - crossMs;
  const sweeperActive = Boolean(station.sweeper && (
    (closes && nowMs >= headSweeperAtMs)
    || (previousCloses && nowMs < located.startsAtMs + overlapMs)
  ));
  const sweeperStartedAtMs = closes && nowMs >= headSweeperAtMs
    ? headSweeperAtMs
    : located.startsAtMs - (sweeperGap(station) + sweeperLead(station)) * 1000;
  return {
    phase: inSweeper ? "sweeper" : "music",
    ...(station.sweeper ? { sweeper: station.sweeper } : {}),
    sweeperSlot: closes,
    sweeperNext: nextCloses,
    crossfadeSeconds: crossfadeSeconds(station),
    ...(sweeperActive ? { sweeperStartedAt: new Date(sweeperStartedAtMs).toISOString() } : {}),
    station: station.stationName,
    queueId: `${catalog.version}:${located.cycle}:${located.position}:${inSweeper ? "sweeper" : "music"}`,
    catalogVersion: catalog.version,
    serverTime: new Date(nowMs).toISOString(),
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    offsetSeconds: Math.max(0, inSweeper ? (nowMs - startsAtMs) / 1000 : Math.floor((nowMs - startsAtMs) / 1000)),
    cycle: located.cycle,
    position: located.position + 1,
    total: located.order.length,
    current,
    next: upcoming[0]!,
    upcoming,
    listeners,
  };
}

/**
 * Un navegador avisa que YouTube rechazó una pieza. Solo vale para lo que está al
 * aire o preparado a continuación, y decide el servidor. `null`: no está al aire.
 */
export async function reportRadioUnavailable(station: RadioStation, videoId: string, nowMs = Date.now(), listener: RadioListener = {}): Promise<{ excluded: boolean; verdict: RadioVerdict } | null> {
  const snapshot = radioSnapshot(station, nowMs, 0, listener);
  if (!snapshot) return null;
  if (![snapshot.current, ...snapshot.upcoming.slice(0, 2)].some((item) => item.videoId === videoId)) return null;
  const verdict = await availabilityOf(stateFor(station), station).verify(videoId, nowMs);
  radioLog("info", "radio_video_reported", { station: station.stationName, videoId, verdict });
  return { excluded: verdict === "unavailable" && Boolean(station.owner), verdict };
}

export interface RadioCatalogInspection {
  items: number; playable: number; version: string | null; totalDurationSeconds: number;
  genres: number; lastModified: string | null; error: string | null;
  /** Fuera del aire para todos: vetos en el país base o casi mundiales. */
  regionExcluded: number;
  /** Al aire, pero con relleno en los países que las vetan. */
  regionRestricted: number;
  regionRestrictedCountries: Array<{ country: string; items: number }>;
  excluded: number; unclassified: number; availabilityCheckedAt: string | null; owner: boolean;
}

const emptyInspection = (owner: boolean, error: string): RadioCatalogInspection => ({
  items: 0, playable: 0, version: null, totalDurationSeconds: 0, genres: 0, lastModified: null, error,
  regionExcluded: 0, regionRestricted: 0, regionRestrictedCountries: [], excluded: 0, unclassified: 0, availabilityCheckedAt: null, owner,
});

export function inspectCatalog(station: RadioStation): RadioCatalogInspection {
  const owner = Boolean(station.owner);
  try {
    const state = stateFor(station);
    const catalog = loadCatalog(state, station, Date.now());
    if (!catalog) return emptyInspection(owner, "el catálogo no se pudo leer");
    const counts = new Map<string, number>();
    let regionRestricted = 0;
    for (const item of catalog.items) {
      const blocked = item.regionRestriction?.blocked;
      if (!item.regionRestriction) continue;
      regionRestricted += 1;
      for (const country of blocked ?? []) counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    const store = availabilityOf(state, station);
    const excluded = catalog.file.items.filter((item) => store.isExcluded(item.videoId)).length;
    return {
      items: catalog.items.length,
      playable: catalog.items.length,
      version: catalog.version,
      totalDurationSeconds: catalog.totalDuration,
      genres: new Set(catalog.items.map((item) => genrePrimaryKey(item.genres)).filter(Boolean)).size,
      lastModified: fs.statSync(station.catalogPath).mtime.toISOString(),
      error: null,
      regionExcluded: catalog.file.regionExcluded,
      regionRestricted,
      regionRestrictedCountries: [...counts].map(([country, items]) => ({ country, items })).sort((a, b) => b.items - a.items || a.country.localeCompare(b.country)),
      excluded,
      unclassified: catalog.file.items.length - excluded - catalog.items.length,
      availabilityCheckedAt: catalog.file.availabilityCheckedAt,
      owner,
    };
  } catch (error) {
    return emptyInspection(owner, error instanceof Error ? error.message : String(error));
  }
}
