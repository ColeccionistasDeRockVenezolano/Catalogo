// CRV · Plan para vaciar «Fichas repetidas» de Curaduría (Brian, 2026-10-04:
// «resolver todas, de forma automática, con las decisiones recomendadas»).
//
// Lee los hallazgos abiertos de la categoría y la cola, decide por par con las
// reglas ya elegidas por Brian y escribe reports/fichas-repetidas-2026-10-04-plan.json
// (lo aplica scripts/fix-fichas-repetidas-2026-10-04.ts). No escribe en la base.
//
// Personas — reglas del run 11823 ([[posibles-duplicados-2026-10-04]]):
//   · proyecto común (banda, disco no recopilatorio, pista, artista, sello o
//     ≥2 colegas) → fusión;
//   · sin proyecto: nombre de una palabra → distintas; fechas de nacimiento o
//     venezolano sí/no que se contradicen → distintas; nombre completo → fusión
//     solo si el apellido es raro (≤10 fichas), tiene 3+ palabras o la bio de
//     una banda/persona nombra a la otra; nombre común → distintas.
// Organizaciones: mismo tipo → fusión; «other» frente a estudio → fusión;
//   tipos distintos o nombre genérico → distintas.
// Discos (mismo artista): mismo año (±1) y uno vacío, o ≥60 % de pistas en
//   común con el mismo año → fusión; reediciones de otro año y homónimos → distintas.
// Pistas (mismo disco): la fuente lista el tema dos veces → distintas; la copia
//   añadida al final sin duración con otra grafía → fusión.
//
//   ./scripts/with-node22.sh npx tsx scripts/plan-fichas-repetidas-2026-10-04.ts
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { nameKey } from "../src/curation/lexicon.js";

const OUT = "reports/fichas-repetidas-2026-10-04-plan.json";
const VARIOUS = 257;
const pool = getPool();

type Kind = "person" | "organization" | "artist" | "album" | "track";
interface Decision { kind: Kind; a: number; b: number; verdict: "merge" | "distinct"; why: string; strength: number }
const decisions: Decision[] = [];
const decide = (kind: Kind, a: number, b: number, verdict: Decision["verdict"], why: string, strength = 1) => {
  if (a === b) return;
  decisions.push({ kind, a: Math.min(a, b), b: Math.max(a, b), verdict, why, strength });
};
const num = (v: unknown) => Number(v);
const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

// ---------------------------------------------------------------------------
// Pares candidatos por tipo
// ---------------------------------------------------------------------------
const { rows: findings } = await pool.query<{ id: string; detector: string; signature: string; entity_id: string; value: string | null; evidence: { values?: Array<{ id: number }>; collidingIds?: number[] }; related: unknown }>(`
  SELECT id::text, detector, signature, entity_id::text, value, evidence, related
    FROM ingest.curation_findings WHERE category='fichas_repetidas' AND status='open'`);
const { rows: reviews } = await pool.query<{ id: string; kind: string; payload: { entityKind: Kind; targetId: number; conflictingTargetId: number; alias?: string } }>(`
  SELECT id::text, kind::text, payload FROM ingest.review_queue
   WHERE status IN ('open','in_progress') AND kind IN ('ambiguous_alias','person_match','organization_match','album_match')`);
const { rows: handled } = await pool.query<{ kind: string; a_id: string; b_id: string }>("SELECT kind, a_id::text, b_id::text FROM ingest.curation_distinct_pairs");
const alreadyDistinct = new Set(handled.map((r) => `${r.kind}:${r.a_id}-${r.b_id}`));

