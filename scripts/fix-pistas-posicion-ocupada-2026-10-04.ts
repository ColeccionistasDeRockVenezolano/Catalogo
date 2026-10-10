// Pistas de Sincopa que quedaron fuera tras la Revisión de ingesta 2026-10-04:
// la promoción falló por posición ocupada y fix-sincopa-position-collisions las
// dejó «en espera» (título casi igual, posición ya libre o disco sin resolver).
// Brian, 2026-10-04: «arreglo por reglas».
//
//  0. Desorden Público: el 5600 «Desorden Público En Vivo» es el CD 1 del 3979
//     (mismas 17 pistas, mismo orden) y la ficha desorden_envivo.htm tenía tres
//     claims de disco apuntando al debut 166. Se fusiona 5600 → 3979 y los claims
//     pasan al 3979, donde están las 15 pistas del CD 2 con el mismo título.
//  1. Reglas, en orden (las mismas de overrides-pistas.mjs más dos de posición):
//     - mismo título en el disco → misma pista;
//     - en su número hay una pista con el mismo título base, sin paréntesis
//       («Tocando el Cielo (Unplugged)» = «Tocando El Cielo (Acoustic)») → misma;
//     - en su número hay un título basura (el nombre del artista, créditos
//       «X & Y», «(tracks 01, 02…)») → misma pista, y toma el título de Sincopa;
//     - parte de un popurrí ya nombrado → se queda en espera;
//     - versión que el disco no tiene, otro número u otra canción → pista nueva:
//       en su número de Sincopa si está libre y, si no, al final del disco;
//     - título contenido o errata con el mismo número → misma pista.
//  Las fichas de discos mezclados (varias páginas de Sincopa en un disco) siguen
//  en la lista manual y no se tocan, salvo con --mixed-plan (segunda tanda,
//  Brian 2026-10-04: «ensayo por reglas + lista»): con el plan de
//  split-sincopa-mixed-albums, una pista nueva de la ficha dueña o de una edición
//  que comparte al menos el 60 % de sus pistas con el disco entra (falta o es
//  extra de la edición); la de una ficha a separar o con poco en común (otro
//  volumen, otra recopilación) se queda en espera para Brian.
//
//   tsx scripts/fix-pistas-posicion-ocupada-2026-10-04.ts [--confirm] [--out=…json]
//       [--identities=…json] [--mixed-plan=…json]
//   (la lista de identidades está en reports/revision-ingesta-2026-10-04/posicion-ocupada-pendientes.json)
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getDb, getPool } from "../src/db/client.js";
import { bindRun, withRunScope } from "../src/db/run-binding.js";
import { scrapeRuns } from "../src/db/schema/ingest.js";
import { finishRun } from "../src/ingest/runs.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { approveEntity } from "../src/review/approval.js";

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const fold = (text: string) => text.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\d]+/gu, " ").trim();
const base = (text: string) => fold(text.replace(/\([^)]*\)/gu, ""));
const VERSION = /\((?:[^)]*\b(?:version|versi[oó]n|unplugged|acoustic|remix|remixed|mix|dance|radio|extended|end)\b[^)]*)\)/iu;
const nums = (text: string) => [...fold(text).matchAll(/\b(?:part|parte|no|n|vol)?\s*(\d+|ii|iii|iv|v|vi)\b/gu)].map((m) => m[1]).join(",");
const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
};

const LIVE = { keep: 3979, drop: 5600, wrongAlbum: 166, page: "https://sincopa.com/rock_pop/cdinfo_rock/desorden_envivo.htm" };
const MIXED_REASON = "varias fichas de Sincopa comparten este disco del core";

interface Page { identity: string; identityKey: string; rawPageId: number; url: string; title: string; num: number | null; numClaimIds: number[]; albumIds: number[]; artist: string }
interface Track { id: number; n: number; title: string }
type Verdict =
  | { kind: "same"; trackId: number; retitle?: boolean; rule: string; why: string }
  | { kind: "new"; position: number | "end"; rule: string; why: string }
  | { kind: "hold"; rule: string; why: string };

const IDENTITIES = arg("identities") ?? "reports/revision-ingesta-2026-10-04/posicion-ocupada-pendientes.json";
const MIXED_SHARE = 0.6;

