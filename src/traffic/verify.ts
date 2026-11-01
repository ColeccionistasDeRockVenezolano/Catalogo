// ¿Es el agente quien dice ser?
//
// Portado de Herra 1.1.36 (`dist/traffic/verify.js`) para la ventana 3.7. Tres
// respuestas posibles, y la interfaz las muestra tal cual:
//
//   verified    la IP está en la lista que publica el operador, o su DNS
//               inverso cae bajo el dominio documentado y resuelve de vuelta a
//               la misma IP.
//   spoofed     el operador ofrece una forma de comprobarlo y la IP no pasa:
//               alguien usa ese nombre sin serlo.
//   unverified  no hay forma de saberlo: el operador no publica nada, falta la
//               IP real del visitante (sin CF-Connecting-IP todo llega desde
//               loopback) o el DNS no respondió.
//
// Las listas se descargan una vez al día y se guardan en disco, así que un
// reinicio no deja la verificación a ciegas mientras vuelven a bajar. En CRV el
// timer es propio (no se descargan en cada petición) y la carpeta se configura
// con CRV_TRAFFIC_LISTS_DIR.
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { agentDef, RANGE_LISTS, type RangeListKey } from "./agents.js";
import { moduleLogger } from "../logger/index.js";

const log = moduleLogger("traffic");

export type Verification = "verified" | "unverified" | "spoofed" | "none";
export const VERIFICATIONS: readonly Verification[] = ["verified", "unverified", "spoofed", "none"];

const REFRESH_EVERY_MS = 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const DNS_TIMEOUT_MS = 3_000;
// Veredictos recordados por agente e IP. Un rastreador vuelve con la misma IP
// cientos de veces al día: sin caché cada visita sería una consulta DNS.
const CACHE_TTL_MS = 6 * 3600 * 1000;
const CACHE_MAX = 5_000;
// Una lista de más de esto no es una lista de rastreadores: se descarta.
const MAX_PREFIXES = 20_000;
const MAX_LIST_BYTES = 2 * 1024 * 1024;

interface ParsedPrefix { v6: boolean; base: bigint; bits: number }
interface StoredList { fetchedAt: string; prefixes: string[] }
interface RangesFile { lists: Partial<Record<RangeListKey, StoredList>> }

const parsed = new Map<RangeListKey, ParsedPrefix[]>();
let stored: RangesFile = { lists: {} };
let refreshTimer: NodeJS.Timeout | null = null;
let refreshing: Promise<void> | null = null;
let networkVerification = false;

function listsPath(): string {
  return process.env["CRV_TRAFFIC_LISTS_DIR"]?.trim()
    || path.join(os.homedir(), ".cache", "crv-traffic");
}

function rangesPath(): string {
  return path.join(listsPath(), "bot-ranges.json");
}

