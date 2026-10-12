// Plan Aqustico · corrección de géneros sin sentido (pedido de Brian del 2026-10-12).
//
// La etiqueta «Alternativa» de Aqustico es «música alternativa» en sentido
// amplio: con el alias de D2 (→ rock-alternativo) los 43 discos que la usaban
// quedaron mal (Irepelusa es R&B/pop urbano; Motherflowers, hip hop con fusión
// tropical, según la prensa y los demás discos de cada uno en CRV). Aquí el
// género correcto se confirma como principal y el de Aqustico se rechaza, por el
// mismo camino que la Mesa de géneros (decisión humana: ninguna regla lo reabre).
// Todo en UN run (`brian`), reversible con `crv runs undo <run>`. Sin --confirm
// corre entero y se deshace.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/corregir-generos.mts [--confirm]
import { writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { confirmGenre, rejectGenre } from "../../src/genres/human.js";
import { lockGenres } from "../../src/genres/store.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/aqustico-2026-10";

interface Arreglo { artista: string; desde: string; hacia: string; motivo: string; soloTitulos?: string[] }

const ARREGLOS: Arreglo[] = [
  { artista: "Irepelusa", desde: "rock-alternativo", hacia: "r-and-b",
    motivo: "«Alternativa» de Aqustico no es rock: Irepelusa hace pop urbano/R&B (prensa: El Universal, NTN24; sus demás discos en CRV: R&B)" },
  { artista: "Motherflowers", desde: "rock-alternativo", hacia: "hip-hop",
    motivo: "«Alternativa» de Aqustico no es rock: Motherflowers es un trío de hip hop con fusión tropical (Indie Hoy; sus demás discos en CRV: hip hop)" },
  { artista: "Motherflowers", desde: "world-ethnic", hacia: "hip-hop", soloTitulos: ["Turromantik"],
    motivo: "«Del Mundo» de Aqustico es una etiqueta vaga: Motherflowers es hip hop con fusión tropical (Indie Hoy)" },
  { artista: "Francisco Montoya", desde: "musica-tradicional", hacia: "joropo", soloTitulos: ["El Moderno Florentino"],
    motivo: "«Tradicional Venezolana» de Aqustico: Francisco Montoya es cantante llanero; joropo es el término preciso (sus demás discos en CRV)" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const report = { mode: confirm ? "confirm" : "dry-run", runId: 0,
    cambios: [] as Array<{ albumId: number; artista: string; titulo: string; desde: string; hacia: string; rechazado: boolean }> };
  const { runId } = await withOperatorRun({
    name: "aqustico_genre_fix", operator: "brian",
    note: "Plan Aqustico: corregir los géneros de Aqustico que no tienen sentido (pedido de Brian, 2026-10-12)",
    params: { plan: "~/Desktop/PLAN_AQUSTICO_2026-10-12.md", confirm },
  }, async ({ client, runId: run }) => {
    report.runId = run;
    await lockGenres(client);
    for (const arreglo of ARREGLOS) {
      // Solo los discos cuyo principal vino de Aqustico con el género equivocado.
      const discos = (await client.query<{ id: string; title: string }>(`
        SELECT al.id::text, al.title FROM ingest.album_genres ag
          JOIN ingest.genres g ON g.id = ag.genre_id
          JOIN public.albums al ON al.id = ag.album_id
          JOIN public.artists ar ON ar.id = al.artist_id
         WHERE ag.decided_by = 'auto:aqustico' AND ag.role = 'primary' AND ag.status = 'confirmed'
           AND g.slug = $1 AND ar.name = $2 AND ($3::text[] IS NULL OR al.title = ANY($3::text[]))
         ORDER BY al.id`, [arreglo.desde, arreglo.artista, arreglo.soloTitulos ?? null])).rows;
      for (const disco of discos) {
        const base = { kind: "album" as const, entityId: Number(disco.id), actor: "brian", reason: arreglo.motivo, runId: run };
        await confirmGenre(client, { ...base, genreSlug: arreglo.hacia, role: "primary" });
        // Si el de Aqustico era la familia del nuevo, confirmGenre ya lo dejó «superseded».
        const vivo = await client.query(`
          SELECT 1 FROM ingest.album_genres ag JOIN ingest.genres g ON g.id = ag.genre_id
           WHERE ag.album_id = $1 AND g.slug = $2 AND ag.status = 'confirmed'`, [disco.id, arreglo.desde]);
        if (vivo.rowCount) await rejectGenre(client, { ...base, genreSlug: arreglo.desde });
        report.cambios.push({ albumId: Number(disco.id), artista: arreglo.artista, titulo: disco.title,
          desde: arreglo.desde, hacia: arreglo.hacia, rechazado: Boolean(vivo.rowCount) });
      }
    }
  }, { rollbackOnly: !confirm });
  const out = `${DIR}/genero-correccion-${report.mode}-run${runId}.json`;
  writeFileSync(out, JSON.stringify(report, null, 1));
  const porArtista = new Map<string, number>();
  for (const c of report.cambios) porArtista.set(`${c.artista} ${c.desde}→${c.hacia}`, (porArtista.get(`${c.artista} ${c.desde}→${c.hacia}`) ?? 0) + 1);
  console.log(`géneros Aqustico corregidos (${report.mode}, run ${runId}): ${report.cambios.length} discos → ${out}`);
  for (const [k, n] of porArtista) console.log(`  ${n} · ${k}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