interface MixedPage { url: string; role: string; tracks: number; linked: number; why: string; channel?: boolean; split?: boolean }
// Papel de cada ficha en su disco mezclado, según split-sincopa-mixed-albums --plan.
function mixedRoles(): Map<string, MixedPage> {
  const file = arg("mixed-plan");
  const out = new Map<string, MixedPage>();
  if (file === undefined) return out;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{ albumId: number; pages: MixedPage[] }> | { albums: Array<{ albumId: number; pages: MixedPage[] }> };
  for (const album of Array.isArray(raw) ? raw : raw.albums) {
    const a = album as { albumId: number; pages: MixedPage[]; channel?: boolean };
    // Un disco con una ficha a separar o cuya dueña no sostiene ninguna pista se separa antes de completar nada.
    const split = a.pages.some((p) => p.role === "separar") || a.pages.some((p) => p.role === "dueña" && p.linked === 0);
    for (const page of a.pages) out.set(`${a.albumId}|${page.url}`, { ...page, channel: a.channel === true, split });
  }
  return out;
}

function mixedVerdict(verdict: Verdict, page: MixedPage | undefined): Verdict {
  if (verdict.kind !== "new") return verdict;
  if (!page) return { kind: "hold", rule: "disco-mezclado", why: MIXED_REASON };
  if (page.channel) return { kind: "hold", rule: "disco-del-canal", why: "el orden y los datos del disco vienen del canal: no se cambia" };
  if (page.split && page.role !== "separar") return { kind: "hold", rule: "disco-a-separar", why: "el disco junta otro disco de Sincopa: separarlo antes" };
  if (page.role === "separar") return { kind: "hold", rule: "disco-a-separar", why: `la ficha es otro disco: ${page.why}` };
  const share = page.tracks > 0 ? page.linked / page.tracks : 0;
  if (page.role === "dueña" || share >= MIXED_SHARE) return { ...verdict, why: `${verdict.why}; ficha ${page.role} (${page.linked}/${page.tracks} enlazadas)` };
  return { kind: "hold", rule: "edicion-poco-en-comun", why: `ficha ${page.role} con ${page.linked}/${page.tracks} pistas en el disco: ¿otro volumen u otra recopilación?` };
}

async function pending(): Promise<Page[]> {
  const pool = getPool();
  const identities = JSON.parse(readFileSync(IDENTITIES, "utf8")) as string[];
  // Pistas de Sincopa con título aún candidato y sin pista del core, de fichas
  // cuyo disco está en el core.
  const { rows } = await pool.query<{ identity_raw: string; identity_key: string; raw_page_id: string; url: string; title: string | null; num: string | null; num_ids: string[] | null; album_ids: string[] | null; artist: string | null }>(`
    WITH t AS (
      SELECT DISTINCT c.identity_raw, c.raw_page_id FROM ingest.claims c
       WHERE c.source_id=(SELECT id FROM ingest.sources WHERE slug='sincopa') AND c.entity_kind='track' AND c.field='title'
         AND c.status='candidate' AND c.track_id IS NULL AND c.identity_raw = ANY($1::text[])
         AND EXISTS (SELECT 1 FROM ingest.claims a WHERE a.raw_page_id=c.raw_page_id AND a.entity_kind='album' AND a.status='accepted' AND a.album_id IS NOT NULL))
    SELECT c.identity_raw, max(c.identity_key) AS identity_key, c.raw_page_id::text, r.url,
           max(c.raw_value #>> '{}') FILTER (WHERE c.field='title') AS title,
           -- El número de Sincopa aunque un pase anterior lo haya descartado: la regla de posición lo necesita.
           coalesce(max(c.raw_value #>> '{}') FILTER (WHERE c.field='track_number' AND c.status='candidate'),
                    max(c.raw_value #>> '{}') FILTER (WHERE c.field='track_number')) AS num,
           array_agg(c.id::text) FILTER (WHERE c.field='track_number' AND c.status='candidate') AS num_ids,
           (SELECT array_agg(DISTINCT a.album_id::text) FROM ingest.claims a
             WHERE a.raw_page_id=c.raw_page_id AND a.entity_kind='album' AND a.status='accepted' AND a.album_id IS NOT NULL) AS album_ids,
           (SELECT ar.name FROM public.albums al JOIN public.artists ar ON ar.id=al.artist_id
             WHERE al.id=(SELECT min(a.album_id) FROM ingest.claims a WHERE a.raw_page_id=c.raw_page_id AND a.entity_kind='album' AND a.status='accepted')) AS artist
      FROM t JOIN ingest.claims c ON c.identity_raw=t.identity_raw AND c.raw_page_id=t.raw_page_id AND c.entity_kind='track'
      JOIN ingest.raw_pages r ON r.id=c.raw_page_id
     WHERE c.status IN ('candidate','accepted','superseded')
     GROUP BY c.identity_raw, c.raw_page_id, r.url`, [identities]);
  return rows.filter((row) => row.title !== null).map((row) => ({
    identity: row.identity_raw, identityKey: row.identity_key, rawPageId: Number(row.raw_page_id), url: row.url, title: row.title!,
    num: row.num === null ? null : Number(row.num), numClaimIds: (row.num_ids ?? []).map(Number), albumIds: (row.album_ids ?? []).map(Number), artist: row.artist ?? "",
  }));
}

