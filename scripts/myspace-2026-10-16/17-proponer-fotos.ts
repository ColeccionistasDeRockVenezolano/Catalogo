// Publica los claims históricos de fotos en Curaduría · Portadas y fotos.
// Las copias verificadas tienen vista previa local; una URL antigua sin copia
// queda visible como candidata documental, pero la UI impide elegirla.
// Uso: tsx scripts/myspace-2026-10-16/17-proponer-fotos.ts [--confirm]
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { proposeImageCandidate } from "../../src/merge/image-candidates.js";

interface PhotoRow {
  artistId: number;
  banda: string;
  fotoUrl: string;
  snapshotUrl: string;
  archivo: string;
  sha256: string;
}

const ledger = "reports/myspace-2026-10-16/claims-fotos.jsonl";
const confirm = process.argv.includes("--confirm");
const rows = readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as PhotoRow);
const mediaDir = path.resolve("web/public/media/myspace-wayback");
// Respuesta visual genérica del CDN de MySpace/Wayback: cuadro gris 90×90.
// Aparece en 25 filas de la cosecha y no es una foto del artista.
const PLACEHOLDER_SHA256 = "e6c6d88041d56bce30731b1caea6be809dd05c6cc4ca16beec5c731f73522582";

function preview(row: PhotoRow): string | null {
  if (!row.archivo || !existsSync(row.archivo)) return null;
  const content = readFileSync(row.archivo);
  const digest = createHash("sha256").update(content).digest("hex");
  if (digest !== row.sha256) throw new Error(`Copia de ${row.banda} no coincide con su sha256: ${row.archivo}`);
  if (digest === PLACEHOLDER_SHA256) return null;
  const ext = path.extname(row.archivo).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) throw new Error(`Formato de imagen no admitido: ${row.archivo}`);
  const file = `${digest}${ext}`;
  if (confirm) {
    mkdirSync(mediaDir, { recursive: true });
    if (!existsSync(path.join(mediaDir, file))) copyFileSync(row.archivo, path.join(mediaDir, file));
  }
  return `/crv/media/myspace-wayback/${file}`;
}

async function main(): Promise<void> {
  const pool = getPool();
  const live = await pool.query<{ id: string; picture_url: string | null }>(
    "SELECT id::text, picture_url FROM public.artists WHERE id=ANY($1::bigint[])",
    [[...new Set(rows.map((row) => row.artistId))]],
  );
  const artists = new Map(live.rows.map((row) => [Number(row.id), row.picture_url]));
  const prepared = rows.map((row) => ({ row, url: preview(row) }));
  const usable = prepared.filter(({ url }) => url).length;
  console.log(`${rows.length} fotos históricas · ${usable} copias locales · ${artists.size} artistas existentes`);
  if (!confirm) { console.log("ensayo; usar --confirm para proponerlas"); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:myspace-fotos-curaduria",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Fotos históricas de MySpace/Wayback propuestas en Curaduría; las URLs sin copia local son documentales y no se pueden elegir.",
  }, async (context) => {
    const count = { proposed: 0, already: 0, known: 0, missingArtist: 0, withPreview: 0, withoutPreview: 0 };
    for (const { row, url } of prepared) {
      if (!artists.has(row.artistId)) { count.missingArtist++; continue; }
      // Si una copia resultó ser el cuadro gris de MySpace, conservar la
      // decisión ya tomada sobre esa candidata; no reabrirla con la URL cruda.
      const oldLocalUrl = row.archivo && row.sha256
        ? `/crv/media/myspace-wayback/${row.sha256}${path.extname(row.archivo).toLowerCase()}` : null;
      const previous = await context.client.query(`
        SELECT 1 FROM ingest.image_candidates
         WHERE artist_id=$1 AND origin='myspace-wayback-2026-10-16'
           AND candidate_url=ANY($2::text[]) LIMIT 1`,
      [row.artistId, [row.fotoUrl, oldLocalUrl].filter(Boolean)]);
      if (previous.rowCount) { count.already++; continue; }
      const claim = await context.client.query<{ id: string }>(`
        SELECT id::text FROM ingest.claims
         WHERE artist_id=$1 AND field='picture_url' AND extractor='perfil-myspace-wayback'
           AND COALESCE(normalized_value,raw_value) #>> '{}' = $2
         ORDER BY id DESC LIMIT 1`, [row.artistId, row.fotoUrl]);
      const result = await proposeImageCandidate(context.client, {
        kind: "artist",
        targetId: row.artistId,
        currentUrl: artists.get(row.artistId) ?? null,
        candidateUrl: url ?? row.fotoUrl,
        ...(claim.rows[0] ? { claimId: Number(claim.rows[0].id) } : {}),
        source: url ? "myspace-wayback" : "myspace-wayback-sin-copia",
        pageUrl: row.snapshotUrl,
        origin: "myspace-wayback-2026-10-16",
        runId: context.runId,
      });
      count[result]++;
      if (url) count.withPreview++; else count.withoutPreview++;
    }
    return count;
  });
  console.log(JSON.stringify({ runId, ...result }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
