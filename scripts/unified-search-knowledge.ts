import { readReviewedVocabulary } from "../src/search/semantic-review.js";
import { resourceFieldAdministration, resourceFieldStatus } from "../src/search/resource-field-review.js";
import { extractReleaseLanguage, releaseLanguageStudySchema } from "../src/search/rym-release-language.js";
import { studyReleaseFileSchema, studyReserveSchema, assertDevelopmentSelection } from "../src/search/study-identity.js";
import { reviewGenreMappings, type LegacyGenreMapping } from "../src/search/genre-mapping-review.js";
import { readGenreKnowledge, buildGenreKnowledgeMap } from "../src/search/genre-map.js";
import { runKnowledgeInterpretation } from "../src/search/knowledge-interpretation.js";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { projectRoot } from "../src/config/project-root.js";
import { extractReviews, selectReviews, hashText, REVIEW_EXTRACTOR_VERSION, type ExtractedReview } from "../src/search/review-protocol.js";
import { KNOWLEDGE_VERSION } from "../src/search/knowledge-contracts.js";
import { enqueueKnowledgeBatch, runKnowledgeChunk, knowledgeFeedStatus, retryKnowledgeJob } from "../src/search/knowledge-feed.js";
import { prepareStudyFeed, syncStudyFeed, studyFeedCursorSchema } from "../src/search/knowledge-sync.js";

const root = projectRoot(import.meta.url);
const out = path.join(root, "reports/unified-search-stage2");
const json = async (relative: string) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const save = async (file: string, value: unknown) => writeFile(path.join(out, file), JSON.stringify(value, null, 2) + "\n");

