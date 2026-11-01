// CRV · Fusión asistida por la IA del catálogo para los pares que propone
// `artist-candidates` (Brian, 2026-10-29).
//
// QUÉ HACE: por cada par, arma un dosier con los hechos de las dos fichas
// (nombre, alias, origen, fechas, integrantes, discografía, audiovisuales,
// enlaces y señales del detector), pide a DeepSeek —la misma IA del catálogo—
// que interprete si son la MISMA identidad, y solo entonces fusiona. La IA
// PROPONE; el código dispone: sin dos hechos de identidad citados del dosier,
// sin señal determinista del detector o con una contradicción, no se fusiona.
//
// NADA SE PIERDE: la fusión va por `mergeEntities` (el mismo camino auditado de
// la API), conserva el nombre del duplicado como alias, une los textos largos y
// los marca para que la IA los reescriba, mueve TODAS las referencias (discos,
// integrantes, audiovisuales, galería, documentos, claims) y deja `merge_audit`
// para deshacer. Antes y después se comparan integrantes, discos,
// audiovisuales, alias y fechas: si falta algo, se deshace el run y se informa.
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DeepSeekGateway } from "../ai/gateway.js";
import { getPool } from "../db/client.js";
import { getEnv } from "../config/env.js";
import { searchLocalEvidence } from "../research/local-evidence.js";
import {
  ArtistMergeLossError, chooseArtistKeep, loadArtistProfiles, mergeArtistVerified,
  missingAfterMerge, missingFields, type ArtistMergeRunResult, type ArtistProfile,
} from "../merge/artist-merge-run.js";
import { withOperatorRun } from "../merge/operator.js";
import { rewritePending } from "../merge/text-rewrite.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import type { ArtistCandidate } from "./artist-candidates.js";
import type { FeedbackPrecedent } from "../curation/feedback.js";
import type { LocalEvidence } from "../research/local-evidence.js";
import { loadFeedbackForPairs } from "../curation/feedback.js";

// Compatibilidad: la CLI y sus pruebas importan estas piezas desde aquí.
export { chooseArtistKeep, loadArtistProfiles, missingAfterMerge, missingFields };
export type { ArtistProfile };

export const ARTIST_MERGE_SCHEMA_VERSION = "artist-merge-verdict.v2";

/** La IA solo puede elegir entre estas cuatro respuestas. */
export const artistMergeVerdictSchema = z.object({
  decision: z.enum(["same_identity", "related", "distinct", "needs_human"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    fact_id: z.string().min(1).max(80),
    supports: z.enum(["match", "separate"]),
  })).max(20),
  reasoning: z.string().min(1).max(2000),
  /** Datos que faltan en una ficha; no impiden fusionar, se anotan. */
  data_gaps: z.array(z.string().min(1).max(300)).max(10),
  /** Razones por las que PODRÍAN no ser la misma identidad; bloquean la fusión. */
  identity_doubts: z.array(z.string().min(1).max(300)).max(10),
}).strict();

export type ArtistMergeVerdict = z.infer<typeof artistMergeVerdictSchema>;

export const ARTIST_MERGE_INSTRUCTIONS = [
  "Decides si dos fichas del catálogo de rock venezolano son la MISMA identidad.",
  "Usa SOLO los hechos del INPUT (facts). No uses conocimiento propio ni inventes fechas, nombres, alias ni relaciones.",
  "Los hechos fuente.N son fragmentos de capturas propias (RHV, RYM, Hippito, Discogs, etc.). Cítalos si los usas. Una fuente compartida por muchas fichas es un directorio, no una prueba de identidad.",
  "Una banda puede cambiar de nombre, de integrantes y de época: eso no la convierte en otra identidad.",
  "Dos PROYECTOS distintos de la misma persona (un alias temprano, un proyecto paralelo, un nombre anterior con discografía propia) son fichas distintas: responde related, no same_identity, aunque compartan la persona, las cuentas oficiales o un alias cruzado. same_identity es para la MISMA ficha duplicada, no para etapas o proyectos que el catálogo conserva por separado.",
  "Dos fichas con el mismo nombre pueden ser homónimos de ciudades o épocas distintas: eso las SEPARA.",
  "Un proyecto solista y una banda pueden estar relacionados sin ser la misma ficha.",
  "Casos CRV ya decididos: «Kámara de Tortura» y «La Kámara De la Tortura» son la MISMA banda (variante de escritura + tracklist + página + foto): same_identity. «Nemesis» y «Nemesis (Lara)» son homónimos: distinct. «Nuuro» y «Arca» son dos proyectos distintos de Alejandra Ghersi: related, nunca same_identity.",
  "same_identity exige al menos DOS hechos de identidad distintos (no solo el nombre) y ningún hecho en contra; si dudas de la identidad, responde needs_human.",
  "related = comparten músicos o historia pero son fichas distintas (proyecto paralelo, homenaje, colaboración).",
  "distinct = homónimos o proyectos sin relación.",
  "En `data_gaps` lista SOLO datos que faltan en una ficha (año, ciudad, integrantes, enlaces): son huecos, no dudas de identidad y NO bloquean la fusión.",
  "En `identity_doubts` lista SOLO razones por las que podrían ser entidades distintas o meramente relacionadas (otra ciudad, otra época, otro proyecto). Si hay alguna, la fusión NO se hará.",
  "Cada evidencia cita un fact_id que existe en facts y dice si apoya match o separate.",
  "Responde las seis claves: decision, confidence (0..1), evidence, reasoning, data_gaps, identity_doubts.",
].join("\n");

