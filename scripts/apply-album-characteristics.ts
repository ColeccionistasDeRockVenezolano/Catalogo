// Lote autorizado: características y ediciones de los títulos auditados.
// Sin --confirm revierte todo. Repetir el lote confirmado no duplica aportes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { albumTitleCharacteristics, albumTitleEdition } from "../src/normalization/album-characteristics.js";

const AUDIT = "reports/titulos-albumes-2026-10-15/hallazgos.json";
const OUT = "reports/caracteristicas-discos";
const EXTRACTOR = "caracteristicas-titulo";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface Version { id: number; title: string | null; position: number; source: string; notes: string | null; source_ref: string | null; edition_types: string[] }
interface Row { id: number; title: string; type: string; youtube_url: string | null; wordpress_url: string | null; classes: unknown[]; versions: Version[] }

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const mode = confirm ? "confirm" : "dry-run";
  const audit = JSON.parse(readFileSync(AUDIT, "utf8")) as { groups: Array<{ key: string; items: Array<{ albumId: number; title: string }> }> };
  const targets = new Map(audit.groups.filter(group => ["acoustic", "instrumental", "remix", "edition"].includes(group.key))
    .flatMap(group => group.items.map(item => [item.albumId, item.title] as const)));
  if (targets.size !== 268) throw new Error(`Se esperaban 268 discos, hay ${targets.size}`);
  mkdirSync(OUT, { recursive: true });
  const outcome = await withOperatorRun({
    name: "caracteristicas-y-ediciones-titulos", operator: "Brian (Codex)",
    note: "Crear y aplicar acústico, instrumental, remix y ediciones de los títulos auditados, por instrucción explícita de Brian. Inferencias del título, sin verificación externa. Conservar tipos concretos y no inventar fechas de edición.",
    params: { audit: AUDIT, confirm, targets: [...targets.keys()] },
  }, async context => {
    const { client, runId } = context;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:album-characteristics'))");
    const rows = (await client.query<Row>(`SELECT a.id::int,a.title,a.album_type::text AS type,a.youtube_url,a.wordpress_url,
      (SELECT coalesce(json_agg(c ORDER BY c.position,c.id),'[]') FROM ingest.album_classifications c WHERE c.album_id=a.id) AS classes,
      (SELECT coalesce(json_agg(v ORDER BY v.position,v.id),'[]') FROM ingest.album_versions v WHERE v.album_id=a.id) AS versions
      FROM public.albums a WHERE a.id=ANY($1::bigint[]) ORDER BY a.id FOR UPDATE`, [[...targets.keys()]])).rows;
    if (rows.length !== targets.size) throw new Error("Faltan discos de la auditoría");
    writeFileSync(`${OUT}/antes-${mode}.json`, JSON.stringify({ runId, albums: rows }, null, 2) + "\n");
    const sourceId = (await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='crv-tipo-disco'")).rows[0]?.id;
    if (!sourceId) throw new Error("Falta fuente crv-tipo-disco");
    const added: Array<{ albumId: number; classification: string }> = [];
    const typeChanges: Array<{ albumId: number; oldType: string; newType: string }> = [];
    const versions: Array<{ albumId: number; versionId: number; action: string; title: string; editionTypes: string[] }> = [];
    const skippedTypes: Array<{ albumId: number; reason: string }> = [];
    const evidence = async (row: Row, field: string, value: unknown) => {
      const url = row.youtube_url ?? row.wordpress_url ?? `crv-fuente://catalogo/album/${row.id}`;
      const claim = (await client.query<{ id: string }>(`INSERT INTO ingest.claims(
        source_id,entity_kind,album_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,
        confidence,status,created_by,run_id,notes,identity_key)
        VALUES($1,'album',$2,$3,to_jsonb($4::text),$5::jsonb,$6,$7,'1','medium','accepted','system',$8,$9,$10)
        ON CONFLICT DO NOTHING RETURNING id::text`,
      [sourceId, row.id, field, row.title, JSON.stringify(value), hash([EXTRACTOR, row.id, row.title, field, value]), EXTRACTOR, runId,
        "Característica o edición indicada en el título; inferencia autorizada por Brian", `tipo-disco:album:${row.id}`])).rows[0];
      if (claim) await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
        VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`, [claim.id, url, `[título] ${row.title}`, hash([url, row.title])]);
    };
    for (const row of rows) {
      if (row.title !== targets.get(row.id)) throw new Error(`Cambió el título auditado de ${row.id}`);
      const characteristics = albumTitleCharacteristics(row.title);
      const edition = albumTitleEdition(row.title);
      if (characteristics.includes("Remix") && row.type === "other") {
        const sheet = await client.query(`SELECT classification FROM ingest.album_classifications WHERE album_id=$1
          AND NOT inferred AND classification IN ('Studio Album','Single','EP','Demos','Live Album','Compilation Album')`, [row.id]);
        if (sheet.rowCount) skippedTypes.push({ albumId: row.id, reason: "La hoja da otro tipo explícito" });
        else {
          await updateEntity({ ...context, note: `${context.note} [título] ${row.title}` }, "album", row.id, { album_type: "remix" });
          const url = row.youtube_url ?? row.wordpress_url ?? `crv-fuente://catalogo/album/${row.id}`;
          await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
            SELECT id,$3,$4,1,$5 FROM ingest.claims WHERE run_id=$1 AND album_id=$2 AND field='album_type'
            ON CONFLICT DO NOTHING`, [runId, row.id, url, `[título] ${row.title}`, hash([url, row.title])]);
          typeChanges.push({ albumId: row.id, oldType: row.type, newType: "remix" });
        }
      }
      for (const classification of characteristics) {
        const inserted = await client.query(`INSERT INTO ingest.album_classifications(album_id,classification,position,inferred)
          VALUES($1,$2,coalesce((SELECT max(position) FROM ingest.album_classifications WHERE album_id=$1),0)+1,true)
          ON CONFLICT(album_id,classification) DO NOTHING RETURNING id`, [row.id, classification]);
        if (!inserted.rowCount) continue;
        await evidence(row, "album_classification", classification);
        added.push({ albumId: row.id, classification });
      }
      if (!edition) continue;
      const existing = row.versions.find(version => version.title === edition.title)
        ?? (row.versions.length === 1 && row.versions[0]!.source === "albums" && !row.versions[0]!.title && !row.versions[0]!.edition_types.length ? row.versions[0] : undefined);
      const note = `Edición indicada en el título: «${row.title}».`;
      let versionId: number;
      let action: string;
      if (existing) {
        const types = [...new Set([...existing.edition_types, ...edition.types])];
        const notes = existing.notes?.includes(note) ? existing.notes : [existing.notes, note].filter(Boolean).join("\n");
        const updated = await client.query(`UPDATE ingest.album_versions SET title=$2,edition_types=$3,notes=$4
          WHERE id=$1 AND (title,edition_types,notes) IS DISTINCT FROM ($2::text,$3::text[],$4::text) RETURNING id`,
        [existing.id, edition.title, types, notes]);
        if (!updated.rowCount) continue;
        versionId = existing.id;
        action = "updated";
      } else {
        const result = await client.query<{ id: number }>(`INSERT INTO ingest.album_versions(
          album_id,position,title,edition_types,format,notes,is_primary,source,source_ref,run_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,'titulo-disco',$8,$9) RETURNING id::int`,
        [row.id, Math.max(0, ...row.versions.map(version => version.position)) + 1, edition.title, edition.types,
          /\bCD\b/u.test(edition.title) ? "CD" : null, note, !row.versions.length,
          row.youtube_url ?? row.wordpress_url ?? `crv-fuente://catalogo/album/${row.id}`, runId]);
        versionId = result.rows[0]!.id;
        action = "created";
      }
      await evidence(row, "album_version", { title: edition.title, types: edition.types });
      versions.push({ albumId: row.id, versionId, action, title: edition.title, editionTypes: edition.types });
    }
    const counters = { targets: rows.length, classifications: added.length, typeChanges: typeChanges.length, versions: versions.length };
    await client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1", [runId, JSON.stringify(counters)]);
    return { ...counters, added, typeChanges, versions, skippedTypes };
  }, { rollbackOnly: !confirm });
  writeFileSync(`${OUT}/resultado-${mode}.json`, JSON.stringify({ mode, ...outcome }, null, 2) + "\n");
  console.log(JSON.stringify({ mode, runId: outcome.runId, targets: outcome.result.targets, classifications: outcome.result.classifications, typeChanges: outcome.result.typeChanges.length, versions: outcome.result.versions.length }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