const pairs = new Map<Kind, Map<string, { a: number; b: number; via: Set<string>; aliasName?: string }>>();
const addPair = (kind: Kind, x: number, y: number, via: string, aliasName?: string) => {
  if (!x || !y || x === y) return;
  const [a, b] = x < y ? [x, y] : [y, x];
  const key = `${a}-${b}`;
  const map = pairs.get(kind) ?? pairs.set(kind, new Map()).get(kind)!;
  const item = map.get(key) ?? { a, b, via: new Set<string>() };
  item.via.add(via);
  if (aliasName) item.aliasName = aliasName;
  map.set(key, item);
};
for (const f of findings) {
  const values = f.evidence?.values as Array<{ id: number }> | undefined;
  const kindOf: Record<string, Kind> = { artistas_equivalentes: "artist", organizaciones_equivalentes: "organization", discos_repetidos: "album", pistas_repetidas: "track", personas_equivalentes: "person" };
  if (kindOf[f.detector] && values?.length === 2) addPair(kindOf[f.detector]!, values[0]!.id, values[1]!.id, f.detector);
  if (f.detector === "alias_que_choca_con_otra_ficha") {
    for (const other of (f.evidence?.collidingIds ?? []) as number[]) addPair(f.signature as Kind, num(f.entity_id), other, "alias", f.value ?? undefined);
  }
}
for (const r of reviews) {
  if (r.kind !== "ambiguous_alias") continue;
  const kind = r.payload.entityKind as Kind;
  if (kind === "track") continue; // homónimos legítimos; los del mismo disco ya están en pistas_repetidas
  addPair(kind, num(r.payload.targetId), num(r.payload.conflictingTargetId), "cola", r.payload.alias);
}

// ---------------------------------------------------------------------------
// Artistas: decisiones vistas a mano (2026-10-04)
// ---------------------------------------------------------------------------
const ARTIST_MERGES: Array<[number, number, string]> = [
  [3376, 3374, "Di Donna = Héctor Di Donna (mismos discos)"],
  [3699, 3757, "Esteban Demian = Esteban Demián (mismos discos)"],
  [3699, 3755, "Steven Damian = Esteban Demián (mismos discos)"],
  [3880, 3881, "Juan Galea y Su Grupo = Juan Galea (mismos discos)"],
  [3870, 3892, "Reina Lucero = Reyna Lucero (mismos discos)"],
  [2944, 4380, "Orquesta Sinfónica (de) Venezuela"], [2944, 4390, "OSV"], [2944, 4488, "O.S.V."], [2944, 8, "OSV"],
  [3416, 4365, "OSGMA"], [4371, 4373, "OSSB"], [3964, 4032, "ONKORA"], [3492, 3627, "Frank «El Pavo» Hernández"],
  [248, 1786, "Todosantos = Todossantos (mismo «Aeropuerto» 2005 y «Acid Girlzzz»)"],
];
const ARTIST_DISTINCT: Array<[number, number, string]> = [
  [1414, 4235, "El Arca (jazz-ska) ≠ Arca (electrónica)"],
  [3583, 4345, "THE Trío ≠ A Trio"],
  [332, 3228, "Kolman (Zulia, 2012) ≠ Abraxas (Caracas, 1987)"],
];
for (const [k, d, why] of ARTIST_MERGES) decide("artist", k, d, "merge", why, 10);
for (const [a, b, why] of ARTIST_DISTINCT) decide("artist", a, b, "distinct", why);
const artistKeep = new Map<string, number>(ARTIST_MERGES.map(([k, d]) => [`${Math.min(k, d)}-${Math.max(k, d)}`, k]));

// ---------------------------------------------------------------------------
// Organizaciones
// ---------------------------------------------------------------------------
const GENERIC_ORG = new Set(["home", "music", "rock", "center", "solo", "bunker", "vintage", "universal", "playa"]);
const orgPairs = [...(pairs.get("organization")?.values() ?? [])];
// Más dos careos de la Mesa con candidato claro y vínculo de nombre exacto
const orgIds = [...new Set(orgPairs.flatMap((p) => [p.a, p.b]))];
const { rows: orgRows } = await pool.query<{ id: string; name: string; t: string | null; score: string }>(`
  SELECT o.id::text, o.name, o.organization_type::text t,
         ((SELECT count(*) FROM public.albums x WHERE x.label_id=o.id)*3
          + (SELECT count(*) FROM public.album_credits c WHERE c.organization_id=o.id)
          + (SELECT count(*) FROM public.track_credits c WHERE c.organization_id=o.id)
          + (CASE WHEN o.country IS NOT NULL THEN 5 ELSE 0 END))::text score
    FROM public.organizations o WHERE o.id = ANY($1::bigint[])`, [orgIds]);