export interface ArtistMergeDossier {
  facts: Array<{ id: string; text: string }>;
  a: ArtistProfile;
  b: ArtistProfile;
  /** Decisiones humanas o undos anteriores sobre este mismo par. */
  precedents: FeedbackPrecedent[];
  /** Fragmentos citables de capturas propias (RHV, RYM, Hippito, etc.). */
  localEvidence: LocalEvidence[];
}

function formatYears(from: number | null, to: number | null): string {
  if (from === null && to === null) return "";
  if (from !== null && to !== null) return ` (${from}-${to})`;
  return from !== null ? ` (desde ${from})` : ` (hasta ${to})`;
}

/** Hechos numerados y legibles; la IA debe citar sus ids. */
export function buildDossier(
  a: ArtistProfile, b: ArtistProfile, candidate: Pick<ArtistCandidate, "score" | "signals" | "features" | "deterministic">,
  precedents: FeedbackPrecedent[] = [],
  localEvidence: LocalEvidence[] = [],
): ArtistMergeDossier {
  const facts: ArtistMergeDossier["facts"] = [];
  const add = (id: string, text: string) => facts.push({ id, text });
  const side = (prefix: string, profile: ArtistProfile) => {
    add(`${prefix}.nombre`, `Ficha ${profile.id}: «${profile.name}» — tipo ${profile.artistType}`);
    add(`${prefix}.origen`, `Ficha ${profile.id} origen: ${profile.originCity ?? "sin ciudad"}${profile.originCountry ? `, ${profile.originCountry}` : ""}; formación ${profile.formedYear ?? "sin año"}; disolución ${profile.disbandedYear ?? "sin año"}; años activos: ${profile.yearsActive ?? "sin dato"}; estado: ${profile.status ?? "sin dato"}`);
    add(`${prefix}.alias`, `Ficha ${profile.id} alias: ${profile.aliases.length ? profile.aliases.join("; ") : "ninguno"}`);
    add(`${prefix}.integrantes`, `Ficha ${profile.id} integrantes: ${profile.members.length
      ? profile.members.map((member) => `${member.name} (${member.role}${formatYears(member.from, member.to)})`).join("; ")
      : "sin integrantes registrados"}`);
    add(`${prefix}.discografia`, `Ficha ${profile.id} discografía: ${profile.albums.length
      ? profile.albums.map((album) => `${album.title}${album.year ? ` (${album.year})` : ""} [${album.type}]`).join("; ")
      : "sin discos"}`);
    add(`${prefix}.audiovisuales`, `Ficha ${profile.id} audiovisuales: ${profile.audiovisuals.length
      ? profile.audiovisuals.map((item) => `${item.title}${item.year ? ` (${item.year})` : ""}`).join("; ")
      : "sin audiovisuales"}`);
    add(`${prefix}.enlaces`, `Ficha ${profile.id} enlaces: ${profile.links.length ? profile.links.join("; ") : "sin enlaces"}`);
    add(`${prefix}.evidencia`, `Ficha ${profile.id} páginas de evidencia: ${profile.evidence.length ? profile.evidence.join("; ") : "sin páginas"}`);
    add(`${prefix}.volumen`, `Ficha ${profile.id} volumen: ${profile.claims} claims, ${profile.gallery} imágenes de galería, ${profile.documents} documentos, ${profile.mediaLinks} enlaces de medios`);
  };
  side("a", a);
  side("b", b);
  add("detector.senales", `Señales automáticas del par: score ${candidate.score.toFixed(2)}, ${candidate.signals} deterministas; `
    + candidate.features.filter((feature) => feature.value > 0).map((feature) => `${feature.key}: ${feature.evidence}`).join(" | "));
  precedents.forEach((precedent, index) => {
    add(`precedente.${index + 1}`, `Decisión anterior sobre este par (${precedent.aId}/${precedent.bId}), ${precedent.source}: ${precedent.outcome}${precedent.note ? ` — ${precedent.note}` : ""}`);
  });
  localEvidence.forEach((evidence, index) => {
    add(`fuente.${index + 1}`, `Fuente local ${evidence.source}${evidence.title ? ` — ${evidence.title}` : ""}${evidence.url ? ` — ${evidence.url}` : ""}: ${evidence.snippet}`);
  });
  return { facts, a, b, precedents, localEvidence };
}

