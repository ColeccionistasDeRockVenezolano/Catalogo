// CRV · Plan v2 del primo, etapa 3 (puntos 3 y 4): identidades por tilde,
// abreviaturas dentro de una banda, discos repetidos y artistas sin tilde.
// Plan: ~/Desktop/Plan v2 primo/PLAN_POR_ETAPAS.md. D3 con la recomendación
// del plan: se fusiona solo con proyecto común y se renombra a la grafía con
// tilde sin preguntar; lo que no tenga vínculo va a la cola.
//
// Este script NO escribe en la base: lee el catálogo y deja el plan en
// reports/plan-v2-etapa3/plan.json. Lo aplica scripts/plan-v2-etapa3-apply.ts
// (un run por bloque).
//
//   3a · Personas que solo difieren en tildes o mayúsculas. Regla vigente
//        ([[fusion-personas-solo-con-proyecto]]): misma banda o artista, mismo
//        disco no recopilatorio, misma pista, misma organización o ≥2 colegas.
//        Sin vínculo → cola (person_duplicate). Nombre: la grafía con tilde,
//        salvo que el catálogo casi nunca la escriba así («Heráclio»); si el
//        canal da una de las grafías, manda el canal.
//   3b · «A. Cazalis» o «Cazalis» frente al nombre completo de un integrante:
//        la evidencia es la banda (créditos en sus discos) o la misma canción
//        compuesta (una versión de otra banda). Si la abreviatura encaja con
//        dos integrantes, va a la cola.
//   3c · Discos del mismo artista con la misma clave sin tildes, espacios ni
//        signos, o con el año pegado al título («En Vivo 2008» / «En Vivo»), o
//        cuyo alias es el título del otro. Se confirma con las pistas: una
//        ficha vacía o ≥60 % de títulos en común, y año a ±1.
//   3d · Artistas cuyo nombre es la forma sin tilde de lo que escriben sus
//        fuentes («Cronica» → «Crónica»).
//
//   ./scripts/with-node22.sh npx tsx scripts/plan-v2-etapa3-plan.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { compactKey } from "../src/curation/lexicon.js";
import { previewAlbumMerge } from "../src/merge/album-merge.js";
import { nameWithoutNickname } from "../src/review/person-names.js";

const OUT_DIR = "reports/plan-v2-etapa3";
const VARIOUS = 257;
const pool = getPool();
const num = (v: unknown) => Number(v);
const marks = (s: string) => (s.normalize("NFD").match(/\p{M}/gu) ?? []).length;
const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
/** Clave de 3a/3d: sin tildes ni mayúsculas, con los espacios colapsados. */
const accentKey = (s: string) => strip(s).toLowerCase().replace(/\s+/gu, " ").trim();
const badCase = (s: string) => s === s.toLowerCase() || (s === s.toUpperCase() && /\p{L}{3}/u.test(s));

/**
 * Jerarquía de verdad: libros > canal > hoja > Hippito > RHV > Sincopa > blogs > APIs.
 * «crv-operador» no cuenta como humano: la mayoría de sus claims los dejaron
 * scripts de alta (el título actual ya entra como candidato aparte).
 */
const SOURCE_RANK: Record<string, number> = {
  hemeroteka: 95, "youtube-data-api": 90, "yt-master-seed": 85, "hippito-y-sus-chatarritas": 80,
  "rock-hecho-en-venezuela": 70, "rhv-blogspot": 68, sincopa: 60, "metal-archives": 55,
  "descargas-metal-venezolano": 50, rockzuela: 50, "rock-de-vzla": 50, "el-punk-en-venezuela": 50, "coleccionistas-de-rock-venezolano": 50,
  wikipedia: 45, musicavenezuela: 40, rateyourmusic: 40,
  musicbrainz: 35, discogs: 35, deezer: 35, spotify: 35, itunes: 35, "wikidata-api": 35,
};
const rank = (slug: string) => SOURCE_RANK[slug] ?? (slug === "_actual" ? 25 : slug.startsWith("crv-") ? 20 : 30);

// ---------------------------------------------------------------------------
// Pares ya decididos: no se reabren.
// ---------------------------------------------------------------------------
// Un par cerrado como «distintas» POR FALTA DE VÍNCULO («sin proyecto», «una
// palabra») se reabre solo si hoy hay proyecto común: es evidencia nueva. Los
// cerrados por época, roles o a mano no se tocan.
const NO_LINK = /sin proyecto|sin v[ií]nculo|una palabra/iu;
const distinctRows = (await pool.query<{ kind: string; a: string; b: string; note: string }>(
  "SELECT kind, a_id::text a, b_id::text b, note FROM ingest.curation_distinct_pairs")).rows;
const distinct = new Set(distinctRows.map((r) => `${r.kind}:${r.a}-${r.b}`));
const distinctHard = new Set(distinctRows.filter((r) => !NO_LINK.test(r.note)).map((r) => `${r.kind}:${r.a}-${r.b}`));
const reviewRows = (await pool.query<{ a: string; b: string; live: boolean; dismissed: boolean; hard: boolean }>(`
  SELECT LEAST(person_a_id, person_b_id)::text a, GREATEST(person_a_id, person_b_id)::text b,
         bool_or(status IN ('open','in_progress')) live, bool_or(status='dismissed') dismissed,
         bool_or(status='dismissed' AND coalesce(resolution_note,'') !~* 'sin proyecto|sin v[ií]nculo|una palabra') hard
    FROM ingest.review_queue
   WHERE kind::text IN ('person_duplicate','person_match') AND person_a_id IS NOT NULL AND person_b_id IS NOT NULL
   GROUP BY 1,2`)).rows;