const orgs = new Map(orgRows.map((r) => [num(r.id), { name: r.name, t: r.t ?? "other", score: num(r.score) }]));
const { organizationKey } = await import("../src/review/person-names.js");
for (const p of orgPairs) {
  const A = orgs.get(p.a); const B = orgs.get(p.b);
  if (!A || !B) continue;
  const key = organizationKey(A.name).replace(/\s+/gu, "");
  const special = (A.name + B.name).toLowerCase();
  if (GENERIC_ORG.has(key) && !(special.includes("mastering") && key === "universal" && /mastering/i.test(A.name) && /mastering/i.test(B.name))) {
    decide("organization", p.a, p.b, "distinct", `nombre genérico «${key}»: pueden ser lugares distintos`); continue;
  }
  if (/orchestra/i.test(A.name + B.name) || key === "teatronacional") { decide("organization", p.a, p.b, "distinct", "orquesta/teatro, no estudio"); continue; }
  const sameType = A.t === B.t;
  const otherVsStudio = (A.t === "other" && B.t === "recording_studio") || (B.t === "other" && A.t === "recording_studio");
  if (p.via.has("alias") && !p.via.has("organizaciones_equivalentes") && nameKey(A.name) !== nameKey(B.name) && organizationKey(A.name) !== organizationKey(B.name)) {
    decide("organization", p.a, p.b, "distinct", "alias que solo coincide de nombre con otra organización"); continue;
  }
  if (sameType || otherVsStudio) decide("organization", p.a, p.b, "merge", `mismo nombre${sameType ? " y tipo" : " (other→estudio)"}`, 5);
  else decide("organization", p.a, p.b, "distinct", `tipos distintos (${A.t} / ${B.t})`);
}

// ---------------------------------------------------------------------------
// Discos (mismo artista)
// ---------------------------------------------------------------------------
const albumPairs = [...(pairs.get("album")?.values() ?? [])];
// careos de la Mesa cuyo título ya existe como disco aparte
albumPairs.push({ a: 2039, b: 13972, via: new Set(["mesa"]) }, { a: 521, b: 14088, via: new Set(["mesa"]) }, { a: 427, b: 14084, via: new Set(["mesa"]) }, { a: 3337, b: 5594, via: new Set(["mesa"]) });
const albumIds = [...new Set(albumPairs.flatMap((p) => [p.a, p.b]))];
const { rows: albumRows } = await pool.query<{ id: string; artist_id: string; title: string; y: number | null }>(
  "SELECT id::text, artist_id::text, title, release_year y FROM public.albums WHERE id = ANY($1::bigint[])", [albumIds]);
const albums = new Map(albumRows.map((r) => [num(r.id), { artist: num(r.artist_id), title: r.title, year: r.y }]));
const { rows: trackRows } = await pool.query<{ album_id: string; title: string }>("SELECT album_id::text, title FROM public.tracks WHERE album_id = ANY($1::bigint[])", [albumIds]);
const tracksOf = new Map<number, Set<string>>();
for (const t of trackRows) (tracksOf.get(num(t.album_id)) ?? tracksOf.set(num(t.album_id), new Set()).get(num(t.album_id))!).add(nameKey(t.title).replace(/\s+/gu, ""));
// Todosantos/Todossantos se fusionan: sus discos cuentan como del mismo artista.
const sameArtist = (x: number, y: number) => x === y || (Math.min(x, y) === 248 && Math.max(x, y) === 1786);
for (const p of albumPairs) {
  const A = albums.get(p.a); const B = albums.get(p.b);
  if (!A || !B) continue;
  if (!sameArtist(A.artist, B.artist)) { decide("album", p.a, p.b, "distinct", "discos homónimos de artistas distintos"); continue; }
  const ta = tracksOf.get(p.a) ?? new Set(); const tb = tracksOf.get(p.b) ?? new Set();
  const common = [...ta].filter((t) => tb.has(t)).length;
  const overlap = Math.min(ta.size, tb.size) ? common / Math.min(ta.size, tb.size) : 0;
  const yearGap = A.year !== null && B.year !== null ? Math.abs(A.year - B.year) : 0;
  const oneEmpty = ta.size === 0 || tb.size === 0;
  const tracksDiffer = Math.abs(ta.size - tb.size) > Math.max(2, 0.25 * Math.max(ta.size, tb.size));
  if (oneEmpty && yearGap <= 1) decide("album", p.a, p.b, "merge", `mismo disco: uno sin pistas, año ${A.year ?? "?"}/${B.year ?? "?"}`, 3);
  else if (!oneEmpty && overlap >= 0.6 && yearGap <= 1 && !tracksDiffer) decide("album", p.a, p.b, "merge", `mismo disco: ${common}/${Math.min(ta.size, tb.size)} pistas en común`, 4);
  else if (yearGap > 1) decide("album", p.a, p.b, "distinct", `reedición u otro disco (${A.year} / ${B.year})`);
  else decide("album", p.a, p.b, "distinct", `mismo título, contenido distinto (${common} pistas en común de ${ta.size}/${tb.size})`);
}

