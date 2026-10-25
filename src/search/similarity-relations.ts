import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashText } from "./review-protocol.js";

// R28 · pares «similar» de Aqustico como relaciones de parecido explicables.
// La fuente lista artistas parecidos sin decir en qué: el aspecto queda
// «unknown» y la relación nunca acredita sonido, voz, guitarra, parentesco ni
// nacionalidad. Un extremo solo se resuelve a CRV con identidad ya probada en
// el plan Aqustico (cruce «probado» o alta creada desde la propia ficha); el
// resto queda como referencia externa, sin alta ficticia.

const endpointSchema = z.object({
  sourceId: z.number().int().positive(),
  name: z.string().min(1),
  crvArtistId: z.number().int().positive().nullable(),
  identity: z.enum(["aqustico_cross_proven", "aqustico_profile_created", "external_reference"]),
}).strict();

export const similarityRelationSchema = z.object({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  resourceId: z.literal("R28"),
  from: endpointSchema,
  to: endpointSchema,
  sourceRank: z.number().int().positive(),
  direction: z.literal("listed_by_source"),
  mutual: z.boolean(),
  nature: z.literal("platform_similarity_unexplained"),
  aspect: z.literal("unknown"),
  capture: z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  status: z.literal("proposed"),
}).strict().refine(r => r.from.crvArtistId !== null, "El origen debe tener identidad probada en CRV");

export const similarityFileSchema = z.object({
  version: z.literal("crv-similarity-relations-0.1.0"),
  resourceId: z.literal("R28"),
  policy: z.literal("explainable_proposals_never_assignments"),
  identityRule: z.string(),
  coverage: z.object({
    sourceFiles: z.number().int().nonnegative(), sourcePairs: z.number().int().nonnegative(),
    originsWithProvenIdentity: z.number().int().nonnegative(), relations: z.number().int().nonnegative(),
    bothResolved: z.number().int().nonnegative(), externalTargets: z.number().int().nonnegative(),
    mutual: z.number().int().nonnegative(), skippedUnprovenOrigin: z.number().int().nonnegative(),
  }).strict(),
  relations: z.array(similarityRelationSchema),
}).strict();
export type SimilarityRelation = z.infer<typeof similarityRelationSchema>;

export interface AqusticoIdentity { crvArtistId: number; identity: "aqustico_cross_proven" | "aqustico_profile_created" }

/** Lee los vínculos Aqustico→CRV que el plan Aqustico ya probó; nada por nombre suelto. */
export async function readAqusticoIdentities(root: string): Promise<Map<number, AqusticoIdentity>> {
  const ids = new Map<number, AqusticoIdentity>();
  const tsv = await readFile(path.join(root, "reports/aqustico-2026-10/cruces-artistas.tsv"), "utf8");
  for (const line of tsv.split("\n").slice(1)) {
    const [aq, , crv, , , proven] = line.split("\t");
    if (proven === "probado" && aq && crv) ids.set(Number(aq), { crvArtistId: Number(crv), identity: "aqustico_cross_proven" });
  }
  const created = JSON.parse(await readFile(path.join(root, "reports/aqustico-2026-10/altas-artistas-confirm.json"), "utf8")) as
    { resultados: Record<string, { resultado: string; artistId?: number }> };
  for (const [key, r] of Object.entries(created.resultados)) {
    const aq = Number(key.replace(/^aq:/u, ""));
    if (r.resultado.startsWith("creado") && r.artistId && !ids.has(aq)) ids.set(aq, { crvArtistId: r.artistId, identity: "aqustico_profile_created" });
  }
  return ids;
}

