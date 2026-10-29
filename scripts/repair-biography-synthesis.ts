// Repara una síntesis que perdió datos de la biografía anterior (años, nombres
// propios) o que se pasó del límite del aplicador. Una segunda llamada con el
// campo `correccion`, como el patrón de tmp-analysis/bio-fusion-2026-10-20.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createDeepSeekGateway } from "../src/ai/gateway.js";
import { closeDb } from "../src/db/client.js";

interface Source { ref: string; source: string; url: string | null; text: string }
interface Dossier { caseId: string; kind: string; entityId: number; name: string; currentText: string | null; sources: Source[]; [key: string]: unknown }
interface Out { caseId: string; text: string | null; sourcesUsed: string[]; discarded?: unknown[]; note?: string | null; model?: string }

const DOSSIERS = process.env["BIO_DOSSIERS_DIR"] ?? "reports/bio-dossiers-ig2-only";
const SYNTH = process.env["BIO_SYNTH_DIR"] ?? "reports/bio-synth-ig2";
const BATCH = process.argv.find((a) => a.startsWith("--batch="))?.slice(8) ?? "artist-001";
const GUIDE = "docs/curation/BIOGRAFIAS_SINTESIS.md";
const MAX = 7000;
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const MINIMAL = process.argv.includes("--minimal");
const TARGET = Number(process.argv.find((a) => a.startsWith("--target="))?.slice(9) ?? 0);

const responseSchema = z.object({
  caseId: z.string(), text: z.string().nullable(),
  sourcesUsed: z.array(z.string()).default([]),
  discarded: z.array(z.object({ ref: z.string().nullable().transform((v) => v ?? "?"), reason: z.string().nullable().transform((v) => v ?? "") })).default([]),
  note: z.string().nullable().default(null),
});

function rules(): string {
  const guide = readFileSync(GUIDE, "utf8");
  const start = guide.indexOf("## Instrucciones para el subagente de síntesis");
  const end = guide.indexOf("## Procedimiento del subagente");
  return [
    "Redactas la biografía (artista, persona, organización) o la reseña (disco) de UNA ficha del catálogo de rock venezolano.",
    "El INPUT JSON es un único expediente. Devuelve UN objeto JSON con las claves caseId, text, sourcesUsed, discarded y note.",
    "", guide.slice(start, end).trim(), "",
    "## Comprobación final antes de responder",
    "- Como mucho 3 temas nombrados en todo el texto y como mucho 5 nombres propios por párrafo.",
    "- Nunca copies la lista de temas, de artistas ni de créditos.",
    "- Español íntegro, sin correos, teléfonos ni enlaces.",
  ].join("\n");
}

const readJsonl = <T,>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);

const years = (text: string) => new Set((text.match(/\b(?:19|20)\d{2}\b/gu) ?? []));
const properNames = (text: string) => new Set(
  (text.match(/\b(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}\s+){1,3}[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}\b/gu) ?? [])
    .map((n) => n.replace(/\s+/gu, " ").trim()));

async function main(): Promise<void> {
  const dossiers = readJsonl<Dossier>(path.join(DOSSIERS, `${BATCH}.jsonl`));
  const outputs = readJsonl<Out>(path.join(SYNTH, `${BATCH}.jsonl`));
  const byCase = new Map(outputs.map((o) => [o.caseId, o]));
  const gateway = createDeepSeekGateway();
  const instructions = rules();
  let repaired = 0;
  for (const dossier of dossiers) {
    if (ONLY && dossier.caseId !== ONLY) continue;
    const out = byCase.get(dossier.caseId) ?? { caseId: dossier.caseId, text: dossier.currentText ?? "", sourcesUsed: [] };
    if (!out.text && !MINIMAL) continue;
    const proposedText = out.text ?? "";
    const current = dossier.currentText ?? "";
    if (!current.trim()) continue;
    const lostYears = [...years(current)].filter((y) => !proposedText.includes(y));
    const lostNames = [...properNames(current)].filter((n) => !proposedText.toLowerCase().includes(n.toLowerCase()));
    const tooLong = proposedText.length > MAX;
    if (!lostYears.length && !lostNames.length && !tooLong && !MINIMAL) continue;
    const fixes: string[] = [];
    if (MINIMAL) fixes.push(`Reescribe la biografía completa en menos de ${TARGET || 6000} caracteres: es un límite duro. Conserva todos los años, nombres propios, discos y hechos de la biografía actual.`);
    if (lostYears.length) fixes.push(`Tu texto omitió años que la biografía actual afirmaba: ${lostYears.join(", ")}. Consérvalos con su contexto exacto (no los cambies de significado).`);
    if (lostNames.length) fixes.push(`Tu texto omitió nombres propios que la biografía actual mencionaba: ${lostNames.slice(0, 12).join(", ")}. Reincorpóralos con su rol.`);
    if (tooLong) fixes.push(`El texto tiene ${proposedText.length} caracteres y el límite duro es ${MAX}. Debes entregar menos de ${TARGET || 4000} caracteres conservando TODOS los años, nombres propios y discos de la biografía actual. Comprime la redacción: frases cortas, sin enumerar temas, sin anécdotas ni adjetivos.`);
    fixes.push("No copies la biografía anterior literalmente: reescribe manteniendo su información y la del expediente.");
    try {
      const res = await gateway.propose({ taskKind: "biography", schemaVersion: "crv-bio-synth.v1", instructions, responseSchema,
        input: { ...dossier, ...(MINIMAL ? { sources: dossier.sources.filter((s) => s.source === "instagram-coleccionistas" && s.text) } : {}), correccion: fixes.join(" ") } });
      const answer = res.proposal;
      if (answer.caseId !== dossier.caseId) throw new Error(`caseId ${answer.caseId}`);
      byCase.set(dossier.caseId, { ...answer, model: res.model });
      repaired += 1;
      console.log(`${dossier.caseId} ${dossier.name} reparado (${lostYears.length} años, ${lostNames.length} nombres, largo ${tooLong}) -> ${answer.text?.length ?? 0} ch`);
    } catch (error) {
      console.error(`${dossier.caseId} FALLÓ: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  writeFileSync(path.join(SYNTH, `${BATCH}.jsonl`),
    dossiers.map((d) => byCase.get(d.caseId)).filter((o): o is Out => Boolean(o)).map((o) => JSON.stringify(o) + "\n").join(""));
  console.log(JSON.stringify({ repaired }));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());
