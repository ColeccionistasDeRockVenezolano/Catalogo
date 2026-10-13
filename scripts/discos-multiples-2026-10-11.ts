// CRV · Discos múltiples en una página (Brian, 2026-10-11).
//
// Los discos partidos en varias fichas (Lado A/B, CD I/II, Disco A/B, DVD,
// volúmenes del mismo año, reediciones en otro formato) pasan a UNA ficha con
// una lista de pistas por disco, cada una con el nombre de la fuente
// (`public.album_discs`, 0063). El plan lo arma
// scripts/discos-multiples-2026-10-11-plan.py y vive en
// reports/discos-multiples-2026-10-11/plan.json. Operaciones por grupo:
//   label             nombre de un disco (upsert en album_discs)
//   merge             fusión de fichas: `match` empareja pistas (duplicados y
//                     reediciones con la misma lista), `append` suma los discos
//                     del que desaparece detrás de los del que queda
//   rename            título nuevo; el anterior queda como alias
//   layout_by_number  reparte las pistas de una ficha plana en discos según
//                     su número actual ([[1,2,3],[4,5]] → disco 1 y disco 2)
//   move_disc         cambia el número de disco de todas sus pistas
// Cada grupo va en su SAVEPOINT: uno que falla no arrastra a los demás.
// Sin --confirm todo corre en un run que se revierte (ensayo).
//
// Otras tandas con el mismo formato de plan: --dir=<carpeta con plan.json>; el
// plan puede traer `title` y `note` propios (B-Sides, 2026-10-13).
//
//   ./scripts/with-node22.sh npx tsx scripts/discos-multiples-2026-10-11.ts [--confirm] [--only=<texto del grupo>] [--dir=reports/…]
import { readFileSync, writeFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { closeDb } from "../src/db/client.js";
import { createAlias, promotePrimaryAlias } from "../src/api/repositories/aliases.js";
import { mergeAlbums, previewAlbumMerge, type AlbumMergeMode } from "../src/merge/album-merge.js";
import { updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

type Step =
  | { op: "label"; album: number; disc: number; title: string }
  | { op: "merge"; keep: number; drop: number; mode: AlbumMergeMode }
  | { op: "rename"; album: number; title: string }
  | { op: "layout_by_number"; album: number; discs: number[][] }
  | { op: "move_disc"; album: number; from: number; to: number };
interface Group { name: string; why: string; steps: Step[] }

const DIR = process.argv.find((item) => item.startsWith("--dir="))?.slice(6) ?? "reports/discos-multiples-2026-10-11";
const confirm = process.argv.includes("--confirm");
const only = process.argv.find((item) => item.startsWith("--only="))?.slice(7);
const plan = JSON.parse(readFileSync(`${DIR}/plan.json`, "utf8")) as { groups: Group[]; doubts: string[]; title?: string; note?: string };
const groups = plan.groups.filter((group) => !only || group.name.includes(only));
const NOTE = plan.note ?? "Discos múltiples 2026-10-11: los discos partidos en varias fichas van en una página con una lista por disco (Brian)";
const TITLE = plan.title ?? "Discos múltiples 2026-10-11";

async function tracksOf(client: PoolClient, album: number): Promise<Array<{ id: number; disc: number; num: number; title: string }>> {
  return (await client.query<{ id: string; disc_number: number; track_number: number; title: string }>(
    "SELECT id::text, disc_number, track_number, title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number, track_number", [album],
  )).rows.map((row) => ({ id: Number(row.id), disc: row.disc_number, num: row.track_number, title: row.title }));
}

async function step(context: OperatorContext, s: Step, log: string[]): Promise<void> {
  const { client } = context;
  switch (s.op) {
    case "label":
      await client.query(`
        INSERT INTO public.album_discs(album_id, disc_number, title, notes) VALUES($1,$2,$3,$4)
        ON CONFLICT (album_id, disc_number) DO UPDATE SET title=EXCLUDED.title`,
      [s.album, s.disc, s.title, `${NOTE} (run ${context.runId})`]);
      log.push(`  disco ${s.disc} de ${s.album} = «${s.title}»`);
      return;
    case "rename": {
      const old = (await client.query<{ title: string }>("SELECT title FROM public.albums WHERE id=$1", [s.album])).rows[0];
      if (!old) throw new Error(`álbum ${s.album} inexistente`);
      if (old.title === s.title) return;
      const exists = await client.query("SELECT 1 FROM ingest.album_aliases WHERE album_id=$1 AND alias=$2", [s.album, old.title]);
      if (!exists.rowCount) await createAlias(context, "album", s.album, { alias: old.title, aliasType: "alternate_title", isPrimary: false });
      await updateEntity(context, "album", s.album, { title: s.title });
      // El alias principal (⭐) de un disco es su título: pasa al nuevo.
      await promotePrimaryAlias(context, "album", s.album, s.title, "alternate_title");
      log.push(`  ${s.album}: «${old.title}» → «${s.title}» (el anterior queda como alias)`);
      return;
    }
    case "layout_by_number": {
      const tracks = await tracksOf(client, s.album);
      const wanted = s.discs.flat();
      if (tracks.some((t) => t.disc !== 1) || tracks.length !== wanted.length || new Set(wanted).size !== wanted.length
        || wanted.some((n) => !tracks.some((t) => t.num === n))) {
        throw new Error(`layout de ${s.album}: las pistas (${tracks.map((t) => `${t.disc}.${t.num}`).join(" ")}) no cuadran con ${JSON.stringify(s.discs)}`);
      }
      await client.query("UPDATE public.tracks SET track_number=track_number+10000 WHERE album_id=$1", [s.album]);
      for (const [d, numbers] of s.discs.entries()) {
        for (const [i, n] of numbers.entries()) {
          await client.query("UPDATE public.tracks SET disc_number=$1, track_number=$2 WHERE album_id=$3 AND track_number=$4",
            [d + 1, i + 1, s.album, n + 10000]);
        }
      }
      log.push(`  ${s.album}: pistas repartidas en ${s.discs.length} discos (${s.discs.map((d) => d.length).join(" + ")})`);
      return;
    }
    case "move_disc": {
      const taken = await client.query("SELECT 1 FROM public.tracks WHERE album_id=$1 AND disc_number=$2", [s.album, s.to]);
      if (taken.rowCount && s.from !== s.to) throw new Error(`move_disc ${s.album}: el disco ${s.to} ya tiene pistas`);
      await client.query("UPDATE public.tracks SET disc_number=$1 WHERE album_id=$2 AND disc_number=$3", [s.to, s.album, s.from]);
      return;
    }
    case "merge": {
      const preview = await previewAlbumMerge(client, s.keep, s.drop, { mode: s.mode });
      const loose = preview.matchedTracks.filter((m) => m.matchType === "position");
      log.push(`  ${s.mode === "append" ? "suma" : "funde"} ${s.drop} «${preview.drop.title}» (${preview.drop.tracks.length} pistas) en ${s.keep} «${preview.keep.title}»`
        + (s.mode === "append" ? ` como disco ${preview.discOffset + 1}` : `: ${preview.matchedTracks.length} emparejadas, ${preview.unmatchedDropTracks.length} sueltas`));
      for (const m of loose) log.push(`    ⚠ por posición: ${m.discNumber}.${m.keepTrackNumber} «${m.keepTitle}» ← «${m.dropTitle}»`);
      for (const t of s.mode === "match" ? preview.unmatchedDropTracks : []) log.push(`    ⚠ suelta: ${t.discNumber}.${t.trackNumber} «${t.title}»`);
      for (const w of preview.warnings) log.push(`    · ${w}`);
      for (const c of preview.fieldConflicts) log.push(`    · ${c.field}: queda ${JSON.stringify(c.keepValue)}, ${JSON.stringify(c.dropValue)} va a notas`);
      // La portada distinta del que desaparece la propone mergeInto en
      // Curaduría · Portadas y fotos (regla de imágenes, 0038).
      if (preview.fieldConflicts.some((c) => c.field === "cover_url")) log.push(`    · portada de ${s.drop}: candidata en Curaduría`);
      await mergeAlbums(context, { keepId: s.keep, dropId: s.drop, previewHash: preview.previewHash, keepDropNameAsAlias: true, mode: s.mode });
      return;
    }
  }
}

const report: string[] = [];
const failed: string[] = [];
const { runId } = await withOperatorRun({ name: "curation:album-discs", operator: "claude-code", note: NOTE, params: { groups: groups.length } }, async (context) => {
  for (const group of groups) {
    const log = [`### ${group.name}`, `_${group.why}_`];
    await context.client.query("SAVEPOINT g");
    try {
      for (const s of group.steps) await step(context, s, log);
      const keep = group.steps.find((s) => s.op === "merge")?.keep ?? (group.steps[0] as { album: number }).album;
      const final = await tracksOf(context.client, keep);
      const discs = (await context.client.query<{ disc_number: number; title: string }>(
        "SELECT disc_number, title FROM public.album_discs WHERE album_id=$1 ORDER BY disc_number", [keep])).rows;
      const sizes = [...new Set(final.map((t) => t.disc))].map((d) => `${discs.find((x) => x.disc_number === d)?.title ?? `Disco ${d}`}: ${final.filter((t) => t.disc === d).length}`);
      log.push(`  → ficha ${keep}: ${sizes.join(" · ") || "sin pistas"}`);
      await context.client.query("RELEASE SAVEPOINT g");
    } catch (error) {
      await context.client.query("ROLLBACK TO SAVEPOINT g");
      failed.push(`${group.name}: ${String(error)}`);
      log.push(`  ✗ FALLÓ: ${String(error)}`);
    }
    report.push(log.join("\n"));
  }
}, { rollbackOnly: !confirm });

const head = `# ${TITLE} — ${confirm ? `run ${runId}` : `ensayo (run ${runId} revertido)`}\n\n${groups.length - failed.length}/${groups.length} grupos aplicados.\n`;
writeFileSync(`${DIR}/${confirm ? "aplicado" : "ensayo"}.md`, `${head}\n${report.join("\n\n")}\n\n## Dudas (sin tocar)\n${plan.doubts.map((d) => `- ${d}`).join("\n")}\n`);
console.log(head);
for (const line of failed) console.log("  fallo", line);
await closeDb();
