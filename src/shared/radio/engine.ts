// CRV · Motor de radio determinista (Fase 3).
//
// Portado del motor de Herra para que el catálogo pueda calcular la misma
// emisión al mismo segundo. La fuente de verdad sigue siendo el catálogo
// exportado y su configuración (`auth.project_features`, feature `radio`);
// este módulo no escribe nada: solo lee el catálogo, sus exclusiones y el
// respaldo de géneros.
import crypto from "node:crypto";
import fs from "node:fs";
import { genrePrimaryKey, type RadioItemGenres } from "./genres.js";
import { genreProgrammingOrder } from "./programming.js";

export type { RadioItemGenres } from "./genres.js";

export interface RadioRegionRestriction { allowed?: string[]; blocked?: string[] }
export interface RadioCatalogItem {
  videoId: string; title: string; artist: string | null; album: string; year: number | null;
  trackNumber: number; startSeconds: number; durationSeconds: number; available: true;
  genres?: RadioItemGenres | null;
  regionRestriction?: RadioRegionRestriction;
}
export interface RadioSweeper {
  src: string; durationSeconds: number; overlapSeconds?: number; leadSeconds?: number; everyPieces?: number;
}
export interface RadioStation {
  sweeper?: RadioSweeper;
  crossfadeSeconds?: number;
  catalogPath: string;
  epochMs: number;
  stationName: string;
}
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
const SUPPORTED_VERSIONS = new Set<unknown>([2, 3]);
const UPCOMING_COUNT = 6;
const GENRE_COVERAGE_MIN = 0.9;
const COMPILATION_ARTIST = /^(various artists|varios artistas|v\.?\s?a\.?)$/iu;

interface CatalogFile {
  version: number; generatedAt: string; availabilityCheckedAt: string; channelId: string;
  items: RadioCatalogItem[]; regionPolicy?: unknown;
}
interface CatalogCache {
  path: string; mtimeMs: number; version: string; totalDuration: number;
  items: RadioCatalogItem[];
}
interface EngineState {
  catalog: CatalogCache | null;
  baseOrders: Map<string, RadioCatalogItem[]>;
  orders: Map<string, RadioCatalogItem[]>;
}
const states = new Map<string, EngineState>();

function stateKey(station: RadioStation): string {
  return `${station.catalogPath}\n${station.epochMs}\n${JSON.stringify(station.sweeper ?? null)}\n${crossfadeSeconds(station)}`;
}

function stateFor(station: RadioStation): EngineState {
  const key = stateKey(station);
  let state = states.get(key);
  if (!state) {
    state = { catalog: null, baseOrders: new Map(), orders: new Map() };
    states.set(key, state);
  }
  return state;
}

export function resetRadioEngineForTests(): void {
  states.clear();
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

function regionBlocks(item: { regionRestriction?: RadioRegionRestriction }, country: string): boolean {
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

function parseCatalogFile(filePath: string): { items: RadioCatalogItem[]; version: unknown; availabilityCheckedAt: string; regionPolicy: RadioRegionPolicy } {
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
  return { items: airable, version: raw.version, availabilityCheckedAt: String(raw.availabilityCheckedAt), regionPolicy };
}

function exclusions(filePath: string): Set<string> {
  const excluded = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(`${filePath}.unavailable.json`, "utf8")) as { videos?: Record<string, unknown> };
    for (const videoId of Object.keys(raw.videos ?? {})) {
      if (/^[A-Za-z0-9_-]{11}$/u.test(videoId)) excluded.add(videoId);
    }
  } catch { /* sin exclusiones */ }
  return excluded;
}

function genreBackup(filePath: string): Map<string, RadioItemGenres> {
  const map = new Map<string, RadioItemGenres>();
  try {
    const raw = JSON.parse(fs.readFileSync(`${filePath}.genres.json`, "utf8")) as { videos?: Record<string, unknown> };
    for (const [videoId, genres] of Object.entries(raw.videos ?? {})) {
      const parsed = parseGenres(genres);
      if (parsed && videoId) map.set(videoId, parsed);
    }
  } catch { /* sin respaldo */ }
  return map;
}

