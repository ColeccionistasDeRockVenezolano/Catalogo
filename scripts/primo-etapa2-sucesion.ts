// CRV · Plan del primo, etapa 2 (2026-10-12): sucesión de sellos (punto 7).
// Solo con fuente (decisión de Brian): cada relación lleva la cita literal y su
// URL. Nada se deduce de que un disco lleve dos sellos.
//
//   npx tsx scripts/primo-etapa2-sucesion.ts [--confirm]
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const confirm = process.argv.includes("--confirm");
const WIKI = "https://en.wikipedia.org/wiki/Rodven_Records";
const DISCOGS_POLYGRAM_VE = "https://hypermuse.net/label/93850";
const TRADEMARK = "https://trademarks.justia.com/owners/inversiones-rodven-c-a-956211";

const RELATIONS: Array<{ from: number; to: number; type: string; start?: number; note: string; urls: string[] }> = [
  { from: 2277, to: 4, type: "renamed_from",
    note: "«In its beginnings, SonoRodven (As it was originally named) emerged as a local source for international compilation albums»",
    urls: [WIKI] },
  { from: 2277, to: 3905, type: "absorbed_by", start: 1995,
    note: "«It was ultimately acquired by PolyGram in 1995.» · «In 1994-1995 PolyGram N.V. agreed to acquire Rodven Records of Venezuela for $57 million […] renamed as PolyGram Records S.A. (Venezuela)»",
    urls: [WIKI, DISCOGS_POLYGRAM_VE] },
  { from: 3905, to: 3393, type: "absorbed_by", start: 1999,
    note: "«Today is part of Universal Music Venezuela S.A. and under the umbrella of Universal Music Group» (Universal Music Group figura como matriz de Rodven desde 1999)",
    urls: [DISCOGS_POLYGRAM_VE, WIKI] },
  { from: 2047, to: 2277, type: "division_of",
    note: "«VelvetRodven and later TH-Rodven, an outlet for all Latin dance music oriented artists»",
    urls: [WIKI] },
  { from: 1563, to: 2277, type: "division_of",
    note: "La marca «LIDERES ENTERTAINMENT GROUP» (grabaciones de sonido y video musicales) está registrada a nombre de Inversiones Rodven C.A.",
    urls: [TRADEMARK] },
];

const pool = getPool();
const names = new Map((await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.organizations WHERE id = ANY($1::bigint[])",
  [RELATIONS.flatMap((r) => [r.from, r.to])])).rows.map((row) => [Number(row.id), row.name]));
for (const r of RELATIONS) console.log(`${names.get(r.from)} —${r.type}→ ${names.get(r.to)}${r.start ? ` (${r.start})` : ""}`);
if (RELATIONS.some((r) => !names.has(r.from) || !names.has(r.to))) throw new Error("falta alguna organización");
if (confirm) {
  const { runId } = await withOperatorRun({ name: "primo-etapa2:sucesion", operator: "claude-code", note: "Plan del primo, etapa 2 (2026-10-12): sucesión de Rodven con fuente (punto 7)" }, async (context) => {
    for (const r of RELATIONS) {
      await context.client.query(`
        INSERT INTO ingest.organization_relations(from_organization_id, to_organization_id, relation_type, start_year, evidence_note, source_urls, run_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (from_organization_id, to_organization_id, relation_type) DO NOTHING`,
      [r.from, r.to, r.type, r.start ?? null, r.note, r.urls, context.runId]);
    }
  });
  console.log(`run ${runId}`);
}
await closeDb();
