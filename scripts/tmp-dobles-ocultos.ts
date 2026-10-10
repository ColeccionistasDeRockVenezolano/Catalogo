import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { nameKey } from "../src/curation/lexicon.js";
const pool = getPool();
const { rows: albums } = await pool.query<{ id: string; artist_id: string; title: string; y: number | null; t: string }>(
  "SELECT id::text, artist_id::text, title, release_year y, album_type::text t FROM public.albums WHERE artist_id <> 257");
const { rows: tracks } = await pool.query<{ album_id: string; title: string }>("SELECT album_id::text, title FROM public.tracks");
const { rows: distinct } = await pool.query<{ a_id: string; b_id: string }>("SELECT a_id::text, b_id::text FROM ingest.curation_distinct_pairs WHERE kind='album'");
const dist = new Set(distinct.map((r) => `${r.a_id}-${r.b_id}`));
const k = (s: string) => nameKey(s).replace(/[^\p{L}\p{N}]/gu, "");
const tk = new Map<number, Set<string>>();
for (const t of tracks) (tk.get(+t.album_id) ?? tk.set(+t.album_id, new Set()).get(+t.album_id)!).add(k(t.title.replace(/\s*[([].*?[)\]]\s*/gu, " ")));
const { rows: arts } = await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists");
const artistName = new Map(arts.map((r) => [+r.id, r.name]));
const byArtist = new Map<number, typeof albums>();
for (const a of albums) (byArtist.get(+a.artist_id) ?? byArtist.set(+a.artist_id, []).get(+a.artist_id)!).push(a);
const out: unknown[] = [];
for (const list of byArtist.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const A = list[i]!, B = list[j]!;
  const [a, b] = +A.id < +B.id ? [A, B] : [B, A];
  if (dist.has(`${a.id}-${b.id}`) || k(a.title) === k(b.title)) continue;
  const ta = tk.get(+a.id) ?? new Set(), tb = tk.get(+b.id) ?? new Set();
  const gap = a.y !== null && b.y !== null ? Math.abs(a.y - b.y) : 0;
  if (gap > 1) continue;
  const small = Math.min(ta.size, tb.size), big = Math.max(ta.size, tb.size);
  const common = [...ta].filter((x) => tb.has(x)).length;
  const ka = k(a.title), kb = k(b.title);
  const contains = ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka));
  // Números y volúmenes (arábigos o romanos) deben coincidir: «Vol. 2» ≠ «Vol. 1».
  const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  const nums = (t: string) => [...new Set((nameKey(t).match(/\b(\d+|[ivx]+)\b/gu) ?? []).map((n) => ROMAN[n] ?? n).filter((n) => /^\d+$/u.test(n)))].sort().join(",");
  const words = (t: string) => new Set(nameKey(t).split(/\s+/u).filter((w) => w.length > 2));
  const wa = words(a.title), wb = words(b.title);
  const jaccard = [...wa].filter((w) => wb.has(w)).length / Math.max(1, new Set([...wa, ...wb]).size);
  const similar = contains || jaccard >= 0.5;
  const SPECIFIC = new Set(["studio_album", "live_album", "remix", "compilation", "ep", "single", "demo"]);
  const typeClash = SPECIFIC.has(a.t) && SPECIFIC.has(b.t) && a.t !== b.t && !(["studio_album", "ep"].includes(a.t) && ["studio_album", "ep"].includes(b.t));
  const liveWords = (t: string) => /\b(vivo|live|gira|tour|concierto|concert|remix|remixes|remezcla)/iu.test(t);
  const reissue = /\b(reissue|reedici|remaster|aniversario|anniversary)/iu.test(a.title + " " + b.title) && gap >= 1;
  const sameNums = nums(a.title) === nums(b.title);
  const shorter = Math.min(ka.length, kb.length);
  const hasVol = (t: string) => /\bvol/iu.test(nameKey(t));
  const artistKey = k(artistName.get(+a.artist_id) ?? "");
  const selfTitled = artistKey.length > 0 && (k(a.title) === artistKey || k(b.title) === artistKey || (shorter <= artistKey.length + 2 && (ka.includes(artistKey) || kb.includes(artistKey)) && Math.min(ka.length, kb.length) === Math.min(...[ka, kb].filter((x) => x.includes(artistKey)).map((x) => x.length))));
  const editionGap = small > 0 && gap >= 1;
  let rule = "", doubt = "";
  if (typeClash || liveWords(a.title) !== liveWords(b.title) || reissue || !sameNums || hasVol(a.title) !== hasVol(b.title) || selfTitled || editionGap) {
    if ((small >= 4 && common / small >= 0.8) || (small === 0 && contains)) doubt = `${small ? `contenido ${common}/${small}` : "uno vacío"} pero ${typeClash ? "tipos distintos" : reissue || editionGap ? "ediciones de años distintos" : !sameNums || hasVol(a.title) !== hasVol(b.title) ? "volúmenes distintos" : selfTitled ? "título = nombre del artista" : "en vivo/remix frente a estudio"}`;
  } else if (small >= 4 && small / big >= 0.75 && common / small >= 0.6 && similar) rule = `mismo disco: ${common}/${small} pistas en común y título parecido`;
  else if (small === 0 && contains && shorter >= 8 && (a.y === b.y || a.y === null || b.y === null)) rule = "mismo disco: uno sin pistas, título contenido y mismo año";
  else if (small >= 4 && common / small >= 0.8) doubt = `contenido ${common}/${small} con títulos distintos`;
  if (rule || doubt) out.push({ a: +a.id, b: +b.id, ta: `${a.title} [${a.y ?? "?"} ${a.t} ${ta.size}]`, tb: `${b.title} [${b.y ?? "?"} ${b.t} ${tb.size}]`, artist: +a.artist_id, rule, doubt });
}
writeFileSync("reports/discos-dobles-ocultos-2026-10-04-candidatos.json", JSON.stringify(out, null, 1));
console.log(out.length);
await closeDb();
