// CRV · Plan del primo, etapa 2 (2026-10-12): periodos de integrantes de
// Sincopa (punto 12). Se corrige contra las páginas ya guardadas, sin
// reingerir.
//
// La ficha de Sincopa separa «Group Members» de «Ex-Members» y escribe el
// periodo entre paréntesis. El adaptador guardó solo los años: «(1985-)» bajo
// «Group Members» (sigue en la banda) quedó como un año suelto de entrada, y
// «(2011)» bajo «Ex-Members» (estuvo solo ese año) quedó sin año de salida.
// Aquí:
//   · actual con «(AAAA-)»   → is_current = true (si no tiene año de salida);
//   · ex con «(AAAA)»        → to_year = AAAA (si entró ese año y no tenía salida).
//   · ex con «(AAAA/BBBB)»   → to_year = BBBB, el último año citado.
// Lo demás («(1985-2004/2013)», dos etapas) no se toca.
//
//   npx tsx scripts/primo-etapa2-sincopa-periodos.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const confirm = process.argv.includes("--confirm");
const pool = getPool();
const key = (name: string) => normalizeEntityName(name.replace(/["“”«»]/gu, " ")).compactSecondaryKey;

interface Listed { section: "current" | "ex"; period: string }

function listedMembers(file: string): Map<string, Listed[]> {
  const raw = readFileSync(file, "latin1")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/giu, "");
  const flat = raw.replace(/<[^>]+>/gu, "|").replace(/&quot;/gu, "\"").replace(/&amp;/gu, "&").replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ").replace(/(\|\s*)+/gu, "|");
  const start = flat.search(/\|(?:Group )?Members\|/iu);
  if (start < 0) return new Map();
  const end = flat.indexOf("|Discography|", start);
  const block = flat.slice(start, end < 0 ? undefined : end);
  const exAt = block.search(/\|(?:Ex-?|Former |Past )Members:?\|/iu);
  const out = new Map<string, Listed[]>();
  for (const match of block.matchAll(/\|([^|():]{2,80}?)\s*\|\s*\((\d{4}[^)]{0,20})\)/gu)) {
    const section = exAt >= 0 && match.index! > exAt ? "ex" : "current";
    const name = key(match[1]!);
    out.set(name, [...(out.get(name) ?? []), { section, period: match[2]!.replace(/\s+/gu, "") }]);
  }
  return out;
}

const { rows } = await pool.query<{ membership_id: string; person_name: string; stored_path: string; from_year: number | null; to_year: number | null;
  is_current: boolean; artist: string }>(`
  SELECT DISTINCT m.id::text AS membership_id, c.raw_value #>> '{}' AS person_name, r.stored_path, m.from_year, m.to_year, m.is_current, a.name AS artist
    FROM ingest.claims c
    JOIN ingest.sources s ON s.id = c.source_id AND s.name = 'Sincopa'
    JOIN ingest.raw_pages r ON r.id = c.raw_page_id
    JOIN public.artist_members m ON m.id = c.artist_membership_id
    JOIN public.artists a ON a.id = m.artist_id
   WHERE c.field = 'person_name'`);
const pages = new Map<string, Map<string, Listed[]>>();
const plan: Array<{ id: number; artist: string; name: string; set: "current" | "to"; value: number | null; period: string }> = [];
for (const row of rows) {
  if (!pages.has(row.stored_path)) {
    try { pages.set(row.stored_path, listedMembers(`data/${row.stored_path}`)); } catch { pages.set(row.stored_path, new Map()); }
  }
  const listed = pages.get(row.stored_path)!.get(key(row.person_name));
  if (!listed || listed.length !== 1) continue;
  const [{ section, period }] = listed as [Listed];
  if (section === "current" && /^\d{4}-$/u.test(period) && row.to_year === null && !row.is_current && row.from_year === Number(period.slice(0, 4))) {
    plan.push({ id: Number(row.membership_id), artist: row.artist, name: row.person_name, set: "current", value: null, period });
  } else if (section === "ex" && /^\d{4}$/u.test(period) && row.to_year === null && row.from_year === Number(period)) {
    plan.push({ id: Number(row.membership_id), artist: row.artist, name: row.person_name, set: "to", value: Number(period), period });
  } else if (section === "ex" && /^\d{4}\/\d{4}$/u.test(period) && row.to_year === null && row.from_year === Number(period.slice(0, 4))) {
    // «(2004/2013)» de un exintegrante: el último año citado es el de salida.
    plan.push({ id: Number(row.membership_id), artist: row.artist, name: row.person_name, set: "to", value: Number(period.slice(5)), period });
  }
}
writeFileSync(`reports/primo-etapa2/sincopa-periodos-${confirm ? "aplicado" : "ensayo"}.md`, [
  `# Periodos de integrantes de Sincopa — ${confirm ? "aplicado" : "ensayo"}`, "",
  `${rows.length} membresías con página de Sincopa; ${plan.filter((item) => item.set === "current").length} pasan a actuales; ${plan.filter((item) => item.set === "to").length} reciben año de salida.`, "",
  ...plan.map((item) => `- **${item.artist}** · ${item.name} «(${item.period})» → ${item.set === "current" ? "actual" : `salida ${item.value}`}`),
].join("\n") + "\n");
console.log(`${rows.length} membresías; actuales ${plan.filter((item) => item.set === "current").length}; salidas ${plan.filter((item) => item.set === "to").length}`);
if (confirm) {
  const { runId } = await withOperatorRun({ name: "primo-etapa2:sincopa-periodos", operator: "claude-code",
    note: "Plan del primo, etapa 2 (2026-10-12): periodos de integrantes según la ficha guardada de Sincopa («(1985-)» = actual, «(2011)» = un año)" }, async (context) => {
    for (const item of plan) {
      if (item.set === "current") await context.client.query("UPDATE public.artist_members SET is_current = true WHERE id = $1 AND to_year IS NULL", [item.id]);
      else await context.client.query("UPDATE public.artist_members SET to_year = $2 WHERE id = $1 AND to_year IS NULL", [item.id, item.value]);
    }
  });
  console.log(`run ${runId}`);
}
await closeDb();
