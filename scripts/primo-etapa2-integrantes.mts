// CRV · Plan del primo, etapa 2 (2026-10-12): integrantes (puntos 11 y 12).
//
//   --stage=instrumentos [--confirm]
//       Normaliza el rol libre de cada membresía a la lista fija de
//       instrumentos (src/discography/instruments.ts) y lo guarda en
//       `ingest.membership_details.instruments`. El rol original no se toca.
//   --stage=expedientes
//       Un expediente por banda con integrantes: biografía, textos originales
//       de las fuentes (expedientes de biografías) y la lista de membresías con
//       su id. Solo lectura.
//   --stage=extraer [--concurrency=20] [--limit=N] [--ids=1,2]
//       DeepSeek flash, UNA llamada por banda (Brian: nada de subagentes en
//       masa). Propone fundadores y periodos con una cita literal; el código la
//       valida (está en el texto, nombra a la persona y contiene el año o la
//       palabra de fundación). Reanudable; caché en ingest.ai_runs.
//   --stage=aplicar [--confirm]
//       Fundador → `membership_details.is_founder` con su cita. Años → solo
//       donde la membresía no tenía (`from_year`/`to_year` nulos). Un run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createDeepSeekGateway } from "../src/ai/gateway.js";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { instrumentsOf } from "../src/discography/instruments.js";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = arg("stage");
const confirm = process.argv.includes("--confirm");
const DIR = "reports/primo-etapa2";
const BIO_DIR = arg("bio") ?? `${DIR}/bio-dossiers`;
const DOSSIERS = `${DIR}/integrantes-expedientes.jsonl`;
const EXTRACTION = `${DIR}/integrantes-extraccion.jsonl`;
const ONLY = arg("ids")?.split(",").map(Number);
const NOTE = "Plan del primo, etapa 2 (2026-10-12): integrantes";
const pool = getPool();
mkdirSync(DIR, { recursive: true });

const readJsonl = <T,>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T) : []);

// ── Instrumentos ───────────────────────────────────────────────────────────
async function instrumentos(): Promise<void> {
  const { rows } = await pool.query<{ id: string; role: string }>("SELECT id::text, role FROM public.artist_members ORDER BY id");
  const planned = rows.map((row) => ({ id: Number(row.id), role: row.role, instruments: instrumentsOf(row.role) }));
  const without = planned.filter((row) => !row.instruments.length);
  const roles = new Map<string, number>();
  for (const row of without) roles.set(row.role.toLowerCase(), (roles.get(row.role.toLowerCase()) ?? 0) + 1);
  writeFileSync(`${DIR}/instrumentos-${confirm ? "aplicado" : "ensayo"}.md`, [
    `# Instrumentos de integrantes — ${confirm ? "aplicado" : "ensayo"}`, "",
    `${planned.length} membresías; ${planned.length - without.length} con instrumento; ${without.length} sin instrumento reconocible.`, "",
    "## Roles sin instrumento (más frecuentes)", "", ...[...roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([role, count]) => `- «${role}» ×${count}`),
  ].join("\n") + "\n");
  console.log(`${planned.length} membresías; ${planned.length - without.length} con instrumento`);
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:instrumentos", operator: "claude-code", note: `${NOTE}: instrumentos normalizados (punto 11)` }, async (context) => {
    let written = 0;
    for (const row of planned.filter((item) => item.instruments.length)) {
      const done = await context.client.query(`
        INSERT INTO ingest.membership_details(artist_member_id, instruments, run_id) VALUES ($1, $2, $3)
        ON CONFLICT (artist_member_id) DO UPDATE SET instruments = EXCLUDED.instruments, updated_at = now()
         WHERE ingest.membership_details.instruments IS DISTINCT FROM EXCLUDED.instruments`, [row.id, row.instruments, context.runId]);
      written += done.rowCount ?? 0;
    }
    return { written };
  });
  console.log(`run ${runId}:`, result);
}

// ── Expedientes ────────────────────────────────────────────────────────────
interface Dossier {
  caseId: string;
  artistId: number;
  name: string;
  formedYear: number | null;
  disbandedYear: number | null;
  bio: string | null;
  members: Array<{ memberId: number; name: string; role: string; fromYear: number | null; toYear: number | null; current: boolean }>;
  sources: Array<{ ref: string; source: string; url: string | null; text: string }>;
}

