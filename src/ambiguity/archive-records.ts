// Fichas de músico guardadas en disco por las cosechas del proyecto. Metal Archives responde 403 a una
// descarga directa, pero la cosecha del 2026-10-01 guardó la página de cada músico venezolano (nombre
// real, nacimiento, ciudad y bandas con años): es la fuente que confirmó a mano a los homónimos de metal.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getEnv } from "../config/env.js";

const MA_DIR = "raw/metal-archives-ve-2026-10-01";

interface MaPerson { url: string; artist_id: string; name: string; real_name: string; bands: Array<{ band: string; role: string }>; }

function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/["“”«»][^"“”«»]*["“”«»]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

let maPersons: MaPerson[] | null = null;
function loadMaPersons(): MaPerson[] {
  if (maPersons) return maPersons;
  const path = join(resolve(getEnv().DATA_DIR), MA_DIR, "person-details.jsonl");
  maPersons = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as MaPerson) : [];
  return maPersons;
}

/** El nombre de la ficha es el del músico, su nombre real o cabe entero en el nombre real («Jesús Hernández» ⊂ «Jesús Alberto Hernández Rondon»). */
function sameName(ficha: string, record: MaPerson): boolean {
  const wanted = fold(ficha);
  if (!wanted) return false;
  const names = [record.name, record.real_name].filter((name) => name && name !== "N/A").map(fold);
  if (names.includes(wanted)) return true;
  const tokens = wanted.split(" ");
  return tokens.length >= 2 && names.some((name) => tokens.every((token) => name.split(" ").includes(token)));
}

/**
 * Páginas de Metal Archives del músico que se llama como la ficha y tocó en una de sus bandas.
 * Nombre y banda a la vez: «Francisco González» de Oblivion of Hybrids, no cualquier Francisco González.
 */
export function metalArchivesArtistUrls(name: string, projects: readonly string[]): string[] {
  const bands = new Set(projects.map(fold));
  return loadMaPersons().filter((record) => sameName(name, record) && record.bands.some((band) => bands.has(fold(band.band))))
    .map((record) => record.url);
}

/** Copia local de una página de Metal Archives (músico o banda), si la cosecha la guardó. */
export function localArchivePage(rawUrl: string): string | null {
  const match = /^https?:\/\/(?:www\.)?metal-archives\.com\/(artists|bands)\/[^/]+\/(\d+)/u.exec(rawUrl);
  if (!match) return null;
  const path = join(resolve(getEnv().DATA_DIR), MA_DIR, match[1] === "artists" ? "persons" : "bands", `${match[2]}.html`);
  return existsSync(path) ? path : null;
}
