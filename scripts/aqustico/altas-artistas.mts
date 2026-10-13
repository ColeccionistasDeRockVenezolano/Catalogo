// Altas de artistas (y su persona, si es solista) verificados como venezolanos,
// del lote Aqustico «sin ficha» (Brian, 2026-10-12). Dry-run por defecto.
//
//   * SIN --confirm: no escribe nada.
//       1) pre-chequeos de solo lectura (duplicados por clave compacta en artists,
//          persons y sus alias; nombres sospechosos de persona),
//       2) sonda ER: repite las altas dentro de una transacción que se revierte al
//          final y dice qué crearía, qué ya existe y qué quedaría en cola (score).
//   * CON --confirm: aplica por lotes en runs reversibles (`crv runs undo <id>`),
//     savepoint por entidad, guardas ER (needs_review con score<0.66 → allowSimilar;
//     el resto queda propuesto en la cola de revisión), foto local copiada a
//     web/public/media + manifiesto, y la evidencia web de venezolanidad en notes.
//
// Persona: si ya existe en el catálogo (clave compacta) se VINCULA (membresía
// «Titular del proyecto»); si no, se intenta crear; si el ER duda, la propuesta
// queda en la cola de revisión y el ARTISTA se crea igualmente.
//
// Uso:
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/altas-artistas.mts \
//     [--plan=reports/aqustico-2026-10/altas-artistas-plan.jsonl] [--confirm] [--batch=50]
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, createEntity, createRelation, updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { normalizeEntityName } from "../../src/normalization/entity-name.js";
import { classifyPersonName } from "../../src/review/person-junk.js";

const ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano";
const OUT = path.join(ROOT, "reports/aqustico-2026-10");
const STORE = path.join(ROOT, "web", "public", "media");
const MANIFEST_PATH = path.join(STORE, "manifest.json");

const args = process.argv.slice(2);
const argVal = (n: string) => args.find((v) => v.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const CONFIRM = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 50);
const PLAN_PATH = argVal("plan") ?? path.join(OUT, "altas-artistas-plan.jsonl");
const ROL_TITULAR = "Titular del proyecto";
const UMBRAL_ALLOW = 0.66;

interface PlanItem {
  clave: string;
  aq_id: number;
  nombre: string;
  tipo: "solo_artist" | "band" | "duo" | "group" | "project";
  values: { origin_city?: string; formed_year?: number; notes?: string };
  persona: { name: string; real_name?: string; notes?: string } | null;
  foto: { archivo: string; url: string };
  evidencia: string[];
  notas: string;
}

type Rec = {
  resultado: string; detalle?: string; score?: number; existingId?: number;
  artistId?: number; personId?: number; personaExistente?: number; personaCola?: string; foto?: string;
  candidatos?: string[];
};
type Resultado = Record<string, Rec>;

function cargarPlan(): PlanItem[] {
  return readFileSync(PLAN_PATH, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
    const it = JSON.parse(l) as PlanItem;
    if (!it.nombre || !it.tipo || !it.foto?.archivo) throw new Error(`ítem inválido: ${JSON.stringify(it).slice(0, 140)}`);
    if (it.tipo === "solo_artist" && !it.persona) throw new Error(`solista sin persona: ${it.clave}`);
    return it;
  });
}

function buildArtistValues(it: PlanItem): Record<string, unknown> {
  return {
    name: it.nombre, artist_type: it.tipo, origin_country: "Venezuela",
    ...(it.values.origin_city ? { origin_city: it.values.origin_city } : {}),
    ...(it.values.formed_year ? { formed_year: it.values.formed_year } : {}),
    notes: `Alta desde Aqustico (lote «sin ficha» 2026-10-12). ${it.values.notes ?? ""} Evidencia de venezolanidad: ${it.evidencia.join(" · ")}`.slice(0, 2000),
  };
}
function buildPersonValues(it: PlanItem): Record<string, unknown> {
  const p = it.persona!;
  return {
    name: p.name, nationality: "Venezuela", is_venezuelan: "true",
    ...(p.real_name ? { real_name: p.real_name } : {}),
    notes: `Alta desde Aqustico (lote «sin ficha» 2026-10-12). ${p.notes ?? ""} Evidencia: ${it.evidencia.join(" · ")}`.slice(0, 2000),
  };
}

/** Índice de personas por clave compacta (para vincular en vez de duplicar). */
async function indicePersonas(context: OperatorContext): Promise<Map<string, number>> {
  const { rows } = await context.client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons");
  const map = new Map<string, number>();
  for (const r of rows) map.set(normalizeEntityName(r.name).compactSecondaryKey, Number(r.id));
  return map;
}