async function expedientes(): Promise<void> {
  const bios = new Map<number, Array<{ ref: string; source: string; url: string | null; text: string }>>();
  for (const file of readdirSync(BIO_DIR).filter((name) => /^artist-\d+\.jsonl$/u.test(name))) {
    for (const dossier of readJsonl<{ entityId: number; sources: Array<{ ref: string; source: string; url: string | null; text: string }> }>(path.join(BIO_DIR, file))) {
      let budget = 14000;
      bios.set(dossier.entityId, dossier.sources.flatMap((source) => {
        const text = (source.text ?? "").slice(0, Math.min(4000, Math.max(0, budget)));
        budget -= text.length;
        return text ? [{ ref: source.ref, source: source.source, url: source.url, text }] : [];
      }));
    }
  }
  const { rows } = await pool.query<{ artist_id: string; name: string; biography: string | null; formed_year: number | null; disbanded_year: number | null;
    members: Dossier["members"] }>(`
    SELECT a.id::text AS artist_id, a.name, a.biography, a.formed_year, a.disbanded_year,
           jsonb_agg(jsonb_build_object('memberId', m.id, 'name', p.name, 'role', m.role, 'fromYear', m.from_year, 'toYear', m.to_year, 'current', m.is_current) ORDER BY m.id) AS members
      FROM public.artists a JOIN public.artist_members m ON m.artist_id = a.id JOIN public.persons p ON p.id = m.person_id
     GROUP BY a.id HAVING count(*) >= 2 ORDER BY a.id`);
  const out = rows.map((row): Dossier => ({
    caseId: `artist:${row.artist_id}`, artistId: Number(row.artist_id), name: row.name, formedYear: row.formed_year, disbandedYear: row.disbanded_year,
    bio: row.biography, members: row.members, sources: bios.get(Number(row.artist_id)) ?? [],
  })).filter((dossier) => dossier.bio || dossier.sources.length);
  writeFileSync(DOSSIERS, out.map((dossier) => JSON.stringify(dossier)).join("\n") + "\n");
  console.log(JSON.stringify({ bands: rows.length, withTexts: out.length, withSources: out.filter((d) => d.sources.length).length, out: DOSSIERS }));
}

// ── Extracción ─────────────────────────────────────────────────────────────
const SCHEMA_VERSION = "crv-founders-periods.v1";
const evidenceSchema = z.object({ quote: z.string(), sourceRef: z.string() });
const evidenceOrNull = z.preprocess((value) => (value && typeof value === "object" && "quote" in value ? value : null), evidenceSchema.nullable());
const yearOrNull = z.preprocess((value) => (typeof value === "string" && /^\d{4}$/u.test(value) ? Number(value) : typeof value === "number" ? value : null), z.number().int().nullable());
const responseSchema = z.object({
  caseId: z.string(),
  members: z.array(z.object({
    memberId: z.preprocess((value) => (typeof value === "string" ? Number(value) : value), z.number().int()),
    founder: z.preprocess((value) => (typeof value === "boolean" ? value : null), z.boolean().nullable()),
    founderEvidence: evidenceOrNull,
    fromYear: yearOrNull,
    toYear: yearOrNull,
    periodEvidence: evidenceOrNull,
  })),
  note: z.preprocess((value) => (typeof value === "string" ? value : null), z.string().nullable()),
});
type Extraction = z.infer<typeof responseSchema>;

const INSTRUCTIONS = `Tarea: para cada integrante YA REGISTRADO de la banda, decir si fue fundador y en qué años estuvo, SOLO con los textos del expediente.
Entrada: {caseId, name, formedYear, disbandedYear, bio, members:[{memberId, name, role, fromYear, toYear, current}], sources:[{ref, source, url, text}]}.
La bio se cita con sourceRef "bio"; cada fuente, con su ref (s1, s2…).

Para cada integrante de members (usa su memberId; no agregues personas nuevas):
- founder: true solo si el texto lo presenta como fundador o parte de la formación original («fundada por», «formada por», «la formación original», «junto a … crearon la banda», «founded by», «original lineup»). false si el texto dice que llegó después («se unió en», «reemplazó a», «ingresó»). null si el texto no lo dice.
- founderEvidence: {quote, sourceRef} con un fragmento LITERAL (máximo 250 caracteres) que contenga el apellido o el nombre de la persona y la frase de fundación o de llegada. null si founder es null.
- fromYear / toYear: años de entrada y salida SOLO si el texto los da para esa persona (o si es fundador y el texto da el año de fundación). null si no.
- periodEvidence: {quote, sourceRef} LITERAL que contenga el nombre (o apellido) y el año. null si no hay años.
Una entrada por memberId que tenga algo (founder no nulo o algún año). Omite a los que no tienen nada.
Si los textos hablan de otra banda homónima, ignóralos y explícalo en note.
Devuelve {caseId, members, note}.`;