function decide(page: Page, tracks: Track[]): Verdict {
  const ft = fold(page.title);
  const exact = tracks.filter((t) => fold(t.title) === ft);
  if (exact.length === 1) return { kind: "same", trackId: exact[0]!.id, rule: "mismo-titulo", why: `«${exact[0]!.title}» #${exact[0]!.n}` };
  if (exact.length > 1) return { kind: "hold", rule: "varios-con-el-titulo", why: exact.map((t) => `#${t.n}`).join(", ") };
  const position = page.num === 0 ? 1 : page.num;
  const atPos = position === null ? undefined : tracks.find((t) => t.n === position);
  if (atPos && base(atPos.title) === base(page.title)) return { kind: "same", trackId: atPos.id, rule: "misma-posicion-mismo-titulo-base", why: `#${atPos.n} «${atPos.title}»` };
  const junk = atPos && (fold(atPos.title) === fold(page.artist) || /\btracks?\s+\d/iu.test(atPos.title) || /^[\p{L}.]+(?: [\p{L}.]+)+ & [\p{L}.]+(?: [\p{L}.]+)+$/u.test(atPos.title));
  if (atPos && junk) return { kind: "same", trackId: atPos.id, retitle: true, rule: "misma-posicion-titulo-basura", why: `#${atPos.n} «${atPos.title}» → «${page.title}»` };
  const scored = tracks.map((t) => {
    const fc = fold(t.title.replace(/\((?:[^)]*\/[^)]*|en vivo|live|demo|[^)]*cover|[^)]*remix)\)/giu, ""));
    const contains = fc.includes(ft) || ft.includes(fc);
    const shorter = fc.length < ft.length ? fc : ft;
    const strong = contains && (shorter.split(" ").length >= 2 || shorter.length / Math.max(fc.length, ft.length) >= 0.6);
    const medley = /[/;,]|^(mosaico|guacomania|popurri|potpourri|suite)|\b(parte a|i\.|a\.)/iu.test(t.title) && !/[/]/u.test(page.title) && fc !== ft && fc.includes(ft);
    return { t, fc, strong, medley };
  });
  const medley = scored.find((x) => x.medley);
  if (medley) return { kind: "hold", rule: "parte-de-popurri", why: `ya nombrada en «${medley.t.title}»` };
  const free = position !== null && position > 0 && !atPos;
  const fresh = (rule: string, why: string): Verdict => ({ kind: "new", position: free ? position! : "end", rule, why });
  if (VERSION.test(page.title) && !scored.some((x) => VERSION.test(x.t.title))) return fresh("otra-version", "versión que el disco no tiene");
  const strong = scored.filter((x) => x.strong);
  if (strong.length === 1 && nums(page.title) === nums(strong[0]!.fc)) return { kind: "same", trackId: strong[0]!.t.id, rule: "titulo-contenido", why: `«${strong[0]!.t.title}» #${strong[0]!.t.n}` };
  if (strong.length === 1) return fresh("otro-numero", `otro número que «${strong[0]!.t.title}»`);
  // Errata: pocas letras y poca proporción («La Reyna» = «La Reina»; «El Motilón» ≠ «El Mochilón»).
  const typo = scored.filter((x) => { const d = lev(ft, x.fc); return d <= 2 && d / Math.max(ft.length, x.fc.length) <= 0.15 && nums(page.title) === nums(x.fc); });
  if (typo.length === 1) return { kind: "same", trackId: typo[0]!.t.id, rule: "errata", why: `errata de «${typo[0]!.t.title}» #${typo[0]!.t.n}` };
  return fresh(free ? "posicion-libre" : "otra-pista", free ? "su número está libre" : "sin pareja en el disco");
}

