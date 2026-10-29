// CRV · Duplicados en las membresías y fichas de artista (Brian, 2026-10-26:
// «conserva la ficha con más datos y la que tiene menos datos haz merge, no se
// debe perder nada; intenta no generar claims»).
//
// El plan lo arma el detector (nombres dentro de una misma banda: idénticos,
// abreviados, con iniciales o solo el nombre de pila sin otros proyectos) y se
// aplica en cuatro runs de operador, uno por fase, para deshacer cada uno solo:
//
//   personas     fusiones en la ficha con más datos (la otra queda como alias;
//                bios unidas y marcadas para reescribir, datos cortos a notas);
//                solo se renombra la que queda cuando su nombre era de pila,
//                con iniciales o sin tildes y otra variante lo da completo;
//   separar      fichas que juntan a dos personas («Tony Alda Alejandro
//                Bautista»): la trayectoria se copia a las dos (splitPerson);
//                el nombre repetido («Felipe Pirela Felipe Pirela») se fusiona;
//   artistas     fichas de artista repetidas, con sus discos gemelos;
//   membresias   una fila por persona y etapa en las bandas tocadas y en las
//                que ya tenían filas repetidas;
//   basura       empresas acreditadas como persona → organización; «by X» y
//                «Vers. Esp. X» → la persona X (nota en el crédito); créditos
//                que solo son texto de la fuente («Directed by») se retiran.
//
// Las fusiones y divisiones mueven filas del core con auditoría; solo los
// renombres pasan por updateEntity (claim de corrección humana).
//
//   ./scripts/with-node22.sh npx tsx scripts/fix-membresias-duplicadas-2026-10-26.ts --plan=<plan.json> --out=<dir> [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { mergeEntities, previewEntityMerge } from "../src/merge/entity-merge.js";
import { consolidateMemberships, mergeEquivalentCredits } from "../src/merge/equivalent-relations.js";
import { deleteEntity, updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";
import { combineRoles } from "../src/merge/membership-roles.js";
import { mergeInto } from "../src/review/duplicates.js";
import { removeRelation } from "../src/merge/removals.js";
import { convertPerson, splitPerson } from "../src/review/person-corrections.js";

interface Plan {
  merges: Array<{ keep: number; keepName: string; rename: string | null; drops: Array<{ id: number; name: string; alias: boolean }> }>;
  splits: Array<{ person: number; name: string; op: "split" | "merge"; into: number[] }>;
  artists: Array<{ keep: number; drop: number }>;
  /** Ficha de solo nombre de pila compartida por varias bandas: lo de esta banda pasa al integrante. */
  retargets?: Array<{ from: number; fromName: string; artist: number; artistName: string; to: number; toName: string }>;
  /** Fichas de persona que no son personas o arrastran texto de la fuente. */
  junk?: {
    /** Empresa acreditada como persona: pasa a una organización (existente o nueva, sin claim). */
    organizations: Array<{ person: number; name: string; organization?: number; create?: { name: string; type: string }; creditNote?: string }>;
    /** «by Vytas Brenner», «Vers. Español Rudy Márquez»: a la persona real, con la nota en el crédito. */
    persons: Array<{ person: number; name: string; to: number; creditNote?: string }>;
    renames: Array<{ person: number; name: string; rename: string; creditNote?: string }>;
    /** «Directed by», «Vers. Esp»: créditos sin persona; se retiran con su historia y la ficha se borra. */
    removals: Array<{ person: number; name: string }>;
  };
}

const NOTE = "Duplicados en membresías y fichas de artista (Brian, 2026-10-26)";
const arg = (name: string): string | undefined => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const confirm = process.argv.includes("--confirm");
const plan = JSON.parse(readFileSync(arg("plan") ?? "", "utf8")) as Plan;
const outDir = arg("out") ?? ".";

class DryRun extends Error {
  constructor(readonly payload: unknown) { super("dry-run"); }
}

/** Ficha a la que fue a parar un id tras las fusiones de este mismo script. */
const movedTo = new Map<number, number>();
const resolve = (id: number): number => {
  let current = id;
  while (movedTo.has(current)) current = movedTo.get(current)!;
  return current;
};

async function exists(context: OperatorContext, table: string, id: number): Promise<boolean> {
  return (await context.client.query(`SELECT 1 FROM public.${table} WHERE id=$1`, [id])).rowCount === 1;
}

/**
 * Cada fusión o división va en su propio savepoint: una ficha vetada por la
 * política editorial (PCE01) o un choque de datos deja el resto del lote en pie.
 */
async function guarded(context: OperatorContext, work: () => Promise<string>): Promise<string> {
  await context.client.query("SAVEPOINT item");
  try {
    const outcome = await work();
    await context.client.query("RELEASE SAVEPOINT item");
    return outcome;
  } catch (error) {
    await context.client.query("ROLLBACK TO SAVEPOINT item");
    const code = (error as { code?: string }).code;
    return `omitida (${code === "PCE01" ? "política editorial" : (error as Error).message})`;
  }
}

async function mergePerson(context: OperatorContext, keepId: number, dropId: number, alias: boolean): Promise<string> {
  return guarded(context, async () => {
  const preview = await previewEntityMerge(context.client, "person", keepId, dropId, { lock: true });
  if (preview.eraConflict !== null) return `omitida (trayectorias imposibles: ${preview.eraConflict})`;
  const result = await mergeEntities(context, { kind: "person", keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: alias });
  movedTo.set(dropId, keepId);
  return `${result.moved} filas movidas, ${result.membershipsMerged} membresías y ${result.creditsMerged} créditos unidos${result.preserved.length ? `, conservado: ${result.preserved.join(", ")}` : ""}`;
  });
}

async function persons(context: OperatorContext): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const merge of plan.merges) {
    const keep = resolve(merge.keep);
    const done: unknown[] = [];
    for (const drop of merge.drops) {
      const dropId = resolve(drop.id);
      if (dropId === keep || !(await exists(context, "persons", dropId))) { done.push({ drop: drop.id, outcome: "ya unida" }); continue; }
      done.push({ drop: drop.id, name: drop.name, outcome: await mergePerson(context, keep, dropId, drop.alias) });
    }
    let renamed: string | null = null;
    if (merge.rename && movedTo.size && done.some((item) => String((item as { outcome: string }).outcome).includes("filas movidas"))) {
      const rename = merge.rename;
      renamed = await guarded(context, async () => { await updateEntity(context, "person", keep, { name: rename }); return rename; });
    }
    out.push({ keep, name: merge.keepName, renamed, drops: done });
  }
  return out;
}

