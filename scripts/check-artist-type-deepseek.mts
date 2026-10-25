// CRV · Tipo de artista desde la biografía (Brian, 2026-10-15: «chequeen las
// biografías, lo relacionen con el número de miembros y definan si es banda,
// dúo o solista; lo que no tenga información suficiente se deja registrado»).
//
// Una llamada a DeepSeek flash por artista con biografía. El modelo lee SOLO la
// biografía y la lista de integrantes del core y devuelve el tipo con una cita
// literal; el código valida que la cita esté en la biografía (un reintento) y
// compara con el tipo actual:
//   coincide     el tipo de la bio es el del core (grupo público: band/group = banda,
//                project según sus integrantes, como artist-groups.ts)
//   cambiar      difiere y el tipo actual nunca lo afirmó nadie (el DEFAULT 'band'
//                del DDL: sin rastro en merge_audit ni en el diario)
//   conflicto    difiere de un tipo que alguien afirmó → revisión humana
//   insuficiente la bio no lo dice, o la cita no se pudo verificar
// Aparte marca `lista_no_cuadra` cuando la bio cuenta integrantes y la lista
// del core tiene otro número (para revisar Miembros, no el tipo).
//
// Solo lectura del core: no escribe nada; aplicar es trabajo de otro script.
// Reanudable: lo ya escrito en la salida no se vuelve a pedir; cada llamada
// queda en `ingest.ai_runs` (caché por hash de prompt).
// Uso: tsx scripts/check-artist-type-deepseek.mts [--out=<dir>] [--concurrency=20] [--limit=N] [--ids=1,2] [--sample=40]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createDeepSeekGateway } from "../src/ai/gateway.js";
import { closeDb, getPool } from "../src/db/client.js";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT_DIR = arg("out") ?? "reports/tipo-artista-2026-10-15";
const CONCURRENCY = Number(arg("concurrency") ?? 20);
const LIMIT = Number(arg("limit") ?? Infinity);
const SAMPLE = arg("sample") ? Number(arg("sample")) : null;
const ONLY = arg("ids")?.split(",").map(Number);
const MAX_BIO = 8000;
export const SCHEMA_VERSION = "crv-artist-type-check.v1";


const responseSchema = z.object({
  artistId: z.coerce.number().int(),
  tipo: z.enum(["band", "duo", "solo_artist", "project", "insuficiente"]),
  integrantes_segun_bio: z.coerce.number().int().nullable(),
  cita: z.string().nullable(),
  coincide_con_lista: z.boolean().nullable(),
  nota: z.string().nullable(),
});
type Answer = z.infer<typeof responseSchema>;

interface Case {
  artistId: number;
  name: string;
  tipo_actual: string;
  bio: string;
  integrantes: Array<{ personId: number; name: string; roles: string[]; desde: number | null; hasta: number | null; actual: boolean }>;
}

