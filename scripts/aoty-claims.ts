#!/usr/bin/env tsx
/**
 * Emite claims de AOTY (fuente album-of-the-year) para campos VACÍOS del catálogo:
 *   - albums.cover_url        (portada 750x0)
 *   - albums.release_date_text
 *   - artists.picture_url
 *
 * Nunca propone un campo que ya tenga valor: el merge engine, además, solo rellena
 * vacíos y abre conflicto si algo cambia. Sin --confirm solo cuenta.
 *
 * Uso: npm run cli -- x  |  ./scripts/with-node22.sh tsx scripts/aoty-claims.ts [--confirm] [--source=31684]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/client.js";
import { persistClaim } from "../src/claims/persistence.js";

const CAPTURE = "data/raw/aoty-2026-10-19";
const EXTRACTOR = "aoty-capture-2026-10-19";
const VERSION = "1";
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SOURCE_ID = Number(args.find((a) => a.startsWith("--source="))?.split("=")[1] ?? 31684);

function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function baseTitle(s: unknown): string {
  return norm(String(s ?? "").replace(/\((?:[^()]*)\)|\[[^\]]*\]/g, " ").split(/\s[-–]\s(?:single|ep|album|deluxe|remaster)/i)[0]);
}

interface AotyArtist { name: string; url: string; image?: string; image_large?: unknown }
interface AotyAlbum { artist?: string; title?: string; url: string; cover?: string; cover_large?: unknown; details?: Record<string, { text?: string }> }

function jsonl<T>(file: string): T[] {
  return readFileSync(`${CAPTURE}/${file}`, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

function detail(pub: AotyAlbum, key: string): string {
  const t = pub.details?.[key]?.text ?? "";
  return String(t).replace(new RegExp(`\\s*/\\s*${key}\\s*$`), "").trim();
}

async function main() {
  const pool = getPool();
  const exists = (await pool.query("SELECT id FROM ingest.sources WHERE id=$1 AND enabled", [SOURCE_ID])).rows[0];
  if (!exists) throw new Error(`fuente ${SOURCE_ID} inexistente o deshabilitada`);

  const artists = jsonl<AotyArtist>("artists.jsonl");
  const albums = jsonl<AotyAlbum>("albums.jsonl");

  const catArtists = new Map<string, { id: number; name: string; picture_url: string | null }>();
  for (const r of (await pool.query("SELECT id, name, picture_url FROM public.artists")).rows) {
    const k = norm(r.name);
    if (!catArtists.has(k)) catArtists.set(k, { id: Number(r.id), name: r.name, picture_url: r.picture_url });
  }
  const catAlbums = new Map<string, { id: number; cover: string | null; date: string | null }>();
  for (const r of (await pool.query("SELECT artist_id, title, id, cover_url, release_date_text FROM public.albums")).rows) {
    const base = { id: Number(r.id), cover: r.cover_url, date: r.release_date_text };
    catAlbums.set(`${r.artist_id}|${norm(r.title)}`, base);
    const b = `${r.artist_id}|b:${baseTitle(r.title)}`;
    if (!catAlbums.has(b)) catAlbums.set(b, base);
  }

  const artistMatch = new Map<string, { id: number; name: string; picture_url: string | null }>();
  for (const a of artists) {
    const hit = catArtists.get(norm(a.name));
    if (hit) artistMatch.set(a.name, hit);
  }

  const counters = { cover: 0, date: 0, picture: 0, skipped: 0 };
  const plan: Array<{ kind: "album" | "artist"; id: number; field: string; value: string; url: string; identity: string }> = [];

  for (const pub of albums) {
    const cand = artistMatch.get(String(pub.artist ?? ""));
    if (!cand) { counters.skipped++; continue; }
    const key = `${cand.id}|${norm(pub.title)}`;
    const row = catAlbums.get(key) ?? catAlbums.get(`${cand.id}|b:${baseTitle(pub.title)}`);
    if (!row) { counters.skipped++; continue; }
    const cover = String(pub.cover_large || pub.cover || "");
    if (!row.cover && cover && /^https?:\/\//.test(cover)) {
      counters.cover++;
      plan.push({ kind: "album", id: row.id, field: "cover_url", value: cover, url: pub.url, identity: `${pub.artist} — ${pub.title}` });
    }
    const date = detail(pub, "Release Date");
    if (!row.date && date) {
      counters.date++;
      plan.push({ kind: "album", id: row.id, field: "release_date_text", value: date, url: pub.url, identity: `${pub.artist} — ${pub.title}` });
    }
  }

  for (const a of artists) {
    const hit = artistMatch.get(a.name);
    if (!hit || hit.picture_url) continue;
    const img = String(a.image_large || a.image || "");
    if (!img) continue;
    counters.picture++;
    plan.push({ kind: "artist", id: hit.id, field: "picture_url", value: String(img), url: a.url, identity: a.name });
  }

  console.log(JSON.stringify({ source: SOURCE_ID, confirm: CONFIRM, ...counters }, null, 1));
  if (!CONFIRM) {
    console.log("dry-run: nada escrito (usar --confirm)");
    await pool.end();
    return;
  }

  let inserted = 0, prior = 0;
  for (const p of plan) {
    const evidence = { url: p.url, excerpt: `AOTY · ${p.identity} · ${p.field}: ${p.value}` };
    const rawValue = { field: p.field, value: p.value, source: "albumoftheyear" };
    const res = await persistClaim({
      entityKind: p.kind,
      ...(p.kind === "album" ? { albumId: p.id } : { artistId: p.id }),
      sourceId: SOURCE_ID,
      field: p.field,
      rawValue,
      normalizedValue: p.value,
      rawHash: createHash("sha256").update(JSON.stringify([p.kind, p.id, p.field, p.value])).digest("hex"),
      identity: `aoty:${p.kind}:${p.id}:${p.field}`,
      identitySecondary: p.url,
      originalIdentity: p.identity,
      extractor: EXTRACTOR,
      extractorVersion: VERSION,
      confidence: "medium",
      createdBy: "system",
      evidence,
    });
    if (res.inserted) inserted++; else prior++;
  }
  console.log(JSON.stringify({ inserted, already: prior }));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
