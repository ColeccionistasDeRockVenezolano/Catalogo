// Perfiles por fuente de un artista y votación por campo, sin modelo de IA.
// Busca al artista en Deezer, iTunes, MusicBrainz, Discogs y Last.fm; confirma
// la identidad comparando los discos que ya tiene la ficha; arma una versión
// del artista por fuente y vota cada campo por familias de origen.
// No escribe en el catálogo: deja profiles.json, comparison.json e informe.md.
//
// Uso: npx tsx scripts/source-profiles.ts <artistId> --out <dir> [--cache <dir>] [--offline] [--sources deezer,itunes,...]
// La caché de respuestas es una captura: va al staging del SSD
// (scripts/staging.py new data/raw <campaña>) y se publica al cerrar.
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { closeDb, getPool } from "../src/db/client.js";
import type { SourceAttempt } from "../src/verification/source-profile-adapters.js";
import { PROFILE_SOURCES, runSourceProfiles, type SourceProfileRun } from "../src/verification/source-profile-run.js";
import type { CatalogArtist, FieldVote, ProfileSourceSlug, SourceProfile, WorkComparison, compareArtist } from "../src/verification/source-profiles.js";

loadDotenv();
const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const artistId = Number(process.argv[2]);
if (!Number.isInteger(artistId)) throw new Error("uso: source-profiles.ts <artistId> --out <dir>");
const out = arg("--out") ?? path.join(os.tmpdir(), `crv-source-profiles-${artistId}`);
const sources = (arg("--sources")?.split(",") ?? PROFILE_SOURCES) as ProfileSourceSlug[];

const run = await runSourceProfiles(getPool(), artistId, {
  sources, offline: process.argv.includes("--offline"), log: (line) => console.log(line),
  ...(arg("--cache") ? { cacheDir: arg("--cache")! } : {}),
});
const { artist, attempts, profiles, works, artistFields } = run;
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "profiles.json"), JSON.stringify({ artist, attempts, knownIds: run.knownIds, requests: run.requests }, null, 2));
await writeFile(path.join(out, "comparison.json"), JSON.stringify({ artist: artistFields, works }, null, 2));
await writeFile(path.join(out, "informe.md"), report(artist, attempts, profiles, artistFields, works, run));
console.log(`\nInforme en ${path.join(out, "informe.md")}`);
await closeDb();

function cell<T>(vote: FieldVote<T>, source: ProfileSourceSlug): string {
  if (!(source in vote.bySource)) return "·";
  const value = vote.bySource[source];
  return value === null || value === undefined ? "—" : String(value);
}