// ---------------------------------------------------------------------------
// Pistas (mismo disco)
// ---------------------------------------------------------------------------
const trackPairs = [...(pairs.get("track")?.values() ?? [])];
trackPairs.push({ a: 8237, b: 155383, via: new Set(["manual"]) });
const trackIds = [...new Set(trackPairs.flatMap((p) => [p.a, p.b]))];
const { rows: tRows } = await pool.query<{ id: string; album_id: string; disc: number; title: string; dur: number | null; n: string; tail: boolean; sources: string }>(`
  SELECT t.id::text, t.album_id::text, t.disc_number disc, t.title, t.duration_seconds dur,
         (SELECT count(*) FROM public.tracks x WHERE x.album_id=t.album_id)::text n,
         t.track_number = (SELECT max(track_number) FROM public.tracks x WHERE x.album_id=t.album_id AND x.disc_number=t.disc_number) tail,
         coalesce((SELECT string_agg(DISTINCT s.slug, ',') FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id WHERE c.track_id=t.id AND c.field='title'), '') sources
    FROM public.tracks t WHERE t.id = ANY($1::bigint[])`, [trackIds]);
const tracks = new Map(tRows.map((r) => [num(r.id), r]));
for (const p of trackPairs) {
  const A = tracks.get(p.a); const B = tracks.get(p.b);
  if (!A || !B) continue;
  if (A.album_id !== B.album_id) { decide("track", p.a, p.b, "distinct", "pistas de discos distintos"); continue; }
  // La copia añadida al final por los arreglos del 2026-10-04: id alto, sin duración, otra grafía.
  const [orig, copy] = num(A.id) < num(B.id) ? [A, B] : [B, A];
  const ka = nameKey(orig.title).replace(/[^\p{L}\p{N}]/gu, ""); const kb = nameKey(copy.title).replace(/[^\p{L}\p{N}]/gu, "");
  let prefix = 0; while (prefix < Math.min(ka.length, kb.length) && ka[prefix] === kb[prefix]) prefix += 1;
  const similar = ka.includes(kb) || kb.includes(ka) || prefix >= 0.6 * Math.min(ka.length, kb.length);
  const appended = num(copy.id) >= 155000 && copy.dur === null && (orig.title !== copy.title || p.via.has("manual")) && (similar || p.via.has("manual"));
  if (appended) decide("track", num(orig.id), num(copy.id), "merge", `copia añadida al final con otra grafía («${copy.title}» = «${orig.title}»)`, 5);
  else decide("track", p.a, p.b, "distinct", `la fuente (${A.sources || B.sources || "—"}) lista el tema dos veces: versiones del mismo disco`);
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
const personPairs = [...(pairs.get("person")?.values() ?? [])];
const personIds = [...new Set(personPairs.flatMap((p) => [p.a, p.b]))];
const { rows: pRows } = await pool.query<{ id: string; name: string; bio: string | null; birth: string | null; death: string | null; ven: boolean | null }>(`
  SELECT id::text, name, biography bio, birth_date::text birth, death_date::text death, is_venezuelan ven FROM public.persons WHERE id = ANY($1::bigint[])`, [personIds]);
const persons = new Map(pRows.map((r) => [num(r.id), r]));
const { rows: links } = await pool.query<{ person_id: string; artist_id: string | null; album_id: string | null; track_id: string | null; org_id: string | null; member: boolean }>(`
  SELECT m.person_id::text, m.artist_id::text, NULL::text album_id, NULL::text track_id, NULL::text org_id, true member FROM public.artist_members m WHERE m.person_id = ANY($1::bigint[])
  UNION ALL
  SELECT c.person_id::text, al.artist_id::text, CASE WHEN al.album_type <> 'compilation' AND al.artist_id <> ${VARIOUS} THEN al.id::text END, NULL, NULL, false
    FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE c.person_id = ANY($1::bigint[])
  UNION ALL
  SELECT c.person_id::text, al.artist_id::text, CASE WHEN al.album_type <> 'compilation' AND al.artist_id <> ${VARIOUS} THEN al.id::text END, t.id::text, NULL, false
    FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id WHERE c.person_id = ANY($1::bigint[])
  UNION ALL
  SELECT po.person_id::text, NULL, NULL, NULL, po.organization_id::text, false FROM public.person_organizations po WHERE po.person_id = ANY($1::bigint[])`, [personIds]);
interface Ctx { artists: Set<number>; albums: Set<number>; tracks: Set<number>; orgs: Set<number>; member: boolean; links: number }
const ctx = new Map<number, Ctx>();
const ctxOf = (id: number) => ctx.get(id) ?? ctx.set(id, { artists: new Set(), albums: new Set(), tracks: new Set(), orgs: new Set(), member: false, links: 0 }).get(id)!;
for (const l of links) {
  const c = ctxOf(num(l.person_id));
  c.links += 1;
  if (l.artist_id && num(l.artist_id) !== VARIOUS) c.artists.add(num(l.artist_id));
  if (l.album_id) c.albums.add(num(l.album_id));
  if (l.track_id) c.tracks.add(num(l.track_id));
  if (l.org_id) c.orgs.add(num(l.org_id));
  if (l.member) c.member = true;
}
// Colegas: otras personas acreditadas en los mismos discos
const allAlbums = [...new Set([...ctx.values()].flatMap((c) => [...c.albums]))];
const { rows: colRows } = await pool.query<{ album_id: string; person_id: string }>(`
  SELECT DISTINCT al.id::text album_id, x.person_id::text FROM public.albums al
    JOIN LATERAL (SELECT person_id FROM public.album_credits WHERE album_id=al.id AND person_id IS NOT NULL
                  UNION SELECT c.person_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE t.album_id=al.id AND c.person_id IS NOT NULL) x ON true
   WHERE al.id = ANY($1::bigint[])`, [allAlbums]);
const peopleOnAlbum = new Map<number, number[]>();
for (const r of colRows) (peopleOnAlbum.get(num(r.album_id)) ?? peopleOnAlbum.set(num(r.album_id), []).get(num(r.album_id))!).push(num(r.person_id));
const colleagues = (id: number) => new Set([...(ctx.get(id)?.albums ?? [])].flatMap((a) => peopleOnAlbum.get(a) ?? []).filter((p) => p !== id));
// Frecuencia de apellidos (última palabra sin tildes)
const { rows: allNames } = await pool.query<{ name: string }>("SELECT name FROM public.persons");
const lastToken = (n: string) => { const t = strip(n).toLowerCase().replace(/["“”«»(].*?["“”«»)]/gu, " ").match(/[a-zñ]+/gu) ?? []; return t[t.length - 1] ?? ""; };
const surnameCount = new Map<string, number>();
for (const { name } of allNames) { const s = lastToken(name); surnameCount.set(s, (surnameCount.get(s) ?? 0) + 1); }
const realWords = (n: string) => (strip(n).replace(/["“”«»(].*?["“”«»)]/gu, " ").match(/[\p{L}]{2,}/gu) ?? []).length;
const { rows: artistNames } = await pool.query<{ id: string; name: string; bio: string | null }>("SELECT id::text, name, biography bio FROM public.artists");
const artistById = new Map(artistNames.map((r) => [num(r.id), r]));
const mentions = (text: string | null | undefined, needle: string) => {
  if (!text || needle.length < 6) return false;
  return new RegExp(`(^|[^\\p{L}])${strip(needle).toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}([^\\p{L}]|$)`, "u").test(strip(text).toLowerCase());
};
const personKeep = new Map<string, number>();
const personRename = new Map<number, string>();
for (const p of personPairs) {
  const A = persons.get(p.a); const B = persons.get(p.b);
  if (!A || !B) continue;
  const ca = ctxOf(p.a); const cb = ctxOf(p.b);
  const shared = (x: Set<number>, y: Set<number>) => [...x].some((v) => y.has(v));
  const colA = colleagues(p.a); const colB = colleagues(p.b);
  const commonColleagues = [...colA].filter((v) => colB.has(v) && v !== p.a && v !== p.b).length;
  const project = shared(ca.artists, cb.artists) ? "misma banda o artista" : shared(ca.albums, cb.albums) ? "mismo disco" : shared(ca.tracks, cb.tracks) ? "misma pista"
    : shared(ca.orgs, cb.orgs) ? "misma organización" : commonColleagues >= 2 ? `${commonColleagues} colegas en común` : null;
  // Nombre que se compara: el canónico, o el alias que choca
  const sameKey = nameKey(A.name) === nameKey(B.name);
  const compared = sameKey ? B.name : (p.aliasName ?? B.name);
  const keyMatches = sameKey || nameKey(compared) === nameKey(A.name) || nameKey(compared) === nameKey(B.name);
  const conflict = (A.birth && B.birth && A.birth.slice(0, 4) !== B.birth.slice(0, 4)) ? "años de nacimiento distintos"
    : (A.death && B.death && A.death.slice(0, 4) !== B.death.slice(0, 4)) ? "años de muerte distintos"
      : (A.ven !== null && B.ven !== null && A.ven !== B.ven) ? "uno venezolano y el otro no" : null;
  let verdict: "merge" | "distinct"; let why: string; let strength = 1;
  if (conflict) { verdict = "distinct"; why = conflict; }
  else if (project) { verdict = "merge"; why = `mismo nombre y ${project}`; strength = 5; }
  else if (!keyMatches) { verdict = "distinct"; why = "nombres que no coinciden y sin vínculo"; }
  else if (realWords(compared) < 2) { verdict = "distinct"; why = "nombre de una palabra sin vínculo"; }
  else {
    const surname = lastToken(compared); const freq = surnameCount.get(surname) ?? 0;
    const bandsA = [...ca.artists].map((id) => artistById.get(id)).filter(Boolean); const bandsB = [...cb.artists].map((id) => artistById.get(id)).filter(Boolean);
    // La bio (de la persona o de su banda) nombra a la banda de la otra. Que la
    // bio de la banda de A nombre a A no cuenta: es el mismo nombre que B.
    const other = (list: typeof bandsA, mine: typeof bandsA) => list.filter((band) => !mine.some((m) => m!.id === band!.id));
    const bioCross = other(bandsB, bandsA).some((band) => mentions(A.bio, band!.name) || bandsA.some((m) => mentions(m!.bio, band!.name)))
      || other(bandsA, bandsB).some((band) => mentions(B.bio, band!.name) || bandsB.some((m) => mentions(m!.bio, band!.name)));
    if (realWords(compared) >= 3) { verdict = "merge"; why = "nombre completo de 3+ palabras"; strength = 2; }
    else if (freq <= 10) { verdict = "merge"; why = `apellido poco común («${surname}», ${freq} fichas)`; strength = 2; }
    else if (bioCross) { verdict = "merge"; why = "la bio de una banda nombra a la otra"; strength = 2; }
    else { verdict = "distinct"; why = `nombre común sin proyecto («${surname}», ${freq} fichas)`; }
  }
  decide("person", p.a, p.b, verdict, why, strength);
  if (verdict === "merge") {
    // Principal: la ligada a un artista (miembro), luego con bio, luego más vínculos
    const score = (id: number, r: typeof A) => (ctxOf(id).member ? 1000 : 0) + (r.bio ? 100 : 0) + ctxOf(id).links;
    personKeep.set(`${p.a}-${p.b}`, score(p.a, A) >= score(p.b, B) ? p.a : p.b);
  }
}

