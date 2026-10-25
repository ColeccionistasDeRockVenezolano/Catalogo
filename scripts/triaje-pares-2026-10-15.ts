// Triaje de los 9 pares de la verificación externa (2026-10-15) y de los casos revisados de los 28.
// - Fusiones con evidencia interna+externa: 1144→960, 531→623, 1448→937, 269→289.
// - Alias históricos nuevos: «Abaddon»→#335 (con advertencia de homonimia), «Remembrance»→#518, «Heylel»→#3186.
// - Pares declarados DISTINTOS (no fusionar): 335/963, 332/3228, 518/2284, 3186/3241, 1287/590, 1288/748.
// Uso: ./scripts/with-node22.sh npx tsx scripts/triaje-pares-2026-10-15.ts [--confirm]
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createAlias } from "../src/api/repositories/aliases.js";
import { mergeEntities, previewEntityMerge, type EntityMergePreview, type MergeFieldChoice } from "../src/merge/entity-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { declareDistinctPair } from "../src/curation/repository.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const CONFIRM = process.argv.includes("--confirm");
const OPERADOR = "hermes (encargo de Brian 2026-10-15)";

interface Fusion { keep: number; drop: number; bio: MergeFieldChoice; motivo: string; }
const FUSIONES: Fusion[] = [
  { keep: 960, drop: 1144, bio: "combine", motivo: "«Baphomet» (nombre 1988-1992) es la misma banda que «Baphometh»: 11 de 12 miembros en común y el mismo disco «In The Beginning» (1988-1992); la verificación externa del 2026-10-15 confirma la trayectoria. La bio del duplicado aporta la formación inicial y queda marcada para reescritura." },
  { keep: 623, drop: 531, bio: "keep", motivo: "«Bajo Cero» es la grafía anterior de «Bajo Zero» (Metal Archives); los 4 miembros de #531 están también en #623 (su bio es un texto de relleno)." },
  { keep: 937, drop: 1448, bio: "combine", motivo: "«Wismar» (2002-2011) es la etapa anterior de «Lithopedion»: mismo disco «BlackHymn» (2011) y Wismar Pulido como responsable. La bio del duplicado (origen del proyecto) queda marcada para reescritura." },
  { keep: 289, drop: 269, bio: "keep", motivo: "«Azucar Cacao Leche» (#269, sin ciudad ni miembros) es la misma agrupación que «Azúcar, Cacao & Leche» (#289): mismo LP de 1971; #289 es la ficha completa." },
];

interface AliasNuevo { artist: number; alias: string; nota: string; }
const ALIASES: AliasNuevo[] = [
  { artist: 335, alias: "Abaddon", nota: "nombre histórico de 1992, abandonado porque ya existía otra agrupación con ese nombre; NO confundir con Abaddon de Valencia (#963, 1994)" },
  { artist: 518, alias: "Remembrance", nota: "etapa 2009-2015 (ficha #2284); Across The Ruins es su continuación tras la migración a Chile — etapas conservadas" },
  { artist: 3186, alias: "Heylel", nota: "denominación 2020-2021 (ficha #3241); interrupción 2022-2023 y retomada en 2024 — etapas conservadas" },
];

interface Distinto { a: number; b: number; nota: string; }
const DISTINTOS: Distinto[] = [
  { a: 335, b: 963, nota: "Natastor usó el nombre Abaddon en 1992 y lo abandonó precisamente por homonimia; la Abaddon de Valencia es de 1994. Verificación externa 2026-10-15: conservar separadas." },
  { a: 332, b: 3228, nota: "La Abraxas de #3228 (Caracas, 1987-1996) no es la Abraxas de Cabimas (2012-2017) que pasó a llamarse Kolman (#332, vía la fusionada #651). Homonimia, no duplicado." },
  { a: 518, b: 2284, nota: "Across The Ruins (#518) es la continuación de Remembrance (#2284, 2009-2015) tras migrar a Chile: etapas históricas conservadas (verificación externa 2026-10-15)." },
  { a: 3186, b: 3241, nota: "Blodmåne (#3186) retomó en 2024 tras la etapa Heylel (#3241, 2020-2021): etapas conservadas (verificación externa 2026-10-15)." },
  { a: 1287, b: 590, nota: "Nemesis de Lara (Barquisimeto, thrash, 1988) y Nemesis de Caracas (heavy) son bandas distintas (Metal Archives); no fusionar." },
  { a: 1288, b: 748, nota: "Agonía de Mérida (2002) y Agonía de Caracas (2009) son agrupaciones distintas (Metal Archives); no fusionar sin evidencia en contrario." },
];