async function splits(context: OperatorContext): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const split of plan.splits) {
    const into = [...new Set(split.into.map(resolve))];
    if (!(await exists(context, "persons", split.person))) { out.push({ ...split, outcome: "ya no existe" }); continue; }
    if (into.includes(split.person)) { out.push({ ...split, outcome: "omitida: el destino es la propia ficha" }); continue; }
    if (into.length === 1) {
      out.push({ ...split, into, outcome: await mergePerson(context, into[0]!, split.person, false) });
      continue;
    }
    out.push({ ...split, into, outcome: await guarded(context, async () => (await splitPerson(context.client, split.person, into, context.note, context.runId, split.name)).detail) });
  }
  return out;
}

const titleKey = (title: string): string => title.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();

/** Discos gemelos: mismo título normalizado y mismo año, o un único candidato a ±1 año. */
async function findTwins(context: OperatorContext, keep: number, drop: number): Promise<{ pairs: Array<[number, number]>; doubtful: number[] }> {
  const { rows } = await context.client.query<{ id: string; artist_id: string; title: string; release_year: number | null }>(
    "SELECT id::text, artist_id::text, title, release_year FROM public.albums WHERE artist_id = ANY($1)", [[keep, drop]]);
  const keepAlbums = rows.filter((row) => Number(row.artist_id) === keep);
  const pairs: Array<[number, number]> = [];
  const doubtful: number[] = [];
  const used = new Set<number>();
  for (const album of rows.filter((row) => Number(row.artist_id) === drop)) {
    const same = keepAlbums.filter((other) => titleKey(other.title) === titleKey(album.title) && !used.has(Number(other.id)));
    if (!same.length) continue;
    const exact = same.filter((other) => other.release_year === album.release_year);
    const near = same.filter((other) => other.release_year === null || album.release_year === null || Math.abs(other.release_year - album.release_year) <= 1);
    const twin = exact.length === 1 ? exact[0] : exact.length === 0 && near.length === 1 ? near[0] : undefined;
    if (!twin) { doubtful.push(Number(album.id)); continue; }
    used.add(Number(twin.id));
    pairs.push([Number(album.id), Number(twin.id)]);
  }
  return { pairs, doubtful };
}