// ---------------------------------------------------------------------------
// Componentes: unir fusiones sin juntar dos fichas declaradas distintas
// ---------------------------------------------------------------------------
const plan: Record<string, unknown> = { generatedAt: new Date().toISOString(), merges: {}, distinct: {} };
const scoreFor = new Map<string, Map<number, number>>();
async function scores(kind: Kind, ids: number[]): Promise<Map<number, number>> {
  const sql: Record<Kind, string> = {
    person: `SELECT id, (CASE WHEN EXISTS(SELECT 1 FROM public.artist_members WHERE person_id=p.id) THEN 1000 ELSE 0 END + CASE WHEN biography IS NOT NULL THEN 100 ELSE 0 END
              + (SELECT count(*) FROM public.album_credits WHERE person_id=p.id) + (SELECT count(*) FROM public.track_credits WHERE person_id=p.id)) s FROM public.persons p WHERE id = ANY($1::bigint[])`,
    organization: `SELECT id, ((SELECT count(*) FROM public.albums x WHERE x.label_id=o.id)*3 + (SELECT count(*) FROM public.album_credits c WHERE c.organization_id=o.id)
              + (SELECT count(*) FROM public.track_credits c WHERE c.organization_id=o.id) + CASE WHEN country IS NOT NULL THEN 5 ELSE 0 END) s FROM public.organizations o WHERE id = ANY($1::bigint[])`,
    artist: `SELECT id, (SELECT count(*) FROM public.albums WHERE artist_id=a.id) + CASE WHEN biography IS NOT NULL THEN 100 ELSE 0 END s FROM public.artists a WHERE id = ANY($1::bigint[])`,
    album: `SELECT id, (SELECT count(*) FROM public.tracks WHERE album_id=al.id) s FROM public.albums al WHERE id = ANY($1::bigint[])`,
    track: `SELECT id, -id s FROM public.tracks WHERE id = ANY($1::bigint[])`,
  };
  const { rows } = await pool.query<{ id: string; s: string }>(sql[kind], [ids]);
  return new Map(rows.map((r) => [num(r.id), num(r.s)]));
}
for (const kind of ["person", "organization", "artist", "album", "track"] as Kind[]) {
  const list = decisions.filter((d) => d.kind === kind);
  const parent = new Map<number, number>();
  const find = (x: number): number => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const members = (root: number) => [...new Set([...parent.keys(), ...list.flatMap((d) => [d.a, d.b])])].filter((x) => find(x) === root);
  const distinct = list.filter((d) => d.verdict === "distinct");
  const rejected: Decision[] = [];
  for (const d of list.filter((x) => x.verdict === "merge").sort((x, y) => y.strength - x.strength)) {
    const ra = find(d.a); const rb = find(d.b);
    if (ra === rb) continue;
    const ma = members(ra); const mb = members(rb);
    const clash = distinct.some((x) => (ma.includes(x.a) && mb.includes(x.b)) || (ma.includes(x.b) && mb.includes(x.a)))
      || ma.some((x) => mb.some((y) => alreadyDistinct.has(`${kind}:${Math.min(x, y)}-${Math.max(x, y)}`)));
    if (clash) { rejected.push(d); continue; }
    parent.set(rb, ra);
  }
  // Pares que una fusión rechazada deja sin decidir: quedan distintos con su motivo
  for (const d of rejected) distinct.push({ ...d, verdict: "distinct", why: `${d.why}, pero el grupo choca con un par distinto` });
  const ids = [...new Set(list.flatMap((d) => [d.a, d.b]))];
  const s = await scores(kind, ids);
  scoreFor.set(kind, s);
  const groups = new Map<number, number[]>();
  for (const id of ids) { const r = find(id); if (r !== id || list.some((d) => d.verdict === "merge" && (d.a === id || d.b === id))) (groups.get(r) ?? groups.set(r, []).get(r)!).push(id); }
  const merges = [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const forced = kind === "artist" ? g.find((id) => ARTIST_MERGES.some(([k]) => k === id)) : undefined;
    const keep = forced ?? [...g].sort((x, y) => (s.get(y) ?? 0) - (s.get(x) ?? 0) || x - y)[0]!;
    return { keep, drops: g.filter((id) => id !== keep), why: list.filter((d) => d.verdict === "merge" && g.includes(d.a) && g.includes(d.b)).map((d) => d.why) };
  });
  // Distintos: los pares no fusionados de la lista (dos ids en el mismo grupo ya no lo son)
  const distinctOut = [...new Map(distinct.filter((d) => find(d.a) !== find(d.b)).map((d) => [`${d.a}-${d.b}`, d])).values()].map((d) => ({ a: d.a, b: d.b, why: d.why }));
  (plan["merges"] as Record<string, unknown>)[kind] = merges;
  (plan["distinct"] as Record<string, unknown>)[kind] = distinctOut;
}
// Renombre cuando solo cambian tildes: por palabra manda la grafía más usada
// en todo el catálogo de personas («Heraclio» gana a «Heráclio», «Rubén» a «Ruben»).
const tokenFreq = new Map<string, number>();
for (const { name } of allNames) for (const t of name.match(/[\p{L}]+/gu) ?? []) tokenFreq.set(t.toLowerCase(), (tokenFreq.get(t.toLowerCase()) ?? 0) + 1);
const spellingScore = (n: string) => (n.match(/[\p{L}]+/gu) ?? []).reduce((sum, t) => sum + Math.log(1 + (tokenFreq.get(t.toLowerCase()) ?? 0)), 0);
const personMerges = (plan["merges"] as Record<string, Array<{ keep: number; drops: number[] }>>)["person"]!;
for (const g of personMerges) {
  const keepName = persons.get(g.keep)?.name ?? "";
  const options = [g.keep, ...g.drops].map((id) => persons.get(id)?.name ?? "").filter((n) => strip(n).toLowerCase() === strip(keepName).toLowerCase() && n !== keepName);
  const best = options.sort((x, y) => spellingScore(y) - spellingScore(x))[0];
  // Solo tildes (no mayúsculas: «AmaSónica» no se toca) y solo si gana con claridad
  const marks = (n: string) => (n.normalize("NFD").match(/\p{M}/gu) ?? []).length;
  // Nunca se quitan tildes: si la grafía más usada no las tiene, se queda como está.
  if (best && strip(best) === strip(keepName) && marks(best) > marks(keepName) && spellingScore(best) > spellingScore(keepName) + 0.5) personRename.set(g.keep, best);
}
plan["personRenames"] = Object.fromEntries(personRename);
void personKeep; void artistKeep; void scoreFor;

