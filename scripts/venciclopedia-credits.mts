// CRV · Créditos de sesión de Venciclopedia (2026-10-20).
//
// Las fichas de disco traen bloques `{{créditos}}` con músicos + instrumento,
// cargos técnicos + nombre y empresas + función. Es el aporte que el catálogo
// no tiene de ninguna otra fuente.
//
// Reglas anti-duplicación:
//   · NO se crea ninguna persona ni organización: el nombre debe resolver a
//     UNA ficha existente (variantes previsibles incluidas) o el crédito se
//     reporta y no se escribe;
//   · el crédito se inserta solo si no existe ya la misma terna
//     (álbum|pista, persona|artista, tipo, rol);
//   · un crédito con `pistas` va a `track_credits` de esa pista; sin `pistas`
//     va a `album_credits`. El lado del vinilo (A1, B2) se traduce con la misma
//     numeración que usa el adapter, donde la cara B es el mismo disco.
//
//   ./scripts/with-node22.sh npx tsx scripts/venciclopedia-credits.mts [--confirm]
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { VenciclopediaAdapter, parseWikiPages } from "../src/adapters/venciclopedia.js";
import { loadStoredAdapterPages } from "../src/ingest/runner.js";
import { normalizeIdentity } from "../src/normalization/claims.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";
import { getPool, closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { projectRoot } from "../src/config/project-root.js";

const SLUG = "venciclopedia";
const OPERATOR = "hermes-agent";
const NOTE = "Créditos de sesión de Venciclopedia (2026-10-20): músicos, técnicos y empresas enlazados solo contra fichas existentes; sin altas";
const ROOT = projectRoot(import.meta.url);
const OUT = path.join(ROOT, "reports", "venciclopedia-2026-10-20");
const CONFIRM = process.argv.includes("--confirm");

function titleKey(value: string): string {
  return value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
    .replace(/^(los|las|el|la)\s+/u, "").replace(/[^a-z0-9]+/g, "");
}

/** Cargo de la fuente → `credit_type` del catálogo. */
function creditTypeFor(role: string): string {
  const folded = role.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  if (/fotograf|foto\b/.test(folded)) return "photography";
  if (/productor|produccion|producido/.test(folded)) return "producer";
  if (/diseno|arte|ilustrac|logotipo|grafica/.test(folded)) return "artwork";
  if (/mezcla|mix/.test(folded)) return "mixing";
  if (/master/.test(folded)) return "mastering";
  if (/ingenier|grabaci|sonido|tecnico/.test(folded)) return "recording";
  if (/invitad|featuring|colabora/.test(folded)) return "guest";
  if (/letra|autor|compuest|musica de|composicion/.test(folded)) return "composer";
  return "other";
}

/** Extrae los pares sufijados (`músico1`, `músico1a`, `instrumento2b`…). */
function pairsOf(params: Record<string, string>, nameField: string, valueField: string): Array<{ value: string; name: string; note: string; tracks: string }> {
  const out: Array<{ value: string; name: string; note: string; tracks: string }> = [];
  const re = new RegExp(`^${nameField}(\\d+)([a-z]?)$`, "u");
  for (const [key, name] of Object.entries(params)) {
    const match = key.match(re);
    if (!match) continue;
    const [, index, suffix] = match;
    const value = params[`${valueField}${index}${suffix}`] ?? params[`${valueField}${index}`] ?? "";
    const note = params[`nota${index}${suffix}`] ?? params[`nota${index}`] ?? "";
    const tracks = params[`pistas${index}${suffix}`] ?? params[`pistas${index}`] ?? "";
    if (name.trim()) out.push({ value: value.trim(), name: name.trim(), note: note.trim(), tracks: tracks.trim() });
  }
  return out;
}

/** Mapa «A1»/«B2»/«3» → número de pista, con la numeración del adapter. */
function sideMap(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const blocks = [...content.matchAll(/\{\{\s*pistas([^}]*)\}\}/giu)].map((match) => match[1] ?? "");
  let number = 0;
  for (const block of blocks) {
    const side = (block.match(/\|\s*lado\s*=\s*([A-Za-z])/u)?.[1] ?? "").toUpperCase();
    const titles = [...block.matchAll(/\|\s*t[íi]tulo\d+\s*=/giu)].length;
    for (let i = 1; i <= titles; i += 1) {
      number += 1;
      const declared = block.match(new RegExp(`\\|\\s*pista${i}\\s*=\\s*([A-Za-z]?\\d+)`, "iu"))?.[1]?.toUpperCase();
      if (declared) map.set(declared, number);
      if (side) map.set(`${side}${i}`, number);
    }
  }
  return map;
}

