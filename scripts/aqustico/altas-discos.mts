// Plan Aqustico · E5 (H7 + H8) — discos que faltan de artistas ya en CRV, y
// pistas de discos de CRV que no tienen ninguna.
//
// Entradas (de E0 y de orden-pistas.py):
//   * H7 de una canción: disco `single`, pista 1.
//   * H7 de varias canciones y H8: solo si orden-pistas.json trae el orden de otra
//     fuente (Deezer o MusicBrainz, artista + título exactos y todas las canciones
//     presentes). Sin orden, en espera (decisión D4, valor por defecto).
// Guardas: solo artistas PROBADOS (disco en común, E0); nada de artistas nuevos
// (D3); variantes de discos que ya están y títulos de relleno ya salieron en E0
// como H7-duda; un disco que la API declara con más canciones de las que trae
// queda en espera; si el motor de identidad (ER) ve un parecido, NO se fuerza
// (sin allowSimilar): queda en la cola de revisión. Año y sello quedan vacíos
// (Aqustico no los tiene). La portada va después por media:localize y el
// género por apply-source-genres (libro «aqustico-altas»).
//
// Camino del operador (createEntity) en runs reversibles de ≤50 discos; cada
// campo deja además un claim de la fuente `aqustico` con su evidencia.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/altas-discos.mts [--confirm] [--limit=N]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { OperatorError, createEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { ensureAqusticoSource } from "./fuente.mjs";

const ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano";
const DIR = `${ROOT}/reports/aqustico-2026-10`;
const RAW = `${ROOT}/data/raw/aqustico-2026-10-11`;
const BATCH = 50;
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

interface Cancion { songId: number; title: string; seconds: number | null }
interface Hueco { hueco: string; crvId: number; aqId: string; valor: { title: string; canciones: Cancion[]; cover: string | null; genres: string[] } | string[]; evidencia: string; detalle?: string }
interface Orden { hueco: string; aqIds: string; crvArtistId?: number; crvAlbumId?: number; artist: string; title: string;
  orden: null | { source: string; url: string; externalTitle: string; order: Record<string, { disc: number; n: number; title: string; seconds: number | null }> } }

interface Pista { songId: number; title: string; disc: number; n: number; seconds: number | null }
interface Plan { tipo: "nuevo" | "pistas"; aqIds: string; artistId: number; albumId?: number; title: string; albumType?: string;
  pistas: Pista[]; cover: string | null; genres: string[]; evidencia: string; ordenFuente?: string }

