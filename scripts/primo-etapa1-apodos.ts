// CRV · Plan del primo, etapa 1 (2026-10-12), puntos 2 y 1B.3: apodos de persona.
//
// Las fuentes escriben a la persona con el apodo entre comillas («José Luis
// "Cheo" Pardo», «Carlos Eduardo "Cayayo" Troconis»). Ese alias ya está
// guardado; aquí se extrae el apodo y se guarda como alias `nickname` (0067),
// del que la pantalla compone «Nombre "Apodo" Apellido». La base no cambia de
// nombre salvo en un caso: si la ficha se llama por el apodo («Cayayo
// Troconis») y una fuente da el nombre de pila con el mismo apellido, pasa a
// llamarse por el nombre real («Carlos Eduardo Troconis»; regla del caso
// Canserbero: manda el nombre real, el anterior queda como alias). Esos
// renombres NO se aplican aquí: salen como plan de `crv review persons`
// (op `rename`) en reports/primo-etapa1/apodos-renombres.json.
//
//   uso: tsx scripts/primo-etapa1-apodos.ts            (plan, no escribe)
//        tsx scripts/primo-etapa1-apodos.ts --confirm  (aplica dentro de un run)
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";
import { displayKey } from "../src/normalization/public-names.js";

const QUOTED = /^(.*?)\s*["“«]([^"”»]+)["”»]\s*(.*)$/u;
const NOTE = "Plan del primo, etapa 1 (2026-10-12): apodo tomado del alias de fuente con el apodo entre comillas";
const confirm = process.argv.includes("--confirm");

interface Row { person_id: string; name: string; alias: string; alias_type: string; alias_id: string }
interface Plan { personId: number; name: string; nickname: string; from: string; existingAliasId: number | null; existingType: string | null; rename: string | null }

function plausibleNickname(nick: string, name: string): boolean {
  const words = nick.trim().split(/\s+/u);
  if (!nick.trim() || nick.length > 30 || words.length > 3) return false;
  if (/[†(),;:/\\@0-9]/u.test(nick) && !/^[\p{L} .'-]*\d+[\p{L} .'-]*$/u.test(nick)) return false;
  const key = displayKey(nick);
  return key.length >= 2 && !displayKey(name).split(" ").includes(key);
}

const pool = getPool();
const { rows } = await pool.query<Row>(
  `SELECT a.person_id::text, p.name, a.alias, a.alias_type::text, a.id::text AS alias_id
     FROM ingest.person_aliases a JOIN public.persons p ON p.id = a.person_id
    WHERE a.person_id IN (SELECT person_id FROM ingest.person_aliases WHERE alias ~ '["“«][^"”»]+["”»]')
    ORDER BY a.person_id, a.id`);
const byPerson = new Map<number, { name: string; aliases: Row[] }>();
for (const row of rows) {
  const id = Number(row.person_id);
  const entry = byPerson.get(id) ?? { name: row.name, aliases: [] };
  entry.aliases.push(row);
  byPerson.set(id, entry);
}

const plans: Plan[] = [];
const skipped: Array<{ personId: number; name: string; alias: string; why: string }> = [];
for (const [personId, { name, aliases }] of byPerson) {
  const nameKey = displayKey(name);
  const nameWords = nameKey.split(" ");
  const found = new Map<string, Plan>();
  for (const row of aliases) {
    const match = QUOTED.exec(row.alias.trim());
    if (!match) continue;
    const nick = match[2]!.trim();
    const before = (match[1] ?? "").trim();
    const after = (match[3] ?? "").trim();
    // Comillas al principio («"Melodías de América" Rodolfo …») son un título, no un apodo.
    if (!before) continue;
    const rest = displayKey(`${before} ${after}`);
    let rename: string | null = null;
    if (rest !== nameKey) {
      // «Cayayo Troconis» con alias «Carlos Eduardo "Cayayo" Troconis»: la ficha
      // lleva el apodo + apellido; el nombre real es el de la fuente.
      const nickKey = displayKey(nick);
      const surname = nameWords.slice(1).join(" ");
      if (nameWords[0] === nickKey && nameWords.length >= 2 && before && after && displayKey(after) === surname
        && !/[†(]/u.test(before)) {
        // El apellido se escribe como en la ficha (conserva sus tildes).
        rename = [before, ...name.trim().split(/\s+/u).slice(1)].join(" ").replace(/\s+/gu, " ").trim();
      } else {
        continue;
      }
    }
    if (!plausibleNickname(nick, rename ?? name)) { skipped.push({ personId, name, alias: row.alias, why: "apodo no plausible" }); continue; }
    const key = displayKey(nick);
    const prior = found.get(key);
    if (prior && (prior.rename === null || rename !== null)) continue;
    const existing = aliases.find((item) => displayKey(item.alias) === key) ?? null;
    found.set(key, { personId, name, nickname: nick, from: row.alias, existingAliasId: existing ? Number(existing.alias_id) : null, existingType: existing?.alias_type ?? null, rename });
  }
  const renames = new Set([...found.values()].map((plan) => plan.rename).filter(Boolean));
  if (renames.size > 1) { skipped.push({ personId, name, alias: [...renames].join(" | "), why: "varios nombres reales posibles" }); for (const plan of found.values()) plan.rename = null; }
  plans.push(...found.values());
}

const toMark = plans.filter((plan) => plan.existingType !== "nickname");
const renames = plans.filter((plan) => plan.rename);
console.log(`personas con apodo: ${new Set(plans.map((plan) => plan.personId)).size}; alias a marcar/crear: ${toMark.length} (${toMark.filter((p) => p.existingAliasId).length} existentes, ${toMark.filter((p) => !p.existingAliasId).length} nuevos); renombres: ${renames.length}; descartados: ${skipped.length}`);
const outPath = process.env["PRIMO_OUT"] ?? "reports/primo-etapa1/apodos-plan.json";
writeFileSync(outPath, JSON.stringify({ plans, skipped }, null, 2));
console.log(`plan en ${outPath}`);
for (const plan of renames) console.log(`  renombre ${plan.personId}: «${plan.name}» → «${plan.rename}» (apodo ${plan.nickname})`);
if (renames.length) writeFileSync("reports/primo-etapa1/apodos-renombres.json", JSON.stringify({
  decidedAt: "2026-10-12",
  evidence: "Plan del primo, etapa 1 (1B.3): la ficha se llamaba por el apodo; una fuente da el nombre de pila con el mismo apellido. Manda el nombre real (caso Canserbero); el anterior queda como alias.",
  corrections: renames.map((plan) => ({ op: "rename", person: { id: plan.personId, name: plan.name }, to: plan.rename, keepOldNameAsAlias: true, why: `alias de fuente «${plan.from}»` })),
}, null, 2));

if (confirm) {
  const { runId } = await withOperatorRun({ name: "primo-etapa1:apodos", operator: "claude-code", note: NOTE }, async (context) => {
    const client = context.client;
    for (const plan of toMark) {
      if (plan.existingAliasId) {
        await client.query(`UPDATE ingest.person_aliases SET alias_type = 'nickname', notes = concat_ws(' · ', notes, $2::text) WHERE id = $1`, [plan.existingAliasId, `${NOTE} («${plan.from}»)`]);
      } else {
        await client.query(
          `INSERT INTO ingest.person_aliases (person_id, alias, alias_type, normalized_alias, confidence, notes)
           VALUES ($1, $2, 'nickname', $3, 'medium', $4) ON CONFLICT (person_id, alias) DO UPDATE SET alias_type = 'nickname'`,
          [plan.personId, plan.nickname, normalizeEntityName(plan.nickname).primaryKey, `${NOTE} («${plan.from}»)`]);
      }
    }
  });
  console.log(`run ${runId}`);
}
await closeDb();