const INSTRUCTIONS = `Tarea: decidir qué tipo de artista es la ficha, usando SOLO su biografía y la lista de integrantes registrados.
Entrada: {artistId, name, tipo_actual, bio, integrantes:[{personId,name,roles,desde,hasta,actual}]}.
La lista puede estar incompleta o vacía: no es prueba de nada por sí sola; manda la biografía.

tipo:
- "band": grupo de 3 o más integrantes (banda, trío, cuarteto, orquesta, agrupación, colectivo).
- "duo": exactamente dos integrantes fijos.
- "solo_artist": UNA persona que firma con su nombre, real o artístico (Ilan Chester, Cecilia Todd, Canserbero).
- "project": UNA persona que firma con un nombre que no es de persona (Zardonic, Ashwave).
  Si la ficha lleva nombre de persona (nombre y apellido), es "solo_artist" aunque la bio diga «proyecto» o «alias».
- "insuficiente": la biografía no dice cuántos son ni nombra la alineación, ni deja claro que es una sola persona.
No deduzcas por el nombre de la ficha, el género ni el plural de los verbos sueltos; hace falta que la biografía lo diga
(«banda», «trío», «dúo», «integrada por X, Y y Z», «el cantautor», «su primer disco como solista», «proyecto de X»…).
Los músicos acompañantes, invitados o de sesión de un solista NO lo convierten en banda.
Si la formación cambió con los años, usa la formación principal y dilo en nota.

integrantes_segun_bio: cuántos integrantes cuenta o nombra la biografía para la formación principal; null si no se sabe.
cita: fragmento LITERAL copiado de la bio (máximo 300 caracteres) que DICE el tipo o la alineación; null solo si tipo="insuficiente".
Una cita de contacto, discografía o fechas que no dice qué es la ficha no sirve: en ese caso tipo="insuficiente".
coincide_con_lista: true si la lista de integrantes cuadra con lo que dice la bio, false si no cuadra
(p. ej. la bio habla de un trío y la lista tiene 1 o 6), null si la bio no permite compararla.
nota: breve, en español; explica la discrepancia o por qué no alcanza la información; null si no hay nada que decir.
Devuelve {artistId, tipo, integrantes_segun_bio, cita, coincide_con_lista, nota}.`;

const normalize = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
  .replace(/[«»"“”'’`´]/gu, "").replace(/\s+/gu, " ").trim();

/** Grupo público del tipo (artist-groups.ts): band/group → banda; project según sus integrantes. */
function publicGroup(tipo: string, memberCount: number): string {
  if (tipo === "group") return "band";
  if (tipo === "project") return memberCount === 1 ? "solo_artist" : memberCount === 2 ? "duo" : "band";
  return tipo;
}

// Palabras con las que una cita dice el tipo o la alineación (Profanvm, muestra 2026-10-15: una cita de contacto pasó como «project»).
const TYPE_MARKER = /\b(band|grup|agrupaci|conjunt|orquest|colectiv|du[oe]|tri[oa]\b|cuartet|quintet|sextet|integra|miembr|formad|fundad|formaci|alineaci|proyecto|unipersonal|solista|cantante|cantautor|compositor|music|interprete|rapero|mc\b|dj\b|productor|guitarrist|baterist|bajist|pianist|tecladist|vocalist|nombre artistico|seudonimo|alias|nacid|members?|formed|founded|one-man|solo|project|singer|songwriter|artist)/u;

function validate(item: Case, answer: Answer): string[] {
  const problems: string[] = [];
  if (answer.artistId !== item.artistId) problems.push(`artistId devuelto ${answer.artistId}`);
  if (answer.tipo !== "insuficiente") {
    const quote = normalize(answer.cita ?? "");
    if (!quote) problems.push("falta la cita");
    else if (!normalize(item.bio).includes(quote)) problems.push("la cita no está literal en la bio");
    else if (!TYPE_MARKER.test(quote)) problems.push("la cita no dice qué es la ficha (banda, dúo, solista, proyecto, integrantes…)");
  }
  return problems;
}

type Veredicto = "coincide" | "cambiar" | "conflicto" | "insuficiente";
interface OutputRow extends Answer {
  name: string;
  tipo_actual: string;
  afirmado: boolean;
  integrantes_registrados: number;
  veredicto: Veredicto;
  lista_no_cuadra: boolean;
  model: string;
  descartado: string[];
}

function verdict(item: Case, asserted: boolean, answer: Answer): Veredicto {
  if (answer.tipo === "insuficiente") return "insuficiente";
  if (answer.tipo === item.tipo_actual) return "coincide";
  // 'group' y 'band' son el mismo grupo público; un 'project' solo coincide consigo mismo.
  const bothPlain = answer.tipo !== "project" && item.tipo_actual !== "project";
  if (bothPlain && publicGroup(answer.tipo, 0) === publicGroup(item.tipo_actual, 0)) return "coincide";
  return asserted ? "conflicto" : "cambiar";
}

const readJsonl = <T,>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T) : []);