function cargar(): { plan: Plan[]; espera: Array<{ hueco: string; title: string; motivo: string; aqIds: string }> } {
  const huecos = (JSON.parse(readFileSync(`${DIR}/tabla-maestra.json`, "utf8")) as { huecos: Hueco[] }).huecos;
  const ordenes = (JSON.parse(readFileSync(`${DIR}/orden-pistas.json`, "utf8")) as { discos: Orden[] }).discos;
  const ordenBy = new Map(ordenes.map((o) => [o.aqIds, o]));
  const declarado = new Map<string, number>();
  for (const line of readFileSync(`${RAW}/catalogo-albumes.tsv`, "utf8").trim().split("\n").slice(1)) {
    const p = line.split("\t");
    if (p[5]) declarado.set(p[0]!, Number(p[5]));
  }
  const plan: Plan[] = [];
  const espera: Array<{ hueco: string; title: string; motivo: string; aqIds: string }> = [];
  for (const h of huecos.filter((x) => x.hueco === "H7")) {
    const v = h.valor as { title: string; canciones: Cancion[]; cover: string | null; genres: string[] };
    const decl = Math.max(0, ...h.aqId.split(",").map((id) => declarado.get(id) ?? 0));
    if (decl > v.canciones.length) { espera.push({ hueco: "H7", title: v.title, aqIds: h.aqId, motivo: `la API declara ${decl} canciones y trae ${v.canciones.length}` }); continue; }
    if (v.canciones.length === 1) {
      const c = v.canciones[0]!;
      plan.push({ tipo: "nuevo", aqIds: h.aqId, artistId: h.crvId, title: v.title, albumType: "single", cover: v.cover, genres: v.genres,
        evidencia: h.evidencia, pistas: [{ songId: c.songId, title: c.title, disc: 1, n: 1, seconds: c.seconds }] });
      continue;
    }
    const o = ordenBy.get(h.aqId)?.orden;
    if (!o) { espera.push({ hueco: "H7", title: v.title, aqIds: h.aqId, motivo: "sin orden de pistas en Deezer ni MusicBrainz (D4)" }); continue; }
    plan.push({ tipo: "nuevo", aqIds: h.aqId, artistId: h.crvId, title: v.title, albumType: "other", cover: v.cover, genres: v.genres,
      evidencia: h.evidencia, ordenFuente: o.url,
      pistas: v.canciones.map((c) => { const p = o.order[String(c.songId)]!; return { songId: c.songId, title: c.title, disc: p.disc, n: p.n, seconds: c.seconds ?? p.seconds }; }) });
  }
  for (const o of ordenes.filter((x) => x.hueco === "H8")) {
    if (!o.orden) { espera.push({ hueco: "H8", title: o.title, aqIds: o.aqIds, motivo: "sin orden de pistas en Deezer ni MusicBrainz (D4)" }); continue; }
    const ord = o.orden;
    plan.push({ tipo: "pistas", aqIds: o.aqIds, artistId: 0, albumId: o.crvAlbumId!, title: o.title, cover: null, genres: [],
      evidencia: `https://api.aqustico.com/album/${o.aqIds.split(",")[0]}`, ordenFuente: ord.url,
      pistas: Object.entries(ord.order).map(([songId, p]) => ({ songId: Number(songId), title: p.title, disc: p.disc, n: p.n, seconds: p.seconds })) });
  }
  return { plan: plan.slice(0, LIMIT), espera };
}

async function claim(context: OperatorContext, sourceId: number, kind: "album" | "track", id: number, field: string, value: unknown, url: string, excerpt: string, identity: string): Promise<void> {
  const col = kind === "album" ? "album_id" : "track_id";
  const row = await context.client.query<{ id: string }>(`
    INSERT INTO ingest.claims(source_id,entity_kind,${col},field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
    VALUES($1,$2,$3,$4,$5::jsonb,$5::jsonb,$6,'aqustico-volcado-2026-10-11','1','medium','accepted','system',$7,$8,$9)
    ON CONFLICT DO NOTHING RETURNING id::text`,
  [sourceId, kind, id, field, JSON.stringify(value), sha([kind, identity, field, value]), context.runId, excerpt.slice(0, 400), identity]);
  if (row.rows[0]) {
    await context.client.query("INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
      [row.rows[0].id, url, excerpt.slice(0, 500), sha([url, excerpt])]);
  }
}

