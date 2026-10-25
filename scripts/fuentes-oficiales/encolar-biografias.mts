// CRV · Biografías oficiales a la cola de reescritura (Brian, 2026-10-13).
//
// Junta el texto narrativo de las páginas de biografía del propio artista (sitio oficial,
// «about»/descripción de su Bandcamp) capturadas por la campaña de fuentes oficiales y lo pone,
// junto a la biografía vigente, en `ingest.text_rewrites`: la cola que ya usan las fusiones
// (regla de Brian: unir sin perder datos). `crv texts rewrite` hace después la unión con DeepSeek
// flash —sin años inventados ni perdidos, sin resumir— y la escribe en su propio run.
//
// Solo fichas confirmadas por el cotejo de trayectoria («same_artist»). Una biografía que ya
// contiene el texto oficial no se encola. Sin --confirm solo informa; --muestra=N además pide a
// la IA N uniones de ejemplo (sin escribir nada) para revisarlas.
// Uso: tsx scripts/fuentes-oficiales/encolar-biografias.mts [--ids=…] [--muestra=N] [--confirm]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { createDeepSeekGateway } from "../../src/ai/gateway.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { containsText, type TextSource } from "../../src/merge/preserve.js";
import { rewriteTexts } from "../../src/merge/text-rewrite.js";
import { loadCases } from "./cotejar-trayectoria.mjs";
import { fold } from "./cotejar-discografia.mjs";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const CAMPAIGN = "reports/official-enrichment-2026-10-13";
const CASE_DIRS = (arg("cases") ?? `${CAMPAIGN}/cases,${CAMPAIGN}/expanded/cases`).split(",");
const TRAJECTORY = arg("trayectoria") ?? "reports/fuentes-oficiales-2026-10-13/trayectoria.jsonl";
const ONLY = arg("ids")?.split(",").map(Number);
const SAMPLE = Number(arg("muestra") ?? 0);
const CONFIRM = process.argv.includes("--confirm");
const REPORT = `reports/fuentes-oficiales-2026-10-13/biografias-${CONFIRM ? "encoladas" : "vista-previa"}.json`;
const OPERATOR = "claude-code (delegado por Brian)";

// La página de biografía misma, no sus subpáginas (las de cada integrante en C4 Trío son biografías de personas).
const BIO_PATH = /\/(?:[\w-]*biograf[\w-]*|biography|bio|about|acerca[\w-]*|historia|history|nosotros|quienes-somos|resena)\/?(?:\.html?)?$/iu;
// Un texto oficial más largo no cabe en una sola reescritura (Paul Gillman: 76.000 caracteres); va al informe.
const MAX_OFFICIAL = 18000;
const NOISE = /copyright|all rights? reserved|derechos reservados|cookies?|newsletter|suscr[ií]bete|subscribe|log ?in|sign ?up|privacy|privacidad|add to cart|comprar|buy (?:now|digital)|design and development|mira el video|watch the video/iu;

interface Page { url: string; content: string; contentHash: string }
interface CaseFile { artistId: number; name: string; pages: Page[]; sourceAttributions?: Array<{ origin: string; status: string }>; rejectedSources?: Array<{ url: string }>; nonPrimarySources?: Array<{ url: string }> }

/** Párrafos narrativos de una página: líneas con frases (≥8 palabras y puntuación), sin menús ni avisos legales. */
export function narrative(content: string): string {
  const body = content.split("Enlaces de la página:")[0] ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/​/gu, "").replace(/\s+/gu, " ").trim();
    if (line.startsWith("JSON-LD") || line.length < 60 || line.split(" ").length < 8 || !/[.,;:]/u.test(line) || NOISE.test(line)) continue;
    const key = fold(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join("\n\n");
}

/** Descripción del perfil de Bandcamp del artista (JSON-LD publisher/description). */
function bandcampDescription(page: Page, names: Set<string>): string | null {
  if (!/\.bandcamp\.com/iu.test(page.url)) return null;
  const publisher = /^JSON-LD 1 \/publisher\/name: (.*)$/mu.exec(page.content)?.[1];
  const description = /^JSON-LD 1 \/publisher\/description: (.*)$/mu.exec(page.content)?.[1]?.trim();
  if (!publisher || !names.has(fold(publisher)) || !description || description.length < 60) return null;
  return description;
}