const reviewDismissed = new Set(reviewRows.filter((r) => r.dismissed).map((r) => `${r.a}-${r.b}`));
const reviewHard = new Set(reviewRows.filter((r) => r.hard).map((r) => `${r.a}-${r.b}`));
const reviewLive = new Set(reviewRows.filter((r) => r.live).map((r) => `${r.a}-${r.b}`));
const pk = (x: number, y: number) => `${Math.min(x, y)}-${Math.max(x, y)}`;
/** "hard": cerrado por otro motivo; "nolink": cerrado por falta de vínculo; null: abierto. */
const personSettled = (x: number, y: number): "hard" | "nolink" | null =>
  distinctHard.has(`person:${pk(x, y)}`) || reviewHard.has(pk(x, y)) ? "hard"
    : distinct.has(`person:${pk(x, y)}`) || reviewDismissed.has(pk(x, y)) ? "nolink" : null;

// ---------------------------------------------------------------------------
// Personas: datos y vínculos de proyecto
// ---------------------------------------------------------------------------
interface Person { id: number; name: string; bio: boolean; birth: string | null; death: string | null; ven: boolean | null }
const persons = new Map((await pool.query<{ id: string; name: string; bio: boolean; birth: string | null; death: string | null; ven: boolean | null }>(`
  SELECT id::text, name, biography IS NOT NULL bio, birth_date::text birth, death_date::text death, is_venezuelan ven FROM public.persons`))
  .rows.map((r) => [num(r.id), { ...r, id: num(r.id) } as Person]));

interface Ctx { artists: Set<number>; memberOf: Set<number>; albums: Set<number>; tracks: Set<number>; orgs: Set<number>; composed: Set<number>; links: number }
const ctx = new Map<number, Ctx>();
const ctxOf = (id: number) => ctx.get(id) ?? ctx.set(id, { artists: new Set(), memberOf: new Set(), albums: new Set(), tracks: new Set(), orgs: new Set(), composed: new Set(), links: 0 }).get(id)!;
const linkRows = (await pool.query<{ person_id: string; artist_id: string | null; album_id: string | null; track_id: string | null; org_id: string | null; member: boolean; composer: boolean }>(`
  SELECT m.person_id::text, m.artist_id::text, NULL::text album_id, NULL::text track_id, NULL::text org_id, true member, false composer FROM public.artist_members m
  UNION ALL
  SELECT c.person_id::text, al.artist_id::text, CASE WHEN al.album_type <> 'compilation' AND al.artist_id <> ${VARIOUS} THEN al.id::text END, NULL, NULL, false, false
    FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE c.person_id IS NOT NULL
  UNION ALL
  SELECT c.person_id::text, al.artist_id::text, CASE WHEN al.album_type <> 'compilation' AND al.artist_id <> ${VARIOUS} THEN al.id::text END, t.id::text, NULL, false,
         c.credit_type::text IN ('composer','lyricist','songwriter') OR c.role ILIKE '%compos%'
    FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id WHERE c.person_id IS NOT NULL
  UNION ALL
  SELECT po.person_id::text, NULL, NULL, NULL, po.organization_id::text, false, false FROM public.person_organizations po`)).rows;