async function inventory() {
  await mkdir(out, { recursive: true });
  const pages = path.join(root, "data/raw/rym-reviews-2026-10-16/pages");
  const grouped = new Map<string, ExtractedReview[]>();
  const manifest = [], discrepancies = [];
  for (const file of (await readdir(pages)).filter(f => f.endsWith(".json")).sort()) {
    const relative = path.relative(root, path.join(pages, file));
    const rawText = await readFile(path.join(pages, file), "utf8"), raw = JSON.parse(rawText);
    if (raw.tipo_doc !== "reviews") continue;
    const htmlFile = relative.replace(/\.json$/u, ".html");
    let html: string;
    try { html = await readFile(path.join(root, htmlFile), "utf8"); }
    catch { discrepancies.push({ file: relative, reason: "missing_html" }); continue; }
    const capturedAt = raw.capturedAt ?? null;
    const rows = extractReviews({ source: htmlFile, html, capturedAt: capturedAt ?? "unknown", release: raw.href, page: raw.page });
    manifest.push({ json: relative, jsonHash: hashText(rawText), html: htmlFile, htmlHash: hashText(html), capturedAt,
      release: raw.href, page: raw.page, actualReviews: rows.length, declaredReviews: raw.total_declarado ?? null });
    grouped.set(raw.href, [...(grouped.get(raw.href) ?? []), ...rows]);
    for (const r of rows) {
      const prior = raw.reviews?.find((p: {review_id:number}) => String(p.review_id) === r.id);
      if (prior && (hashText(String(prior.texto ?? "").replace(/\s+/gu, " ").trim()) !== r.textHash || !prior.usuario || !prior.fecha))
        discrepancies.push({ reviewId: r.id, file: relative, textChanged: hashText(String(prior.texto ?? "").replace(/\s+/gu, " ").trim()) !== r.textHash,
          authorRecovered: !prior.usuario && !!r.account, dateRecovered: !prior.fecha && !!r.visibleDate });
    }
  }
  const pilot = await json("reports/rym-reviews-piloto/v0.1.0/muestra.json") as Array<{href:string}>;
  // The original eight releases stay reserved when the corpus grows.
  const reserve=studyReserveSchema.parse(await json("docs/unified-search/stage2/study-reserve.json"));
  const holdout=reserve.releases;
  for(const href of holdout)if(!grouped.has(href))throw new Error("La reserva fijada no está completa en el corte");
  const supplement=studyReleaseFileSchema.parse(await json("docs/unified-search/stage2/study-releases.json"));
  assertDevelopmentSelection(supplement.releases.map(r=>r.release),holdout);
  for(const capture of supplement.releases.filter(r=>r.stratum==="single_release_page_exception")){
    if(holdout.some(h=>h.replace(/\/$/u,"")===capture.release.replace(/\/$/u,"")))throw new Error("Una captura suplementaria no puede abrir la reserva");
    if(grouped.has(capture.release))throw new Error("Captura suplementaria duplicada con el corpus base");
    const [html,metadataText]=await Promise.all([readFile(path.join(root,capture.html),"utf8"),readFile(path.join(root,capture.metadata),"utf8")]);
    if(hashText(html)!==capture.htmlHash||hashText(metadataText)!==capture.metadataHash)throw new Error("Captura suplementaria cambió; revisar corte");
    const meta=JSON.parse(metadataText);
    if(meta.href.replace(/\/$/u,"")!==capture.release.replace(/\/$/u,""))throw new Error("URL de captura suplementaria no coincide");
    const rows=extractReviews({source:capture.html,html,capturedAt:meta.capturedAt,release:capture.release,page:1});
    grouped.set(capture.release,rows);
    manifest.push({json:capture.metadata,jsonHash:capture.metadataHash,html:capture.html,htmlHash:capture.htmlHash,capturedAt:meta.capturedAt,release:capture.release,page:1,actualReviews:rows.length,declaredReviews:null});
  }
  const releases=[...grouped.keys()].sort();
  const selection = releases.map(release => {
    const s = selectReviews(grouped.get(release)!);
    const role = pilot.some(p => p.href === release) ? "pilot_development" : holdout.includes(release) ? "reserved_unopened" : "new_development";
    return { release, role, reason: role === "pilot_development" ? "Antecedente; no prueba final" : role === "reserved_unopened" ? "Reserva determinista por publicación; no diseñar categorías con estos textos" : "Contraste nuevo; diversidad musical aún requiere selección revisada",
      ...s, selected: s.selected.map(({ text: _text, ...metadata }) => metadata),
      stratum:supplement.releases.find(r=>r.release===release)?.stratum??"multiple_review_pages",crvIdentity: "pending_documented_link", edition: "unknown", annotationStatus: "not_evaluated" };
  });
  const vocabulary=await readReviewedVocabulary(root);
  const legacyMappings = await json("reports/rym-reviews-piloto/v0.1.0/cruce-generos.json") as LegacyGenreMapping[];
  let genres: Array<Record<string, unknown>>, databaseStatus = "available";
  try { genres = (await getPool().query("SELECT id,slug,name,description,level,parent_genre_id FROM ingest.genres WHERE active ORDER BY slug")).rows; }
  catch { databaseStatus = "unavailable_using_historical_inventory"; genres = (await json("reports/intenciones-humanas/v0.1.0/generos-crv.json")).genres; }
  const resourceRegistry = await json("docs/unified-search/resources.json");
  let crossed:{manifest:unknown[];crossings:unknown[]}|null=null;
  try{crossed=await json("reports/unified-search-stage2/four-source-crossing.json");}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const crossedCaptures=crossed?.manifest.length??0;
  let languageCount=0;
  const languageReport=await json("reports/unified-search-stage2/release-languages.json").catch((error:NodeJS.ErrnoException)=>{if(error.code!=="ENOENT")throw error;return null;});
  if(languageReport){
    const report=releaseLanguageStudySchema.parse(languageReport);
    for(const input of report.inputs)if(hashText(await readFile(path.join(root,input.path),"utf8"))!==input.sha256)throw new Error("Corte de idiomas obsoleto; ejecutar search:languages:study");
    if(report.manifest.length!==report.records.length||new Set(report.manifest.map(m=>m.albumId)).size!==report.manifest.length)throw new Error("Manifiesto de idiomas incompleto o duplicado");
    for(const capture of report.manifest){
      const record=report.records.find(r=>r.object.id===capture.albumId);
      if(!record)throw new Error("Idioma sin registro de identidad");
      const [html,metadata]=await Promise.all([readFile(path.join(root,capture.html),"utf8"),readFile(path.join(root,capture.metadata),"utf8")]);
      if(hashText(metadata)!==capture.metadataHash)throw new Error("Metadatos del corte de idiomas cambiaron");
      const extracted=extractReleaseLanguage({html,source:record.source,capturedAtOriginal:JSON.parse(metadata).capturedAt,expectedHash:capture.htmlHash,object:record.object});
      if(JSON.stringify(extracted)!==JSON.stringify(record))throw new Error("Evidencia de idiomas obsoleta");
    }
    languageCount=report.records.length;
  }

  let fieldReview: Awaited<ReturnType<typeof resourceFieldAdministration>> = null;
  let fieldReviewStatus = "verified";
  try { fieldReview = await resourceFieldAdministration(root); if (!fieldReview) fieldReviewStatus = "missing"; }
  catch { fieldReviewStatus = "needs_review"; }
  const resourceUses = resourceRegistry.resources.map((r: {id:string;resource:string;availability:string;acceptance:string;nextTask:string}) => ({
    id: r.id, resource: r.resource, availability: r.availability, acceptance: r.acceptance,
    fieldReview: fieldReview?.resources.find(row => row.id === r.id) ?? null,
    disposition: r.id === "R16" ? "excluded" : ["R01","R02"].includes(r.id) && crossedCaptures>0 ? "community_release_context_extracted" : ["R41", "R42"].includes(r.id) ? "development_artifacts_preserved" : r.id === "R04" ? "review_extraction_and_development_annotations" : r.id === "R05" ? "track_ratings_extracted_not_assignments" : r.id === "R09" ? "existing_track_ids_reused" : "deferred",
    evidence: ["R01","R02"].includes(r.id) ? "four-source-crossing.json;development-annotations.json;docs/unified-search/stage2/community-crossing.json" : r.id === "R41" ? "vocabulary.json" : r.id === "R42" ? "pilot-findings.json;study.json;mappings.json" : r.id === "R04" ? "study.json;development-annotations.json;laya-development-interpretations.json;chain-rehearsal.json" : r.id === "R05" ? "study.json:selected.trackRatings" : r.id === "R09" ? "development-annotations.json:object.identityEvidence" : null,
    reason: ["R01","R02"].includes(r.id) ? `Contexto documentado en ${crossedCaptures} fichas y ${crossed?.crossings.length??0} anotaciones: términos principales/secundarios y descriptores separados, sin heredar atributos a pistas ni sumar testigos. Falta ampliar corpus y revisión editorial.` : r.id === "R03" ? `Media y votos disponibles de ${crossedCaptures} fichas de álbum conservados como contexto en four-source-crossing.json; sin peso de veracidad. Discografía y agregados de fichas de artista aún diferidos, requieren adaptador y control de identidad propios.` : r.id === "R16" ? "Shoutbox retirado por Brian; prohibida su reingesta y entrenamiento" : ["R41", "R42"].includes(r.id) ? "Conservación trazable; no aprobación musical" : r.id === "R04" ? "Extracción y anotaciones de desarrollo con cuatro procedencias separadas; falta ampliar diversidad, corpus y revisión independiente" : r.id === "R05" ? "Notas por pista conservadas separadamente; no son atributos ni puntuaciones de verdad" : r.id === "R09" ? "IDs de pistas y relación con el álbum reutilizados por vínculo documentado; créditos nuevos no extraídos" : "Diferido: este recurso aún no tiene un adaptador de afirmaciones validado para identidad, alcance y procedencia; disponibilidad de archivos no acredita integración. Tarea: " + r.nextTask,
  }));
  await save("study.json", { version: "crv-review-study-0.3.0", predecessor:"crv-review-study-0.2.0", extractorVersion: REVIEW_EXTRACTOR_VERSION, schemaVersion: KNOWLEDGE_VERSION,
    generatedAt: new Date().toISOString(), reserveVersion:reserve.version, reservedReleases:holdout, manifest, discrepancies, releases: selection,
    independentEvaluation: { status: "pending", evaluators: [], agreement: null, supportPrecision: null, scopeErrors: null, thresholds: "Must be fixed before opening final holdout" },
    limits: ["La captura no acredita identidad CRV", "Muestreo de extremos sin prevalencia poblacional", "No se evaluaron musicalmente las publicaciones nuevas", "Autores distintos no equivalen a personas independientes"] });
  await save("vocabulary.json", vocabulary);
  await save("mappings.json", await reviewGenreMappings(root, legacyMappings, await json("reports/rym-reviews-piloto/v0.1.0/muestra.json"), new Set(genres.map(g=>String(g["slug"])))));
  await save("pilot-findings.json", { version: "crv-pilot-preservation-v1", findings: await json("reports/rym-reviews-piloto/v0.1.0/hallazgos.json"),
    quotes: await json("reports/rym-reviews-piloto/v0.1.0/evidencias-breves.json"), queries: await json("reports/rym-reviews-piloto/v0.1.0/consultas-prueba.json"),
    humanQueries: await json("reports/intenciones-humanas/v0.1.0/matriz-consultas.json"), status: "development_only_not_general_validation" });
  const genreMap = buildGenreKnowledgeMap(genres, await readGenreKnowledge(root), databaseStatus);
  await save("genre-map.json", genreMap);
  const languageResource=resourceUses.find((r:{id:string})=>r.id==="R06");
  if(languageResource&&languageCount){
    languageResource.disposition="release_language_metadata_extracted_partial";
    languageResource.evidence="release-languages.json;src/search/rym-release-language.ts;verification/language-result.json";
    languageResource.reason=`Campo Language/Languages conservado en ${languageCount} publicaciones con identidad documentada y huellas verificadas. Adaptador acotado a English/Spanish; otros literales pendientes, ausencias desconocidas. Sin herencia a pistas/ediciones, consultas públicas ni aprobación editorial. Falta ampliar cobertura y validar condiciones de idioma en la unidad buscada.`;
  }
  for (const resource of resourceUses) resource.disposition = resource.fieldReview ? resourceFieldStatus(resource.fieldReview.fields) : resource.id === "R16" ? "excluded" : "field_review_required";
  await save("resource-uses.json", { version: "crv-resources-stage2-v2", fieldReviewStatus, fieldReviewVersion: fieldReview?.version ?? null,
    fieldReviewRevision:fieldReview?.revision ?? null, fieldCoverage: fieldReview?.coverage ?? null, resources: resourceUses });
  console.log(JSON.stringify({ releases: releases.length, reserved: holdout.length, pages: manifest.length, facets: vocabulary.facets.length, genres: genres.length, described: genreMap.coverage.described, documentedProposals: genreMap.coverage.documentedProposals, output: "reports/unified-search-stage2", musicalValidation: "pending" }));
}