/** Pide a la IA del catálogo el veredicto para un par. */
export async function classifyArtistPair(
  gateway: DeepSeekGateway, candidate: ArtistCandidate, dossier: ArtistMergeDossier,
): Promise<{ verdict: ArtistMergeVerdict; model: string; runId: number | null }> {
  const factIds = new Set(dossier.facts.map((fact) => fact.id));
  const payload = {
    fichas: { a: candidate.a.id, b: candidate.b.id },
    facts: dossier.facts,
  };
  const ask = (correction?: string) => gateway.propose({
    taskKind: "hard_entity_resolution", modelClass: "fast",
    schemaVersion: ARTIST_MERGE_SCHEMA_VERSION,
    responseSchema: artistMergeVerdictSchema,
    instructions: ARTIST_MERGE_INSTRUCTIONS,
    input: correction === undefined ? payload : { ...payload, correccion: correction },
  });
  const invalid = (proposal: ArtistMergeVerdict): string | null => {
    const unknown = [...new Set(proposal.evidence.map((item) => item.fact_id).filter((id) => !factIds.has(id)))];
    return unknown.length ? `citó hechos que no existen en el dosier: ${unknown.join(", ")}` : null;
  };
  let result: Awaited<ReturnType<typeof ask>>;
  try {
    result = await ask();
  } catch (error) {
    const problem = `la respuesta anterior no cumplió el contrato (${(error as Error).message.slice(0, 200)})`;
    result = await ask(`Corrige: ${problem}. Devuelve SOLO el objeto JSON con las seis claves, sin texto fuera del JSON y con comas entre propiedades.`);
  }
  let verdict = result.proposal;
  const cited = invalid(verdict);
  if (cited) {
    result = await ask(`Corrige: ${cited}. Usa solo fact_id que aparezcan en facts.`);
    verdict = result.proposal;
  }
  return { verdict, model: result.model, runId: result.runId ?? null };
}

/** Nombres con paréntesis de desambiguación: «Necrosis (Zulia)» no es «Necrosis». */
function disambiguators(name: string): string[] {
  return [...name.matchAll(/\(([^)]{2,40})\)/gu)].map((match) => normalizeEntityName(match[1]!).secondaryKey);
}

export interface MergePolicyResult {
  merge: boolean;
  reason: string;
}

/**
 * La IA propone; esto dispone. Solo se fusiona con `same_identity`, confianza
 * alta, dos hechos de identidad citados, ningún hecho en contra, ninguna
 * incertidumbre, al menos una señal determinista del detector y sin
 * desambiguadores de nombre incompatibles.
 */
export function artistMergePolicy(candidate: ArtistCandidate, verdict: ArtistMergeVerdict): MergePolicyResult {
  const matchFacts = new Set(verdict.evidence.filter((item) => item.supports === "match").map((item) => item.fact_id));
  const separateFacts = new Set(verdict.evidence.filter((item) => item.supports === "separate").map((item) => item.fact_id));
  const left = disambiguators(candidate.a.name);
  const right = disambiguators(candidate.b.name);
  const sameDisambiguators = left.length === right.length && left.every((item) => right.includes(item));
  if ((left.length || right.length) && !sameDisambiguators) {
    return { merge: false, reason: `nombres desambiguados distintos: «${candidate.a.name}» / «${candidate.b.name}»` };
  }
  if (verdict.decision !== "same_identity") return { merge: false, reason: `la IA dijo ${verdict.decision}` };
  if (verdict.confidence < 0.85) return { merge: false, reason: `confianza ${verdict.confidence.toFixed(2)} < 0,85` };
  if (matchFacts.size < 2) return { merge: false, reason: "la IA no citó dos hechos de identidad" };
  if (separateFacts.size) return { merge: false, reason: `la IA citó hechos en contra: ${[...separateFacts].join(", ")}` };
  if (verdict.identity_doubts.length) return { merge: false, reason: `la IA dudó de la identidad: ${verdict.identity_doubts.join("; ")}` };
  if (candidate.signals < 1) return { merge: false, reason: "sin señal determinista del detector; queda a revisión humana" };
  return { merge: true, reason: "misma identidad con dos o más hechos y señal determinista" };
}

