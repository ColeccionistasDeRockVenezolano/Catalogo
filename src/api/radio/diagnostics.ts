// CRV · Diagnóstico de escucha de la radio (Fase 3, portado de Herra 1.1.39).
//
// El reproductor avisa cuando debería sonar y no suena, cuando vuelve, cuando
// YouTube da error y cuando la API deja de responderle. El servidor recorta lo que
// recibe a una forma acotada y lo anota en `radio-diagnostics.jsonl`, junto a lo
// que emitía en ese instante. No guarda IP, cuenta ni User-Agent: solo el país y un
// resumen del navegador.
import fs from "node:fs";
import path from "node:path";

export const RADIO_DIAGNOSTIC_KINDS = ["stall", "stall_end", "stall_abandoned", "player_error", "api_outage_end", "bg_relay", "player_reload", "hidden_relay", "playback_quality"] as const;
export type RadioDiagnosticKind = (typeof RADIO_DIAGNOSTIC_KINDS)[number];
const MAX_DEPTH = 5;
const MAX_KEYS = 60;
const MAX_ARRAY = 100;
const MAX_STRING = 300;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,48}$/u;
export const RADIO_DIAGNOSTICS_MAX_BYTES = 20 * 1024 * 1024;
export const RADIO_DIAGNOSTICS_FILE = "radio-diagnostics.jsonl";

export function isRadioDiagnosticKind(value: unknown): value is RadioDiagnosticKind {
  return typeof value === "string" && (RADIO_DIAGNOSTIC_KINDS as readonly string[]).includes(value);
}

/** Copia acotada de un valor JSON. Lo que no cabe se recorta; lo que no es JSON simple se descarta. */
export function sanitizeDiagnostic(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    // Del rastro interesa lo último.
    const out: unknown[] = [];
    for (const entry of value.slice(-MAX_ARRAY)) {
      const item = sanitizeDiagnostic(entry, depth + 1);
      if (item !== undefined) out.push(item);
    }
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (count >= MAX_KEYS) break;
      if (!KEY_PATTERN.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const clean = sanitizeDiagnostic(entry, depth + 1);
      if (clean === undefined) continue;
      out[key] = clean;
      count += 1;
    }
    return out;
  }
  return undefined;
}

/** Familia, versión mayor y sistema. El texto completo nunca se guarda; Brave se declara aparte. */
export function summarizeUserAgent(ua: string | undefined, brave = false, appleTouch = false): { browser: string; version: string | null; os: string; mobile: boolean } {
  const text = ua ?? "";
  const pick = (pattern: RegExp): string | null => pattern.exec(text)?.[1] ?? null;
  let browser = "otro";
  let version: string | null = null;
  const rules: Array<[string, RegExp]> = [
    ["Edge", /Edg(?:A|iOS)?\/(\d+)/u],
    ["Opera", /(?:OPR|OPT)\/(\d+)/u],
    ["Samsung Internet", /SamsungBrowser\/(\d+)/u],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/u],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/u],
    ["Safari", /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//u],
  ];
  for (const [name, pattern] of rules) {
    const found = pick(pattern);
    if (found) { browser = name; version = found; break; }
  }
  if (brave && browser === "Chrome") browser = "Brave";
  let os = "otro";
  if (/iPhone|iPad|iPod/u.test(text)) os = `iOS ${pick(/OS (\d+)[_\d]* like Mac/u) ?? ""}`.trim();
  else if (/Android/u.test(text)) os = `Android ${pick(/Android (\d+)/u) ?? ""}`.trim();
  else if (/Windows NT/u.test(text)) os = "Windows";
  else if (/CrOS/u.test(text)) os = "ChromeOS";
  else if (/Mac OS X/u.test(text)) os = appleTouch ? "iPadOS" : "macOS";
  else if (/Linux/u.test(text)) os = "Linux";
  return { browser, version, os, mobile: appleTouch || /Mobi|Android|iPhone|iPad|iPod/u.test(text) };
}

/** Una línea JSON; rota al crecer y deja el actual y uno anterior. */
export function appendRadioDiagnostic(logDir: string, entry: unknown, maxBytes = RADIO_DIAGNOSTICS_MAX_BYTES): string {
  const file = path.join(logDir, RADIO_DIAGNOSTICS_FILE);
  fs.mkdirSync(logDir, { recursive: true });
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch { /* todavía no existe */ }
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return file;
}