// ── Lectura del crudo ───────────────────────────────────────────────────────
const adapter = new VenciclopediaAdapter();
const pages = await loadStoredAdapterPages(SLUG, adapter);
interface CreditWanted {
  albumIdentity: string; kind: "person" | "organization"; name: string; role: string;
  creditType: string; note: string; trackNumber?: number;
}
const wanted: CreditWanted[] = [];
const albumOfPage = new Map<string, { identity: string; title: string; content: string }>();

for (const page of pages) {
  for (const wiki of parseWikiPages(page.body)) {
    if (!/cr[ée]ditos/i.test(wiki.content)) continue;
    // La identidad sale del adapter: funciona con ficha `{{record}}` y también
    // en las páginas de disco que solo traen tracklist y créditos.
    const identity = adapter.releaseIdentity(wiki);
    if (!identity) continue;
    albumOfPage.set(wiki.title, { identity: `${identity.artist}::${identity.title}`, title: identity.title, content: wiki.content });
  }
}

function parseCredits(content: string): Array<{ params: Record<string, string> }> {
  const blocks: Array<{ params: Record<string, string> }> = [];
  for (const match of content.matchAll(/\{\{\s*cr[ée]ditos\s*\|([\s\S]*?)\n?\}\}/giu)) {
    const params: Record<string, string> = {};
    const body = match[1] ?? "";
    // Los parámetros van separados por «|» de nivel superior; aquí no hay
    // plantillas anidadas en los créditos, así que el split simple es fiel.
    for (const part of body.split("|")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    blocks.push({ params });
  }
  return blocks;
}

function stripLinks(value: string): string {
  return value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/'''/g, "").trim();
}

for (const album of albumOfPage.values()) {
  const map = sideMap(album.content);
  for (const block of parseCredits(album.content)) {
    const musicians = pairsOf(block.params, "músico", "instrumento");
    const alumni = pairsOf(block.params, "musico", "instrumento");
    for (const item of [...musicians, ...alumni]) {
      const role = stripLinks(item.value || "músico");
      const trackNumber = item.tracks ? map.get(item.tracks.toUpperCase().split(/[,\s]+/)[0] ?? "") : undefined;
      wanted.push({
        albumIdentity: album.identity, kind: "person", name: stripLinks(item.name),
        role: item.note ? `${role} (${stripLinks(item.note)})` : role,
        creditType: "musician", note: item.tracks ? `pistas ${item.tracks}` : "",
        ...(trackNumber === undefined ? {} : { trackNumber }),
      });
    }
    for (const item of pairsOf(block.params, "nombre", "cargo")) {
      const role = stripLinks(item.value || "colaborador");
      const trackNumber = item.tracks ? map.get(item.tracks.toUpperCase().split(/[,\s]+/)[0] ?? "") : undefined;
      wanted.push({
        albumIdentity: album.identity, kind: "person", name: stripLinks(item.name), role,
        creditType: creditTypeFor(role), note: item.tracks ? `pistas ${item.tracks}` : "",
        ...(trackNumber === undefined ? {} : { trackNumber }),
      });
    }
    for (const item of pairsOf(block.params, "empresa", "función")) {
      wanted.push({
        albumIdentity: album.identity, kind: "organization", name: stripLinks(item.name),
        role: stripLinks(item.value || "empresa"), creditType: creditTypeFor(item.value), note: "",
      });
    }
  }
}

console.log(`páginas con créditos: ${albumOfPage.size} · créditos leídos: ${wanted.length}`);

// ── Aplicación ──────────────────────────────────────────────────────────────
interface Stats {
  read: number; resolved: number; ambiguous: number; missing: number; noAlbum: number;
  insertedAlbum: number; insertedTrack: number; already: number; skippedTrack: number;
  missingNames: string[]; ambiguousNames: string[];
}

async function apply(client: PoolClient): Promise<Stats> {
  const stats: Stats = {
    read: wanted.length, resolved: 0, ambiguous: 0, missing: 0, noAlbum: 0,
    insertedAlbum: 0, insertedTrack: 0, already: 0, skippedTrack: 0,
    missingNames: [], ambiguousNames: [],
  };
  await client.query("SET LOCAL lock_timeout = '20s'");

  const { rows: personRows } = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons");
  const { rows: artistRows } = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists");
  const { rows: orgRows } = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.organizations");
  const index = new Map<string, Array<{ id: number; kind: "person" | "artist" | "organization" }>>();
  const push = (name: string, entry: { id: number; kind: "person" | "artist" | "organization" }): void => {
    for (const variant of predictableNameVariants(name)) {
      const list = index.get(variant) ?? []; list.push(entry); index.set(variant, list);
    }
  };
  for (const row of personRows) push(row.name, { id: Number(row.id), kind: "person" });
  for (const row of artistRows) push(row.name, { id: Number(row.id), kind: "artist" });
  for (const row of orgRows) push(row.name, { id: Number(row.id), kind: "organization" });

  const { rows: albumRows } = await client.query<{ id: string; artist_id: string; title: string }>(
    "SELECT id::text, artist_id::text, title FROM public.albums");
  const albumIndex = new Map<string, number[]>();
  for (const row of albumRows) {
    const key = `${row.artist_id}|${titleKey(row.title)}`;
    const list = albumIndex.get(key) ?? []; list.push(Number(row.id)); albumIndex.set(key, list);
  }
  const { rows: trackRows } = await client.query<{ id: string; album_id: string; track_number: number; disc_number: number }>(
    "SELECT id::text, album_id::text, track_number, disc_number FROM public.tracks");
  const trackIndex = new Map<string, number>();
  for (const row of trackRows) trackIndex.set(`${row.album_id}|${row.disc_number}|${row.track_number}`, Number(row.id));

  const { rows: existingAlbum } = await client.query<{ album_id: string; person_id: string | null; artist_id: string | null; organization_id: string | null; credit_type: string; role: string }>(
    "SELECT album_id::text, person_id::text, artist_id::text, organization_id::text, credit_type::text, role FROM public.album_credits");
  // La clave normaliza el rol: «Guitarra» y «guitarra» son el mismo crédito.
  const existingAlbumKeys = new Set(existingAlbum.map((row) => `${row.album_id}|${row.person_id ?? row.artist_id ?? row.organization_id}|${row.credit_type}|${titleKey(row.role)}`));
  const { rows: existingTrack } = await client.query<{ track_id: string; person_id: string | null; artist_id: string | null; credit_type: string; role: string }>(
    "SELECT track_id::text, person_id::text, artist_id::text, credit_type::text, role FROM public.track_credits");
  const existingTrackKeys = new Set(existingTrack.map((row) => `${row.track_id}|${row.person_id ?? row.artist_id}|${row.credit_type}|${titleKey(row.role)}`));

  for (const item of wanted) {
    const [artistName, albumTitle] = item.albumIdentity.split("::");
    if (!artistName || !albumTitle) { stats.noAlbum += 1; continue; }
    const artistIds = (() => {
      const found = new Set<number>();
      for (const variant of predictableNameVariants(artistName)) {
        for (const entry of index.get(variant) ?? []) if (entry.kind === "artist" || entry.kind === "person") found.add(entry.id);
      }
      return [...found];
    })();
    if (artistIds.length !== 1) { stats.noAlbum += 1; continue; }
    const albumIds = albumIndex.get(`${artistIds[0]}|${titleKey(albumTitle)}`) ?? [];
    if (albumIds.length !== 1) { stats.noAlbum += 1; continue; }
    const albumId = albumIds[0]!;

    const candidates = [...new Set((index.get(normalizeIdentity(item.name)) ?? []).concat(
      predictableNameVariants(item.name).flatMap((variant) => index.get(variant) ?? []),
    ).filter((entry) => item.kind === "organization" ? entry.kind === "organization" : entry.kind !== "organization")
      .map((entry) => `${entry.kind}:${entry.id}`))].map((key) => {
        const [kind, id] = key.split(":");
        return { kind: kind as "person" | "artist" | "organization", id: Number(id) };
      });
    if (candidates.length === 0) {
      stats.missing += 1;
      if (stats.missingNames.length < 60 && !stats.missingNames.includes(item.name)) stats.missingNames.push(item.name);
      continue;
    }
    // Un músico de sesión es una persona: si el nombre existe como persona Y
    // como artista, la persona es la lectura correcta y el empate se rompe.
    const people = candidates.filter((entry) => entry.kind === "person");
    const narrowed = people.length === 1 ? people : candidates;
    if (narrowed.length > 1) {
      stats.ambiguous += 1;
      if (stats.ambiguousNames.length < 40 && !stats.ambiguousNames.includes(item.name)) stats.ambiguousNames.push(item.name);
      continue;
    }
    const target = (people.length === 1 ? people[0]! : candidates[0]!);
    stats.resolved += 1;
    const role = item.role.slice(0, 200);

    if (item.trackNumber !== undefined) {
      const trackId = trackIndex.get(`${albumId}|1|${item.trackNumber}`);
      if (trackId === undefined) { stats.skippedTrack += 1; continue; }
      const key = `${trackId}|${target.id}|${item.creditType}|${titleKey(role)}`;
      if (existingTrackKeys.has(key)) { stats.already += 1; continue; }
      await client.query(
        `INSERT INTO public.track_credits(track_id, ${target.kind === "person" ? "person_id" : target.kind === "artist" ? "artist_id" : "organization_id"}, credit_type, role, notes)
         VALUES ($1,$2,$3::credit_type,$4,$5)`,
        [trackId, target.id, item.creditType, role, item.note || null],
      );
      existingTrackKeys.add(key);
      stats.insertedTrack += 1;
      continue;
    }

    const key = `${albumId}|${target.id}|${item.creditType}|${titleKey(role)}`;
    if (existingAlbumKeys.has(key)) { stats.already += 1; continue; }
    await client.query(
      `INSERT INTO public.album_credits(album_id, ${target.kind === "person" ? "person_id" : target.kind === "artist" ? "artist_id" : "organization_id"}, credit_type, role, notes)
       VALUES ($1,$2,$3::credit_type,$4,$5)`,
      [albumId, target.id, item.creditType, role, item.note || null],
    );
    existingAlbumKeys.add(key);
    stats.insertedAlbum += 1;
  }
  return stats;
}

let stats: Stats;
if (CONFIRM) {
  const outcome = await withOperatorRun({ name: "venciclopedia:credits", operator: OPERATOR, note: NOTE }, (context) => apply(context.client), { serializable: false });
  stats = outcome.result;
  console.log(`run de créditos: ${outcome.runId}`);
} else {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    stats = await apply(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, CONFIRM ? "creditos.json" : "creditos-dry-run.json"), JSON.stringify(stats, null, 1));
console.log(JSON.stringify({ ...stats, missingNames: stats.missingNames.length, ambiguousNames: stats.ambiguousNames.length }, null, 1));
console.log("sin ficha (muestra):", stats.missingNames.slice(0, 12).join(" · "));
console.log("ambiguos (muestra):", stats.ambiguousNames.slice(0, 8).join(" · "));
await closeDb();