const normalize = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
  .replace(/[«»"“”'’`´]/gu, "").replace(/\s+/gu, " ").trim();
const tokens = (text: string) => normalize(text).replace(/[^a-z0-9 ]/gu, " ").split(" ").filter((token) => token.length > 2);
const FOUNDING = /fund|form[oóa]|formaci[oó]n original|original|cre[oóa]|crearon|nac[ei]|origen|inici|comienz|found|formed|start|bega|junto a/iu;

function sourceText(dossier: Dossier, ref: string): string | null {
  if (ref === "bio") return dossier.bio;
  return dossier.sources.find((item) => item.ref === ref)?.text ?? null;
}

/** «Gonzáles» ~ «González»: una letra de diferencia en nombres de 5+ letras. */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const names = (text: string, name: string) => { const found = tokens(text); return tokens(name).some((token) => found.some((other) => close(token, other))); };

/**
 * La cita tiene que estar literal en la fuente y nombrar a la persona. Si la
 * cita sola no la nombra pero la frase que la contiene sí («El grupo se inició
 * ese año cuando Pablo Dagnino (voz)…»), se guarda esa frase como cita.
 */
function checkQuote(dossier: Dossier, name: string, evidence: { quote: string; sourceRef: string } | null): { problem: string | null; quote: string } {
  if (!evidence) return { problem: "sin cita", quote: "" };
  const text = sourceText(dossier, evidence.sourceRef);
  if (text === null) return { problem: `sourceRef ${evidence.sourceRef} no existe`, quote: "" };
  const quote = normalize(evidence.quote);
  const flat = normalize(text);
  const at = quote ? flat.indexOf(quote) : -1;
  if (at < 0) return { problem: "la cita no está literal", quote: "" };
  if (names(evidence.quote, name)) return { problem: null, quote: evidence.quote };
  // La frase entera en el texto original (las posiciones de `flat` sirven de guía aproximada).
  const original = text.replace(/\s+/gu, " ");
  const sentences = original.split(/(?<=[.!?])\s+/u);
  const anchor = evidence.quote.trim().slice(0, 40);
  const sentence = sentences.find((item) => item.includes(anchor)) ?? null;
  if (sentence && sentence.length <= 400 && names(sentence, name)) return { problem: null, quote: sentence };
  return { problem: "la cita no nombra a la persona", quote: "" };
}

interface Checked { memberId: number; name: string; founder: boolean | null; founderEvidence: { quote: string; sourceRef: string } | null;
  fromYear: number | null; toYear: number | null; periodEvidence: { quote: string; sourceRef: string } | null }

function validate(dossier: Dossier, answer: Extraction): { clean: Checked[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(dossier.members.map((member) => [member.memberId, member]));
  const clean: Checked[] = [];
  for (const item of answer.members) {
    const member = byId.get(item.memberId);
    if (!member) { problems.push(`memberId ${item.memberId} no existe`); continue; }
    let founder = item.founder;
    let founderEvidence = item.founderEvidence;
    if (founder !== null) {
      const checked = checkQuote(dossier, member.name, founderEvidence);
      const problem = checked.problem ?? (founder && !FOUNDING.test(checked.quote) ? "la cita no habla de fundación" : null);
      if (problem) { problems.push(`«${member.name}» fundador: ${problem}`); founder = null; founderEvidence = null; }
      else founderEvidence = { quote: checked.quote, sourceRef: founderEvidence!.sourceRef };
    }
    let { fromYear, toYear } = item;
    let periodEvidence = item.periodEvidence ?? (founder ? founderEvidence : null);
    if (fromYear !== null || toYear !== null) {
      const checked = checkQuote(dossier, member.name, periodEvidence);
      const yearIn = (year: number | null) => year === null || checked.quote.includes(String(year))
        || (founder === true && year === dossier.formedYear);
      if (checked.problem || !yearIn(fromYear) || !yearIn(toYear) || (fromYear !== null && toYear !== null && toYear < fromYear)) {
        problems.push(`«${member.name}» años: ${checked.problem ?? "el año no está en la cita"}`);
        fromYear = null; toYear = null; periodEvidence = null;
      } else periodEvidence = { quote: checked.quote, sourceRef: periodEvidence!.sourceRef };
    } else periodEvidence = null;
    // Fundador sin año propio: el que da su cita («nació en Caracas durante
    // 2001»); si la cita no da ninguno, el año de formación de la ficha.
    if (founder === true && fromYear === null) {
      const quoted = founderEvidence!.quote.match(/(?<!\d)(19[4-9]\d|20[0-2]\d)(?!\d)/u);
      fromYear = quoted ? Number(quoted[1]) : dossier.formedYear;
      if (fromYear !== null) periodEvidence = founderEvidence;
    }
    if (founder !== null || fromYear !== null || toYear !== null) clean.push({ memberId: item.memberId, name: member.name, founder, founderEvidence, fromYear, toYear, periodEvidence });
  }
  return { clean, problems };
}

interface OutputRow { caseId: string; artistId: number; name: string; members: Checked[]; note: string | null; model: string; dropped: string[] }

async function extraer(): Promise<void> {
  const concurrency = Number(arg("concurrency") ?? 20);
  const limit = Number(arg("limit") ?? Infinity);
  const dossiers = readJsonl<Dossier>(DOSSIERS).filter((dossier) => !ONLY || ONLY.includes(dossier.artistId));
  const done = new Map(readJsonl<OutputRow>(EXTRACTION).map((row) => [row.caseId, row]));
  const pending = dossiers.filter((dossier) => !done.has(dossier.caseId)).slice(0, limit);
  const gateway = createDeepSeekGateway();
  const stats = { pending: pending.length, written: 0, retried: 0, failed: [] as Array<{ caseId: string; error: string }> };
  const flush = () => writeFileSync(EXTRACTION, [...done.values()].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const queue = [...pending];
  const worker = async () => {
    for (let dossier = queue.shift(); dossier; dossier = queue.shift()) {
      try {
        const ask = (fix?: string) => gateway.propose({
          taskKind: "narrative_extraction", modelClass: "fast", schemaVersion: SCHEMA_VERSION, instructions: INSTRUCTIONS, responseSchema,
          input: fix ? { ...dossier, correccion: fix } : dossier,
        });
        let result = await ask();
        let checked = validate(dossier, result.proposal);
        if (checked.problems.length) {
          stats.retried += 1;
          result = await ask(`Tu respuesta anterior tuvo estos errores: ${checked.problems.slice(0, 15).join("; ")}. Corrige: copia citas literales que nombren a la persona y contengan el año o la frase de fundación, o deja null.`);
          checked = validate(dossier, result.proposal);
        }
        done.set(dossier.caseId, { caseId: dossier.caseId, artistId: dossier.artistId, name: dossier.name, members: checked.clean, note: result.proposal.note, model: result.model, dropped: checked.problems });
        flush();
        stats.written += 1;
        if (stats.written % 100 === 0) console.error(`${stats.written}/${pending.length}`);
      } catch (error) {
        stats.failed.push({ caseId: dossier.caseId, error: (error as Error).message.slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  console.log(JSON.stringify(stats, null, 2));
}

// ── Aplicar ────────────────────────────────────────────────────────────────
async function aplicar(): Promise<void> {
  const rows = readJsonl<OutputRow>(EXTRACTION).filter((row) => !ONLY || ONLY.includes(row.artistId));
  const items = rows.flatMap((row) => row.members.map((member) => ({ ...member, artistId: row.artistId, artist: row.name })));
  const sourceName = (dossier: Dossier | undefined, ref: string | undefined) =>
    ref === "bio" ? "biografía CRV" : dossier?.sources.find((source) => source.ref === ref)?.source ?? ref ?? null;
  const dossiers = new Map(readJsonl<Dossier>(DOSSIERS).map((dossier) => [dossier.artistId, dossier]));
  const current = new Map((await pool.query<{ id: string; from_year: number | null; to_year: number | null }>(
    "SELECT id::text, from_year, to_year FROM public.artist_members WHERE id = ANY($1::bigint[])", [items.map((item) => item.memberId)])).rows
    .map((row) => [Number(row.id), row]));
  // «década de 1980», «los 1980s», «años 80»: una década no es un año de entrada ni de salida.
  const vague = (year: number | null, quote: string | undefined) => year !== null && !!quote
    && new RegExp(`(?:d[eé]cada\\s+de(?:\\s+los)?|a[nñ]os)\\s+${year}|${year}\\s*'?s\\b`, "iu").test(quote);
  const plan = items.flatMap((item) => {
    const row = current.get(item.memberId);
    if (!row) return [];
    const quote = (item.periodEvidence ?? item.founderEvidence)?.quote;
    if (vague(item.fromYear, quote)) item.fromYear = null;
    if (vague(item.toYear, quote)) item.toYear = null;
    const fromYear = row.from_year === null ? item.fromYear : null;
    let toYear = row.to_year === null ? item.toYear : null;
    const from = fromYear ?? row.from_year;
    if (toYear !== null && from !== null && toYear < from) toYear = null;
    return [{ ...item, setFrom: fromYear, setTo: toYear }];
  });
  const founders = plan.filter((item) => item.founder === true).length;
  const years = plan.filter((item) => item.setFrom !== null || item.setTo !== null).length;
  writeFileSync(`${DIR}/integrantes-${confirm ? "aplicado" : "ensayo"}.md`, [
    `# Fundadores y periodos — ${confirm ? "aplicado" : "ensayo"}`, "",
    `${rows.length} bandas leídas; ${founders} fundadores; ${plan.filter((item) => item.founder === false).length} marcados como no fundadores; ${years} membresías con años nuevos.`, "",
    ...plan.slice(0, 400).map((item) => `- **${item.artist}** · ${item.name}: ${item.founder === true ? "fundador" : item.founder === false ? "no fundador" : ""}${item.setFrom !== null || item.setTo !== null ? ` ${item.setFrom ?? "…"}–${item.setTo ?? "…"}` : ""} — «${(item.founderEvidence ?? item.periodEvidence)?.quote ?? ""}»`),
  ].join("\n") + "\n");
  console.log(`${rows.length} bandas; ${founders} fundadores; ${years} membresías con años nuevos`);
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:fundadores-periodos", operator: "claude-code",
    note: `${NOTE}: fundadores y periodos desde biografías con cita (DeepSeek flash propone, el código valida) (punto 11)` }, async (context) => {
    let details = 0; let periods = 0;
    for (const item of plan) {
      if (item.founder !== null) {
        const evidence = item.founderEvidence!;
        await context.client.query(`
          INSERT INTO ingest.membership_details(artist_member_id, is_founder, founder_evidence, founder_source, run_id) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (artist_member_id) DO UPDATE SET is_founder = EXCLUDED.is_founder, founder_evidence = EXCLUDED.founder_evidence,
                 founder_source = EXCLUDED.founder_source, updated_at = now()`,
        [item.memberId, item.founder, evidence.quote, String(sourceName(dossiers.get(item.artistId), evidence.sourceRef)).slice(0, 60), context.runId]);
        details++;
      }
      if (item.setFrom !== null || item.setTo !== null) {
        await context.client.query(`
          UPDATE public.artist_members SET from_year = COALESCE(from_year, $2), to_year = COALESCE(to_year, $3) WHERE id = $1`,
        [item.memberId, item.setFrom, item.setTo]);
        periods++;
      }
    }
    return { details, periods };
  });
  console.log(`run ${runId}:`, result);
}

if (stage === "instrumentos") await instrumentos();
else if (stage === "expedientes") await expedientes();
else if (stage === "extraer") await extraer();
else if (stage === "aplicar") await aplicar();
else throw new Error("uso: --stage=instrumentos|expedientes|extraer|aplicar [--confirm]");
await closeDb();
