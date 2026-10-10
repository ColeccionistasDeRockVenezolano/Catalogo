/** Revisa la propuesta existente sin llamadas de IA. --save guarda el borrador validado. */
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { getPlan, savePlan } from "../src/curation/ai/store.js";
import { executePlan } from "../src/curation/ai/executor.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { load } from "cheerio";

const operator = "Codex · revisión solicitada por Brian";
const sourceUrls = [
  "https://sincopa.com/rock_pop/cdinfo_rock/banana_voladora1.htm",
  "https://sincopa.com/rock_pop/cdinfo_rock/banana_voladora2.htm",
];

try {
  const plan = await getPlan(5);
  if (plan.entityKind !== "artist" || plan.entityId !== 1212 || plan.status !== "ready" || plan.revision !== 4 || !plan.draft)
    throw new Error("La propuesta de La Banana Voladora ya cambió; revisar antes de continuar.");
  const sources = await Promise.all(sourceUrls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`No se pudo comprobar ${url}`);
    const $ = load(new TextDecoder("windows-1252").decode(await response.arrayBuffer()));
    $("script,style").remove();
    return { url, text: $("body").text().replace(/\s+/g, " ").trim() };
  }));
  if (!sources[0]!.text.includes("Vocals, Keyboards & Acoustic Guitar: Enrique Figueredo") ||
      !sources[0]!.text.includes("Alto Sax, Keyboards & Background Vocals: Humberto Meza") ||
      !sources[1]!.text.includes("Vocals & Keyboards: Enrique Figueredo") ||
      !sources[1]!.text.includes("Keyboards: Humberto Meza"))
    throw new Error("Las fuentes cambiaron; no guardar la corrección sin comprobarlas.");
  const draft = structuredClone(plan.draft);
  for (const op of draft.operations) {
    if (op.key === "member_424" && op.op === "replace_relation") {
      op.values = { role: "Lead Vocals, Keyboards & Acoustic Guitar" };
      op.reason = `Se eliminan repeticiones conservando voz, teclados y guitarra acústica documentados en 1994 y voz y teclados en 1997. Fuentes: ${sourceUrls.join(" y ")}`;
    }
    if (op.key === "member_432" && op.op === "replace_relation") {
      op.values = { role: "Alto Sax, Keyboards & Background Vocals" };
      op.reason = `Se eliminan repeticiones conservando saxofón alto, teclados y coros documentados en 1994 y teclados en 1997. Fuentes: ${sourceUrls.join(" y ")}`;
    }
    if (op.op === "merge_entities") {
      op.reason += `. Cotejo editorial: las parejas coinciden en artista, año y repertorio de Sincopa (${op.key === "merge_211_3826" ? sourceUrls[0] : sourceUrls[1]}). Se conservan las pistas adicionales de la ficha principal y los créditos de ambas.`;
    }
  }
  draft.summary = "Fusionar los duplicados de los discos de 1994 y 1997, conservando pistas, créditos, portadas y enlaces. Limpiar los roles repetidos de Enrique Figueredo y Humberto Meza conservando todos sus instrumentos documentados en las fuentes de ambos discos.";
  draft.unresolved = draft.unresolved.filter((text) =>
    !text.startsWith("Rol exacto de Enrique") &&
    !text.startsWith("Título de la pista instrumental") &&
    !text.startsWith("Existencia de pistas adicionales"));
  draft.unresolved.push("Sincopa documenta 14 pistas en 1997; la ficha 212 contiene una pista adicional. La fusión conserva esa pista y deja su procedencia pendiente de revisión.");
  const reviewedKeys = draft.operations.filter((op) => op.enabled).map((op) => op.key);
  const { result } = await withOperatorRun(
    { name: "ai-curation:preview", operator, note: "Comprobar propuesta 5 preservando instrumentos y contenido discográfico" },
    (context) => executePlan(context, { kind: "artist", id: 1212 }, draft, plan.evidence, reviewedKeys, { preview: true }),
    { rollbackOnly: true, serializable: true },
  );
  if (!result.preview.ready) throw new Error(JSON.stringify(result.preview.items.map(({ key, error }) => ({ key, error }))));
  mkdirSync("reports/banana-voladora-2026-10-10", { recursive: true });
  writeFileSync("reports/banana-voladora-2026-10-10/revision.json", JSON.stringify({
    proposalId: plan.id, originalRevision: plan.revision, originalDraft: plan.draft,
    draft, reviewedKeys, sources, preview: result.preview,
  }, null, 2));
  if (process.argv.includes("--save")) {
    const saved = await savePlan(plan.id, plan.revision, draft, reviewedKeys, operator);
    writeFileSync("reports/banana-voladora-2026-10-10/propuesta-validada.json", JSON.stringify(saved, null, 2));
    console.log(JSON.stringify({ id: saved.id, revision: saved.revision, ready: saved.preview?.ready, status: saved.status, errors: saved.preview?.items.filter((item) => item.error) }));
  } else {
    console.log(JSON.stringify({ id: plan.id, ready: result.preview.ready, operations: result.preview.items.map(({ key, error }) => ({ key, error })), catalogChanged: false }));
  }
} finally {
  await closeDb();
}