async function main(): Promise<void> {
  const confirmed = new Set<number>();
  if (existsSync(TRAJECTORY)) for (const line of readFileSync(TRAJECTORY, "utf8").split("\n").filter((l) => l.trim())) {
    const row = JSON.parse(line) as { artistId: number; result: { identity: string } };
    if (row.result.identity === "same_artist") confirmed.add(row.artistId);
  }
  const cases = [...(loadCases(CASE_DIRS, { requireFacts: false }) as unknown as Map<number, CaseFile>).values()]
    .filter((state) => confirmed.has(state.artistId) && (!ONLY || ONLY.includes(state.artistId)));
  const pool = getPool();
  const planned: Array<{ artistId: number; name: string; current: string | null; sources: TextSource[]; officialChars: number }> = [];
  const skipped: Array<{ artistId: number; name: string; why: string }> = [];
  for (const state of cases) {
    const artist = (await pool.query<{ name: string; biography: string | null; aliases: string[] }>(`SELECT a.name, a.biography,
        coalesce((SELECT array_agg(alias) FROM ingest.artist_aliases x WHERE x.artist_id=a.id), '{}') AS aliases FROM public.artists a WHERE a.id=$1`, [state.artistId])).rows[0];
    if (!artist) continue;
    const names = new Set([artist.name, ...artist.aliases].map(fold));
    const excluded = new Set([...(state.rejectedSources ?? []), ...(state.nonPrimarySources ?? [])].map((source) => source.url));
    const official: TextSource[] = [];
    for (const page of state.pages) {
      if (excluded.has(page.url)) continue;
      const text = BIO_PATH.test(new URL(page.url).pathname) ? narrative(page.content) : bandcampDescription(page, names);
      if (!text || text.length < 200) continue;
      if (official.some((source) => containsText(source.text, text))) continue;
      for (let index = official.length - 1; index >= 0; index -= 1) if (containsText(text, official[index]!.text)) official.splice(index, 1);
      official.push({ label: `Sitio oficial · ${page.url}`, text });
    }
    // Mismo texto en dos idiomas (c4trio.com/en/biografia y /biografia): se queda el español.
    for (const source of [...official]) {
      const url = new URL(source.label.replace(/^Sitio oficial · /u, ""));
      if (/^\/en\//u.test(url.pathname) && official.some((other) => other !== source && new URL(other.label.replace(/^Sitio oficial · /u, "")).pathname === url.pathname.replace(/^\/en/u, ""))) official.splice(official.indexOf(source), 1);
    }
    if (official.reduce((sum, source) => sum + source.text.length, 0) > MAX_OFFICIAL) { skipped.push({ artistId: state.artistId, name: artist.name, why: `texto oficial demasiado largo (${official.reduce((sum, source) => sum + source.text.length, 0)} caracteres) para una sola unión` }); continue; }
    if (!official.length) { skipped.push({ artistId: state.artistId, name: artist.name, why: "sin página de biografía oficial" }); continue; }
    const fresh = official.filter((source) => !artist.biography || !containsText(artist.biography, source.text));
    if (!fresh.length) { skipped.push({ artistId: state.artistId, name: artist.name, why: "la biografía ya contiene el texto oficial" }); continue; }
    const sources = [...(artist.biography?.trim() ? [{ label: "Biografía vigente de CRV", text: artist.biography }] : []), ...fresh];
    planned.push({ artistId: state.artistId, name: artist.name, current: artist.biography, sources, officialChars: fresh.reduce((sum, source) => sum + source.text.length, 0) });
  }

  const samples: Array<{ artistId: number; name: string; text?: string; error?: string }> = [];
  if (SAMPLE > 0) {
    const gateway = createDeepSeekGateway();
    for (const item of planned.slice(0, SAMPLE)) {
      try { samples.push({ artistId: item.artistId, name: item.name, text: (await rewriteTexts(gateway, { kind: "artist", name: item.name, sources: item.sources })).text }); }
      catch (error) { samples.push({ artistId: item.artistId, name: item.name, error: (error as Error).message.slice(0, 400) }); }
    }
  }

  let runId: number | null = null;
  if (CONFIRM && planned.length) {
    runId = (await withOperatorRun({
      name: "fuentes-oficiales:biografias",
      operator: OPERATOR,
      note: "Biografías oficiales encoladas para unirlas a la vigente sin perder datos (crv texts rewrite); campaña de fuentes oficiales 2026-10-13 pedida por Brian.",
      params: { fichas: planned.length },
    }, async (context) => {
      for (const item of planned) {
        await context.client.query(`
          INSERT INTO ingest.text_rewrites(entity_kind,entity_id,field,sources,reason,run_id)
          VALUES('artist',$1,'biography',$2::jsonb,$3,$4)
          ON CONFLICT (entity_kind,entity_id,field) WHERE status='pending'
          DO UPDATE SET sources=EXCLUDED.sources, reason=EXCLUDED.reason, run_id=EXCLUDED.run_id`,
        [item.artistId, JSON.stringify(item.sources), "Biografía del sitio oficial del artista (campaña de fuentes oficiales 2026-10-13)", context.runId]);
      }
    })).runId;
  }
  writeFileSync(REPORT, JSON.stringify({ run: runId, planned: planned.map(({ current: _current, ...item }) => item), skipped, samples }, null, 2));
  console.log(JSON.stringify({ confirm: CONFIRM, run: runId, encolables: planned.length, saltadas: skipped.length, muestras: samples.length }, null, 2));
  console.log(`informe: ${REPORT}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