for (const l of linkRows) {
  const c = ctxOf(num(l.person_id));
  c.links += 1;
  if (l.artist_id && num(l.artist_id) !== VARIOUS) c.artists.add(num(l.artist_id));
  if (l.member && l.artist_id) c.memberOf.add(num(l.artist_id));
  if (l.album_id) c.albums.add(num(l.album_id));
  if (l.track_id) { c.tracks.add(num(l.track_id)); if (l.composer) c.composed.add(num(l.track_id)); }
  if (l.org_id) c.orgs.add(num(l.org_id));
}
const peopleOnAlbum = new Map<number, Set<number>>();
for (const [pid, c] of ctx) for (const a of c.albums) (peopleOnAlbum.get(a) ?? peopleOnAlbum.set(a, new Set()).get(a)!).add(pid);
const colleagues = (id: number) => new Set([...(ctx.get(id)?.albums ?? [])].flatMap((a) => [...(peopleOnAlbum.get(a) ?? [])]).filter((p) => p !== id));
const shared = (x: Set<number>, y: Set<number>) => [...x].find((v) => y.has(v));
const artistNames = new Map((await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists")).rows.map((r) => [num(r.id), r.name]));

function projectLink(a: number, b: number): string | null {
  const ca = ctxOf(a); const cb = ctxOf(b);
  const artist = shared(ca.artists, cb.artists);
  if (artist !== undefined) return `misma banda o artista (${artistNames.get(artist) ?? artist})`;
  const album = shared(ca.albums, cb.albums);
  if (album !== undefined) return `mismo disco (${album})`;
  const track = shared(ca.tracks, cb.tracks);
  if (track !== undefined) return `misma pista (${track})`;
  if (shared(ca.orgs, cb.orgs) !== undefined) return "misma organización";
  const colB = colleagues(b);
  const common = [...colleagues(a)].filter((p) => colB.has(p) && p !== a && p !== b).length;
  return common >= 2 ? `${common} colegas en común` : null;
}
function dataConflict(A: Person, B: Person): string | null {
  if (A.birth && B.birth && A.birth.slice(0, 4) !== B.birth.slice(0, 4)) return "años de nacimiento distintos";
  if (A.death && B.death && A.death.slice(0, 4) !== B.death.slice(0, 4)) return "años de muerte distintos";
  if (A.ven !== null && B.ven !== null && A.ven !== B.ven) return "uno venezolano y el otro no";
  return null;
}
const personScore = (id: number) => (ctxOf(id).memberOf.size ? 1000 : 0) + (persons.get(id)?.bio ? 100 : 0) + ctxOf(id).links;

// Frecuencia de cada grafía de palabra en el catálogo de personas (guarda «Heráclio»).
const tokenFreq = new Map<string, number>();
for (const p of persons.values()) for (const t of p.name.split(/\s+/u)) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
/** Una grafía con tilde que el catálogo escribe casi siempre sin ella (menos de 1 de cada 4) no se elige. */
const rareAccent = (name: string) => name.split(/\s+/u).some((t) => {
  if (!marks(t)) return false;
  const plain = [...tokenFreq.entries()].filter(([k]) => k !== t && accentKey(k) === accentKey(t) && !marks(k)).reduce((s, [, n]) => s + n, 0);
  return (tokenFreq.get(t) ?? 0) * 3 < plain;
});

// Nombres que da el canal para cada persona.
const channelNames = new Map<number, Set<string>>();
for (const r of (await pool.query<{ person_id: string; v: string }>(`
  SELECT c.person_id::text, c.raw_value#>>'{}' v FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
   WHERE s.slug='youtube-data-api' AND c.person_id IS NOT NULL AND c.field='name' AND jsonb_typeof(c.raw_value)='string'`)).rows) {
  (channelNames.get(num(r.person_id)) ?? channelNames.set(num(r.person_id), new Set()).get(num(r.person_id))!).add(r.v.trim());
}

function chooseName(ids: number[]): { name: string; why: string } {
  const variants = [...new Set(ids.map((id) => persons.get(id)!.name))];
  const channel = [...new Set(ids.flatMap((id) => [...(channelNames.get(id) ?? [])]))].filter((v) => variants.includes(v) && !badCase(v));
  if (channel.length === 1) return { name: channel[0]!, why: "grafía del canal" };
  const ok = variants.filter((v) => !badCase(v) && !rareAccent(v));
  const pool2 = ok.length ? ok : variants.filter((v) => !badCase(v)).length ? variants.filter((v) => !badCase(v)) : variants;
  pool2.sort((x, y) => marks(y) - marks(x) || ids.filter((id) => persons.get(id)!.name === y).length - ids.filter((id) => persons.get(id)!.name === x).length || x.localeCompare(y));
  const best = pool2[0]!;
  return { name: best, why: marks(best) ? "grafía con tilde" : variants.some((v) => marks(v)) ? "la tilde es rara en el catálogo" : "mayúsculas correctas" };
}

// ---------------------------------------------------------------------------
// 3a · Variantes por tilde o mayúsculas
// ---------------------------------------------------------------------------
interface MergeGroup { block: string; keep: number; keepName: string; name: string; nameWhy: string; drops: number[]; names: string[]; why: string[] }
interface QueuePair { block: string; a: number; b: number; aName: string; bName: string; why: string }
interface Discard { block: string; ids: number[]; names: string[]; why: string }
const merges3a: MergeGroup[] = []; const queue3a: QueuePair[] = []; const discard3a: Discard[] = [];
const byAccent = new Map<string, number[]>();
for (const p of persons.values()) { const k = accentKey(p.name); if (k) (byAccent.get(k) ?? byAccent.set(k, []).get(k)!).push(p.id); }
let groups3a = 0; let persons3a = 0;
for (const ids of byAccent.values()) {
  if (new Set(ids.map((id) => persons.get(id)!.name)).size < 2) continue;
  groups3a += 1; persons3a += ids.length;
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!));
  const pairInfo: Array<{ a: number; b: number; link: string | null; settled: boolean; conflict: string | null; reopened: boolean }> = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const a = ids[i]!; const b = ids[j]!;
    const state = personSettled(a, b);
    const conflict = dataConflict(persons.get(a)!, persons.get(b)!);
    const link = state === "hard" || conflict ? null : projectLink(a, b);
    // Cerrado por falta de vínculo y sigue sin vínculo: se respeta la decisión.
    const settled = state === "hard" || (state === "nolink" && !link);
    pairInfo.push({ a, b, link, settled, conflict, reopened: state === "nolink" && !!link });
    if (link) parent.set(find(a), find(b));
  }
  const comps = new Map<number, number[]>();
  for (const id of ids) (comps.get(find(id)) ?? comps.set(find(id), []).get(find(id))!).push(id);
  const mergedInto = new Map<number, number>();
  for (const comp of comps.values()) {
    if (comp.length < 2) continue;
    const inside = pairInfo.filter((p) => comp.includes(p.a) && comp.includes(p.b));
    const blocker = inside.find((p) => p.settled || p.conflict);
    if (blocker) {
      discard3a.push({ block: "3a", ids: comp, names: comp.map((id) => persons.get(id)!.name), why: `grupo con un par ${blocker.settled ? "ya declarado distinto" : blocker.conflict}: no se fusiona` });
      continue;
    }
    const keep = [...comp].sort((x, y) => personScore(y) - personScore(x) || x - y)[0]!;
    const drops = comp.filter((id) => id !== keep);
    const { name, why } = chooseName(comp);
    merges3a.push({ block: "3a", keep, keepName: persons.get(keep)!.name, name, nameWhy: why, drops, names: comp.map((id) => persons.get(id)!.name),
      why: inside.filter((p) => p.link).map((p) => `${p.a}~${p.b}: ${p.link}${p.reopened ? " (cerrado antes por falta de vínculo; hoy lo tiene)" : ""}`) });
    for (const id of comp) mergedInto.set(id, keep);
  }
  for (const p of pairInfo) {
    const ra = mergedInto.get(p.a) ?? p.a; const rb = mergedInto.get(p.b) ?? p.b;
    if (ra === rb) continue;
    if (p.settled) { discard3a.push({ block: "3a", ids: [p.a, p.b], names: [persons.get(p.a)!.name, persons.get(p.b)!.name], why: personSettled(p.a, p.b) === "hard" ? "ya declarados distintos" : "ya cerrados como distintos por falta de vínculo y siguen sin él" }); continue; }
    if (p.conflict) { discard3a.push({ block: "3a", ids: [p.a, p.b], names: [persons.get(p.a)!.name, persons.get(p.b)!.name], why: p.conflict }); continue; }
    if (p.link) continue; // unidos por otro camino que quedó bloqueado
    // Solo un par por grafía distinta: dos «José González» idénticos ya los vio otra pasada.
    if (persons.get(p.a)!.name === persons.get(p.b)!.name) continue;
    if (reviewLive.has(pk(p.a, p.b))) continue;
    queue3a.push({ block: "3a", a: p.a, b: p.b, aName: persons.get(p.a)!.name, bName: persons.get(p.b)!.name, why: "misma grafía salvo tildes, sin proyecto común" });
  }
}