export interface ArtistMergeOutcome {
  status: "merged" | "dismissed" | "left-open" | "skipped" | "failed" | "undone";
  keepId?: number;
  dropId?: number;
  runId?: number;
  auditId?: number;
  moved?: number;
  discarded?: number;
  membershipsMerged?: number;
  rewritePending?: boolean;
  rewriteWritten?: number;
  missing?: string[];
  detail: string;
}

async function artistExists(queryable: Pick<PoolClient, "query">, id: number): Promise<boolean> {
  return ((await queryable.query<{ n: string }>("SELECT count(*)::text AS n FROM public.artists WHERE id=$1", [id])).rows[0]!.n) !== "0";
}

/** Marca el careo como «son distintas / relacionadas»; deja rastro de la IA. */
async function dismissPair(candidate: ArtistCandidate, verdict: ArtistMergeVerdict, reason: string, operator: string): Promise<number> {
  const { result } = await withOperatorRun({
    name: "cli:review:artist-merge:dismiss", operator, note: `IA del catálogo: ${verdict.reasoning.slice(0, 800)}`,
    params: { pair: [candidate.a.id, candidate.b.id], decision: verdict.decision, confidence: verdict.confidence },
  }, async (context) => {
    const note = `IA del catálogo (${verdict.decision}, ${verdict.confidence.toFixed(2)}): ${reason}`.slice(0, 1500);
    const updated = await context.client.query<{ id: string }>(`
      UPDATE ingest.review_queue
         SET status='dismissed', resolved_by='ai', resolved_at=now(), updated_at=now(),
             resolution_note=$3
       WHERE kind='possible_duplicate' AND status IN ('open','in_progress')
         AND LEAST(artist_a_id,artist_b_id)=LEAST($1::bigint,$2::bigint)
         AND GREATEST(artist_a_id,artist_b_id)=GREATEST($1::bigint,$2::bigint)
       RETURNING id::text`,
    [candidate.a.id, candidate.b.id, note]);
    const a = Math.min(candidate.a.id, candidate.b.id);
    const b = Math.max(candidate.a.id, candidate.b.id);
    await context.client.query(`
      INSERT INTO ingest.curation_distinct_pairs(kind,a_id,b_id,decided_by,note,review_id,run_id)
      VALUES ('artist',$1,$2,'ai',$3,$4,$5)
      ON CONFLICT (kind,a_id,b_id) DO NOTHING`,
    [a, b, note, updated.rows[0] ? Number(updated.rows[0].id) : null, context.runId]);
    return updated.rowCount ?? 0;
  });
  return result;
}

/**
 * Fusiona un par ya aprobado por la IA, con el camino auditado de la API.
 * La verificación ocurre dentro de la transacción: si falta algo, el run se
 * revierte y no queda una fusión a medias.
 */