async function loadCases(): Promise<Array<{ item: Case; asserted: boolean }>> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string; artist_type: string; biography: string; asserted: boolean; members: Case["integrantes"] | null }>(`
    WITH afirmados AS (
      SELECT artist_id AS id FROM ingest.merge_audit WHERE entity_kind = 'artist' AND field = 'artist_type'
      UNION
      SELECT (new_data->>'id')::bigint FROM ingest.change_journal
       WHERE table_name = 'artists' AND op = 'UPDATE' AND old_data->>'artist_type' IS DISTINCT FROM new_data->>'artist_type')
    SELECT a.id::text, a.name, a.artist_type::text, a.biography,
           (a.artist_type::text <> 'band'
             OR a.id IN (SELECT id FROM afirmados)) AS asserted,
           (SELECT json_agg(m ORDER BY m.desde NULLS LAST, m.name) FROM (
              SELECT p.id AS "personId", p.name, array_agg(DISTINCT am.role) AS roles,
                     min(am.from_year) AS desde, max(am.to_year) AS hasta, bool_or(am.is_current) AS actual
                FROM public.artist_members am JOIN public.persons p ON p.id = am.person_id
               WHERE am.artist_id = a.id GROUP BY p.id, p.name) m) AS members
      FROM public.artists a
     WHERE coalesce(btrim(a.biography), '') <> ''
       ${ONLY ? "AND a.id = ANY($1::bigint[])" : ""}
     ORDER BY a.id`, ONLY ? [ONLY] : []);
  return rows.map((row) => ({
    asserted: row.asserted,
    item: { artistId: Number(row.id), name: row.name, tipo_actual: row.artist_type, bio: row.biography.slice(0, MAX_BIO), integrantes: row.members ?? [] },
  }));
}

/** Muestra reproducible repartida entre veredictos (para la revisión de 40). */
function pickSample<T extends { artistId: number }>(items: T[], size: number): T[] {
  const hash = (id: number) => (Math.imul(id, 2654435761) >>> 0);
  return [...items].sort((left, right) => hash(left.artistId) - hash(right.artistId)).slice(0, size);
}

