// CRV · Configuración de la estación de radio (Fase 3).
//
// La configuración viaja con el proyecto en `auth.project_features` (feature
// `radio`, config v5). Durante la transición el catálogo se lee del directorio
// de datos que exporta Herra; en el paquete final ese directorio pasa a ser el
// del catálogo. Nadie escribe aquí: la exportación sigue siendo de Herra hasta
// el go-live.
import path from "node:path";
import { getPool } from "../../db/client.js";
import { getEnv } from "../../config/env.js";
import type { RadioStation, RadioSweeper } from "./engine.js";

export interface RadioTexts { stationName?: string; roadmapIntro?: string }
export interface RadioConfig {
  sweeper?: RadioSweeper;
  crossfadeSeconds: number;
  catalogFile: string;
  epoch: string;
  stationName: string;
  roadmapIntro: string | null;
  i18n: { en?: RadioTexts };
  channelId: string | null;
  channelTitle: string | null;
  trackingSheetId: string | null;
  readOnlySheetIds: string[];
  exportSchedule: string;
}

interface FeatureRow { enabled: number; config_json: string; schema_version: number }

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/gu, " ");
  return clean && clean.length <= max ? clean : null;
}

function parseSweeper(value: unknown): RadioSweeper | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const src = typeof raw["src"] === "string" ? raw["src"] : "";
  const durationSeconds = Number(raw["durationSeconds"]);
  if (!/^radio\/[A-Za-z0-9_-]+\.(wav|mp3|ogg)$/u.test(src)) return undefined;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) return undefined;
  const sweeper: RadioSweeper = { src, durationSeconds };
  for (const field of ["overlapSeconds", "leadSeconds"] as const) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < durationSeconds) {
      sweeper[field] = value;
    }
  }
  const every = raw["everyPieces"];
  if (typeof every === "number" && Number.isInteger(every) && every >= 1 && every <= 50) sweeper.everyPieces = every;
  return sweeper;
}

export function parseRadioConfig(configJson: unknown, schemaVersion: number): RadioConfig | null {
  if (!configJson || typeof configJson !== "object" || Array.isArray(configJson)) return null;
  if (schemaVersion > 5 || schemaVersion < 1) return null;
  const raw = configJson as Record<string, unknown>;
  const catalogFile = typeof raw["catalogFile"] === "string" ? raw["catalogFile"].trim() : "";
  const epoch = typeof raw["epoch"] === "string" ? raw["epoch"].trim() : "";
  const stationName = text(raw["stationName"], 40);
  if (!catalogFile || !/^[A-Za-z0-9_./-]+\.json$/u.test(catalogFile) || catalogFile.includes("..") || path.isAbsolute(catalogFile)) return null;
  if (!Number.isFinite(Date.parse(epoch)) || !stationName) return null;
  const crossfade = Number(raw["crossfadeSeconds"]);
  const i18n = raw["i18n"] && typeof raw["i18n"] === "object" && !Array.isArray(raw["i18n"])
    ? raw["i18n"] as Record<string, unknown> : {};
  const en = i18n["en"] && typeof i18n["en"] === "object" && !Array.isArray(i18n["en"])
    ? i18n["en"] as Record<string, unknown> : {};
  const readOnly = Array.isArray(raw["readOnlySheetIds"])
    ? raw["readOnlySheetIds"].filter((id): id is string => typeof id === "string")
    : [];
  const sweeper = parseSweeper(raw["sweeper"]);
  return {
    ...(sweeper ? { sweeper } : {}),
    crossfadeSeconds: Number.isFinite(crossfade) && crossfade >= 0 && crossfade <= 5 ? crossfade : 0,
    catalogFile,
    epoch,
    stationName,
    roadmapIntro: text(raw["roadmapIntro"], 600),
    i18n: {
      ...(text(en["stationName"], 40) || text(en["roadmapIntro"], 600)
        ? { en: {
          ...(text(en["stationName"], 40) ? { stationName: text(en["stationName"], 40)! } : {}),
          ...(text(en["roadmapIntro"], 600) ? { roadmapIntro: text(en["roadmapIntro"], 600)! } : {}),
        } }
        : {}),
    },
    channelId: text(raw["channelId"], 40),
    channelTitle: text(raw["channelTitle"], 120),
    trackingSheetId: text(raw["trackingSheetId"], 128),
    readOnlySheetIds: readOnly,
    exportSchedule: text(raw["exportSchedule"], 60) ?? "0 4 * * *",
  };
}

export function radioDataDir(): string {
  return getEnv().CRV_RADIO_DATA_DIR ?? path.join(process.cwd(), "data", "radio");
}

export async function loadRadioConfig(projectId: number): Promise<RadioConfig | null> {
  const { rows } = await getPool().query<FeatureRow>(
    "SELECT enabled, config_json, schema_version FROM auth.project_features WHERE project_id = $1 AND feature = 'radio'",
    [projectId]);
  const row = rows[0];
  if (!row || row.enabled !== 1) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(row.config_json); } catch { return null; }
  return parseRadioConfig(parsed, row.schema_version);
}

export function radioStationFromConfig(config: RadioConfig, dataDir = radioDataDir()): RadioStation {
  return {
    ...(config.sweeper ? { sweeper: config.sweeper } : {}),
    crossfadeSeconds: config.crossfadeSeconds,
    catalogPath: path.resolve(dataDir, config.catalogFile),
    epochMs: Date.parse(config.epoch),
    stationName: config.stationName,
  };
}

export function radioTexts(config: RadioConfig, lang: "es" | "en"): { stationName: string; roadmapIntro: string | null } {
  const translated = lang === "en" ? config.i18n.en ?? {} : {};
  return {
    stationName: translated.stationName ?? config.stationName,
    roadmapIntro: translated.roadmapIntro ?? config.roadmapIntro,
  };
}