export async function applyArtistMerge(
  candidate: ArtistCandidate, verdict: ArtistMergeVerdict, operator: string, note: string,
  options: { rewrite?: boolean; gateway?: DeepSeekGateway } = {},
): Promise<ArtistMergeOutcome> {
  const pool = getPool();
  if (!(await artistExists(pool, candidate.a.id))) return { status: "skipped", detail: `${candidate.a.id} ya no existe (fusionado antes)` };
  if (!(await artistExists(pool, candidate.b.id))) return { status: "skipped", detail: `${candidate.b.id} ya no existe (fusionado antes)` };
  const profiles = await loadArtistProfiles(pool, [candidate.a.id, candidate.b.id]);
  const profileA = profiles.get(candidate.a.id);
  const profileB = profiles.get(candidate.b.id);
  if (!profileA || !profileB) return { status: "failed", detail: "no se pudieron cargar las dos fichas" };
  const keepId = chooseArtistKeep(profileA, profileB);
  const dropId = keepId === candidate.a.id ? candidate.b.id : candidate.a.id;
  const applied = await (async (): Promise<
    { runId: number; result: ArtistMergeRunResult } | { error: string; missing?: string[] }
  > => {
    try {
      const outcome = await withOperatorRun({
        name: "cli:review:artist-merge", operator, note,
        params: {
          pair: [candidate.a.id, candidate.b.id], keepId, dropId,
          verdict: { decision: verdict.decision, confidence: verdict.confidence, reasoning: verdict.reasoning.slice(0, 800) },
        },
      }, async (context) => mergeArtistVerified(context, { keepId, dropId }));
      return { runId: outcome.runId, result: outcome.result };
    } catch (error) {
      if (error instanceof ArtistMergeLossError) return { error: error.message.slice(0, 500), missing: error.missing };
      return { error: (error as Error).message.slice(0, 500) };
    }
  })();
  if ("missing" in applied && applied.missing) {
    return {
      status: "undone", keepId, dropId, missing: applied.missing,
      detail: `${applied.error}; transacción revertida`,
    };
  }
  if ("error" in applied) return { status: "failed", keepId, dropId, detail: applied.error };
  const { runId, result: run } = applied;
  const merged = run.merged;

  let rewriteWritten: number | undefined;
  let pending = merged.rewritePending;
  if (options.rewrite !== false && options.gateway) {
    try {
      const pendingRows = (await pool.query<{ id: string }>(
        "SELECT id::text FROM ingest.text_rewrites WHERE entity_kind='artist' AND entity_id=$1 AND status='pending' ORDER BY id",
        [keepId])).rows.map((row) => Number(row.id));
      if (pendingRows.length) {
        const report = await rewritePending({
          gateway: options.gateway, confirm: true, ids: pendingRows, concurrency: 2,
          note: `Reescritura tras fusión ${keepId}/${dropId} (IA del catálogo)`,
        });
        rewriteWritten = report.written;
        pending = report.pending > report.written;
      }
    } catch (error) {
      // La fusión ya está hecha y el texto quedó unido: no se pierde nada; la
      // reescritura puede reintentarse desde la cola.
      pending = true;
      rewriteWritten = 0;
    }
  }
  return {
    status: "merged", keepId, dropId, runId, auditId: merged.auditId, moved: merged.moved,
    discarded: merged.discarded, membershipsMerged: merged.membershipsMerged,
    rewritePending: pending, ...(rewriteWritten === undefined ? {} : { rewriteWritten }),
    detail: `fusionadas ${dropId} → ${keepId}`,
  };
}

export interface ArtistMergeBatchOptions {
  candidates: ArtistCandidate[];
  gateway: DeepSeekGateway;
  operator: string;
  note: string;
  /** Sin escribir: solo clasifica y muestra qué haría. */
  dryRun: boolean;
  limit?: number;
  /** No fusionar: los pares que la IA separa quedan abiertos para una persona. */
  keepReviews?: boolean;
  /** Reescritura de biografías con la IA (por defecto sí). */
  rewrite?: boolean;
  concurrency?: number;
  onProgress?: (line: string) => void;
}

export interface ArtistMergeBatchReport {
  mode: "dry-run" | "confirm";
  pairs: number;
  same: number;
  related: number;
  distinct: number;
  uncertain: number;
  merged: number;
  dismissed: number;
  leftOpen: number;
  skipped: number;
  failed: number;
  undone: number;
  rewrites: number;
  failures: Array<{ pair: string; detail: string }>;
  samples: Array<{ pair: string; decision: string; confidence: number; keep: string; drop: string; detail: string; reasoning?: string; dataGaps?: string[]; identityDoubts?: string[] }>;
}