async function fixLiveAlbum(confirm: boolean): Promise<void> {
  const pool = getPool();
  const exists = (await pool.query("SELECT 1 FROM public.albums WHERE id=$1", [LIVE.drop])).rowCount === 1;
  if (!exists) return;
  const client = await pool.connect();
  try {
    const preview = await previewAlbumMerge(client, LIVE.keep, LIVE.drop);
    console.log(`disco ${LIVE.drop} → ${LIVE.keep}: ${preview.matchedTracks.length} pistas emparejadas, ${preview.unmatchedDropTracks.length} sueltas`);
    if (preview.unmatchedDropTracks.length > 0) throw new Error("el 5600 ya no es el CD 1 del 3979");
  } finally {
    client.release();
  }
  if (!confirm) return;
  const note = "Desorden Público: el 5600 es el CD 1 del 3979 «En Vivo Teatro Teresa Carreño»; la ficha desorden_envivo.htm apuntaba también al debut (Brian, 2026-10-04)";
  const result = await withOperatorRun({ name: "fix-desorden-en-vivo-2026-10-04", operator: "brian", note, params: LIVE }, async (context) => {
    const { previewHash } = await previewAlbumMerge(context.client, LIVE.keep, LIVE.drop, { lock: true });
    const merged = await mergeAlbums(context, { keepId: LIVE.keep, dropId: LIVE.drop, previewHash, keepDropNameAsAlias: true });
    const moved = await context.client.query(`
      UPDATE ingest.claims SET album_id=$1, notes=concat_ws(' · ', notes, $4::text), updated_at=now()
       WHERE entity_kind='album' AND album_id=$2 AND raw_page_id=(SELECT id FROM ingest.raw_pages WHERE url=$3)`,
    [LIVE.keep, LIVE.wrongAlbum, LIVE.page, `[run ${context.runId}] la ficha es el disco en vivo, no el debut`]);
    return { tracksMerged: merged.tracksMerged, claimsMoved: moved.rowCount };
  });
  console.log(JSON.stringify(result));
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  await fixLiveAlbum(confirm);
  const pool = getPool();
  const pages = await pending();
  const roles = mixedRoles();
  // Discos con varias fichas de Sincopa: lista manual de Brian.
  const pagesPerAlbum = new Map<number, Set<number>>();
  const { rows: shared } = await pool.query<{ album_id: string; pages: string }>(`
    SELECT album_id::text, count(DISTINCT raw_page_id)::text AS pages FROM ingest.claims
     WHERE source_id=(SELECT id FROM ingest.sources WHERE slug='sincopa') AND entity_kind='album' AND status='accepted' AND album_id IS NOT NULL
       AND raw_page_id IN (SELECT id FROM ingest.raw_pages WHERE url LIKE '%/cdinfo%') GROUP BY album_id HAVING count(DISTINCT raw_page_id) > 1`);
  for (const row of shared) pagesPerAlbum.set(Number(row.album_id), new Set());
  const plan: Array<Page & { albumId: number | null; verdict: Verdict }> = [];
  const taken = new Map<number, Set<number>>();
  const tracksOf = new Map<number, Track[]>();
  // Una identidad con dos fichas (dos numeraciones) se resuelve una vez: primero
  // la ficha cuyo número está libre.
  const byIdentity = new Map<string, Page[]>();
  for (const page of pages) byIdentity.set(page.identity, [...(byIdentity.get(page.identity) ?? []), page]);
  for (const [, group] of byIdentity) {
    let chosen: Verdict | undefined;
    for (const page of group) {
      if (page.albumIds.length !== 1) { plan.push({ ...page, albumId: null, verdict: { kind: "hold", rule: "disco-sin-resolver", why: `discos ${page.albumIds.join(", ")}` } }); continue; }
      const albumId = page.albumIds[0]!;
      if (!tracksOf.has(albumId)) {
        tracksOf.set(albumId, (await pool.query<{ id: string; n: number; title: string }>("SELECT id::text, track_number AS n, title FROM public.tracks WHERE album_id=$1 AND disc_number=1", [albumId])).rows.map((t) => ({ id: Number(t.id), n: t.n, title: t.title })));
      }
      const tracks = tracksOf.get(albumId)!;
      let verdict = chosen ?? decide(page, tracks);
      if (pagesPerAlbum.has(albumId) && roles.size > 0) verdict = mixedVerdict(verdict, roles.get(`${albumId}|${page.url}`));
      else if (verdict.kind === "new" && pagesPerAlbum.has(albumId) && verdict.position === "end" && group.length === 1) verdict = { kind: "hold", rule: "disco-mezclado", why: MIXED_REASON };
      if (verdict.kind === "new" && verdict.position !== "end") {
        const used = taken.get(albumId) ?? new Set<number>();
        if (used.has(verdict.position)) verdict = { ...verdict, position: "end" };
        used.add(verdict.position === "end" ? -1 : verdict.position);
        taken.set(albumId, used);
      }
      plan.push({ ...page, albumId, verdict });
      // La segunda ficha de la misma identidad sigue a la primera.
      if (!chosen && group.length > 1) {
        const better = group.map((p) => decide(p, tracks)).find((v) => v.kind === "new" && v.position !== "end");
        chosen = verdict.kind === "new" && verdict.position === "end" && better ? better : verdict;
        if (chosen !== verdict) plan[plan.length - 1]!.verdict = chosen;
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const item of plan) counts[`${item.verdict.kind}:${item.verdict.rule}`] = (counts[`${item.verdict.kind}:${item.verdict.rule}`] ?? 0) + 1;
  for (const item of plan) {
    const v = item.verdict;
    const head = v.kind === "same" ? `misma → ${v.trackId}${v.retitle ? " (retitula)" : ""}` : v.kind === "new" ? `nueva → ${v.position === "end" ? "al final" : `#${v.position}`}` : "en espera";
    console.log(`- ${head} · ${item.identity} #${item.num ?? "?"} · ${v.rule}: ${v.why}`);
  }
  console.log(JSON.stringify(counts));
  const out = arg("out");
  if (out !== undefined) writeFileSync(out, `${JSON.stringify({ dryRun: !confirm, counts, plan: plan.map(({ numClaimIds: _n, ...rest }) => rest) }, null, 1)}\n`);
  // Una pista nueva se crea una sola vez aunque venga de dos fichas: el enlace de
  // claims va por identidad y alcanza a las dos.
  const created = new Set<string>();
  const work = plan.filter((item) => {
    if (item.verdict.kind === "hold") return false;
    if (item.verdict.kind !== "new") return true;
    if (created.has(item.identity)) return false;
    created.add(item.identity);
    return true;
  });
  if (!confirm || work.length === 0) { await closeDb(); return; }

  const note = arg("note") ?? "Pistas de Sincopa con posición ocupada tras la Revisión de ingesta 2026-10-04: arreglo por reglas (Brian, 2026-10-04)";
  const [run] = await getDb().insert(scrapeRuns).values({ kind: "manual", status: "running", params: { action: "fix-pistas-posicion-ocupada-2026-10-04", note } }).returning();
  if (!run) throw new Error("no se pudo abrir el run");
  const reason = `[run ${run.id}] ${note}`;
  const done = { same: 0, retitled: 0, placed: 0, appended: 0, failed: 0 };
  const failures: Array<{ identity: string; error: string }> = [];
  await withRunScope(run.id, async () => {
    for (const item of work) {
      const v = item.verdict;
      try {
        if (v.kind === "same") {
          const target = tracksOf.get(item.albumId!)!.find((t) => t.id === v.trackId)!;
          await pool.query("UPDATE ingest.claims SET status='superseded', notes=$2, updated_at=now() WHERE id=ANY($1::bigint[])",
            [item.numClaimIds, `${reason}: la pista ya está en el disco como ${target.n}`]);
          await pool.query(`UPDATE ingest.review_queue SET status='dismissed', resolved_by='human', resolution_note=$2, resolved_at=now(), updated_at=now()
                             WHERE claim_a_id=ANY($1::bigint[]) AND status IN ('open','in_progress')`, [item.numClaimIds, reason]);
          if (v.retitle) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              await bindRun(client, run.id);
              await client.query("UPDATE public.tracks SET title=$2 WHERE id=$1", [v.trackId, item.title]);
              await client.query(`INSERT INTO ingest.merge_audit(run_id,entity_kind,track_id,field,old_value,new_value,reason,confidence,performed_by)
                                  VALUES($1,'track',$2,'title',$3::jsonb,$4::jsonb,$5,'high','human')`,
              [run.id, v.trackId, JSON.stringify(target.title), JSON.stringify(item.title), `${reason}: el título del core era basura («${target.title}»)`]);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
            done.retitled += 1;
          }
          try {
            await approveEntity("track", item.identityKey, reason, { humanResolution: { verdict: "same", targetId: v.trackId, decidedBy: "brian", reference: `${v.rule}: ${v.why} (${item.url})` } });
          } catch (error) {
            if (!String((error as Error).message).startsWith("sin claims candidatos")) throw error;
          }
          done.same += 1;
          continue;
        }
        if (v.kind !== "new") continue;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await bindRun(client, run.id);
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`merge:album-append:${item.albumId}`]);
          let number: number;
          let numberNote: string;
          if (v.position === "end") {
            const { rows: [last] } = await client.query<{ n: number }>("SELECT coalesce(max(track_number),0)::int AS n FROM public.tracks WHERE album_id=$1 AND disc_number=1", [item.albumId]);
            number = last!.n + 1;
            numberNote = `Sincopa la numera ${item.num ?? "?"} en otra edición del disco (${item.url}).`;
          } else {
            number = v.position;
            numberNote = `Número de Sincopa (${item.url}).`;
          }
          const { rows: [track] } = await client.query<{ id: string }>(
            "INSERT INTO public.tracks(album_id,disc_number,track_number,title,notes) VALUES($1,1,$2,$3,$4) RETURNING id::text",
            [item.albumId, number, item.title, numberNote]);
          const trackId = Number(track!.id);
          const { rows: claimIds } = await client.query<{ id: string }>(`
            UPDATE ingest.claims SET track_id=$1, updated_at=now()
             WHERE source_id=(SELECT id FROM ingest.sources WHERE slug='sincopa') AND entity_kind='track' AND identity_raw=$2
             RETURNING id::text`, [trackId, item.identity]);
          // El número de Sincopa que no es el que quedó (otra edición, u otra ficha
          // de la misma pista con otra numeración) no se aplica.
          await client.query(`UPDATE ingest.claims SET status='superseded', notes=$3, updated_at=now()
                               WHERE id=ANY($1::bigint[]) AND field='track_number' AND status='candidate'
                                 AND ((raw_value #>> '{}') !~ '^[0-9]+$' OR (raw_value #>> '{}')::int <> $2)`,
          [claimIds.map((c) => Number(c.id)), number, `${reason}: la posición ${item.num ?? "?"} de Sincopa es de otra pista; queda como ${number}`]);
          await client.query("UPDATE ingest.claims SET status='accepted', updated_at=now() WHERE id=ANY($1::bigint[]) AND status='candidate'",
            [claimIds.map((c) => Number(c.id))]);
          const { rows: [audit] } = await client.query<{ id: string }>(`
            INSERT INTO ingest.merge_audit(run_id,entity_kind,track_id,field,old_value,new_value,reason,confidence,performed_by)
            VALUES($1,'track',$2,'title',NULL,$3::jsonb,$4,'high','human') RETURNING id::text`,
          [run.id, trackId, JSON.stringify(item.title), `${reason}: ${v.rule} (${v.why}); pista nueva como ${number}`]);
          for (const c of claimIds) await client.query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [audit!.id, Number(c.id)]);
          await client.query(`UPDATE ingest.review_queue SET status='approved', resolved_by='human', resolution_note=$2, resolved_at=now(), updated_at=now()
                               WHERE claim_a_id=ANY($1::bigint[]) AND status IN ('open','in_progress')`, [claimIds.map((c) => Number(c.id)), reason]);
          await client.query("COMMIT");
          if (v.position === "end") done.appended += 1; else done.placed += 1;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        done.failed += 1;
        failures.push({ identity: item.identity, error: (error as Error).message });
      }
    }
  });
  await finishRun(run.id, done.failed > 0 ? "partial" : "ok", done);
  console.log(JSON.stringify({ runId: run.id, ...done, failures }, null, 1));
  await closeDb();
}

await main();