export interface RadioQualityGroup {
  device: string; browser: string; os: string; pieces: number; identifiers: number;
  withIssues: number; observedMs: number; interruptedMs: number; frozenMs: number;
  unobservedMs: number; maxAheadMs: number; maxBehindMs: number; issues: Record<string, number>;
}

/** Cada pieza cuenta una vez: los lotes son acumulados y pueden reenviarse. */
export function summarizeRadioQuality(entries: Array<Record<string, unknown>>): RadioQualityGroup[] {
  const latest = new Map<string, { piece: Record<string, unknown>; entry: Record<string, unknown> }>();
  for (const entry of entries) {
    if (entry["kind"] !== "playback_quality") continue;
    const report = entry["report"] as Record<string, unknown> | undefined;
    const measurement = report?.["measurement"] as Record<string, unknown> | undefined;
    if (typeof report?.["reportId"] !== "string" || !Array.isArray(measurement?.["pieces"])) continue;
    const pageId = report["reportId"].replace(/:\d+$/u, "");
    for (const value of measurement["pieces"] as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const piece = value as Record<string, unknown>;
      if (typeof piece["id"] !== "string" || piece["firstObservedAt"] == null) continue;
      const key = `${pageId}|${piece["id"]}`;
      const previous = latest.get(key);
      if (previous && Number(previous.piece["sampleCount"]) > Number(piece["sampleCount"])) continue;
      if (previous && previous.piece["outcome"] === "ended" && piece["outcome"] === "ongoing") continue;
      latest.set(key, { piece, entry });
    }
  }
  const groups = new Map<string, RadioQualityGroup>();
  const number = (piece: Record<string, unknown>, key: string): number => {
    const value = piece[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  };
  for (const { piece, entry } of latest.values()) {
    const device = entry["device"] as Record<string, unknown> | null;
    const type = typeof device?.["type"] === "string" ? device["type"] : "unknown";
    const browser = String(entry["browser"] ?? "otro");
    const os = String(entry["os"] ?? "otro");
    const key = JSON.stringify([type, browser, os]);
    const group = groups.get(key) ?? {
      device: type, browser, os, pieces: 0, identifiers: 0, withIssues: 0, observedMs: 0,
      interruptedMs: 0, frozenMs: 0, unobservedMs: 0, maxAheadMs: 0, maxBehindMs: 0, issues: Object.create(null) as Record<string, number>,
    };
    const issues = Array.isArray(piece["issues"]) ? piece["issues"].filter((item): item is string => typeof item === "string" && KEY_PATTERN.test(item)) : [];
    group.pieces += 1;
    if (piece["kind"] === "identifier") group.identifiers += 1;
    if (issues.length) group.withIssues += 1;
    for (const issue of new Set(issues)) group.issues[issue] = (group.issues[issue] ?? 0) + 1;
    group.observedMs += number(piece, "observedMs");
    group.interruptedMs += number(piece, "interruptedMs");
    group.frozenMs += number(piece, "frozenMs");
    group.unobservedMs += number(piece, "unobservedMs");
    group.maxAheadMs = Math.max(group.maxAheadMs, number(piece, "maxAheadMs"));
    group.maxBehindMs = Math.max(group.maxBehindMs, number(piece, "maxBehindMs"));
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Resumen para el panel: los últimos avisos, sin el rastro completo. */
export function recentRadioDiagnostics(logDir: string, limit = 20): { total: number; byKind: Record<string, number>; recent: Array<Record<string, unknown>>; quality: RadioQualityGroup[] } {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(path.join(logDir, RADIO_DIAGNOSTICS_FILE), "utf8").split("\n").filter(Boolean);
  } catch { /* sin avisos */ }
  const byKind: Record<string, number> = {};
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      byKind[String(entry["kind"])] = (byKind[String(entry["kind"])] ?? 0) + 1;
      parsed.push(entry);
    } catch { /* línea cortada por una rotación */ }
  }
  const recent = parsed.slice(-limit).reverse().map((entry) => ({
    receivedAt: entry["receivedAt"], kind: entry["kind"], country: entry["country"], browser: entry["browser"], os: entry["os"],
    server: entry["server"] ?? null,
    device: entry["device"] ?? null,
    measurement: (entry["report"] as Record<string, unknown> | undefined)?.["measurement"] ?? null,
  }));
  return { total: parsed.length, byKind, recent, quality: summarizeRadioQuality(parsed) };
}
