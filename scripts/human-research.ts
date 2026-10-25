// Ficha por preguntas simples para un artista que las APIs no encuentran.
// Primero intenta los perfiles por API (MusicBrainz, Discogs, Deezer/iTunes);
// si no hay dos familias que lo confirmen, pregunta en la web como una persona
// («¿Qué discos ha publicado X?») en fuentes confiables y arma la ficha.
// No escribe en el catálogo: deja dossier.json e informe.md.
//
// Uso: npx tsx scripts/human-research.ts <artistId> --out <dir> [--cache <dir>] [--forzar]
// Gasta modelo (DeepSeek flash): usar con CRV_AI_BUDGET_ID.
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { closeDb, getPool } from "../src/db/client.js";
import { fold, hostOf, type HumanDossier, type HumanField } from "../src/verification/human-research.js";
import { humanResearchForArtist } from "../src/verification/human-research-run.js";
import { profileIsReliable } from "../src/verification/source-profile-plan.js";
import { runSourceProfiles } from "../src/verification/source-profile-run.js";

loadDotenv();
const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const artistId = Number(process.argv[2]);
if (!Number.isInteger(artistId)) throw new Error("uso: human-research.ts <artistId> --out <dir>");
const out = arg("--out") ?? path.join(os.tmpdir(), `crv-human-research-${artistId}`);
const db = getPool();

const run = await runSourceProfiles(db, artistId, { offline: false, ...(arg("--cache") ? { cacheDir: arg("--cache")! } : {}) });
const reliable = profileIsReliable(run);
console.log(`perfiles por API: ${run.profiles.map((profile) => profile.source).join(", ") || "ninguno"} · ${reliable ? "identidad firme" : "sin identidad firme"}`);
if (reliable && !process.argv.includes("--forzar")) {
  console.log("Las APIs ya confirman al artista: la discografía sale de los perfiles (scripts/source-profiles.ts).");
  await closeDb();
  process.exit(0);
}

const dossier = await humanResearchForArtist(db, run, { log: (line) => console.log(line) });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "dossier.json"), JSON.stringify(dossier, null, 2));
await writeFile(path.join(out, "informe.md"), report(dossier));
console.log(`\n${dossier.usage.calls} llamadas al modelo, ${dossier.usage.tokensIn + dossier.usage.tokensOut} tokens · informe en ${path.join(out, "informe.md")}`);
await closeDb();

function report(found: HumanDossier): string {
  const { artist: crv, fields } = found;
  const label: Record<HumanField, string> = { identidad: "Quién es", biografia: "Historia", origen: "Origen", integrantes: "Integrantes", discografia: "Discos", pistas: "Pistas", generos: "Géneros", redes: "Redes y páginas oficiales" };
  const inCatalog: Partial<Record<HumanField, (value: string) => boolean>> = {
    discografia: (value) => crv.albums.some((album) => fold(album.title) === fold(value)),
    integrantes: (value) => crv.memberNames.some((member) => fold(member) === fold(value)),
  };
  const lines = [`# Ficha por preguntas · ${crv.name} (${artistId})`, "", `Generado ${new Date().toISOString()} · ${found.usage.calls} llamadas al modelo (DeepSeek flash), ${found.usage.tokensIn + found.usage.tokensOut} tokens.`,
    "", "Las APIs no confirmaron al artista; cada dato sale de una pregunta simple buscada en fuentes confiables, con su cita literal.", "", "## Primera versión de la ficha", ""];
  for (const field of Object.keys(label) as HumanField[]) {
    const items = fields[field];
    lines.push(`### ${label[field]}`, "");
    if (!items.length) { lines.push("Sin respuesta en fuentes confiables.", ""); continue; }
    for (const item of items) {
      const guest = field === "integrantes" && /^(invitado|sesión|sesion|producción|produccion):/iu.test(item.detail ?? "");
      const mark = inCatalog[field] ? (inCatalog[field]!(item.value) ? " · ya en la ficha" : guest ? " · crédito, no integrante" : " · **nuevo**") : "";
      lines.push(`- ${item.album ? `[${item.album}] ` : ""}${item.value}${item.detail ? ` (${item.detail})` : ""}${mark} — [${hostOf(item.url)}](${item.url}): «${item.quote.slice(0, 220)}${item.quote.length > 220 ? "…" : ""}»`);
    }
    lines.push("");
  }
  lines.push("## Preguntas hechas", "", "| Dato | Pregunta | Páginas leídas (¿es este artista?) | Datos | Descartados |", "|---|---|---|---|---|");
  for (const question of found.questions) {
    const pages = question.pages.map((page) => `[${hostOf(page.url)}](${page.url}) ${page.sameArtist ?? "?"}`).join("; ") || `— (${question.missing ?? "sin resultados"})`;
    const rejected = question.rejected.map((item) => `${item.value.slice(0, 60)}: ${item.why}`).join("; ") || "—";
    lines.push(`| ${question.field}${question.album ? ` «${question.album}»` : ""} | ${question.question} | ${pages} | ${question.items.length} | ${rejected} |`);
  }
  return `${lines.join("\n")}\n`;
}