async function main(): Promise<void> {
  const pool = getPool();
  const previews: EntityMergePreview[] = [];
  const out: Record<string, unknown> = {};

  for (const f of FUSIONES) {
    const prev = await previewEntityMerge(pool, "artist", f.keep, f.drop);
    previews.push(prev);
    const imgs = (["picture_url", "logo_url"] as const).filter((c) => prev.fieldsFilledFromDrop.includes(c));
    console.log(`\nFUSIÓN #${f.drop} → #${f.keep}: «${prev.drop.name}» → «${prev.keep.name}»`);
    console.log(`  conflictos: ${prev.fieldConflicts.map((c) => c.field).join(", ") || "—"} · se completan: ${prev.fieldsFilledFromDrop.join(", ") || "—"} · alias: ${prev.aliasesToAdd.join(", ") || "—"}`);
    console.log(`  imagen/logo que hereda del drop: ${imgs.join(", ") || "no"} · discos compartidos: ${prev.sharedAlbums.map((a) => `${a.id} ${a.title}`).join(" · ") || "—"}`);
    if (prev.warnings.length) console.log(`  AVISOS: ${prev.warnings.join(" | ")}`);
  }
  for (const a of ALIASES) console.log(`\nalias: #${a.artist} ← «${a.alias}» [former_name] — ${a.nota}`);
  for (const d of DISTINTOS) console.log(`distintos: #${d.a} ≠ #${d.b} — ${d.nota}`);

  if (!CONFIRM) { console.log("\nvista previa: repite con --confirm"); await closeDb(); return; }

  const fusiones: unknown[] = [];
  const archivos: string[] = [];
  for (const [i, f] of FUSIONES.entries()) {
    const prev = previews[i]!;
    const { runId, result } = await withOperatorRun({
      name: `hermes:fusion-${f.drop}-${f.keep}`, operator: OPERADOR, note: f.motivo, params: { keep: f.keep, drop: f.drop },
    }, async (context) => {
      const fresh = await previewEntityMerge(context.client, "artist", f.keep, f.drop, { lock: true });
      const fieldChoices: Partial<Record<string, MergeFieldChoice>> = {};
      for (const c of fresh.fieldConflicts) fieldChoices[c.field] = c.field === "biography" ? f.bio : "keep";
      return mergeEntities(context, { kind: "artist", keepId: f.keep, dropId: f.drop, previewHash: fresh.previewHash, fieldChoices, keepDropNameAsAlias: true, rewriteLater: true });
    });
    const heredaImagen = prev.fieldsFilledFromDrop.includes("picture_url");
    const heredaLogo = prev.fieldsFilledFromDrop.includes("logo_url");
    for (const ext of ["jpg", "webp", "png", "gif"]) {
      for (const sufijo of ["", "-logo"]) {
        const archivo = path.join(ROOT, "web", "public", "media", "artist", `${f.drop}${sufijo}.${ext}`);
        if (existsSync(archivo) && !(sufijo === "" ? heredaImagen : heredaLogo)) { rmSync(archivo); archivos.push(archivo); }
      }
    }
    fusiones.push({ ...f, run: runId, resultado: result, heredaImagen, heredaLogo });
    console.log(`\nrun ${runId}: #${f.drop} → #${f.keep} · movidos ${result.moved} · descartados ${result.discarded} · membresías ${result.membershipsMerged} · reescritura pendiente ${result.rewritePending}`);
  }

  const alias: unknown[] = [];
  for (const a of ALIASES) {
    const { runId, result } = await withOperatorRun({
      name: `hermes:alias-${a.alias}`, operator: OPERADOR,
      note: `Nombre histórico «${a.alias}» → #${a.artist}: ${a.nota}.`, params: { artist: a.artist, alias: a.alias },
    }, async (context) => createAlias(context, "artist", a.artist, { alias: a.alias, aliasType: "former_name", isPrimary: false }));
    alias.push({ ...a, run: runId, aliasId: result.id });
    console.log(`run ${runId}: alias «${result.alias}» [former_name] → #${a.artist}`);
  }

  const distintos: unknown[] = [];
  for (const d of DISTINTOS) {
    const r = await declareDistinctPair({ kind: "artist", aId: d.a, bId: d.b }, OPERADOR, d.nota);
    distintos.push({ ...d, pairId: r.pair.id, creado: r.created });
    console.log(`${r.created ? "declarado" : "ya existía"}: #${r.pair.aId} ≠ #${r.pair.bId} (par ${r.pair.id})`);
  }

  out["fusiones"] = fusiones; out["alias"] = alias; out["distintos"] = distintos; out["archivos"] = archivos;
  writeFileSync(path.join(ROOT, DIR, "triaje-pares-aplicado.json"), JSON.stringify(out, null, 1));
  console.log(`\nlisto: ${fusiones.length} fusiones · ${alias.length} alias · ${distintos.length} pares distintos · ${archivos.length} archivos huérfanos`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