// ---------------------------------------------------------------------------
// 3b · Abreviaturas y apellidos sueltos frente a un integrante
// ---------------------------------------------------------------------------
const tokensOf = (name: string) => nameWithoutNickname(name).split(/\s+/u).filter(Boolean);
const INITIALS = /^((?:\p{Lu}\.\s*){1,3})\s*(\p{L}[\p{L}'-]+(?:\s+\p{L}[\p{L}'-]+)?)$/u;
const SINGLE = /^\p{Lu}[\p{L}'-]{2,}$/u;
interface Member { pid: number; tokens: string[] }
const membersByArtist = new Map<number, Member[]>();
for (const r of (await pool.query<{ artist_id: string; person_id: string }>("SELECT DISTINCT artist_id::text, person_id::text FROM public.artist_members")).rows) {
  const p = persons.get(num(r.person_id)); if (!p) continue;
  const tokens = tokensOf(p.name);
  if (tokens.length < 2 || INITIALS.test(p.name.trim())) continue;
  (membersByArtist.get(num(r.artist_id)) ?? membersByArtist.set(num(r.artist_id), []).get(num(r.artist_id))!).push({ pid: p.id, tokens });
}
// Títulos de pistas por artista (para la canción compuesta que otra banda versiona).
const trackTitle = new Map<number, string>(); const titleArtists = new Map<string, Set<number>>();
const trackRows = (await pool.query<{ id: string; title: string; artist_id: string }>(`
  SELECT t.id::text, t.title, al.artist_id::text FROM public.tracks t JOIN public.albums al ON al.id=t.album_id`)).rows;
const trackArtist = new Map<number, number>();
for (const r of trackRows) {
  const key = compactKey(r.title); trackTitle.set(num(r.id), key); trackArtist.set(num(r.id), num(r.artist_id));
  if (key.length >= 4 && num(r.artist_id) !== VARIOUS) (titleArtists.get(key) ?? titleArtists.set(key, new Set()).get(key)!).add(num(r.artist_id));
}
// Compositores de cada canción en el catálogo de cada banda («artista|clave» → personas).
const songComposers = new Map<string, Set<number>>();
for (const [pid, c] of ctx) for (const t of c.composed) {
  const key = `${trackArtist.get(t)}|${trackTitle.get(t)}`;
  (songComposers.get(key) ?? songComposers.set(key, new Set()).get(key)!).add(pid);
}
/** En la banda, esa canción la firma el integrante o alguien con su apellido. */
const bandSignsSong = (artist: number, key: string, full: number, surname: string[]) =>
  [...(songComposers.get(`${artist}|${key}`) ?? [])].some((pid) => pid === full
    || (persons.get(pid) && ` ${tokensOf(persons.get(pid)!.name).join(" ")} `.includes(` ${surname.join(" ")} `)));
function matchMembers(artist: number, initials: string[], surname: string[]): Member[] {
  return (membersByArtist.get(artist) ?? []).filter((m) => {
    // Nombres de 2 a 4 palabras: más largos suelen ser varias personas en una ficha.
    if (m.tokens.length < 2 || m.tokens.length > 4) return false;
    // El apellido (una o dos palabras) es el primero o el segundo apellido: una
    // de las dos últimas posiciones, nunca el nombre de pila.
    const at = m.tokens.findIndex((t, i) => i >= 1 && surname.every((s, k) => m.tokens[i + k] === s));
    if (at < 1 || at + surname.length < m.tokens.length - 1) return false;
    return initials.every((ini, i) => m.tokens[i]?.startsWith(ini));
  });
}
const merges3b: MergeGroup[] = []; const queue3b: QueuePair[] = []; const discard3b: Discard[] = [];
const absorbed3a = new Set(merges3a.flatMap((g) => g.drops));
const targets3b = new Map<number, { short: number[]; why: string[] }>();
for (const p of persons.values()) {
  if (absorbed3a.has(p.id)) continue;
  const raw = p.name.trim();
  const m = INITIALS.exec(raw);
  let initials: string[] = []; let surname: string[];
  if (m) {
    initials = strip(m[1]!).toLowerCase().match(/\p{L}/gu) ?? [];
    surname = tokensOf(m[2]!);
  } else if (SINGLE.test(raw) && !/^(dj|mc)$/iu.test(raw)) {
    surname = tokensOf(raw);
  } else continue;
  if (!surname.length || surname.some((t) => t.length < 3)) continue;
  const c = ctxOf(p.id);
  const found = new Map<number, string>();
  let ambiguous: string | null = null;
  const ambiguousHits = new Set<number>();
  for (const artist of c.artists) {
    const hits = matchMembers(artist, initials, surname).filter((h) => h.pid !== p.id);
    if (hits.length > 1) { ambiguous = `${artistNames.get(artist)}: ${hits.map((h) => persons.get(h.pid)!.name).join(" / ")}`; hits.forEach((h) => ambiguousHits.add(h.pid)); }
    else if (hits.length === 1) found.set(hits[0]!.pid, `integrante de ${artistNames.get(artist)}, acreditado en sus discos`);
  }
  // La canción que compuso la graba otra banda: se busca en la banda que la tiene como propia.
  if (!found.size && !ambiguous) {
    for (const track of c.composed) {
      const key = trackTitle.get(track); if (!key) continue;
      for (const artist of titleArtists.get(key) ?? []) {
        if (c.artists.has(artist)) continue;
        const hits = matchMembers(artist, initials, surname).filter((h) => h.pid !== p.id && bandSignsSong(artist, key, h.pid, surname));
        if (hits.length > 1) { ambiguous = `${artistNames.get(artist)}: ${hits.map((h) => persons.get(h.pid)!.name).join(" / ")}`; hits.forEach((h) => ambiguousHits.add(h.pid)); }
        else if (hits.length === 1) found.set(hits[0]!.pid, `compuso «${key}», canción de ${artistNames.get(artist)} donde ${persons.get(hits[0]!.pid)!.name} es integrante`);
      }
    }
  }
  // Un apellido suelto sin iniciales necesita además ser solo de esa banda.
  if (!initials.length && found.size === 1) {
    const full = [...found.keys()][0]!;
    const outside = [...c.artists].filter((a) => !ctxOf(full).artists.has(a));
    if (outside.length) { ambiguous = `«${raw}» también aparece en ${outside.map((a) => artistNames.get(a)).join(", ")}`; found.clear(); found.set(full, ""); }
  }
  if (ambiguous || found.size > 1) {
    for (const full of new Set([...found.keys(), ...ambiguousHits])) if (!personSettled(p.id, full) && !reviewLive.has(pk(p.id, full))) queue3b.push({ block: "3b", a: full, b: p.id, aName: persons.get(full)!.name, bName: raw, why: `abreviatura dudosa: ${ambiguous ?? "encaja con varios integrantes"}` });
    continue;
  }
  if (found.size !== 1) continue;
  const [full, why] = [...found.entries()][0]!;
  if (personSettled(p.id, full) === "hard") { discard3b.push({ block: "3b", ids: [full, p.id], names: [persons.get(full)!.name, raw], why: "ya declarados distintos" }); continue; }
  const conflict = dataConflict(persons.get(full)!, p);
  if (conflict) { discard3b.push({ block: "3b", ids: [full, p.id], names: [persons.get(full)!.name, raw], why: conflict }); continue; }
  const t = targets3b.get(full) ?? targets3b.set(full, { short: [], why: [] }).get(full)!;
  t.short.push(p.id); t.why.push(`${p.id} «${raw}»: ${why}`);
}
// Si el integrante fue absorbido en 3a, la abreviatura va a la ficha que queda.
const keep3a = new Map(merges3a.flatMap((g) => g.drops.map((d) => [d, g.keep] as const)));
for (const [full, t] of targets3b) {
  const keep = keep3a.get(full) ?? full;
  const name = merges3a.find((g) => g.keep === keep)?.name ?? persons.get(keep)!.name;
  merges3b.push({ block: "3b", keep, keepName: name, name, nameWhy: "nombre completo del integrante", drops: t.short, names: [name, ...t.short.map((id) => persons.get(id)!.name)], why: t.why });
}

// ---------------------------------------------------------------------------
// 3c · Discos repetidos del mismo artista
// ---------------------------------------------------------------------------
const albums = (await pool.query<{ id: string; artist_id: string; title: string; y: number | null; type: string; n: string }>(`
  SELECT al.id::text, al.artist_id::text, al.title, al.release_year y, al.album_type::text type,
         (SELECT count(*) FROM public.tracks t WHERE t.album_id=al.id)::text n
    FROM public.albums al WHERE al.artist_id <> ${VARIOUS}`)).rows.map((r) => ({ ...r, id: num(r.id), artist: num(r.artist_id), n: num(r.n) }));
const albumById = new Map(albums.map((a) => [a.id, a]));
const albumAliases = (await pool.query<{ album_id: string; alias: string }>("SELECT album_id::text, alias FROM ingest.album_aliases")).rows;
const YEAR_TAIL = /[\s([-]*((?:19|20)\d\d)[)\]]?\s*$/u;
const keysOf = new Map<string, Set<number>>();
const addKey = (key: string, id: number) => { if (key.split("|")[1]!.length >= 2) (keysOf.get(key) ?? keysOf.set(key, new Set()).get(key)!).add(id); };
for (const a of albums) {
  addKey(`${a.artist}|${compactKey(a.title)}`, a.id);
  const tail = YEAR_TAIL.exec(a.title);
  if (tail && a.title.slice(0, tail.index).trim().length >= 2) addKey(`${a.artist}|${compactKey(a.title.slice(0, tail.index))}`, a.id);
}
for (const al of albumAliases) { const a = albumById.get(num(al.album_id)); if (a) addKey(`${a.artist}|${compactKey(al.alias)}`, a.id); }
const albumPairs = new Map<string, { a: number; b: number }>();
for (const ids of keysOf.values()) {
  const list = [...ids];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const [a, b] = list[i]! < list[j]! ? [list[i]!, list[j]!] : [list[j]!, list[i]!];
    albumPairs.set(`${a}-${b}`, { a, b });
  }
}
// Fuentes de título de cada disco (para elegir la grafía de mayor rango).
const titleClaims = new Map<number, Array<{ slug: string; v: string }>>();
for (const r of (await pool.query<{ album_id: string; slug: string; v: string }>(`
  SELECT c.album_id::text, s.slug, c.raw_value#>>'{}' v FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
   WHERE c.album_id = ANY($1::bigint[]) AND c.field='title' AND c.status IN ('accepted','superseded') AND jsonb_typeof(c.raw_value)='string'`,
[[...new Set([...albumPairs.values()].flatMap((p) => [p.a, p.b]))]])).rows) {
  (titleClaims.get(num(r.album_id)) ?? titleClaims.set(num(r.album_id), []).get(num(r.album_id))!).push({ slug: r.slug, v: r.v.trim() });
}
const hojaAlbums = new Set((await pool.query<{ album_id: string }>(`
  SELECT DISTINCT c.album_id::text FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
   WHERE s.slug IN ('yt-master-seed','youtube-data-api') AND c.album_id IS NOT NULL`)).rows.map((r) => num(r.album_id)));