function applyGenreBackup(filePath: string, items: readonly RadioCatalogItem[]): RadioCatalogItem[] {
  const backup = genreBackup(filePath);
  if (backup.size === 0) return items.slice();
  return items.map((item) => {
    if (genrePrimaryKey(item.genres)) return item;
    const saved = backup.get(item.videoId);
    return saved ? { ...item, genres: saved } : item;
  });
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

function loadCatalog(station: RadioStation): CatalogCache | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(station.catalogPath); } catch { return null; }
  const state = stateFor(station);
  if (state.catalog?.path === station.catalogPath && state.catalog.mtimeMs === stat.mtimeMs) return state.catalog;
  try {
    const parsed = parseCatalogFile(station.catalogPath);
    const excluded = exclusions(station.catalogPath);
    const playable = parsed.items.filter((item) => !excluded.has(item.videoId));
    const restored = applyGenreBackup(station.catalogPath, playable);
    const items = effectiveCatalogItems(restored);
    if (items.length < 2) return null;
    const digest = crypto.createHash("sha256")
      .update(JSON.stringify(items.map((item) => [item.videoId, item.startSeconds, item.durationSeconds])))
      .digest("hex").slice(0, 16);
    state.catalog = {
      path: station.catalogPath,
      mtimeMs: stat.mtimeMs,
      version: digest,
      totalDuration: items.reduce((sum, item, index) => sum + slotSeconds(station, item, index), 0),
      items,
    };
    state.baseOrders.clear();
    state.orders.clear();
    return state.catalog;
  } catch {
    state.catalog = null;
    return null;
  }
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

export function radioSnapshot(station: RadioStation, nowMs = Date.now(), listeners = 0): RadioSnapshot | null {
  const state = stateFor(station);
  const catalog = loadCatalog(station);
  if (!catalog) return null;
  const located = locate(state, station, catalog, nowMs);
  const scheduled = located.order[located.position]!;
  const upcoming: RadioCatalogItem[] = [];
  let candidateCycle = located.cycle;
  let candidatePosition = located.position + 1;
  while (upcoming.length < Math.min(UPCOMING_COUNT, catalog.items.length - 1)) {
    const candidateOrder = candidateCycle === located.cycle ? located.order : rawOrder(state, catalog, candidateCycle);
    if (candidatePosition >= candidateOrder.length) {
      candidateCycle += 1;
      candidatePosition = 0;
      continue;
    }
    upcoming.push(candidateOrder[candidatePosition]!);
    candidatePosition += 1;
  }
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
    current: scheduled,
    next: upcoming[0]!,
    upcoming,
    listeners,
  };
}

export interface RadioCatalogInspection {
  items: number; playable: number; version: string | null; totalDurationSeconds: number;
  genres: number; lastModified: string | null; error: string | null;
}

export function inspectCatalog(station: RadioStation): RadioCatalogInspection {
  try {
    const catalog = loadCatalog(station);
    if (!catalog) return { items: 0, playable: 0, version: null, totalDurationSeconds: 0, genres: 0, lastModified: null, error: "el catálogo no se pudo leer" };
    return {
      items: catalog.items.length,
      playable: catalog.items.length,
      version: catalog.version,
      totalDurationSeconds: catalog.totalDuration,
      genres: new Set(catalog.items.map((item) => genrePrimaryKey(item.genres)).filter(Boolean)).size,
      lastModified: fs.statSync(station.catalogPath).mtime.toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      items: 0, playable: 0, version: null, totalDurationSeconds: 0, genres: 0, lastModified: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Pieza y fin de tramo en un instante; útil para la sombra. */
export function radioPieceAt(station: RadioStation, nowMs = Date.now()): { item: RadioCatalogItem; startsAtMs: number; endsAtMs: number } | null {
  const state = stateFor(station);
  const catalog = loadCatalog(station);
  if (!catalog) return null;
  const located = locate(state, station, catalog, nowMs);
  const item = located.order[located.position]!;
  return { item, startsAtMs: located.startsAtMs, endsAtMs: located.startsAtMs + slotSeconds(station, item, located.position) * 1000 };
}