// ---- Direcciones --------------------------------------------------------------

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  // IPv4 embebida al final (::ffff:1.2.3.4): se reescribe como dos grupos hex.
  let address = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (dotted) {
    const v4 = ipv4ToBigInt(dotted[1]!);
    address = address.slice(0, -dotted[1]!.length) + `${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(tail !== undefined ? missing : 0).fill("0"), ...tailGroups];
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || "0", 16)), 0n);
}

// Normaliza la IP del visitante: una IPv4 que llega como ::ffff:a.b.c.d se
// compara contra los prefijos IPv4, que es como la publican los operadores.
function toAddress(ip: string): { v6: boolean; value: bigint } | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const candidate = mapped ? mapped[1]! : ip;
  const family = net.isIP(candidate);
  if (family === 4) return { v6: false, value: ipv4ToBigInt(candidate) };
  if (family === 6) return { v6: true, value: ipv6ToBigInt(candidate) };
  return null;
}

export function parsePrefix(prefix: string): ParsedPrefix | null {
  const [address, bitsRaw] = prefix.trim().split("/");
  const family = net.isIP(address ?? "");
  if (family === 0) return null;
  const v6 = family === 6;
  const width = v6 ? 128 : 32;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const value = v6 ? ipv6ToBigInt(address!) : ipv4ToBigInt(address!);
  const shift = BigInt(width - bits);
  return { v6, base: (value >> shift) << shift, bits };
}

function inPrefix(address: { v6: boolean; value: bigint }, prefix: ParsedPrefix): boolean {
  if (address.v6 !== prefix.v6) return false;
  const shift = BigInt((prefix.v6 ? 128 : 32) - prefix.bits);
  return ((address.value >> shift) << shift) === prefix.base;
}

export function ipInPrefixes(ip: string, prefixes: readonly string[]): boolean {
  const address = toAddress(ip);
  if (!address) return false;
  return prefixes.some((prefix) => {
    const p = parsePrefix(prefix);
    return p !== null && inPrefix(address, p);
  });
}

// ---- Listas publicadas --------------------------------------------------------

function applyStored(file: RangesFile): void {
  stored = file;
  parsed.clear();
  for (const key of Object.keys(RANGE_LISTS) as RangeListKey[]) {
    const list = file.lists[key];
    if (!list) continue;
    parsed.set(key, list.prefixes.map(parsePrefix).filter((p): p is ParsedPrefix => p !== null));
  }
}

// Formato común a todos los operadores: {"prefixes":[{"ipv4Prefix":"…"},{"ipv6Prefix":"…"}]}.
export function extractPrefixes(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { prefixes?: unknown }).prefixes;
  if (!Array.isArray(raw) || raw.length > MAX_PREFIXES) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as Record<string, unknown>)["ipv4Prefix"] ?? (entry as Record<string, unknown>)["ipv6Prefix"];
    if (typeof value === "string" && parsePrefix(value)) out.push(value.trim());
  }
  return out.length > 0 ? out : null;
}

function loadStoredRanges(): void {
  try {
    const body = JSON.parse(fs.readFileSync(rangesPath(), "utf8")) as RangesFile;
    if (body && typeof body === "object" && body.lists && typeof body.lists === "object") applyStored(body);
  } catch { /* Primera vez: aún no hay archivo. */ }
}

async function fetchList(key: RangeListKey): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RANGE_LISTS[key], {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "CRV bot-verification" },
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_LIST_BYTES) return null;
    return extractPrefixes(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshRanges(): Promise<void> {
  const next: RangesFile = { lists: { ...stored.lists } };
  const keys = Object.keys(RANGE_LISTS) as RangeListKey[];
  const results = await Promise.all(keys.map(async (key) => [key, await fetchList(key)] as const));
  const failed: string[] = [];
  for (const [key, prefixes] of results) {
    // Una descarga fallida conserva la lista anterior: mejor una lista de ayer
    // que declarar falsos a todos los rastreadores de ese operador.
    if (prefixes) next.lists[key] = { fetchedAt: new Date().toISOString(), prefixes };
    else failed.push(key);
  }
  applyStored(next);
  try {
    fs.mkdirSync(path.dirname(rangesPath()), { recursive: true });
    fs.writeFileSync(rangesPath(), JSON.stringify(next));
  } catch (error) {
    log.warn({ err: (error as Error).message }, "no se pudieron guardar las listas de IP");
  }
  verdicts.clear();
  log.info({ listas: keys.length - failed.length, fallidas: failed }, "listas de bots refrescadas");
}

function oldestFetch(): number {
  const times = (Object.keys(RANGE_LISTS) as RangeListKey[])
    .map((key) => Date.parse(stored.lists[key]?.fetchedAt ?? ""));
  return times.some((time) => !Number.isFinite(time)) ? 0 : Math.min(...times);
}

// Arranque: carga lo guardado y, si la verificación en red está encendida,
// refresca en segundo plano lo que tenga más de un día.
export function startBotVerification(options: { network: boolean } = { network: false }): void {
  loadStoredRanges();
  networkVerification = options.network;
  if (!networkVerification) return;
  const run = () => {
    if (refreshing) return;
    refreshing = refreshRanges().finally(() => { refreshing = null; });
  };
  if (Date.now() - oldestFetch() > REFRESH_EVERY_MS) run();
  refreshTimer = setInterval(run, REFRESH_EVERY_MS);
  refreshTimer.unref();
}

export function stopBotVerification(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

export function rangeListStatus(): Array<{ key: RangeListKey; fetchedAt: string | null; prefixes: number }> {
  return (Object.keys(RANGE_LISTS) as RangeListKey[]).map((key) => ({
    key, fetchedAt: stored.lists[key]?.fetchedAt ?? null, prefixes: parsed.get(key)?.length ?? 0,
  }));
}

// ---- Veredicto ----------------------------------------------------------------

const verdicts = new Map<string, { verdict: Verification; at: number }>();

function remember(cacheKey: string, verdict: Verification): Verification {
  if (verdicts.size >= CACHE_MAX) {
    const oldest = verdicts.keys().next().value;
    if (oldest !== undefined) verdicts.delete(oldest);
  }
  verdicts.set(cacheKey, { verdict, at: Date.now() });
  return verdict;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), DNS_TIMEOUT_MS).unref()),
  ]);
}

// FCrDNS: nombre inverso bajo el dominio del operador y, de vuelta, la misma IP.
async function reverseDnsMatches(ip: string, suffixes: readonly string[]): Promise<Verification> {
  let hostnames: string[];
  try {
    hostnames = await withTimeout(dns.reverse(ip));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Sin registro PTR: los rastreadores que documentan esta comprobación
    // siempre lo tienen, así que su ausencia es un impostor.
    return code === "ENOTFOUND" || code === "ENODATA" ? "spoofed" : "unverified";
  }
  const candidates = hostnames.filter((host) => suffixes.some((suffix) => host.toLowerCase().endsWith("." + suffix)));
  if (candidates.length === 0) return "spoofed";
  for (const host of candidates) {
    try {
      const addresses = await withTimeout(dns.lookup(host, { all: true }));
      if (addresses.some((entry) => entry.address === ip)) return "verified";
    } catch { return "unverified"; }
  }
  return "spoofed";
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Síncrono cuando basta con las listas; la promesa solo aparece si hace falta
// preguntar al DNS. Así el registro de tráfico no espera por lo que ya sabe.
export function verifyAgent(agentKey: string, ip: string | null): Verification | Promise<Verification> {
  const agent = agentDef(agentKey);
  if (!agent) return agentKey ? "unverified" : "none";
  const hasRanges = Boolean(agent.ranges?.length);
  const hasRdns = Boolean(agent.rdns?.length);
  if (!hasRanges && !hasRdns) return "unverified";
  if (!ip || LOOPBACK.has(ip) || !toAddress(ip)) return "unverified";

  const cacheKey = `${agent.key}|${ip}`;
  const cached = verdicts.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.verdict;

  const address = toAddress(ip)!;
  const lists = (agent.ranges ?? []).map((key) => parsed.get(key)).filter((list): list is ParsedPrefix[] => Boolean(list));
  if (lists.some((list) => list.some((prefix) => inPrefix(address, prefix)))) return remember(cacheKey, "verified");

  if (hasRdns && networkVerification) {
    return reverseDnsMatches(ip, agent.rdns!).then((verdict) => (
      verdict === "unverified" ? verdict : remember(cacheKey, verdict)
    ));
  }
  // Con listas cargadas y sin DNS, no estar en ellas es suficiente para
  // descartarlo. Sin listas (primer arranque sin red) no se sabe.
  return lists.length > 0 ? remember(cacheKey, "spoofed") : "unverified";
}