async function artists(context: OperatorContext): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const merge of plan.artists) {
    if (!(await exists(context, "artists", merge.drop))) { out.push({ ...merge, outcome: "ya no existe" }); continue; }
    const albums: string[] = [];
    let doubtful: number[] = [];
    let summary = "";
    const outcome = await guarded(context, async () => {
    const twins = await findTwins(context, merge.keep, merge.drop);
    doubtful = twins.doubtful;
    for (const [drop, keep] of twins.pairs) {
      const preview = await previewAlbumMerge(context.client, keep, drop, { lock: true });
      const result = await mergeAlbums(context, { keepId: keep, dropId: drop, previewHash: preview.previewHash, keepDropNameAsAlias: preview.keep.title !== preview.drop.title });
      albums.push(`${drop} «${preview.drop.title}» → ${keep}: ${result.tracksMerged} pistas unidas, ${result.tracksMoved} movidas`);
    }
    const preview = await previewEntityMerge(context.client, "artist", merge.keep, merge.drop, { lock: true });
    const result = await mergeEntities(context, { kind: "artist", keepId: merge.keep, dropId: merge.drop, previewHash: preview.previewHash, keepDropNameAsAlias: true });
    summary = `«${preview.drop.name}» → «${preview.keep.name}»: ${result.moved} filas movidas${result.preserved.length ? `, conservado: ${result.preserved.join(", ")}` : ""}`;
    return "aplicada";
    });
    out.push({ ...merge, outcome, summary, albums, doubtfulAlbums: doubtful });
  }
  return out;
}

interface MemberRow { id: string; artist_id: string; person_id: string; role: string; from_year: number | null; to_year: number | null; is_current: boolean; notes: string | null }

/** Períodos que se tocan (con un año de holgura): la misma etapa contada por dos fuentes. */
const overlaps = (a: MemberRow, b: MemberRow): boolean => {
  const from = (row: MemberRow) => row.from_year ?? row.to_year ?? -Infinity;
  const to = (row: MemberRow) => row.to_year ?? (row.from_year !== null && !row.is_current && row.to_year === null ? Infinity : Infinity);
  if (a.from_year === null && a.to_year === null) return true;
  if (b.from_year === null && b.to_year === null) return true;
  return from(a) <= to(b) + 1 && from(b) <= to(a) + 1;
};

/**
 * Filas repetidas de una persona en una banda cuyos períodos se solapan o se
 * contienen («Vocals 1995–2003» y «Vocals 1998», el año de un disco): una sola
 * fila con el rol unido, el período más amplio y los textos originales en las
 * notas. Las etapas separadas (Seguridad Nacional 1983–1993 y 2005) quedan.
 */