export function buildSimilarityRelations(
  captures: Array<{ originId: number; originName: string; path: string; sha256: string; similar: Array<{ id: number; name: string }> }>,
  identities: Map<number, AqusticoIdentity>,
) {
  const listed = new Set(captures.flatMap(c => c.similar.map(s => `${c.originId}>${s.id}`)));
  const endpoint = (id: number, name: string) => {
    const known = identities.get(id);
    return known ? { sourceId: id, name, crvArtistId: known.crvArtistId, identity: known.identity }
      : { sourceId: id, name, crvArtistId: null, identity: "external_reference" as const };
  };
  const relations: SimilarityRelation[] = [];
  let sourcePairs = 0, skippedUnprovenOrigin = 0;
  for (const c of [...captures].sort((a, b) => a.originId - b.originId)) {
    sourcePairs += c.similar.length;
    if (!identities.has(c.originId)) { skippedUnprovenOrigin += c.similar.length; continue; }
    c.similar.forEach((s, index) => {
      if (s.id === c.originId) return;
      const from = endpoint(c.originId, c.originName), to = endpoint(s.id, s.name);
      // Dos fichas CRV distintas con la misma identidad no se relacionan consigo mismas.
      if (to.crvArtistId !== null && to.crvArtistId === from.crvArtistId) return;
      relations.push(similarityRelationSchema.parse({
        key: hashText(`R28:${c.originId}>${s.id}:${c.sha256}`), resourceId: "R28", from, to, sourceRank: index + 1,
        direction: "listed_by_source", mutual: listed.has(`${s.id}>${c.originId}`), nature: "platform_similarity_unexplained",
        aspect: "unknown", capture: { path: c.path, sha256: c.sha256 }, status: "proposed",
      }));
    });
  }
  return {
    relations, coverage: {
      sourceFiles: captures.length, sourcePairs, originsWithProvenIdentity: captures.filter(c => identities.has(c.originId)).length,
      relations: relations.length, bothResolved: relations.filter(r => r.to.crvArtistId !== null).length,
      externalTargets: relations.filter(r => r.to.crvArtistId === null).length, mutual: relations.filter(r => r.mutual).length, skippedUnprovenOrigin,
    },
  };
}

export async function readAqusticoSimilarCaptures(root: string, dir = "data/raw/aqustico-2026-10-11") {
  const names = new Map<number, string>();
  const tsv = await readFile(path.join(root, "reports/aqustico-2026-10/cruces-artistas.tsv"), "utf8");
  for (const line of tsv.split("\n").slice(1)) { const [aq, name] = line.split("\t"); if (aq && name) names.set(Number(aq), name); }
  const files = (await readdir(path.join(root, dir, "similar"))).filter(f => /^\d+\.json$/u.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  return Promise.all(files.map(async file => {
    const rel = `${dir}/similar/${file}`, body = await readFile(path.join(root, rel), "utf8"), originId = parseInt(file);
    const similar = (JSON.parse(body) as Array<{ id: number; name: string }>).filter(s => Number.isInteger(s.id) && s.name?.trim())
      .map(s => ({ id: s.id, name: s.name.trim() }));
    return { originId, originName: names.get(originId) ?? `aqustico:${originId}`, path: rel, sha256: hashText(body), similar };
  }));
}

/** Candidatos «parecido a X»: solo con aspecto desconocido, porque la fuente no documenta otro. */
export function similarityCandidates(relations: SimilarityRelation[], query: { referenceArtistId: number; aspect: string | null }) {
  if (query.aspect && query.aspect !== "unknown")
    return { status: "unsupported_aspect" as const, reason: "La fuente no documenta en qué se parecen; no respalda un parecido por aspecto.", candidates: [] };
  const candidates = relations.filter(r => r.from.crvArtistId === query.referenceArtistId || r.to.crvArtistId === query.referenceArtistId)
    .map(r => {
      const other = r.from.crvArtistId === query.referenceArtistId ? r.to : r.from;
      return { artist: other, relationKey: r.key, sourceRank: r.sourceRank, mutual: r.mutual, explanation: explainSimilarity(r) };
    })
    .filter((c, i, all) => all.findIndex(x => x.artist.sourceId === c.artist.sourceId) === i);
  return { status: candidates.length ? "supported" as const : "no_relation" as const, reason: null, candidates };
}

export function explainSimilarity(r: SimilarityRelation): string {
  const both = r.mutual ? " La relación aparece en ambas direcciones." : "";
  const external = r.to.crvArtistId === null ? ` ${r.to.name} no tiene ficha probada en CRV; se muestra como referencia externa.` : "";
  return `Aqustico lista a ${r.to.name} entre los artistas similares a ${r.from.name} (posición ${r.sourceRank}).${both}${external}`
    + " La fuente no dice en qué se parecen: no acredita sonido, voz, instrumentos, parentesco ni nacionalidad.";
}
