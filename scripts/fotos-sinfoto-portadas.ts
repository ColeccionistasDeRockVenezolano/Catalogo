// Foto de ficha desde la portada de su propio disco, cuando no hay otra y en ella
// sale el artista (Brian, 2026-11-01). Rostro comprobado con scripts/image-focus.py
// y confirmado a ojo. Copia el archivo: la portada puede cambiar. UN run; sin --confirm se deshace.
//
//   ./scripts/with-node22.sh npx tsx scripts/fotos-sinfoto-portadas.ts [--confirm]
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { isPlaceholderImageUrl } from "../src/merge/image-candidates.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const PORTADAS = [
  { id: 3475, disco: "Con Alma" },
  { id: 8543, disco: "El Sueño Americano" },
  { id: 8544, disco: "En El Umbral" },
  { id: 8563, disco: "Toda Forma de Amor" },
  { id: 8575, disco: "A Eso Vine" },
];
// Propuestas ya localizadas o sustituidas por su portada: se dan por elegidas.
const ELEGIDAS = [8553, 1961, 3475];
const MANIFEST = "web/public/media/manifest.json";

try {
  const { runId, result } = await withOperatorRun({
    name: "fotos-sinfoto-portadas", operator: "claude-code (pedido de Brian)",
    note: "Foto tomada de la portada del propio disco, donde sale el artista; rostro comprobado con YuNet y a ojo.",
    params: { portadas: PORTADAS.length },
  }, async (context) => {
    const copias: Array<{ id: number; origen: string; destino: string }> = [];
    for (const item of PORTADAS) {
      const { rows } = await context.client.query<{ cover_url: string; picture_url: string | null }>(`
        SELECT al.cover_url, a.picture_url FROM public.albums al JOIN public.artists a ON a.id=al.artist_id
         WHERE al.artist_id=$1 AND al.title=$2 AND al.cover_url LIKE '/crv/media/%' LIMIT 1`, [item.id, item.disco]);
      const row = rows[0];
      if (!row) throw new Error(`sin portada local: ${item.id} «${item.disco}»`);
      if (row.picture_url !== null) throw new Error(`la ficha ${item.id} ya tiene imagen`);
      if (isPlaceholderImageUrl(row.cover_url)) throw new Error(`marcador en ${item.id}`);
      const origen = `web/public/media/${row.cover_url.slice("/crv/media/".length).split("?")[0]}`;
      const destino = `web/public/media/artist/${item.id}${path.extname(origen)}`;
      await updateEntity(context, "artist", item.id, { picture_url: `/crv/media/artist/${path.basename(destino)}` });
      copias.push({ id: item.id, origen, destino });
    }
    const elegidas = await context.client.query(`
      UPDATE ingest.image_candidates SET status='chosen',decided_by=$1,decided_at=now(),decision_run_id=$2
       WHERE origin='fotos-sinfoto-2026-11-01' AND status='open' AND artist_id=ANY($3::bigint[])`,
    [context.operator, context.runId, ELEGIDAS]);
    return { copias, elegidas: elegidas.rowCount };
  }, { rollbackOnly: !CONFIRM }).then((outcome) => {
    if (CONFIRM) {
      const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { entries: Record<string, Record<string, unknown>> };
      for (const copia of outcome.result.copias) {
        copyFileSync(copia.origen, copia.destino);
        const entry = manifest.entries[`artist:${copia.id}`];
        if (entry) {
          entry["localPath"] = copia.destino.replace("web/public/", "");
          entry["sourceUrl"] = `catalogo:${copia.origen}`;
        }
      }
      writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return outcome;
  });
  process.stdout.write(`${JSON.stringify({ runId, confirm: CONFIRM, copias: result.copias.length, elegidas: result.elegidas })}\n`);
} finally {
  await closeDb();
}
