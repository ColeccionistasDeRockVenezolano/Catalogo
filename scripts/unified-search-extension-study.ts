// Tramo de ampliación del estudio (R45 AOTY + R46 fanzines). Lee
// docs/unified-search/stage2/extension-readings.json, vuelve a comprobar cada
// cita contra su captura y escribe reports/unified-search-stage2/extension-annotations.json.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { projectRoot } from "../src/config/project-root.js";
import { annotationSchema, KNOWLEDGE_VERSION, type KnowledgeAnnotation } from "../src/search/knowledge-contracts.js";

const root = projectRoot(import.meta.url);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ws = (s: string) => s.replace(/\s+/gu, " ").trim();

interface Reading {
  id: string; resourceId: "R45" | "R46"; object: { kind: "album" | "artist"; id: number; name: string }; artist: string; work: string;
  quote: string; language: string; source: string; account: string; page: number | null; locator: string; captureHash: string;
  capturedAtOriginal: string; visibleDate: string | null; rating?: string; extractorVersion: string; identityEvidence: string[]; analystModel: string; study?: string; rectifiedBy?: string;
  reading: { type: KnowledgeAnnotation["assertion"]["type"]; aspect: string; value: string; state: KnowledgeAnnotation["assertion"]["state"];
    appreciation: KnowledgeAnnotation["assertion"]["appreciation"]; coverage: KnowledgeAnnotation["assertion"]["coverage"]; listeningCondition: string | null;
    interpretation: string; alternative: string; query: string; objectNote: string | null };
}
const config = JSON.parse(await readFile(path.join(root, "docs/unified-search/stage2/extension-readings.json"), "utf8")) as { version: string; analyst: string; method: string; scope: string; readings: Reading[]; rectifications?: unknown[]; rectificationStatus?: string };

// La cita debe seguir en la captura con la misma huella: AOTY por línea, fanzines por página OCR.
const aotyLines = (await readFile(path.join(root, "data/raw/aoty-2026-10-19/user_reviews_all.jsonl"), "utf8")).split("\n");
const corpus = new Map((await readFile(path.join(root, "data/research/punkenvenezuela-fanzines-2026-10-23/corpus.jsonl"), "utf8"))
  .split("\n").filter(Boolean).map(l => JSON.parse(l) as { doc: string; pagina: number; texto: string }).map(p => [`${p.doc}#${p.pagina}`, p.texto]));
function verifyCapture(r: Reading): void {
  if (r.resourceId === "R45") {
    const line = Number(/:(\d+) \.text$/u.exec(r.locator)?.[1]);
    const raw = aotyLines[line - 1] ?? "";
    if (sha(raw) !== r.captureHash || !(JSON.parse(raw) as { text: string }).text.includes(r.quote)) throw new Error(`${r.id}: la reseña AOTY cambió o no contiene la cita`);
  } else {
    const m = /doc=(\S+) pagina=(\d+)/u.exec(r.locator);
    const text = m ? corpus.get(`${m[1]}#${m[2]}`) : undefined;
    if (!text || sha(text) !== r.captureHash || !ws(text).includes(r.quote)) throw new Error(`${r.id}: la página OCR cambió o no contiene la cita`);
  }
}

try {
  const annotations: KnowledgeAnnotation[] = [];
  for (const r of config.readings) {
    verifyCapture(r);
    const table = r.object.kind === "album" ? "public.albums" : "public.artists";
    if (!(await getPool().query(`SELECT 1 FROM ${table} WHERE id=$1`, [r.object.id])).rowCount) throw new Error(`${r.id}: ${table}:${r.object.id} no existe`);
    const a = r.reading;
    annotations.push(annotationSchema.parse({
      version: KNOWLEDGE_VERSION, study: r.study ?? config.version, id: r.id,
      object: { kind: r.object.kind, id: r.object.id, name: r.object.name, resolution: "resolved", identityEvidence: r.identityEvidence, version: null, segment: null },
      observation: { resourceId: r.resourceId, source: r.source, reviewId: null, account: r.account, page: r.page, captureHash: r.captureHash,
        capturedAt: null, capturedAtOriginal: r.capturedAtOriginal, captureTimeZone: null, locator: r.locator, quote: r.quote, language: r.language,
        visibleDate: r.visibleDate, textRevision: null, extractorVersion: r.extractorVersion, paraphrase: null },
      assertion: { type: a.type, aspect: a.aspect, value: a.value, state: a.state, appreciation: a.appreciation, listeningCondition: a.listeningCondition, coverage: a.coverage, activityBasis: null },
      layers: { community: [], genreKnowledge: [], trackRatings: [], communityRating: null,
        individualRating: r.rating && /^\d+$/u.test(r.rating) ? { value: Number(r.rating), minimum: 0, maximum: 100, object: "album" } : null },
      dependencies: [], evidenceChain: r.resourceId === "R45" ? `aoty-account:${r.account}` : `fanzine:${r.account}`,
      analysis: { interpretation: a.interpretation, alternative: a.alternative, analyst: `${config.analyst} (${r.analystModel})`, methodVersion: "review-analysis-0.2.0",
        uncertainty: `Tramo de ampliación: sin cruce comunitario ni de género.${r.resourceId === "R46" ? " Texto por OCR; la cita conserva sus errores." : " Fecha relativa a la captura."}${a.objectNote ? ` Nota del analista: ${a.objectNote}` : ""}${r.rectifiedBy ? ` Rectificada por ${r.rectifiedBy}.` : ""}` },
      proposal: a.type === "taste" ? null : { axis: null, facet: `candidate:${a.aspect}`, value: a.value, query: a.query,
        criterion: "Identidad y alcance documentados; criterio musical por atributo y decisión humana antes de publicar", status: "proposed" },
      comparison: null,
    }));
  }
  await writeFile(path.join(root, "reports/unified-search-stage2/extension-annotations.json"), JSON.stringify({
    version: config.version, method: config.method, scope: config.scope, annotations,
    // Decided after evaluation but not applied, so the measurement keeps matching what was judged.
    rectifications: config.rectifications ?? [], rectificationStatus: config.rectificationStatus ?? null,
    strata: { R45: annotations.filter(a => a.observation.resourceId === "R45").length, R46: annotations.filter(a => a.observation.resourceId === "R46").length },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ version: config.version, annotations: annotations.length }));
} finally { await closeDb(); }