function report(catalog: CatalogArtist, tried: Partial<Record<ProfileSourceSlug, SourceAttempt>>, confirmed: SourceProfile[], fields: ReturnType<typeof compareArtist>, compared: WorkComparison[], context: SourceProfileRun): string {
  const order = confirmed.map((profile) => profile.source);
  const lines = [`# Perfiles por fuente · ${catalog.name} (${catalog.id})`, "", `Generado ${new Date().toISOString()} · sin modelo de IA.`, "", "## Identidad por fuente", "",
    "| Fuente | Resultado | Candidato | Puntaje | Señales |", "|---|---|---|---|---|"];
  for (const source of sources) {
    const attempt = tried[source]!;
    const best = attempt.outcome.best;
    lines.push(`| ${source} | ${attempt.outcome.status}: ${attempt.error ?? attempt.outcome.reason} | ${best ? `${best.candidate.name} (${best.candidate.externalId})` : "—"} | ${best?.score ?? "—"} | ${best ? best.signals.map((signal) => `${signal.name}${signal.detail ? ` (${signal.detail})` : ""}`).join("; ") : "—"} |`);
  }
  const known = Object.entries(context.knownIds).flatMap(([source, ids]) => ids!.map((item) => `${source} ${item.externalId} (${item.via})`));
  if (known.length) lines.push("", `IDs verificados en la ficha: ${known.join("; ")}.`);
  const voting = new Set(confirmed.filter((profile) => profile.source !== "lastfm").map((profile) => (profile.source === "itunes" ? "deezer" : profile.source)));
  // Se llaman igual pero nada más lo confirma: quedan para revisión humana.
  const unconfirmed = sources.flatMap((source) => (tried[source]?.profile ? [] : (tried[source]?.candidates ?? []).filter((item) => item.blocked === "solo coincide el nombre" || item.score >= 0.6).slice(0, 3).map((item) => `${source} «${item.name}» (${item.externalId}): ${item.blocked ?? `puntaje ${item.score}`}`)));
  if (unconfirmed.length) lines.push("", "Candidatos sin confirmar (mismo nombre, sin disco, país o miembro en común):", "", ...unconfirmed.map((item) => `- ${item}`));
  if (!voting.size) lines.push("", "**Sin fuentes externas:** ninguna API confirmó la identidad; la ficha depende de nuestras fuentes y de la investigación web.");
  lines.push("", "## Artista", "", `| Campo | Ficha | ${order.join(" | ")} | Resultado |`, `|---|---|${order.map(() => "---").join("|")}|---|`);
  for (const [label, vote] of [["País", fields.country], ["Año de inicio", fields.beginYear], ["Año de nacimiento", fields.birthYear]] as Array<[string, FieldVote<unknown>]>) {
    lines.push(`| ${label} | ${vote.catalog ?? "—"} | ${order.map((source) => cell(vote, source)).join(" | ")} | ${vote.status}${vote.value !== null ? `: ${vote.value}` : ""}${vote.note ? ` (${vote.note})` : ""} |`);
  }
  for (const [source, tags] of Object.entries(fields.tags)) lines.push(`\nEtiquetas ${source}: ${tags!.slice(0, 12).join(", ")}`);
  const inCatalog = compared.filter((work) => work.catalogAlbumId !== null);
  const fresh = compared.filter((work) => work.catalogAlbumId === null);
  lines.push("", "## Discos de la ficha", "");
  for (const work of inCatalog) {
    lines.push(`### ${work.title} (disco ${work.catalogAlbumId}) · en ${work.families.length} familias: ${work.families.join(", ") || "ninguna"}`, "",
      `| Campo | Ficha | ${order.join(" | ")} | Resultado |`, `|---|---|${order.map(() => "---").join("|")}|---|`);
    for (const [label, vote] of [["Año", work.year], ["Pistas", work.trackCount], ["Sello", work.label]] as Array<[string, FieldVote<unknown>]>) {
      lines.push(`| ${label} | ${vote.catalog ?? "—"} | ${order.map((source) => cell(vote, source)).join(" | ")} | **${vote.status}**${vote.value !== null ? `: ${vote.value}` : ""}${vote.support.length ? ` [${vote.support.join("+")}]` : ""}${vote.note ? ` (${vote.note})` : ""} |`);
    }
    lines.push(`| Tipo (informativo) | — | ${order.map((source) => (source in work.types ? work.types[source] ?? "—" : "·")).join(" | ")} | no se vota |`);
    lines.push("", `Lista de pistas: **${work.tracks.status}**${work.tracks.from ? ` (de ${work.tracks.from}, cada pista en ≥${work.tracks.agreement} familias)` : ""}${work.tracks.note ? ` · ${work.tracks.note}` : ""}`);
    if (work.tracks.proposed.length) lines.push("", work.tracks.proposed.map((track, index) => `${index + 1}. ${track}`).join("\n"));
    const covers = Object.entries(work.covers);
    if (covers.length) lines.push("", `Portadas: ${covers.map(([source, url]) => `[${source}](${url})`).join(" · ")}`);
    lines.push("");
  }
  lines.push("## Discos que la ficha no tiene", "", "Solo como candidatos: el perfil confirma la identidad con los discos ya conocidos, pero un disco nuevo de una sola familia puede ser de un homónimo mezclado en ese perfil.", "",
    "| Título | Familias | Año votado | Tipos por fuente |", "|---|---|---|---|");
  const weak = fresh.filter((work) => !work.families.length);
  for (const work of fresh.filter((item) => item.families.length)) {
    // Un disco publicado antes de que el titular cumpliera 12 años es de otra persona.
    const born = fields.birthYear.value ?? catalog.birthYear ?? null;
    const impossible = born !== null && work.year.value !== null && work.year.value < born + 12 ? " ⚠ posible homónimo (anterior a los 12 años del titular)" : "";
    lines.push(`| ${work.title} | ${work.families.length} (${work.families.join(", ")}) | ${work.year.value ?? "—"} ${work.year.status === "dudoso" ? "(dudoso)" : ""}${impossible} | ${Object.entries(work.types).map(([source, type]) => `${source}: ${type ?? "—"}`).join("; ")} |`);
  }
  if (weak.length) lines.push("", `${weak.length} títulos más aparecen solo en Last.fm (listas armadas por usuarios); no se proponen.`);
  const requests = Object.entries(context.requests).map(([source, count]) => `${source} ${count}`).join(", ");
  lines.push("", `Peticiones a la red en esta corrida: ${requests}. Llamadas al modelo: 0.`);
  return `${lines.join("\n")}\n`;
}