interface AlbumMerge { keep: number; drop: number; artist: string; keepTitle: string; dropTitle: string; title: string | null; titleWhy: string; recordedNote: string | null; mode: "match" | "append"; keepDiscTitle: string | null; dropDiscTitle: string | null; why: string }
// Casos guía del plan que una pasada automática había cerrado como distintos:
// «2LadosB» (EP de MusicBrainz, 2 pistas) está entero dentro de «2 Lados B».
const GUIDE_ALBUM_PAIRS = new Set(["517-14026"]);
const merges3c: AlbumMerge[] = []; const doubts3c: Array<{ a: number; b: number; artist: string; titles: string[]; why: string }> = [];
const albumUsed = new Set<number>();
for (const { a, b } of [...albumPairs.values()].sort((x, y) => x.a - y.a || x.b - y.b)) {
  const A = albumById.get(a)!; const B = albumById.get(b)!;
  const artist = artistNames.get(A.artist) ?? String(A.artist);
  if (distinct.has(`album:${a}-${b}`) && !GUIDE_ALBUM_PAIRS.has(`${a}-${b}`)) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: "ya declarados distintos" }); continue; }
  if (albumUsed.has(a) || albumUsed.has(b)) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: "uno de los dos ya entra en otra fusión de esta tanda; se revisa en la siguiente pasada" }); continue; }
  if (A.y && B.y && Math.abs(A.y - B.y) > 1) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: `años distintos (${A.y} / ${B.y}): reedición u homónimo` }); continue; }
  const score = (x: typeof A) => (hojaAlbums.has(x.id) ? 1000 : 0) + x.n * 10 + (x.y ? 1 : 0);
  const [keepA, dropA] = score(A) >= score(B) ? [A, B] : [B, A];
  const preview = await previewAlbumMerge(pool, keepA.id, dropA.id);
  const s = preview.suggestion;
  const empty = keepA.n === 0 || dropA.n === 0;
  const byTitle = preview.matchedTracks.filter((m) => m.matchType !== "position").length;
  const smaller = Math.min(keepA.n, dropA.n);
  const sameList = smaller > 0 && byTitle / smaller >= 0.6;
  if (!empty && !sameList) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: `pistas distintas (${byTitle} de ${smaller} coinciden por título)` }); continue; }
  if (keepA.n === 0 && dropA.n === 0) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: "las dos fichas sin pistas: no hay con qué confirmar" }); continue; }
  // «Demo 2010» y «Demo 2011»: dos años distintos en el título son dos discos.
  const tails = [keepA.title, dropA.title].map((t) => YEAR_TAIL.exec(t)?.[1] ?? null);
  if (tails[0] && tails[1] && tails[0] !== tails[1]) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: `años distintos en el título (${tails.join(" / ")})` }); continue; }
  // Lista distinta y un título es parte del otro: el motor lo sumaría como otro disco.
  if (s.mode === "append" && !sameList && !empty) { doubts3c.push({ a, b, artist, titles: [A.title, B.title], why: `el motor sugiere sumarlo como otro disco: ${s.reason}` }); continue; }
  // Título: el de la fuente de mayor rango entre las grafías de esta clave; nunca el que lleva el año pegado.
  const yearOf = (t: string) => { const m = YEAR_TAIL.exec(t); return m ? Number(m[1]) : null; };
  const keyNoYear = (t: string) => { const m = YEAR_TAIL.exec(t); return compactKey(m && t.slice(0, m.index).trim().length >= 2 ? t.slice(0, m.index) : t); };
  const groupKey = keyNoYear(keepA.title) === keyNoYear(dropA.title) ? keyNoYear(keepA.title) : null;
  // Emparejados por un alias (títulos distintos): se queda el título actual y el otro pasa a alias.
  const candidates = !groupKey ? [{ slug: "_actual", v: keepA.title }]
    : [...(titleClaims.get(keepA.id) ?? []), ...(titleClaims.get(dropA.id) ?? []), { slug: "_actual", v: keepA.title }, { slug: "_actual", v: dropA.title }]
      .filter((c) => keyNoYear(c.v) === groupKey);
  const stripYear = groupKey !== null && [keepA.title, dropA.title].some((t) => yearOf(t) !== null) && ![keepA.title, dropA.title].every((t) => yearOf(t) !== null);
  const pickable = candidates.filter((c) => !(stripYear && yearOf(c.v) !== null) && !badCase(c.v));
  pickable.sort((x, y) => (rank(y.slug) - rank(x.slug)) || (marks(y.v) - marks(x.v)) || Number(y.v === keepA.title) - Number(x.v === keepA.title));
  const best = pickable[0] ?? { slug: "_actual", v: keepA.title };
  const title = best.v !== keepA.title ? best.v : null;
  // «En Vivo 2008» (grabado) y «En Vivo» (2009): queda el año de publicación y una nota.
  const tailYear = [keepA.title, dropA.title].map(yearOf).find((y) => y !== null) ?? null;
  const pubYear = keepA.y ?? dropA.y;
  const recordedNote = stripYear && tailYear && pubYear && tailYear !== pubYear ? `Grabado en ${tailYear}.` : null;
  merges3c.push({ keep: keepA.id, drop: dropA.id, artist, keepTitle: keepA.title, dropTitle: dropA.title, title,
    titleWhy: best.slug === "_actual" ? "se queda el título actual" : `grafía de ${best.slug}`, recordedNote,
    mode: "match", keepDiscTitle: null, dropDiscTitle: null,
    why: empty ? `una ficha sin pistas (${keepA.n} / ${dropA.n}), mismo año` : `${byTitle} de ${smaller} pistas coinciden por título` });
  albumUsed.add(a); albumUsed.add(b);
}