async function unitePeriods(context: OperatorContext): Promise<unknown[]> {
  const { client, runId, note } = context;
  const { rows } = await client.query<MemberRow>(`
    SELECT id::text, artist_id::text, person_id::text, role, from_year, to_year, is_current, notes
      FROM public.artist_members m
     WHERE (artist_id, person_id) IN (SELECT artist_id, person_id FROM public.artist_members GROUP BY 1, 2 HAVING count(*) > 1)
     ORDER BY artist_id, person_id, id`);
  const groups = new Map<string, MemberRow[]>();
  for (const row of rows) groups.set(`${row.artist_id}|${row.person_id}`, [...(groups.get(`${row.artist_id}|${row.person_id}`) ?? []), row]);
  const out: unknown[] = [];
  for (const group of groups.values()) {
    // Etapas por solapamiento transitivo.
    const stages: MemberRow[][] = [];
    for (const row of group) {
      const touching = stages.filter((stage) => stage.some((other) => overlaps(other, row)));
      const merged = [row, ...touching.flat()];
      for (const stage of touching) stages.splice(stages.indexOf(stage), 1);
      stages.push(merged);
    }
    for (const stage of stages) {
      if (stage.length < 2) continue;
      const ordered = [...stage].sort((left, right) => Number(left.id) - Number(right.id));
      const keep = ordered[0]!;
      const outcome = await guarded(context, async () => {
        const froms = ordered.map((row) => row.from_year).filter((year): year is number => year !== null);
        const tos = ordered.map((row) => row.to_year).filter((year): year is number => year !== null);
        const current = ordered.some((row) => row.is_current);
        const lines = [...new Set(ordered.map((row) => row.notes?.trim()).filter((text): text is string => Boolean(text)))];
        lines.push(`Filas unidas (run ${runId}): ${ordered.map((row) => `«${row.role.trim()}» ${row.from_year ?? "?"}–${row.to_year ?? "?"}${row.is_current ? " actual" : ""} (fila ${row.id})`).join(", ")}`);
        const wanted = {
          // Restos de la fuente pegados al rol («Guitars & Muertos», «Ex- Cronos», el apodo «Pepo»).
          role: combineRoles(ordered.map((row) => row.role)).replace(/(?:,\s*|\s*&\s*)(?:Muertos|Pepo|Ex- Cronos|Inspiración)\b/gu, ""),
          from_year: froms.length ? Math.min(...froms) : null,
          to_year: current || ordered.some((row) => row.from_year !== null && row.to_year === null) ? null : tos.length ? Math.max(...tos) : null,
          is_current: current,
          notes: lines.join("\n"),
        };
        for (const drop of ordered.slice(1)) await mergeInto(client, "artist_membership", Number(keep.id), Number(drop.id), note, runId, { alias: false });
        const before = (await client.query<Omit<MemberRow, "id" | "artist_id" | "person_id">>(
          "SELECT role, from_year, to_year, is_current, notes FROM public.artist_members WHERE id=$1", [keep.id])).rows[0]!;
        await client.query("UPDATE public.artist_members SET role=$2, from_year=$3, to_year=$4, is_current=$5, notes=$6 WHERE id=$1",
          [keep.id, wanted.role, wanted.from_year, wanted.to_year, wanted.is_current, wanted.notes]);
        await client.query(`
          INSERT INTO ingest.merge_audit(run_id,entity_kind,artist_membership_id,field,old_value,new_value,reason,confidence,performed_by)
          VALUES($1,'artist_membership',$2,'membership_consolidated',$3::jsonb,$4::jsonb,$5,'high','system')`,
        [runId, keep.id, JSON.stringify(before), JSON.stringify(wanted), `membresías repetidas unidas: ${note}`]);
        return `${wanted.role} ${wanted.from_year ?? "?"}–${wanted.to_year ?? "?"}${wanted.is_current ? " actual" : ""}`;
      });
      out.push({ artistId: Number(keep.artist_id), personId: Number(keep.person_id), rows: ordered.map((row) => `${row.role} ${row.from_year ?? "?"}–${row.to_year ?? "?"}`), outcome });
    }
  }
  return out;
}