/** Detalle de la última decisión ER del nombre para un kind dado. */
async function detalleEr(context: OperatorContext, kind: "ARTIST" | "PERSON", nombre: string): Promise<{ score: number; candidatos: string[] }> {
  const dec = await context.client.query<{ score: string | null; candidates: unknown }>(
    "SELECT score::text, candidates FROM ingest.entity_resolution_decisions WHERE entity_kind=$1 AND input_name_original=$2 ORDER BY id DESC LIMIT 1",
    [kind, nombre]);
  const score = Number(dec.rows[0]?.score ?? 1);
  const cands = (dec.rows[0]?.candidates as Array<{ canonicalName?: string }> | undefined) ?? [];
  return { score, candidatos: cands.slice(0, 3).map((c) => c.canonicalName ?? "?") };
}

/** Resuelve la persona: existente → id; nueva con permiso ER → id; dudosa → cola (undefined). */
async function resolverPersona(context: OperatorContext, it: PlanItem, indice: Map<string, number>, rec: Rec): Promise<number | undefined> {
  const p = it.persona!;
  const existente = indice.get(normalizeEntityName(p.name).compactSecondaryKey);
  if (existente) { rec.personaExistente = existente; return existente; }
  try {
    const created = await createEntity(context, "person", buildPersonValues(it));
    return created.id;
  } catch (error) {
    if (!(error instanceof OperatorError) || error.code !== "needs_review") throw error;
    const { score, candidatos } = await detalleEr(context, "PERSON", p.name);
    rec.score = score;
    rec.candidatos = candidatos;
    if (score < UMBRAL_ALLOW) {
      await context.client.query("SAVEPOINT p_persona");
      try {
        const created = await createEntity(context, "person", buildPersonValues(it), { allowSimilar: true });
        await context.client.query("RELEASE SAVEPOINT p_persona");
        return created.id;
      } catch (e2) {
        await context.client.query("ROLLBACK TO SAVEPOINT p_persona");
        await context.client.query("RELEASE SAVEPOINT p_persona");
        rec.personaCola = (e2 instanceof Error ? e2.message : String(e2)).slice(0, 200);
        return undefined;
      }
    }
    rec.personaCola = `needs_review score=${score}`;
    return undefined;
  }
}

/** Crea el artista con la guarda ER completa. */
async function crearArtista(context: OperatorContext, it: PlanItem, rec: Rec): Promise<void> {
  try {
    const created = await createEntity(context, "artist", buildArtistValues(it));
    rec.artistId = created.id;
    rec.resultado = "creado";
    return;
  } catch (error) {
    if (!(error instanceof OperatorError)) throw error;
    if (error.code === "already_exists") {
      rec.resultado = "ya_existe";
      const eid = Number((error.details?.["existingId"] as number | undefined) ?? 0);
      if (eid) rec.existingId = eid;
      return;
    }
    if (error.code !== "needs_review") throw error;
    const { score, candidatos } = await detalleEr(context, "ARTIST", it.nombre);
    rec.score = score;
    rec.candidatos = candidatos;
    if (score < UMBRAL_ALLOW) {
      const created = await createEntity(context, "artist", buildArtistValues(it), { allowSimilar: true });
      rec.artistId = created.id;
      rec.resultado = "creado_con_allowSimilar";
      return;
    }
    rec.resultado = "artist_en_cola";
  }
}

async function preChequeos(items: PlanItem[]): Promise<Record<string, string[]>> {
  const pool = getPool();
  const avisos: Record<string, string[]> = {};
  const push = (k: string, msg: string) => { (avisos[k] ??= []).push(msg); };

  const artistKeys = new Map<string, { id: number; name: string }>();
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists")).rows) {
    artistKeys.set(normalizeEntityName(r.name).compactSecondaryKey, { id: Number(r.id), name: r.name });
  }
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text, alias FROM ingest.artist_aliases")).rows) {
    artistKeys.set(normalizeEntityName(r.alias).compactSecondaryKey, { id: Number(r.artist_id), name: r.alias });
  }
  const personKeys = new Map<string, { id: number; name: string }>();
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons")).rows) {
    personKeys.set(normalizeEntityName(r.name).compactSecondaryKey, { id: Number(r.id), name: r.name });
  }
  for (const r of (await pool.query<{ person_id: string; alias: string }>("SELECT person_id::text, alias FROM ingest.person_aliases")).rows) {
    personKeys.set(normalizeEntityName(r.alias).compactSecondaryKey, { id: Number(r.person_id), name: r.alias });
  }

  const vistos = new Set<string>();
  for (const it of items) {
    const key = normalizeEntityName(it.nombre).compactSecondaryKey;
    if (vistos.has(key)) push(it.clave, "duplicado DENTRO del lote (clave compacta)");
    vistos.add(key);
    const ha = artistKeys.get(key);
    if (ha) push(it.clave, `ya existe artista #${ha.id} «${ha.name}» (clave compacta)`);
    if (it.persona) {
      const cls = classifyPersonName(it.persona.name);
      if (cls.kind !== "ok") push(it.clave, `nombre de persona sospechoso (${cls.kind}): ${cls.reason}`);
      const hp = personKeys.get(normalizeEntityName(it.persona.name).compactSecondaryKey);
      if (hp) push(it.clave, `ya existe persona #${hp.id} «${hp.name}» (se vincula)`);
    }
  }
  return avisos;
}

