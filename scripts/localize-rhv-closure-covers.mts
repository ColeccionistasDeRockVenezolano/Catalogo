/** Point only the newly adjudicated albums at verified, already published captures. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun, updateEntity } from "../src/merge/operator.js";
const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env["HOME"]}/crv-staging/`)) throw new Error("Informe en staging SSD");
const covers = JSON.parse(readFileSync(path.join(root, "covers.json"), "utf8")) as Array<{ sourceUrl: string; localUrl?: string; sha256: string }>;
const primary = JSON.parse(readFileSync(path.join(root, "primary-covers.json"), "utf8")) as Array<{ albumId: number; expectedCover: string | null; sourceUrl: string; localUrl: string; sha256: string }>;
const wanted = new Set<number>();
for (const name of ["primary-compilation-decisions-applied.json", "distinct-compilation-decisions-applied.json"]) {
  const applied = JSON.parse(readFileSync(path.join(root, name), "utf8"));
  if (!applied.confirmed) throw new Error("Sólo decisiones aplicadas");
  for (const decision of applied.decisions) if (decision.verdict === "confirmed" && decision.target?.kind === "album_credit") wanted.add(decision.target.albumId);
}
const confirm = process.argv.includes("--confirm");
try {
  const outcome = await withOperatorRun({ name: "rhv:localize-closure-covers", operator: "codex", note: "Portadas de las ediciones documentadas en el cierre RHV; capturas publicadas y verificadas en el disco de 1 TB", params: { albums: wanted.size } }, async context => {
    const albums = (await context.client.query<{ id: number; cover: string | null }>("SELECT id::int,cover_url cover FROM ingest.catalog_albums WHERE id=ANY($1::bigint[]) FOR SHARE", [[...wanted]])).rows;
    if (albums.length !== wanted.size) throw new Error("Falta una edición adjudicada");
    const changed = [];
    for (const album of albums) {
      const preferred = primary.find(c => c.albumId === album.id);
      if (preferred && album.cover !== preferred.expectedCover && album.cover !== preferred.localUrl) throw new Error(`Cambió la carátula: ${album.id}`);
      const capture = preferred ?? covers.find(c => c.sourceUrl === album.cover || c.localUrl === album.cover);
      if (!capture?.localUrl || !["/crv/media/rhv-cierre-incidencias-2026-10-29/", "/crv/media/rhv-cierre-portadas-primarias-2026-10-30/"].some(prefix => capture.localUrl!.startsWith(prefix))) throw new Error(`Carátula modificada o captura ausente: ${album.id}`);
      const file = path.join("web/public/media", capture.localUrl.slice("/crv/media/".length));
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== capture.sha256) throw new Error("Captura no publicada o modificada");
      if (album.cover === capture.localUrl) continue;
      await updateEntity(context, "album", album.id, { cover_url: capture.localUrl });
      changed.push({ albumId: album.id, sourceUrl: album.cover, localUrl: capture.localUrl });
    }
    return changed;
  }, { rollbackOnly: !confirm });
  writeFileSync(path.join(root, confirm ? "localized-covers-applied.json" : "localized-covers-rehearsal.json"), JSON.stringify({ confirmed: confirm, ...outcome }, null, 2));
  console.log(JSON.stringify({ confirmed: confirm, runId: outcome.runId, changed: outcome.result.length }));
} finally { await closeDb(); }
