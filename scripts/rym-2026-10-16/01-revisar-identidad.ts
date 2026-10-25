// Revisa con IA la identidad de las fichas tocadas por el run RYM 20262.
// La salida es un informe editorial; nunca cambia el catálogo.
// Uso: tsx scripts/rym-2026-10-16/01-revisar-identidad.ts
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { createDeepSeekGateway } from "../../src/ai/gateway.js";
import { closeDb, getPool } from "../../src/db/client.js";

const OUT = "reports/rym-resto-2026-10-16/revision-identidad-20262-completa.jsonl";
const V4 = "reports/rym-v4-resto-2026-10-16/artistas.jsonl";
const schema = z.object({
  identity: z.enum(["same", "different", "uncertain"]),
  venezuelanConnection: z.enum(["documented", "possible", "unsupported"]),
  explanation: z.string().min(15).max(1800),
  evidence: z.array(z.string().min(4).max(500)).max(8),
});

interface SourceArtist {
  nombre: string; formed: string | null; info: Record<string, string>;
  discografia_listada: Array<{ t: string; y: string | null; ty: string }>;
}
interface Artist {
  id: string; name: string; biography: string | null; origin_country: string | null;
  origin_city: string | null; formed_year: number | null;
}
function key(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

async function main(): Promise<void> {
  const pool = getPool();
  const jobs = JSON.parse(readFileSync("reports/rym-resto-2026-10-16/artista-ensayo.json", "utf8")) as {
    trabajos: Array<{ artistId: number }>;
  };
  const ids = [...new Set(jobs.trabajos.map((job) => job.artistId))];
  const artists = (await pool.query<Artist>(
    "SELECT id::text,name,biography,origin_country,origin_city,formed_year FROM public.artists WHERE id=ANY($1::bigint[])", [ids],
  )).rows;
  const changes = (await pool.query<{ artist_id: string; field: string; old_value: unknown }>(
    "SELECT artist_id::text,field,old_value FROM ingest.merge_audit WHERE run_id=20262 AND artist_id=ANY($1::bigint[]) AND field IN ('origin_city','formed_year')", [ids],
  )).rows;
  const before = new Map<string, unknown>();
  for (const change of changes) before.set(`${change.artist_id}:${change.field}`, change.old_value);
  const albums = (await pool.query<{ artist_id: string; title: string; release_year: number | null }>(
    "SELECT artist_id::text,title,release_year FROM public.albums WHERE artist_id=ANY($1::bigint[]) ORDER BY release_year NULLS LAST,id", [ids],
  )).rows;
  const titles = new Map<number, string[]>();
  for (const a of albums) {
    const id = Number(a.artist_id);
    const list = titles.get(id) ?? [];
    if (list.length < 12) list.push(`${a.title}${a.release_year ? ` (${a.release_year})` : ""}`);
    titles.set(id, list);
  }
  const source = new Map<string, SourceArtist[]>();
  for (const line of readFileSync(V4, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as SourceArtist;
    source.set(key(r.nombre), [...(source.get(key(r.nombre)) ?? []), r]);
  }
  const done = new Set<number>();
  if (existsSync(OUT)) for (const line of readFileSync(OUT, "utf8").split("\n").filter(Boolean)) {
    try { const row = JSON.parse(line) as { artistId: number }; done.add(row.artistId); } catch { /* línea incompleta */ }
  }
  const gateway = createDeepSeekGateway();
  const pending = artists.filter((a) => !done.has(Number(a.id)));
  console.log(`run 20262: ${artists.length} artistas · ${pending.length} pendientes`);
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (a) => {
      const matches = source.get(key(a.name)) ?? [];
      const rym = matches.length === 1 ? matches[0] : null;
      const input = {
        catalog: { id: Number(a.id), name: a.name, biography: a.biography?.slice(0, 3500) ?? null,
          originCountry: a.origin_country,
          originCityBeforeRun: before.has(`${a.id}:origin_city`) ? before.get(`${a.id}:origin_city`) : a.origin_city,
          formedYearBeforeRun: before.has(`${a.id}:formed_year`) ? before.get(`${a.id}:formed_year`) : a.formed_year,
          albums: titles.get(Number(a.id)) ?? [] },
        rym: rym ? { name: rym.nombre, formed: rym.formed, info: rym.info,
          releases: rym.discografia_listada?.slice(0, 16).map((d) => `${d.t} (${d.y ?? "s/f"}, ${d.ty})`) ?? [] } : null,
      };
      if (!rym) return { artistId: Number(a.id), name: a.name, verdict: null, error: "ficha RYM no única o ausente" };
      try {
        const result = await gateway.propose({
          taskKind: "hard_entity_resolution", modelClass: "fast", schemaVersion: "rym-identity-v1", input,
          instructions: `Compara la ficha del catálogo con la ficha RYM y decide si son el MISMO artista. El nombre igual no prueba identidad. Prioriza biografía, integrantes, discos, años y trayectoria. originCityBeforeRun y formedYearBeforeRun son los valores ANTERIORES al run RYM; si son null, no hay prueba previa en esos campos. El país de origen del catálogo puede ser un valor por defecto y tampoco es prueba suficiente. Evalúa por separado la relación con Venezuela: puede ser venezolano por nacionalidad, carrera o vínculo documentado aunque haya nacido o vivido en otro país; puede tener doble nacionalidad (como Rada). Una ciudad extranjera por sí sola NO demuestra otra identidad ni ausencia de vínculo venezolano. Si falta evidencia independiente del nombre, responde uncertain. En evidence incluye fragmentos breves presentes literalmente en el input; no inventes fuentes.`,
          responseSchema: schema,
        });
        return { artistId: Number(a.id), name: a.name, verdict: result.proposal, aiRunId: result.runId ?? null, model: result.model };
      } catch (error) {
        return { artistId: Number(a.id), name: a.name, verdict: null, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    for (const row of results) {
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(`${row.artistId} ${row.name}: ${row.verdict?.identity ?? "error"}`);
    }
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
