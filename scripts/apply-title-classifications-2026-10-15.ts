// Lote autorizado por Brian a partir de reports/titulos-albumes-2026-10-15.
// Sin --confirm ejecuta el mismo trabajo y revierte la transacción.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { isBSidesTitle } from "../src/normalization/b-sides-title.js";

interface Item { albumId: number; title: string; artist: string | null; albumType: string }
interface Audit {
  bsides: { missingClassification: Item[] };
  live: { unrepresented: Item[] };
  groups: Array<{ key: string; items: Item[] }>;
}
interface Target extends Item { labels: string[]; newType: string | null; note: string }
const OUT = "reports/titulos-albumes-aplicacion-2026-10-15";
const AUDIT = "reports/titulos-albumes-2026-10-15/hallazgos.json";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function plan(): Target[] {
  const audit = JSON.parse(readFileSync(AUDIT, "utf8")) as Audit;
  const targets = new Map<number, Target>();
  const add = (item: Item, labels: string[], newType: string | null, note: string) => {
    if (targets.has(item.albumId)) throw new Error(`Objetivo repetido ${item.albumId}`);
    targets.set(item.albumId, { ...item, labels, newType, note });
  };
  for (const item of audit.bsides.missingClassification) {
    if (!isBSidesTitle(item.title)) throw new Error(`Título sin marca B-Sides: ${item.albumId}`);
    add(item, ["B-Sides"], null, "B-Sides explícito; conservar el tipo principal");
  }
  for (const item of audit.live.unrepresented) add(item, ["En vivo"], null, "Directo explícito; conservar sencillo, demo o EP");
  for (const group of audit.groups.filter(group => ["compilation", "ep", "demo"].includes(group.key))) {
    for (const item of group.items.filter(item => item.albumType === "other")) {
      const type = group.key;
      const label = { compilation: "Compilation Album", ep: "EP", demo: "Demos" }[type]!;
      const mixed = item.albumId === 2006 || item.albumId === 2018;
      add(item, mixed ? [label, "En vivo"] : [label], mixed ? null : type,
        mixed ? "Ficha mixta: ambas clasificaciones, sin imponer un tipo único" : item.albumId === 1034 ? "Split EP: EP explícito, publicación compartida" : `Tipo ${type} explícito en el título`);
    }
  }
  if (targets.size !== 131) throw new Error(`El lote autorizado esperaba 131 discos, tiene ${targets.size}`);
  return [...targets.values()].sort((a, b) => a.albumId - b.albumId);
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const mode = confirm ? "confirm" : "dry-run";
  const targets = plan();
  mkdirSync(OUT, { recursive: true });
  const outcome = await withOperatorRun({
    name: "clasificaciones-por-titulo-2026-10-15", operator: "Brian (Codex)",
    note: "Aplicar B-Sides, compilados, EP, demos y En vivo según auditoría de títulos; autorización explícita de Brian. Inferencia del título, sin verificación externa. Conservar tipos de fichas mixtas.",
    params: { audit: AUDIT, targets, confirm },
  }, async context => {
    const { client, runId } = context;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:title-classifications:2026-10-15'))");
    const before = (await client.query<{ id: number; title: string; type: string; youtube_url: string | null; wordpress_url: string | null; classes: unknown[] }>(`
      SELECT a.id::int, a.title, a.album_type::text AS type, a.youtube_url, a.wordpress_url,
        (SELECT coalesce(json_agg(c ORDER BY c.position,c.id),'[]') FROM ingest.album_classifications c WHERE c.album_id=a.id) AS classes
        FROM public.albums a WHERE a.id=ANY($1::bigint[]) ORDER BY a.id FOR UPDATE`, [targets.map(item => item.albumId)])).rows;
    if (before.length !== targets.length) throw new Error("Faltan discos del lote autorizado");
    const current = new Map(before.map(row => [row.id, row]));
    writeFileSync(`${OUT}/antes-${mode}.json`, JSON.stringify({ runId, targets, albums: before }, null, 2) + "\n");
    const sourceId = (await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='crv-tipo-disco'")).rows[0]?.id;
    if (!sourceId) throw new Error("Falta la fuente de inferencias crv-tipo-disco");
    const typeChanges: Array<{ albumId: number; oldType: string; newType: string; note: string }> = [];
    const added: Array<{ albumId: number; label: string; title: string }> = [];
    for (const item of targets) {
      const row = current.get(item.albumId)!;
      if (row.title !== item.title) throw new Error(`El título cambió desde la auditoría: ${item.albumId}`);
      if (row.type !== item.albumType && row.type !== item.newType) throw new Error(`El tipo cambió desde la auditoría: ${item.albumId} (${row.type})`);
      const url = row.youtube_url ?? row.wordpress_url ?? `crv-fuente://catalogo/album/${item.albumId}`;
      const excerpt = `[título] ${item.title}; ${item.note}`;
      if (item.newType && row.type !== item.newType) {
        if (row.type !== "other") throw new Error(`No se sustituye un tipo concreto: ${item.albumId}`);
        await updateEntity({ ...context, note: `${context.note} ${excerpt}` }, "album", item.albumId, { album_type: item.newType });
        await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
          SELECT id,$3,$4,1,$5 FROM ingest.claims WHERE run_id=$1 AND album_id=$2 AND field='album_type'
          ON CONFLICT DO NOTHING`, [runId, item.albumId, url, excerpt, hash([url, excerpt])]);
        typeChanges.push({ albumId: item.albumId, oldType: row.type, newType: item.newType, note: item.note });
      }
      for (const label of item.labels) {
        const inserted = await client.query(`INSERT INTO ingest.album_classifications(album_id,classification,position,inferred)
          VALUES($1,$2,coalesce((SELECT max(position) FROM ingest.album_classifications WHERE album_id=$1),0)+1,true)
          ON CONFLICT(album_id,classification) DO NOTHING RETURNING id`, [item.albumId, label]);
        if (!inserted.rowCount) continue;
        const claim = (await client.query<{ id: string }>(`INSERT INTO ingest.claims(
          source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,
          confidence,status,created_by,run_id,notes,identity_key)
          VALUES($1,'album',$2,'album_classification',to_jsonb($3::text),to_jsonb($4::text),$5,'clasificacion-titulo','1',
            'medium','accepted','system',$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id::text`,
        [sourceId, item.albumId, item.title, label, hash(["clasificacion-titulo", item.albumId, item.title, label]), runId, item.note, `tipo-disco:album:${item.albumId}`])).rows[0];
        if (claim) await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
          VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`, [claim.id, url, excerpt, hash([url, excerpt])]);
        added.push({ albumId: item.albumId, label, title: item.title });
      }
    }
    const counters = { typeChanges: typeChanges.length, classifications: added.length, targets: targets.length };
    await client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1", [runId, JSON.stringify(counters)]);
    return { ...counters, typeChanges, added, mixed: targets.filter(item => item.albumId === 2006 || item.albumId === 2018) };
  }, { rollbackOnly: !confirm });
  writeFileSync(`${OUT}/resultado-${mode}.json`, JSON.stringify({ mode, ...outcome }, null, 2) + "\n");
  console.log(JSON.stringify({ mode, runId: outcome.runId, typeChanges: outcome.result.typeChanges.length, classifications: outcome.result.added.length, out: OUT }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