async function memberships(context: OperatorContext): Promise<unknown[]> {
  const united = await unitePeriods(context);
  const { rows } = await context.client.query<{ artist_id: string }>(
    "SELECT DISTINCT artist_id::text FROM public.artist_members GROUP BY artist_id, person_id HAVING count(*) > 1");
  const out: unknown[] = [...united];
  for (const row of rows) {
    const result = await consolidateMemberships(context.client, { artistId: Number(row.artist_id) }, context.note, context.runId);
    if (result.merged || result.reviewsOpened) out.push({ artistId: Number(row.artist_id), ...result });
  }
  return out;
}

/**
 * «Carlos», «Gustavo», «Pedro»: una ficha de nombre de pila reúne créditos de
 * personas distintas en varias bandas. No se fusiona; solo sus filas en la
 * banda donde un integrante lleva ese nombre (y nadie más) pasan a él. Las
 * filas se reapuntan sin claims nuevos, con su rastro en merge_audit.
 */
async function retargets(context: OperatorContext): Promise<unknown[]> {
  const { client, runId, note } = context;
  const out: unknown[] = [];
  for (const item of plan.retargets ?? []) {
    const to = resolve(item.to);
    const outcome = await guarded(context, async () => {
      const moved: string[] = [];
      const specs = [
        { kind: "album_credit", table: "album_credits", where: "album_id IN (SELECT id FROM public.albums WHERE artist_id=$2)" },
        { kind: "track_credit", table: "track_credits", where: "track_id IN (SELECT t.id FROM public.tracks t JOIN public.albums al ON al.id=t.album_id WHERE al.artist_id=$2)" },
        { kind: "artist_membership", table: "artist_members", where: "artist_id=$2" },
      ];
      for (const spec of specs) {
        const rows = (await client.query<{ id: string }>(`SELECT id::text FROM public.${spec.table} WHERE person_id=$1 AND ${spec.where}`, [item.from, item.artist])).rows;
        for (const row of rows) {
          await client.query(`UPDATE public.${spec.table} SET person_id=$2 WHERE id=$1`, [row.id, to]);
          await client.query(`
            INSERT INTO ingest.merge_audit(run_id,entity_kind,${spec.kind}_id,field,old_value,new_value,reason,confidence,performed_by)
            VALUES($1,$2,$3,'person_id',$4::jsonb,$5::jsonb,$6,'high','system')`,
          [runId, spec.kind, row.id, JSON.stringify({ person_id: item.from, name: item.fromName }), JSON.stringify({ person_id: to, name: item.toName }),
            `«${item.fromName}» en ${item.artistName} es ${item.toName}: ${note}`]);
        }
        if (rows.length) moved.push(`${rows.length} ${spec.table}`);
      }
      const credits = await mergeEquivalentCredits(client, { column: "person_id", id: to }, note, runId);
      const members = await consolidateMemberships(client, { personId: to, artistId: item.artist }, note, runId);
      return `${moved.join(", ") || "nada"}; ${credits} créditos y ${members.merged} membresías unidos`;
    });
    out.push({ ...item, outcome });
  }
  return out;
}

/** Anota en los créditos de la ficha lo que su nombre decía y se va a perder (p. ej. «versión en español»). */
async function noteCredits(context: OperatorContext, personId: number, text: string): Promise<void> {
  for (const table of ["album_credits", "track_credits"]) {
    await context.client.query(`UPDATE public.${table} SET notes=concat_ws(' · ', NULLIF(notes,''), $2::text) WHERE person_id=$1`, [personId, text]);
  }
}