/** Sonda ER: repite las altas dentro de una transacción que se revierte al final. */
async function sondaEr(items: PlanItem[]): Promise<Resultado> {
  const out: Resultado = {};
  try {
    await withOperatorRun({
      name: "aqustico:altas-artistas-sonda (revertida)", operator: "hermes-curaduria (sonda ER)",
      note: "Sonda ER de las altas del lote Aqustico sin ficha: se revierte al final; no escribe nada.",
    }, async (context) => {
      const indice = await indicePersonas(context);
      for (const it of items) {
        await context.client.query("SAVEPOINT p");
        const rec: Rec = { resultado: "?" };
        let conservar = false;
        try {
          const personId = it.persona ? await resolverPersona(context, it, indice, rec) : undefined;
          if (personId !== undefined) rec.personId = personId;
          await crearArtista(context, it, rec);
          if (rec.artistId !== undefined) {
            if (personId) await createRelation(context, "artist_membership", { artistId: rec.artistId, personId }, {
              role: ROL_TITULAR, is_current: "false", notes: `Titular según alta Aqustico 2026-10-12 (${it.clave})`,
            });
            conservar = true;
          }
        } catch (error) {
          rec.resultado = "error";
          rec.detalle = (error instanceof Error ? error.message : String(error)).slice(0, 220);
        }
        out[it.clave] = rec;
        if (conservar) await context.client.query("RELEASE SAVEPOINT p");
        else { await context.client.query("ROLLBACK TO SAVEPOINT p"); await context.client.query("RELEASE SAVEPOINT p"); }
      }
      throw new Error("probe-rollback-confirmado");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "probe-rollback-confirmado") throw error;
  }
  return out;
}

/** Copia la foto local al media público y a su manifiesto. Devuelve la URL local. */
function sembrarFoto(kind: "artist" | "person", id: number, foto: { archivo: string; url: string }, manifest: { entries: Record<string, Record<string, unknown>> }): string {
  const data = readFileSync(foto.archivo);
  const ext = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "jpg"
    : data.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary")) ? "png"
      : undefined;
  if (!ext) throw new Error(`foto sin firma reconocible: ${foto.archivo}`);
  const rel = `media/${kind}/${id}.${ext}`;
  mkdirSync(path.join(STORE, kind), { recursive: true });
  const dst = path.join(ROOT, "web", "public", rel);
  copyFileSync(foto.archivo, `${dst}.part`);
  renameSync(`${dst}.part`, dst);
  manifest.entries[`${kind}:${id}`] = {
    kind, id, sourceUrl: foto.url, localPath: rel, contentType: `image/${ext === "jpg" ? "jpeg" : "png"}`,
    bytes: data.byteLength, sha256: createHash("sha256").update(data).digest("hex"), downloadedAt: new Date().toISOString(),
  };
  return `/crv/media/${kind}/${id}.${ext}`;
}

async function aplicar(items: PlanItem[]): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { version: 1; entries: Record<string, Record<string, unknown>> };
  const resultados: Resultado = {};
  const runs: number[] = [];

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const { runId } = await withOperatorRun({
      name: `hermes:altas-aqustico-sin-ficha (${i + 1}-${i + slice.length}/${items.length})`,
      operator: "hermes-curaduria (delegado por Brian)",
      note: "Altas del lote Aqustico «sin ficha» (2026-10-12): artistas verificados como venezolanos con evidencia web; persona + membresía «Titular del proyecto» en solistas; foto local.",
      params: { plan: path.relative(ROOT, PLAN_PATH), batch: [i + 1, i + slice.length] },
    }, async (context) => {
      const indice = await indicePersonas(context);
      let hechas = 0;
      for (const it of slice) {
        await context.client.query("SAVEPOINT alt");
        const rec: Rec = { resultado: "?" };
        let conservar = false;
        try {
          const personId = it.persona ? await resolverPersona(context, it, indice, rec) : undefined;
          if (personId !== undefined) rec.personId = personId;
          await crearArtista(context, it, rec);
          if (rec.artistId !== undefined) {
            if (personId) await createRelation(context, "artist_membership", { artistId: rec.artistId, personId }, {
              role: ROL_TITULAR, is_current: "false", notes: `Titular según alta Aqustico 2026-10-12 (${it.clave})`,
            });
            const urlArtista = sembrarFoto("artist", rec.artistId, it.foto, manifest);
            await updateEntity(context, "artist", rec.artistId, { picture_url: urlArtista });
            rec.foto = urlArtista;
            if (personId) {
              const urlPersona = sembrarFoto("person", personId, it.foto, manifest);
              await updateEntity(context, "person", personId, { picture_url: urlPersona });
            }
            hechas += 1;
            conservar = true;
          }
        } catch (error) {
          rec.resultado = "error";
          rec.detalle = (error instanceof Error ? error.message : String(error)).slice(0, 220);
        }
        resultados[it.clave] = rec;
        if (conservar) await context.client.query("RELEASE SAVEPOINT alt");
        else { await context.client.query("ROLLBACK TO SAVEPOINT alt"); await context.client.query("RELEASE SAVEPOINT alt"); }
      }
      await context.client.query("SELECT 1");
      return hechas;
    });
    runs.push(runId);
    const tmp = `${MANIFEST_PATH}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmp, MANIFEST_PATH);
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId}`);
  }

  const report = { mode: "confirm", plan: path.relative(ROOT, PLAN_PATH), runs, items: items.length,
    artistas: Object.values(resultados).filter((r) => r.artistId !== undefined).length,
    personas: Object.values(resultados).filter((r) => r.personId !== undefined && !r.personaExistente).length,
    personasVinculadas: Object.values(resultados).filter((r) => r.personaExistente).length,
    personasEnCola: Object.values(resultados).filter((r) => r.personaCola).length,
    artistasEnCola: Object.values(resultados).filter((r) => r.resultado === "artist_en_cola").length,
    errores: Object.values(resultados).filter((r) => r.resultado === "error").length,
    resultados };
  const file = `${OUT}/altas-artistas-confirm.json`;
  writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(`altas (confirm): artistas ${report.artistas} · personas nuevas ${report.personas} · vinculadas ${report.personasVinculadas} · en cola ${report.personasEnCola} · errores ${report.errores} → ${file}`);
}

