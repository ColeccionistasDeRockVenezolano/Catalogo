// Fotos halladas para las fichas que tenían el marcador «sin foto» de RHV: usa
// dos fotos del archivo propio, ya verificadas, y propone las dudosas en
// Curaduría · Portadas y fotos. UN run; sin --confirm se deshace.
//
//   ./scripts/with-node22.sh npx tsx scripts/fotos-sinfoto-curaduria.ts --propuestas=<json> [--confirm]
import { readFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { proposeImageCandidate } from "../src/merge/image-candidates.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

interface Propuesta { id: number; img: string; page: string | null; source: string; why: string }
const CONFIRM = process.argv.includes("--confirm");
const file = process.argv.find((item) => item.startsWith("--propuestas="))?.slice("--propuestas=".length);
if (!file) throw new Error("falta --propuestas=<json>");
const propuestas = JSON.parse(readFileSync(file, "utf8")) as Propuesta[];

const ARCHIVO = [
  { id: 1887, url: "/crv/media/hermes-importacion-integral-2026-10-24/83/83f188bfc046cc9929899d1cea7f8eaa12bb26f483934756ef9a143ef856e3e4.jpg" },
  { id: 119, url: "/crv/media/hermes-importacion-integral-2026-10-24/06/061726108ae746db22991b678ce82bd6346239efe1344b70f2f74b2f8c501d5d.jpg" },
];

try {
  const { runId, result } = await withOperatorRun({
    name: "fotos-sinfoto", operator: "claude-code (pedido de Brian)",
    note: "Fotos reales para fichas que tenían el marcador «sin foto» de RHV: Caña Loca y Joystick desde su galería; las dudosas o tomadas de portadas, a Curaduría.",
    params: { propuestas: propuestas.length },
  }, async (context) => {
    for (const foto of ARCHIVO) {
      const { rows } = await context.client.query<{ picture_url: string | null }>("SELECT picture_url FROM public.artists WHERE id=$1", [foto.id]);
      if (rows[0]?.picture_url !== null) throw new Error(`la ficha ${foto.id} ya tiene imagen`);
      await updateEntity(context, "artist", foto.id, { picture_url: foto.url });
    }
    let propuestasNuevas = 0;
    for (const item of propuestas) {
      const outcome = await proposeImageCandidate(context.client, {
        kind: "artist", targetId: item.id, currentUrl: null, candidateUrl: item.img, source: item.source,
        pageUrl: item.page, origin: "fotos-sinfoto-2026-11-01", runId: context.runId, context: item.why,
      });
      if (outcome === "proposed") propuestasNuevas += 1;
    }
    return { archivo: ARCHIVO.length, propuestasNuevas };
  }, { rollbackOnly: !CONFIRM });
  process.stdout.write(`${JSON.stringify({ runId, confirm: CONFIRM, ...result })}\n`);
} finally {
  await closeDb();
}