async function junk(context: OperatorContext): Promise<unknown[]> {
  const { client, runId, note } = context;
  const out: unknown[] = [];
  const plans = plan.junk;
  if (!plans) return out;
  for (const item of plans.organizations) {
    out.push({ op: "organizacion", ...item, outcome: await guarded(context, async () => {
      if (item.creditNote) await noteCredits(context, item.person, item.creditNote);
      let target = item.organization;
      if (target === undefined && item.create) {
        const found = (await client.query<{ id: string }>("SELECT id::text FROM public.organizations WHERE lower(name)=lower($1) ORDER BY id LIMIT 1", [item.create.name])).rows[0];
        target = found ? Number(found.id) : Number((await client.query<{ id: string }>(
          "INSERT INTO public.organizations(name,organization_type,notes) VALUES($1,$2::organization_type,$3) RETURNING id::text",
          [item.create.name, item.create.type, `Acreditada como persona «${item.name}»; ${note}`])).rows[0]!.id);
      }
      if (target === undefined) throw new Error("sin organización de destino");
      return `${(await convertPerson(client, item.person, { kind: "organization", id: target }, true, note, runId)).detail}`;
    }) });
  }
  for (const item of plans.persons) {
    out.push({ op: "persona", ...item, outcome: await guarded(context, async () => {
      if (item.creditNote) await noteCredits(context, item.person, item.creditNote);
      const preview = await previewEntityMerge(client, "person", item.to, item.person, { lock: true });
      if (preview.eraConflict !== null) throw new Error(`trayectorias imposibles: ${preview.eraConflict}`);
      const result = await mergeEntities(context, { kind: "person", keepId: item.to, dropId: item.person, previewHash: preview.previewHash, keepDropNameAsAlias: false });
      return `${result.moved} filas movidas`;
    }) });
  }
  for (const item of plans.renames) {
    out.push({ op: "renombre", ...item, outcome: await guarded(context, async () => {
      if (item.creditNote) await noteCredits(context, item.person, item.creditNote);
      await updateEntity(context, "person", item.person, { name: item.rename });
      return item.rename;
    }) });
  }
  for (const item of plans.removals) {
    out.push({ op: "retirar", ...item, outcome: await guarded(context, async () => {
      let removed = 0;
      for (const [kind, table] of [["album_credit", "album_credits"], ["track_credit", "track_credits"]] as const) {
        for (const row of (await client.query<{ id: string }>(`SELECT id::text FROM public.${table} WHERE person_id=$1`, [item.person])).rows) {
          if (await removeRelation(client, kind, Number(row.id), { note: `«${item.name}» no es una persona: ${note}`, runId })) removed += 1;
        }
      }
      const left = (await client.query("SELECT 1 FROM public.artist_members WHERE person_id=$1 UNION ALL SELECT 1 FROM public.person_organizations WHERE person_id=$1", [item.person])).rowCount;
      if (left) throw new Error("conserva membresías u organizaciones");
      await deleteEntity(context, "person", item.person);
      return `${removed} créditos retirados y ficha borrada`;
    }) });
  }
  return out;
}

const PHASES: Array<[string, (context: OperatorContext) => Promise<unknown[]>]> = [
  ["personas", persons], ["separar", splits], ["artistas", artists], ["reasignar", retargets], ["membresias", memberships], ["basura", junk],
];

async function main(): Promise<void> {
  const report: Record<string, unknown> = { confirm };
  const only = arg("phase");
  // Sin --confirm las cuatro fases corren en una sola transacción que se
  // deshace al final, para que cada una vea lo que dejó la anterior.
  if (!confirm) {
    try {
      await withOperatorRun({ name: "membresias-duplicadas", operator: "brian", note: NOTE, params: { dryRun: true } }, async (context) => {
        for (const [name, work] of PHASES) {
          if (only && only !== name) continue;
          report[name] = await work(context);
        }
        throw new DryRun(report);
      });
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
    }
  } else {
    for (const [name, work] of PHASES) {
      if (only && only !== name) continue;
      const done = await withOperatorRun({ name: `membresias-duplicadas-${name}`, operator: "brian", note: `${NOTE} — ${name}`, params: { phase: name } }, work);
      report[name] = { runId: done.runId, items: done.result };
      console.log(`${name}: run ${done.runId}, ${done.result.length} elementos`);
    }
  }
  const file = `${outDir}/resultado-${confirm ? "confirm" : "dry-run"}.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`→ ${file}`);
}

main().finally(() => closeDb()).catch((error) => { console.error(error); process.exitCode = 1; });