// ---------------------------------------------------------------------------
// 3d · Artistas sin tilde frente a la fuente con tilde
// ---------------------------------------------------------------------------
const artistNameClaims = (await pool.query<{ artist_id: string; slug: string; v: string }>(`
  SELECT c.artist_id::text, s.slug, c.raw_value#>>'{}' v FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
   WHERE c.artist_id IS NOT NULL AND c.album_id IS NULL AND c.track_id IS NULL AND c.field='name' AND jsonb_typeof(c.raw_value)='string'`)).rows;
const claimsByArtist = new Map<number, Array<{ slug: string; v: string }>>();
for (const r of artistNameClaims) (claimsByArtist.get(num(r.artist_id)) ?? claimsByArtist.set(num(r.artist_id), []).get(num(r.artist_id))!).push({ slug: r.slug, v: r.v.trim() });
// El directorio de Rock Hecho En Venezuela (crudo de la API de WordPress) no
// entró como claim de nombre: sus títulos de ficha también cuentan («Crónica»).
const artistIdsByAccent = new Map<string, number[]>();
for (const [id, n] of artistNames) (artistIdsByAccent.get(accentKey(n)) ?? artistIdsByAccent.set(accentKey(n), []).get(accentKey(n))!).push(id);
const RHV_DIR = "data/raw/rock-hecho-en-venezuela-directorio";
const decode = (t: string) => t.replace(/&#(\d+);/gu, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/gu, "&").replace(/&#8217;|&rsquo;/gu, "’");
for (const file of existsSync(RHV_DIR) ? readdirSync(RHV_DIR) : []) {
  if (!file.endsWith(".json") || file.endsWith(".headers.json")) continue;
  let items: unknown;
  try { items = JSON.parse(readFileSync(`${RHV_DIR}/${file}`, "utf8")); } catch { continue; }
  for (const item of Array.isArray(items) ? items as Array<{ title?: { rendered?: string } }> : []) {
    let title = decode(item.title?.rendered ?? "").trim();
    const inverted = /^(.+),\s*(Los|Las|La|El|The)$/u.exec(title);
    if (inverted) title = `${inverted[2]} ${inverted[1]}`;
    for (const id of artistIdsByAccent.get(accentKey(title)) ?? []) {
      (claimsByArtist.get(id) ?? claimsByArtist.set(id, []).get(id)!).push({ slug: "rock-hecho-en-venezuela", v: title });
    }
  }
}
// Ortografía: frecuencia de cada grafía de palabra en todo el catálogo
// (artistas, personas, discos y pistas). «Marfíl» y «Taxídermia» pierden.
const corpusFreq = new Map<string, number>();
const addWords = (text: string) => { for (const w of text.match(/\p{L}+/gu) ?? []) corpusFreq.set(w.toLowerCase(), (corpusFreq.get(w.toLowerCase()) ?? 0) + 1); };
for (const n of artistNames.values()) addWords(n);
for (const p of persons.values()) addWords(p.name);
for (const a of albums) addWords(a.title);
for (const r of trackRows) addWords(r.title);
/** Por cada palabra que cambia: false si el catálogo casi nunca la escribe con tilde (menos de 1 de cada 4); null = sin datos. */
function orthography(plain: string, accented: string): boolean | null {
  const pw = plain.match(/\p{L}+/gu) ?? []; const aw = accented.match(/\p{L}+/gu) ?? [];
  let verdict: boolean | null = null;
  for (let i = 0; i < aw.length; i += 1) {
    if (aw[i] === pw[i]) continue;
    const withMark = (corpusFreq.get(aw[i]!.toLowerCase()) ?? 0) - 1; // menos la propia fuente
    const without = (corpusFreq.get((pw[i] ?? "").toLowerCase()) ?? 0) - 1; // menos el propio nombre
    if (withMark + without < 3) continue;
    if (withMark * 3 < without) return false;
    verdict = true;
  }
  return verdict;
}
const takenNames = new Map([...artistNames.entries()].map(([id, n]) => [n.toLowerCase(), id]));
const renames3d: Array<{ id: number; from: string; to: string; why: string }> = []; const doubts3d: Array<{ id: number; from: string; to: string; why: string }> = [];
for (const [id, name] of artistNames) {
  const claims = claimsByArtist.get(id) ?? [];
  // Solo añade tildes: quitarlas da exactamente el nombre actual.
  const accented = claims.filter((c) => c.v !== name && strip(c.v) === name && marks(c.v) > marks(name));
  if (!accented.length) continue;
  const to = [...new Set(accented.map((c) => c.v))].sort((x, y) => Math.max(...accented.filter((c) => c.v === y).map((c) => rank(c.slug))) - Math.max(...accented.filter((c) => c.v === x).map((c) => rank(c.slug))))[0]!;
  const forTo = Math.max(...accented.filter((c) => c.v === to).map((c) => rank(c.slug)));
  const plain = claims.filter((c) => c.v === name);
  const forPlain = plain.length ? Math.max(...plain.map((c) => rank(c.slug))) : 0;
  const toSources = [...new Set(accented.filter((c) => c.v === to).map((c) => c.slug))];
  const plainSources = [...new Set(plain.map((c) => c.slug))];
  const other = takenNames.get(to.toLowerCase());
  if (other !== undefined && other !== id) { doubts3d.push({ id, from: name, to, why: `ya existe otra ficha «${to}» (${other}): es un artista doble, no un renombre` }); continue; }
  if (plainSources.some((s) => s === "youtube-data-api" || s === "yt-master-seed" || s === "crv-operador") && forPlain >= forTo) {
    doubts3d.push({ id, from: name, to, why: `el canal, la hoja o un humano escriben «${name}» (${plainSources.join(", ")}); manda esa grafía` }); continue;
  }
  const ortho = orthography(name, to);
  if (ortho === false) { doubts3d.push({ id, from: name, to, why: `el catálogo escribe la palabra sin tilde casi siempre: «${to}» parece errata de ${toSources.join(", ")}` }); continue; }
  // Sin datos de ortografía: tiene que ganar por rango o por número de fuentes.
  if (ortho === null && !(forTo > forPlain || (forTo === forPlain && toSources.length > plainSources.length))) {
    doubts3d.push({ id, from: name, to, why: `sin datos de ortografía y las fuentes no la prefieren (${toSources.join(", ")} frente a ${plainSources.join(", ")})` }); continue;
  }
  renames3d.push({ id, from: name, to, why: `${toSources.join(", ")} escribe «${to}»${plainSources.length ? `; sin tilde: ${plainSources.join(", ")}` : ""}${ortho ? "; el catálogo usa la tilde" : ""}` });
}

// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const plan = {
  generatedAt: new Date().toISOString(),
  measures: { groups3a, persons3a, albumPairs: albumPairs.size },
  "3a": { merge: merges3a, queue: queue3a, discard: discard3a },
  "3b": { merge: merges3b, queue: queue3b, discard: discard3b },
  "3c": { merge: merges3c, doubts: doubts3c },
  "3d": { rename: renames3d, doubts: doubts3d },
};
writeFileSync(`${OUT_DIR}/plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
console.log([
  `3a: ${groups3a} grupos (${persons3a} fichas) → ${merges3a.length} fusiones (${merges3a.reduce((s, g) => s + g.drops.length, 0)} fichas absorbidas), ${queue3a.length} pares a la cola, ${discard3a.length} descartes`,
  `3b: ${merges3b.length} integrantes ← ${merges3b.reduce((s, g) => s + g.drops.length, 0)} abreviaturas, ${queue3b.length} pares a la cola, ${discard3b.length} descartes`,
  `3c: ${albumPairs.size} pares → ${merges3c.length} fusiones, ${doubts3c.length} dudas`,
  `3d: ${renames3d.length} renombres, ${doubts3d.length} dudas`,
].join("\n"));
await closeDb();