async function main(): Promise<void> {
  const items = cargarPlan();
  console.log(`plan: ${items.length} artistas (${items.filter((i) => i.persona).length} con persona)`);
  const avisos = await preChequeos(items);
  for (const [k, v] of Object.entries(avisos)) console.log(`  AVISO ${k}: ${v.join(" · ")}`);
  if (CONFIRM) {
    await aplicar(items);
  } else {
    const sonda = await sondaEr(items);
    const report = { mode: "dry-run", plan: path.relative(ROOT, PLAN_PATH), items: items.length, avisos, sonda };
    const file = `${OUT}/altas-artistas-dry-run.json`;
    writeFileSync(file, JSON.stringify(report, null, 1));
    const c = Object.values(sonda);
    console.log(`sonda ER: ${c.filter((r) => r.artistId !== undefined).length} artistas OK · `
      + `${c.filter((r) => r.personaExistente).length} personas vinculadas · `
      + `${c.filter((r) => r.personId !== undefined && !r.personaExistente).length} personas nuevas · `
      + `${c.filter((r) => r.personaCola).length} personas a cola · `
      + `${c.filter((r) => r.resultado === "artist_en_cola").length} artistas a cola · `
      + `${c.filter((r) => r.resultado === "error").length} errores → ${file}`);
    for (const [k, r] of Object.entries(sonda)) {
      const n = items.find((i) => i.clave === k)?.nombre ?? "";
      if (r.resultado !== "creado" && r.resultado !== "creado_con_allowSimilar") {
        console.log(`  ${k} ${n}: ${r.resultado}${r.detalle ? " — " + r.detalle : ""}${r.candidatos?.length ? " [" + r.candidatos.join(" | ") + "]" : ""}`);
      }
      if (r.personaCola) console.log(`     persona en cola: ${r.personaCola}${r.score !== undefined ? ` (score ${r.score})` : ""}${r.candidatos?.length ? " [" + r.candidatos.join(" | ") + "]" : ""}`);
    }
  }
  await closeDb();
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