/** Clasifica todos los pares (en paralelo) y, si no es seco, los aplica en serie. */
export async function runArtistMergeBatch(options: ArtistMergeBatchOptions): Promise<ArtistMergeBatchReport> {
  const selected = options.limit === undefined ? options.candidates : options.candidates.slice(0, options.limit);
  const profiles = await loadArtistProfiles(getPool(), selected.flatMap((candidate) => [candidate.a.id, candidate.b.id]));
  const feedback = await loadFeedbackForPairs(getPool(), selected.map((candidate) => [candidate.a.id, candidate.b.id]));
  const report: ArtistMergeBatchReport = {
    mode: options.dryRun ? "dry-run" : "confirm", pairs: selected.length, same: 0, related: 0, distinct: 0,
    uncertain: 0, merged: 0, dismissed: 0, leftOpen: 0, skipped: 0, failed: 0, undone: 0, rewrites: 0,
    failures: [], samples: [],
  };
  const verdicts = new Map<number, ArtistMergeVerdict>();
  const queue = selected.map((candidate, index) => ({ candidate, index }));
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) break;
      const profileA = profiles.get(item.candidate.a.id);
      const profileB = profiles.get(item.candidate.b.id);
      if (!profileA || !profileB) continue;
      const localEvidence = getEnv().CRV_CURATION_LOCAL_EVIDENCE
        ? await searchLocalEvidence(getPool(), [profileA.name, profileB.name], 5)
        : [];
      const dossier = buildDossier(profileA, profileB, item.candidate,
        feedback.get(`${Math.min(profileA.id, profileB.id)}:${Math.max(profileA.id, profileB.id)}`) ?? [], localEvidence);
      try {
        const { verdict } = await classifyArtistPair(options.gateway, item.candidate, dossier);
        verdicts.set(item.index, verdict);
        if (verdict.decision === "same_identity") report.same += 1;
        else if (verdict.decision === "related") report.related += 1;
        else if (verdict.decision === "distinct") report.distinct += 1;
        else report.uncertain += 1;
        options.onProgress?.(`IA ${item.index + 1}/${selected.length}: ${verdict.decision} ${verdict.confidence.toFixed(2)} — ${item.candidate.a.id} «${item.candidate.a.name}» / ${item.candidate.b.id} «${item.candidate.b.name}»`);
      } catch (error) {
        report.failed += 1;
        report.failures.push({ pair: `${item.candidate.a.id}/${item.candidate.b.id}`, detail: `IA: ${(error as Error).message.slice(0, 300)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, selected.length)) }, worker));

  if (options.dryRun) {
    for (const [index, verdict] of verdicts) {
      const candidate = selected[index]!;
      const policy = artistMergePolicy(candidate, verdict);
      if (report.samples.length < 30) {
        report.samples.push({
          pair: `${candidate.a.id}/${candidate.b.id}`, decision: verdict.decision, confidence: verdict.confidence,
          keep: candidate.a.name, drop: candidate.b.name, detail: policy.reason,
          reasoning: verdict.reasoning, dataGaps: verdict.data_gaps, identityDoubts: verdict.identity_doubts,
        });
      }
    }
    return report;
  }

  for (const [index, verdict] of [...verdicts.entries()].sort((left, right) => left[0] - right[0])) {
    const candidate = selected[index]!;
    const pair = `${candidate.a.id}/${candidate.b.id}`;
    const policy = artistMergePolicy(candidate, verdict);
    if (policy.merge) {
      const outcome = await applyArtistMerge(candidate, verdict, options.operator, options.note, {
        ...(options.rewrite === false ? { rewrite: false } : {}), gateway: options.gateway,
      });
      if (outcome.status === "merged") {
        report.merged += 1;
        if (outcome.rewriteWritten) report.rewrites += outcome.rewriteWritten;
        if (verdict.data_gaps.length) {
          options.onProgress?.(`  huecos anotados en ${outcome.keepId}: ${verdict.data_gaps.slice(0, 3).join("; ")}`);
        }
      } else if (outcome.status === "undone") report.undone += 1;
      else if (outcome.status === "skipped") report.skipped += 1;
      else report.failed += 1;
      if (outcome.status !== "merged" && outcome.status !== "skipped") {
        report.failures.push({ pair, detail: outcome.detail });
      }
      if (report.samples.length < 30) {
        report.samples.push({
          pair, decision: verdict.decision, confidence: verdict.confidence,
          keep: String(outcome.keepId ?? ""), drop: String(outcome.dropId ?? ""),
          detail: `${outcome.status}: ${outcome.detail}${outcome.missing?.length ? ` — faltaba ${outcome.missing.join(" · ")}` : ""}`,
        });
      }
      options.onProgress?.(`${policy.merge ? "FUSIÓN" : "REVISIÓN"} ${pair}: ${outcome.status} — ${outcome.detail}`);
      continue;
    }
    if (!options.keepReviews && (verdict.decision === "distinct" || verdict.decision === "related")) {
      const dismissed = await dismissPair(candidate, verdict, policy.reason, options.operator);
      report.dismissed += dismissed ? 1 : 0;
      if (!dismissed) report.leftOpen += 1;
    } else {
      report.leftOpen += 1;
    }
    options.onProgress?.(`${verdict.decision.toUpperCase()} ${pair}: ${policy.reason}`);
  }
  return report;
}