async function main(): Promise<void> {
  const { plan, espera } = cargar();
  console.log(`plan: ${plan.length} (nuevos ${plan.filter((p) => p.tipo === "nuevo").length}, pistas a discos existentes ${plan.filter((p) => p.tipo === "pistas").length}) · en espera ${espera.length} · ${CONFIRM ? "APLICAR" : "ensayo (se deshace)"}`);
  const creadas: Array<{ albumId: number; title: string; artistId: number; tracks: number; genres: string[]; cover: string | null; evidencia: string; tipo: string }> = [];
  const cola: Array<{ title: string; artistId: number; motivo: string }> = [];
  const errores: Array<{ title: string; error: string }> = [];
  const runs: number[] = [];
  for (let i = 0; i < plan.length; i += BATCH) {
    const slice = plan.slice(i, i + BATCH);
    const { runId } = await withOperatorRun({
      name: `aqustico:altas-discos (${i + 1}-${i + slice.length}/${plan.length})`,
      operator: "auto:aqustico",
      note: "Plan Aqustico E5: discos que faltan de artistas ya en CRV (identidad probada por disco en común) y pistas de discos de CRV sin pistas; orden de pistas de Deezer/MusicBrainz cuando hay varias.",
      params: { plan: "~/Desktop/PLAN_AQUSTICO_2026-10-12.md", confirm: CONFIRM },
    }, async (context) => {
      const sourceId = await ensureAqusticoSource(context.client);
      for (const p of slice) {
        await context.client.query("SAVEPOINT alta");
        try {
          let albumId = p.albumId;
          if (p.tipo === "nuevo") {
            try {
              albumId = (await createEntity(context, "album", { title: p.title, album_type: p.albumType }, { artistId: p.artistId })).id;
            } catch (error) {
              if (error instanceof OperatorError && (error.code === "needs_review" || error.code === "already_exists")) {
                await context.client.query("ROLLBACK TO SAVEPOINT alta");
                await context.client.query("RELEASE SAVEPOINT alta");
                cola.push({ title: p.title, artistId: p.artistId, motivo: `${error.code}: ${error.message.slice(0, 160)}` });
                continue;
              }
              throw error;
            }
            const ex = `Aqustico publica «${p.title}» del artista (álbumes ${p.aqIds}) con ${p.pistas.length} canción(es)`;
            await claim(context, sourceId, "album", albumId, "title", p.title, p.evidencia, ex, `aqustico:album:${p.aqIds}`);
            await claim(context, sourceId, "album", albumId, "album_type", p.albumType, p.evidencia,
              p.albumType === "single" ? `${ex}: una sola canción → sencillo` : `${ex}; tipo sin dato en la fuente`, `aqustico:album:${p.aqIds}`);
          } else {
            const has = await context.client.query("SELECT 1 FROM public.tracks WHERE album_id=$1 LIMIT 1", [albumId]);
            if (has.rowCount) { await context.client.query("RELEASE SAVEPOINT alta"); continue; }
          }
          for (const t of [...p.pistas].sort((a, b) => a.disc - b.disc || a.n - b.n)) {
            const values: Record<string, unknown> = { title: t.title, track_number: t.n, disc_number: t.disc };
            if (t.seconds) values["duration_seconds"] = t.seconds;
            const trackId = (await createEntity(context, "track", values, { albumId: albumId! })).id;
            const ex = `Aqustico: canción ${t.songId} «${t.title}»${t.seconds ? ` (${t.seconds} s)` : ""}; posición ${t.disc}-${t.n}${p.ordenFuente ? ` según ${p.ordenFuente}` : " (sencillo de una canción)"}`;
            await claim(context, sourceId, "track", trackId, "title", t.title, p.evidencia, ex, `aqustico:song:${t.songId}`);
            if (t.seconds) await claim(context, sourceId, "track", trackId, "duration_seconds", t.seconds, p.evidencia, ex, `aqustico:song:${t.songId}`);
          }
          await context.client.query("RELEASE SAVEPOINT alta");
          creadas.push({ albumId: albumId!, title: p.title, artistId: p.artistId, tracks: p.pistas.length, genres: p.genres, cover: p.cover, evidencia: p.evidencia, tipo: p.tipo });
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT alta");
          await context.client.query("RELEASE SAVEPOINT alta");
          errores.push({ title: p.title, error: (error as Error).message.slice(0, 200) });
        }
      }
      return creadas.length;
    }, { rollbackOnly: !CONFIRM });
    runs.push(runId);
    console.log(`  lote ${i + 1}-${i + slice.length}: run ${runId}`);
  }
  const mode = CONFIRM ? "confirm" : "dry-run";
  const informe = { generado: new Date().toISOString(), mode, runs, creadas, cola, errores, espera };
  writeFileSync(`${DIR}/e5-altas-${mode}.json`, JSON.stringify(informe, null, 1));
  if (CONFIRM) writeFileSync(`${DIR}/altas-creadas.json`, JSON.stringify(informe, null, 1));
  console.log(`TOTAL (${mode}): ${creadas.filter((c) => c.tipo === "nuevo").length} discos nuevos, ${creadas.filter((c) => c.tipo === "pistas").length} discos completados con pistas, ${creadas.reduce((a, c) => a + c.tracks, 0)} pistas · ${cola.length} a la cola (ER) · ${errores.length} errores · ${espera.length} en espera · runs ${runs.join(",")}`);
  for (const e of [...errores, ...cola].slice(0, 10)) console.log("  ", JSON.stringify(e));
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
