// RYM «nuevos» · géneros de la 2.ª lista sin mapear (generos-sin-mapear-2.mts, run 17915) que no entraron
// porque la ficha ya tenía principal. Brian 2026-10-06: «solo fichas que clasificó RYM» y «corregir la
// principal». Por ficha con algún género confirmado por auto:rateyourmusic:
//   * cada término de la lista que ahora resuelve entra como secundario (confirmGenre, auto:rateyourmusic);
//   * si es el PRIMERO que nombra RYM y la principal actual la puso RYM, pasa a principal (la anterior,
//     a secundario); también si es hijo de la principal actual (más específico; si no, la familia quedaría
//     superseded y la ficha sin principal);
//   * una principal decidida por una persona nunca se toca.
// Un run reversible por lote (--batch=150 fichas); sin --confirm se revierte.
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/rym-nuevos-aplicar/secundarios-rym.mts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { GENRE_COLUMN, GENRE_TABLE, loadTaxonomy } from "../../src/genres/store.js";
import { resolveGenreValue, type Taxonomy } from "../../src/genres/taxonomy.js";
import { confirmGenre } from "../../src/genres/human.js";

type Kind = "album" | "artist";
interface Ficha { kind: Kind; id: number; url: string; terms: string[] }
const D = "reports/rym-nuevos-aplicacion-2026-10-05";
const confirm = process.argv.includes("--confirm");
const LOTE = Number(process.argv.find((a) => a.startsWith("--batch="))?.slice(8) ?? 150);
const LISTA = new Set((JSON.parse(readFileSync(`${D}/generos-sin-mapear-2.json`, "utf8")) as Array<{ termino: string }>).map((x) => x.termino));
const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const vistas = new Set<string>();
const fichas: Ficha[] = [];
const push = (f: Ficha) => { const k = `${f.kind}:${f.id}`; if (!vistas.has(k) && f.terms.some((t) => LISTA.has(t))) { vistas.add(k); fichas.push(f); } };
for (const x of lines(`${D}/plan-discos.jsonl`)) if (x.estado === "ya_existe" && x.generos?.length) push({ kind: "album", id: x.album_id, url: x.url, terms: x.generos });
for (const x of lines(`${D}/completar-generos-artistas.jsonl`)) push({ kind: "artist", id: x.entityId, url: x.url, terms: x.rawGenres });

const slugOf = (tax: Taxonomy, term: string): string | null => {
  const item = resolveGenreValue(tax, term).items.find((i) => i.kind === "genre");
  return item && item.kind === "genre" ? tax.genres.get(item.genreId)!.slug : null;
};
const ancestro = (tax: Taxonomy, padre: number, hijo: number): boolean => {
  for (let g = tax.genres.get(hijo)?.parentId ?? null; g !== null && g !== undefined; g = tax.genres.get(g)?.parentId ?? null) if (g === padre) return true;
  return false;
};

const informe = { fichas: 0, secundarios: 0, principales: 0, saltadas_sin_rym: 0, detalle: [] as unknown[], errores: [] as unknown[] };
const lotes: Ficha[][] = [];
for (let i = 0; i < fichas.length; i += LOTE) lotes.push(fichas.slice(i, i + LOTE));
for (const [n, lote] of lotes.entries()) {
  try {
    await withOperatorRun({
      name: `claude-code:secundarios-rym lote ${n + 1}/${lotes.length}`, operator: "claude-code (delegado por Brian)",
      note: "Géneros de RYM de la 2.ª lista sin mapear (run 17915) en fichas que clasificó RYM; Brian 2026-10-06",
    }, async (context) => {
      const client = context.client;
      const tax = await loadTaxonomy(client);
      for (const f of lote) {
        const rows = (await client.query<{ genre_id: string; role: string; decided_by: string | null }>(
          `SELECT genre_id::text, role, decided_by FROM ${GENRE_TABLE[f.kind]} WHERE ${GENRE_COLUMN[f.kind]}=$1 AND status='confirmed'`, [f.id])).rows;
        if (!rows.some((r) => r.decided_by === "auto:rateyourmusic")) { informe.saltadas_sin_rym++; continue; }
        await client.query("SAVEPOINT f");
        try {
          const actuales = new Set(rows.map((r) => Number(r.genre_id)));
          let principal = rows.find((r) => r.role === "primary");
          const fila = { kind: f.kind, id: f.id, secundarios: [] as string[], principal: null as string | null };
          for (const [i, term] of f.terms.entries()) {
            if (!LISTA.has(term)) continue;
            const slug = slugOf(tax, term);
            if (!slug) continue;
            const gid = [...tax.genres.values()].find((g) => g.slug === slug)!.id;
            const pid = principal ? Number(principal.genre_id) : null;
            const deRym = principal?.decided_by === "auto:rateyourmusic";
            const aPrincipal = pid !== gid && deRym && (i === 0 || (pid !== null && ancestro(tax, pid, gid)));
            if (actuales.has(gid) && !aPrincipal) continue;
            await client.query("SAVEPOINT g");
            try {
              await confirmGenre(client, { kind: f.kind, entityId: f.id, genreSlug: slug, actor: "auto:rateyourmusic",
                reason: `rateyourmusic nombra «${f.terms.join(" | ")}» en ${f.url} (2.ª lista de términos, run 17915; run ${context.runId})`,
                role: aPrincipal ? "primary" : "secondary", runId: context.runId });
              await client.query("RELEASE SAVEPOINT g");
              actuales.add(gid);
              if (aPrincipal) { fila.principal = slug; principal = { genre_id: String(gid), role: "primary", decided_by: "auto:rateyourmusic" }; }
              else fila.secundarios.push(slug);
            } catch {
              // familia por encima de un hijo ya asignado: el hijo es más preciso, se omite
              await client.query("ROLLBACK TO SAVEPOINT g");
            }
          }
          await client.query("RELEASE SAVEPOINT f");
          if (fila.secundarios.length || fila.principal) {
            informe.fichas++; informe.secundarios += fila.secundarios.length; informe.principales += fila.principal ? 1 : 0;
            informe.detalle.push({ ...fila, runId: context.runId });
          }
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT f");
          informe.errores.push({ kind: f.kind, id: f.id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        }
      }
      if (!confirm) throw new Error("__ensayo__");
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "__ensayo__")) throw error;
  }
}
writeFileSync(`${D}/secundarios-rym-${confirm ? "aplicado" : "ensayo"}.json`, JSON.stringify(informe, null, 1));
const { detalle, ...resumen } = informe;
console.log(JSON.stringify({ modo: confirm ? "aplicado" : "ensayo (revertido)", candidatas: fichas.length, ...resumen, errores: informe.errores.length, ejemplos: informe.errores.slice(0, 3) }));
await closeDb();