function writeReports(rows: OutputRow[]): void {
  const by = (veredicto: Veredicto) => rows.filter((row) => row.veredicto === veredicto);
  const dump = (file: string, list: OutputRow[]) => writeFileSync(path.join(OUT_DIR, file), list.map((row) => JSON.stringify(row)).join("\n") + (list.length ? "\n" : ""));
  dump("insuficientes.jsonl", by("insuficiente"));
  dump("cambiar.jsonl", by("cambiar"));
  dump("conflictos.jsonl", by("conflicto"));
  dump("lista-no-cuadra.jsonl", rows.filter((row) => row.lista_no_cuadra));
  const count = (list: OutputRow[], key: (row: OutputRow) => string) => {
    const map = new Map<string, number>();
    for (const row of list) map.set(key(row), (map.get(key(row)) ?? 0) + 1);
    return [...map].sort((left, right) => right[1] - left[1]).map(([name, n]) => `| ${name} | ${n} |`).join("\n");
  };
  const lines = [
    `# Tipo de artista desde la biografía`,
    ``,
    `Generado ${new Date().toISOString()} · ${rows.length} artistas con biografía · DeepSeek flash (${SCHEMA_VERSION}). Solo propuesta: nada escrito en el core.`,
    ``,
    `| veredicto | n |`, `|---|---|`, count(rows, (row) => row.veredicto),
    ``,
    `Lista de integrantes que no cuadra con la bio: ${rows.filter((row) => row.lista_no_cuadra).length}.`,
    ``,
    `## Cambios propuestos (tipo actual sin afirmar → tipo de la bio)`,
    ``,
    `| de → a | n |`, `|---|---|`, count(by("cambiar"), (row) => `${row.tipo_actual} → ${row.tipo}`),
    ``,
    `## Conflictos con un tipo afirmado`,
    ``,
    `| de → a | n |`, `|---|---|`, count(by("conflicto"), (row) => `${row.tipo_actual} → ${row.tipo}`),
    ``,
    `Archivos: insuficientes.jsonl, cambiar.jsonl, conflictos.jsonl, lista-no-cuadra.jsonl; todo en resultados.jsonl.`,
  ];
  writeFileSync(path.join(OUT_DIR, "resumen.md"), lines.join("\n") + "\n");
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const OUT = path.join(OUT_DIR, "resultados.jsonl");
  let cases = await loadCases();
  if (SAMPLE) cases = pickSample(cases.map((entry) => ({ ...entry, artistId: entry.item.artistId })), SAMPLE);
  const done = new Map(readJsonl<OutputRow>(OUT).map((row) => [row.artistId, row]));
  const pending = cases.filter((entry) => !done.has(entry.item.artistId)).slice(0, LIMIT);
  const gateway = createDeepSeekGateway();
  const stats = { pending: pending.length, written: 0, retried: 0, cached: 0, failed: [] as Array<{ artistId: number; error: string }>, hashes: [] as string[] };
  const flush = () => writeFileSync(OUT, [...done.values()].sort((left, right) => left.artistId - right.artistId).map((row) => JSON.stringify(row)).join("\n") + "\n");

  const queue = [...pending];
  const worker = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const { item, asserted } = entry;
      try {
        const ask = (fix?: string) => gateway.propose({
          taskKind: "narrative_extraction", modelClass: "fast", schemaVersion: SCHEMA_VERSION, instructions: INSTRUCTIONS, responseSchema,
          input: fix ? { ...item, correccion: fix } : item,
        });
        let result = await ask();
        let problems = validate(item, result.proposal);
        if (problems.length) {
          stats.retried += 1;
          result = await ask(`Tu respuesta anterior tuvo estos errores: ${problems.join("; ")}. Copia la cita palabra por palabra de la bio, o responde tipo="insuficiente".`);
          problems = validate(item, result.proposal);
        }
        // Sin cita verificable no hay tipo: queda registrado como insuficiente.
        const answer: Answer = problems.length
          ? { ...result.proposal, artistId: item.artistId, tipo: "insuficiente", nota: [result.proposal.nota, `descartado: ${problems.join("; ")}`].filter(Boolean).join(" · ") }
          : result.proposal;
        const registered = item.integrantes.length;
        done.set(item.artistId, {
          ...answer,
          name: item.name,
          tipo_actual: item.tipo_actual,
          afirmado: asserted,
          integrantes_registrados: registered,
          veredicto: verdict(item, asserted, answer),
          // Más registrados que en la bio es normal (formaciones posteriores); menos, faltan integrantes.
          lista_no_cuadra: answer.coincide_con_lista === false
            || (answer.integrantes_segun_bio !== null && registered > 0 && answer.integrantes_segun_bio > registered),
          model: result.model,
          descartado: problems,
        });
        flush();
        stats.written += 1;
        if (result.cached) stats.cached += 1;
        stats.hashes.push(result.promptHash);
        if (stats.written % 100 === 0) console.error(`${stats.written}/${pending.length}`);
      } catch (error) {
        stats.failed.push({ artistId: item.artistId, error: (error as Error).message.slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  writeReports([...done.values()]);
  const usage = (await getPool().query<{ tin: string | null; tout: string | null }>(
    "SELECT sum(tokens_in)::text tin, sum(tokens_out)::text tout FROM ingest.ai_runs WHERE prompt_hash = ANY($1)", [stats.hashes])).rows[0];
  const { hashes: _hashes, ...summary } = stats;
  console.log(JSON.stringify({ ...summary, tokensIn: Number(usage?.tin ?? 0), tokensOut: Number(usage?.tout ?? 0) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