// ---------------------------------------------------------------------------
// Cola: careos de la Mesa
// ---------------------------------------------------------------------------
const mesa: Array<{ reviewId: number; verdict: "same" | "dismiss"; why: string }> = [];
const { rows: mesaRows } = await pool.query<{ id: string; kind: string; claim: string; cand: string | null; cand_name: string | null; same_name: string | null }>(`
  SELECT r.id::text, r.kind::text, c.raw_value#>>'{}' claim, er.candidates->0->>'candidateId' cand, er.candidates->0->>'canonicalName' cand_name,
         CASE r.kind WHEN 'person_match' THEN (SELECT string_agg(p.id::text, ',') FROM public.persons p WHERE lower(p.name)=lower(c.raw_value#>>'{}'))
                     WHEN 'album_match' THEN (SELECT string_agg(a.id::text, ',') FROM public.albums a WHERE lower(a.title)=lower(c.raw_value#>>'{}'))
                     ELSE (SELECT string_agg(o.id::text, ',') FROM public.organizations o WHERE lower(o.name)=lower(c.raw_value#>>'{}')) END same_name
    FROM ingest.review_queue r JOIN ingest.claims c ON c.id=r.claim_a_id
    LEFT JOIN ingest.entity_resolution_decisions er ON er.id=(r.payload->>'resolutionDecisionId')::bigint
   WHERE r.status IN ('open','in_progress') AND r.kind IN ('person_match','album_match','organization_match')`);