try {
  const command = process.argv[2] ?? "inventory";
  if (command === "inventory") await inventory();
  else if (command === "sync-study") {
    const args = process.argv.slice(3);
    const unknown = args.filter((arg, index) => arg !== "--dry-run" && arg !== "--cursor" && args[index - 1] !== "--cursor");
    if (unknown.length || args.filter(a => a === "--cursor").length > 1 || args.filter(a => a === "--dry-run").length > 1)
      throw new Error("Usar sync-study [--dry-run] [--cursor '<JSON>']");
    const cursorIndex = args.indexOf("--cursor");
    const cursor = cursorIndex < 0 ? undefined : studyFeedCursorSchema.parse(JSON.parse(args[cursorIndex + 1] ?? "null"));
    console.log(JSON.stringify(await syncStudyFeed(await prepareStudyFeed(root), {
      dryRun: args.includes("--dry-run"), ...(cursor ? { cursor } : {}),
    })));
  }
  else if (command === "enqueue") {
    if (!process.argv[3]) throw new Error("Indicar archivo de lote");
    console.log(JSON.stringify(await enqueueKnowledgeBatch(JSON.parse(await readFile(process.argv[3], "utf8")))));
  } else if (command === "work") console.log(JSON.stringify(await runKnowledgeChunk()));
  else if (command === "interpret") console.log(JSON.stringify(await runKnowledgeInterpretation(process.argv[3] ? Number(process.argv[3]) : 10)));
  else if (command === "retry") console.log(JSON.stringify(await retryKnowledgeJob(Number(process.argv[3]))));
  else if (command === "status") console.log(JSON.stringify(await knowledgeFeedStatus()));
  else throw new Error("Usar inventory, sync-study [--dry-run] [--cursor '<JSON>'], enqueue <archivo>, work, interpret, retry <id> o status");
} finally { await closeDb(); }
