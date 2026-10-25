// Plan 20/20 · etapa 2: vuelve a puntuar una medición del corpus con las reglas de citas actuales,
// sin modelo: reutiliza las extracciones guardadas y recalcula la disposición de cada cita.
// Uso: npx tsx scripts/stage2-corpus-replay.ts <labels.json> <directorio de la medición>
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const [labelsPath, dir] = process.argv.slice(2);
if (!labelsPath || !dir) throw Error("Uso: stage2-corpus-replay <labels.json> <directorio>");
const { closeDb } = await import("../src/db/client.js");
const { corpusLabelsSchema, scoreEntity, summarize } = await import("../src/verification/corpus-metrics.js");
const { loadVerificationSnapshot } = await import("../src/verification/snapshot.js");
const { assessCitation, announcesOnly, personalId, contextOnly } = await import("../src/verification/extraction-dispositions.js");
const DISCARDED = "Ninguna cita coincide con una fuente preservada; se conserva la extracción rechazada para revisión.";
const labels = corpusLabelsSchema.parse(JSON.parse(await readFile(labelsPath, "utf8")));
const measured = JSON.parse(await readFile(`${dir}/summary.json`, "utf8"));
try {
  const scores = [];
  for (const entity of labels.entities.filter((e) => e.partition === measured.partition)) {
    const saved = JSON.parse(await readFile(`${dir}/${entity.kind}-${entity.id}.json`, "utf8"));
    const pages = await Promise.all(entity.documents.map(async (doc) => JSON.parse(await readFile(`${dirname(labelsPath)}/${doc.file}`, "utf8"))));
    const snapshot = await loadVerificationSnapshot(entity.kind, entity.id);
    const extractions = saved.extractions.map((item: any) => {
      const evidence = item.evidence.map((e: any) => assessCitation(snapshot, pages, e, item.value));
      const literal = evidence.some((e: any) => e.reason !== "El fragmento no aparece literalmente en la copia de la fuente." && e.url);
      // Only the literal test changed: a citation that now matches leaves the discarded state as pending.
      const reopened = item.reason === DISCARDED && literal;
      // A biography sentence (proposed or confirmed) that only announces a plan is kept for review, never as a documented fact.
      const plan = ["biography", "discography", "missingAlbums"].includes(item.area) && (reopened || item.destination !== "discarded") && announcesOnly(evidence.filter((e: any) => e.valid).map((e: any) => e.quote));
      // An identity document number is personal data: discarded, as the current dispositions do.
      if (personalId(item.value ?? "") || evidence.some((e: any) => personalId(e.quote))) return { ...item, evidence: evidence.map((e: any) => ({ ...e, valid: false })), state: "invalid", destination: "discarded", reason: "Contiene el número de un documento de identidad." };
      // The deterministic context checks (sponsor, linked release, minitec) discard as the current dispositions do.
      const context = (reopened || item.destination !== "discarded" && item.state !== "invalid") && !plan ? contextOnly(snapshot, pages, { ...item, evidence }) : null;
      if (context) return { ...item, evidence, state: "uncertain", destination: "discarded", reason: context };
      return { ...item, evidence, ...(reopened ? { state: "uncertain", destination: "pending", reason: "Reabierta por la comprobación literal actual." } : {}), ...(plan ? { state: "uncertain", destination: "discarded", reason: "La cita anuncia un plan; no documenta que ocurriera." } : {}) };
    });
    const before = measured.scores.find((s: any) => s.kind === entity.kind && s.id === entity.id);
    const score = scoreEntity(entity, extractions);
    scores.push({ ...score, consumption: before?.consumption ?? null, complete: before?.complete ?? false, identityPending: before?.identityPending ?? 0 });
    process.stderr.write(`${entity.name}: ${before?.recovered}/${score.positives} → ${score.recovered}/${score.positives} (críticos ${before?.criticalRecovered} → ${score.criticalRecovered}/${score.criticalPositives}) negativos ${score.negativeHits.length}\n`);
  }
  const summary = { replayOf: dir, labels: labelsPath, reviewStatus: labels.reviewStatus, partition: measured.partition, ...summarize(scores), scores };
  await writeFile(`${dir}/replay.json`, `${JSON.stringify(summary, null, 2)}\n`);
  const { scores: _s, ...brief } = summary;
  process.stdout.write(`${JSON.stringify(brief)}\n`);
} finally { await closeDb(); }