const ALBUM_SAME = new Set([253075, 253076, 253081, 253083, 253086, 253091, 253093, 253095, 253096]);
for (const r of mesaRows) {
  const id = num(r.id);
  if (r.kind === "person_match") {
    if (r.cand_name && nameKey(r.cand_name) === nameKey(r.claim)) mesa.push({ reviewId: id, verdict: "same", why: "nombre exacto del candidato (alta del mismo lote)" });
    else mesa.push({ reviewId: id, verdict: "dismiss", why: r.same_name ? `la ficha ya existe aparte (#${r.same_name})` : "sin vínculos: no hay nada que crear" });
  } else if (r.kind === "organization_match") {
    if (r.cand && ["1824", "1215"].includes(r.cand)) mesa.push({ reviewId: id, verdict: "same", why: `errata o forma corta de «${r.cand_name}»` });
    else mesa.push({ reviewId: id, verdict: "dismiss", why: `«${r.claim}» no es «${r.cand_name}» y no tiene vínculos` });
  } else if (ALBUM_SAME.has(id)) mesa.push({ reviewId: id, verdict: "same", why: `mismo disco que «${r.cand_name}» (título de la discografía de Brian)` });
  else mesa.push({ reviewId: id, verdict: "dismiss", why: r.same_name ? `el disco ya existe aparte (#${r.same_name}); el par se decide en discos` : `«${r.claim}» no es «${r.cand_name}»: no se crea un disco vacío` });
}
plan["mesa"] = mesa;

// Lo que no está en ningún par y debe cerrarse igual
plan["labelIsArtist"] = findings.filter((f) => f.detector === "sello_que_es_artista").map((f) => num(f.id));
writeFileSync(OUT, JSON.stringify(plan, null, 1));
const count = (k: string) => Object.fromEntries(Object.entries(plan[k] as Record<string, unknown[]>).map(([kind, list]) => [kind, list.length]));
console.log("fusiones (grupos):", count("merges"));
console.log("distintos (pares):", count("distinct"));
console.log("renombres:", personRename.size, "· mesa:", mesa.length, "· sello=artista:", (plan["labelIsArtist"] as unknown[]).length, "→", OUT);
await closeDb();
