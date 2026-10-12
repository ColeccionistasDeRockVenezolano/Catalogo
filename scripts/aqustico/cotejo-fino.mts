// Plan Aqustico · E0 — tabla maestra de cruces y de huecos (SOLO LECTURA).
//
// Objetivo del plan: «rellenar los huecos de CRV con lo que tiene Aqustico»
// (~/Desktop/PLAN_AQUSTICO_2026-10-12.md). Este script no escribe en la base:
// cruza el volcado de api.aqustico.com (data/raw/aqustico-2026-10-11/) con el
// catálogo y deja en reports/aqustico-2026-10/ qué hueco rellena cada dato.
//
// Reglas de cruce (§0.4 del plan): solo exacto, con `compactSecondaryKey` del
// normalizador del repo; un empate (dos fichas con la misma clave) se excluye.
//   * artista: nombre o alias de CRV. Un artista queda PROBADO solo si además
//     comparte al menos un disco (artista + título) — sin esa segunda prueba no
//     recibe foto, invitados ni discos nuevos (homónimos).
//   * disco: título (o alias) dentro de los discos del artista probado.
//   * pista: título (o alias) único dentro del disco cruzado.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/cotejo-fino.mts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { normalizeEntityName } from "../../src/normalization/entity-name.js";

const ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano";
const RAW = path.join(ROOT, "data/raw/aqustico-2026-10-11");
const OUT = path.join(ROOT, "reports/aqustico-2026-10");
const API = "https://api.aqustico.com";

/** Etiquetas que no son géneros musicales: no se proponen. */
const NO_GENRE = new Set(["#N/D", "Audio libros", "Podcast", "Meditacion"]);

const key = (value: string | null | undefined): string => normalizeEntityName(value ?? "").compactSecondaryKey;

interface AqSong {
  id: number; song_name: string; song_duration: string | null; album_id: number; album_name: string;
  album_cover: string | null; artist_id: number; artist_name: string; featurings?: Array<{ id: number; name: string }>;
}
interface AqAlbum { id: number; nombre: string; cover: string | null; songs_count: string | null }
interface AqArtist { id: number; nombre: string; profile_image: string | null }

/** Una canción del disco agregado de Aqustico. */
interface Cancion { songId: number; title: string; key: string; seconds: number | null; rawDuration: string | null; genre: string | null; featurings: Array<{ id: number; name: string }> }
/** Disco de Aqustico agregado por (artista, título): la API repite discos con ids distintos. */
interface DiscoAq { aqArtistId: number; artist: string; title: string; key: string; albumIds: number[]; cover: string | null; canciones: Cancion[]; genres: Array<{ label: string; n: number }> }

function readJson<T>(file: string): T | null {
  const text = readFileSync(file, "utf8").trim();
  return text ? JSON.parse(text) as T : null;
}

/** Duración en segundos solo si es un número plausible (863 valores de la fuente son basura). */
function seconds(raw: string | null): number | null {
  if (raw === null || !/^\d+(\.\d+)?$/u.test(raw.trim())) return null;
  const value = Math.round(Number(raw));
  return value >= 10 && value <= 3600 ? value : null;
}

function tsv(file: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const clean = (v: string | number | null | undefined) => String(v ?? "").replace(/[\t\n\r]+/gu, " ");
  writeFileSync(path.join(OUT, file), [header.join("\t"), ...rows.map((r) => r.map(clean).join("\t"))].join("\n") + "\n");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const pool = getPool();
  const runsBefore = Number((await pool.query<{ n: string }>("SELECT count(*)::text n FROM ingest.scrape_runs")).rows[0]!.n);

  // ---------- Aqustico ----------
  const genreBySong = new Map<number, string>();
  for (const line of readFileSync(path.join(RAW, "generos/song-generos.tsv"), "utf8").split("\n")) {
    const [id, genre] = line.split("\t");
    if (id && /^\d+$/u.test(id) && genre?.trim()) genreBySong.set(Number(id), genre.trim());
  }
  const artistsAq = new Map<number, AqArtist>();
  for (const file of readdirSync(path.join(RAW, "artist"))) {
    const a = readJson<AqArtist>(path.join(RAW, "artist", file));
    if (a?.id) artistsAq.set(a.id, a);
  }
  const albumCover = new Map<number, string>();
  for (const file of readdirSync(path.join(RAW, "albums"))) {
    for (const a of readJson<AqAlbum[]>(path.join(RAW, "albums", file)) ?? []) if (a.cover) albumCover.set(a.id, a.cover);
  }
  const discos = new Map<string, DiscoAq>();
  for (const file of readdirSync(path.join(RAW, "songs"))) {
    for (const s of readJson<AqSong[]>(path.join(RAW, "songs", file)) ?? []) {
      if (!s.id || !s.album_name) continue;
      const dk = `${s.artist_id}|${key(s.album_name)}`;
      let d = discos.get(dk);
      if (!d) {
        d = { aqArtistId: s.artist_id, artist: s.artist_name, title: s.album_name, key: key(s.album_name), albumIds: [], cover: null, canciones: [], genres: [] };
        discos.set(dk, d);
      }
      if (!d.albumIds.includes(s.album_id)) d.albumIds.push(s.album_id);
      d.cover ??= albumCover.get(s.album_id) ?? s.album_cover ?? null;
      const ck = key(s.song_name);
      if (d.canciones.some((c) => c.key === ck)) continue; // misma canción subida dos veces
      d.canciones.push({ songId: s.id, title: s.song_name, key: ck, seconds: seconds(s.song_duration), rawDuration: s.song_duration,
        genre: genreBySong.get(s.id) ?? null, featurings: s.featurings ?? [] });
    }
  }
  for (const d of discos.values()) {
    const count = new Map<string, number>();
    for (const c of d.canciones) if (c.genre && !NO_GENRE.has(c.genre)) count.set(c.genre, (count.get(c.genre) ?? 0) + 1);
    d.genres = [...count].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }

  // ---------- CRV ----------
  const artistByKey = new Map<string, Set<number>>();
  const artistVia = new Map<string, string>();
  const addArtist = (k: string, id: number, via: string) => {
    if (!k) return;
    (artistByKey.get(k) ?? artistByKey.set(k, new Set()).get(k)!).add(id);
    artistVia.set(`${k}|${id}`, artistVia.get(`${k}|${id}`) ?? via);
  };
  const crvArtist = new Map<number, { name: string; picture: string | null; hasPrimary: boolean }>();
  for (const r of (await pool.query<{ id: string; name: string; picture_url: string | null; p: boolean }>(`
      SELECT a.id::text, a.name, a.picture_url,
             EXISTS(SELECT 1 FROM ingest.artist_genres g WHERE g.artist_id=a.id AND g.role='primary' AND g.status='confirmed') p
        FROM public.artists a`)).rows) {
    crvArtist.set(Number(r.id), { name: r.name, picture: r.picture_url, hasPrimary: r.p });
    addArtist(key(r.name), Number(r.id), "nombre");
  }
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text, alias FROM ingest.artist_aliases")).rows) {
    addArtist(key(r.alias), Number(r.artist_id), "alias");
  }
  const crvAlbum = new Map<number, { artistId: number; title: string; cover: string | null; hasPrimary: boolean; type: string }>();
  const albumsByArtist = new Map<number, Map<string, Set<number>>>();
  const addAlbum = (artistId: number, k: string, id: number) => {
    if (!k) return;
    const m = albumsByArtist.get(artistId) ?? albumsByArtist.set(artistId, new Map()).get(artistId)!;
    (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id);
  };
  for (const r of (await pool.query<{ id: string; artist_id: string; title: string; cover_url: string | null; p: boolean; album_type: string }>(`
      SELECT a.id::text, a.artist_id::text, a.title, a.cover_url, a.album_type::text,
             EXISTS(SELECT 1 FROM ingest.album_genres g WHERE g.album_id=a.id AND g.role='primary' AND g.status='confirmed') p
        FROM public.albums a`)).rows) {
    crvAlbum.set(Number(r.id), { artistId: Number(r.artist_id), title: r.title, cover: r.cover_url, hasPrimary: r.p, type: r.album_type });
    addAlbum(Number(r.artist_id), key(r.title), Number(r.id));
  }
  for (const r of (await pool.query<{ album_id: string; alias: string }>("SELECT album_id::text, alias FROM ingest.album_aliases")).rows) {
    const a = crvAlbum.get(Number(r.album_id));
    if (a) addAlbum(a.artistId, key(r.alias), Number(r.album_id));
  }
  for (const r of (await pool.query<{ album_id: string; title: string | null }>("SELECT album_id::text, title FROM public.album_discs WHERE title IS NOT NULL")).rows) {
    const a = crvAlbum.get(Number(r.album_id));
    if (a) addAlbum(a.artistId, key(r.title), Number(r.album_id));
  }
  const tracksByAlbum = new Map<number, Array<{ id: number; title: string; key: string; disc: number; n: number; seconds: number | null }>>();
  for (const r of (await pool.query<{ id: string; album_id: string; title: string; disc_number: number; track_number: number; duration_seconds: number | null }>(
    "SELECT id::text, album_id::text, title, disc_number, track_number, duration_seconds FROM public.tracks")).rows) {
    const list = tracksByAlbum.get(Number(r.album_id)) ?? tracksByAlbum.set(Number(r.album_id), []).get(Number(r.album_id))!;
    list.push({ id: Number(r.id), title: r.title, key: key(r.title), disc: r.disc_number, n: r.track_number, seconds: r.duration_seconds });
  }
  const trackAlias = new Map<number, string[]>();
  for (const r of (await pool.query<{ track_id: string; alias: string }>("SELECT track_id::text, alias FROM ingest.track_aliases")).rows) {
    (trackAlias.get(Number(r.track_id)) ?? trackAlias.set(Number(r.track_id), []).get(Number(r.track_id))!).push(key(r.alias));
  }
  const personByKey = new Map<string, Set<number>>();
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons")).rows) {
    const k = key(r.name);
    if (k) (personByKey.get(k) ?? personByKey.set(k, new Set()).get(k)!).add(Number(r.id));
  }
  for (const r of (await pool.query<{ person_id: string; alias: string }>("SELECT person_id::text, alias FROM ingest.person_aliases")).rows) {
    const k = key(r.alias);
    if (k) (personByKey.get(k) ?? personByKey.set(k, new Set()).get(k)!).add(Number(r.person_id));
  }

  // ---------- Cruce de artistas (por nombre) ----------
  const artistRows: Array<Array<string | number | null>> = [];
  const candidate = new Map<number, number>(); // aqArtistId → crvArtistId (solo nombre, sin empate)
  for (const a of artistsAq.values()) {
    const ids = [...(artistByKey.get(key(a.nombre)) ?? [])];
    if (ids.length === 1) candidate.set(a.id, ids[0]!);
  }

  // ---------- Cruce de discos y pistas ----------
  const discRows: Array<Array<string | number | null>> = [];
  const trackRows: Array<Array<string | number | null>> = [];
  const proven = new Map<number, number>(); // artista con disco en común
  interface Cruce { disco: DiscoAq; crvAlbumId: number | null; motivo: string }
  const cruces: Cruce[] = [];
  for (const d of discos.values()) {
    const crvArtistId = candidate.get(d.aqArtistId);
    if (crvArtistId === undefined) { cruces.push({ disco: d, crvAlbumId: null, motivo: artistByKey.has(key(d.artist)) ? "artista_ambiguo" : "artista_sin_ficha" }); continue; }
    const hits = [...(albumsByArtist.get(crvArtistId)?.get(d.key) ?? [])];
    if (hits.length === 1) { cruces.push({ disco: d, crvAlbumId: hits[0]!, motivo: "" }); proven.set(d.aqArtistId, crvArtistId); }
    else cruces.push({ disco: d, crvAlbumId: null, motivo: hits.length > 1 ? "disco_ambiguo" : "disco_sin_ficha" });
  }

  for (const a of artistsAq.values()) {
    const ids = [...(artistByKey.get(key(a.nombre)) ?? [])];
    const crvId = candidate.get(a.id) ?? null;
    const motivo = ids.length === 0 ? "sin_ficha" : ids.length > 1 ? "ambiguo" : proven.has(a.id) ? "" : "sin_disco_en_comun";
    artistRows.push([a.id, a.nombre, crvId, crvId ? crvArtist.get(crvId)!.name : null,
      crvId ? artistVia.get(`${key(a.nombre)}|${crvId}`) ?? "" : "", proven.has(a.id) ? "probado" : "no", motivo]);
  }

  // ---------- Huecos ----------
  interface Hueco { hueco: string; kind: string; crvId: number; aqId: number | string; valor: unknown; evidencia: string; detalle?: string }
  const huecos: Hueco[] = [];
  let ordenOk = 0, ordenTot = 0;
  const discrepancias: Array<Array<string | number | null>> = [];
  const genreRows: Array<{ albumId: number; title: string; artist: string; aqArtistId: number; labels: string[] }> = [];

  for (const c of cruces) {
    const d = c.disco;
    const crvArtistId = proven.get(d.aqArtistId) ?? candidate.get(d.aqArtistId) ?? null;
    const evid = `${API}/artist/all-songs/${d.aqArtistId}`;
    discRows.push([d.aqArtistId, d.artist, d.albumIds.join(","), d.title, d.canciones.length, d.genres.map((g) => g.label).join(" | "),
      crvArtistId, c.crvAlbumId, c.crvAlbumId ? crvAlbum.get(c.crvAlbumId)!.title : null, c.motivo]);
    if (c.crvAlbumId === null) continue;
    const alb = crvAlbum.get(c.crvAlbumId)!;
    // H1 género del disco
    if (d.genres.length) {
      if (!alb.hasPrimary) {
        huecos.push({ hueco: "H1", kind: "album", crvId: c.crvAlbumId, aqId: d.albumIds.join(","), valor: d.genres.map((g) => g.label), evidencia: evid, detalle: `${d.artist} — ${alb.title}` });
        genreRows.push({ albumId: c.crvAlbumId, title: alb.title, artist: d.artist, aqArtistId: d.aqArtistId, labels: d.genres.map((g) => g.label) });
      }
    }
    // H4 portada
    if (!alb.cover && d.cover) huecos.push({ hueco: "H4", kind: "album", crvId: c.crvAlbumId, aqId: d.albumIds[0]!, valor: d.cover, evidencia: evid });
    // Pistas
    const tracks = tracksByAlbum.get(c.crvAlbumId) ?? [];
    if (!tracks.length) {
      huecos.push({ hueco: "H8", kind: "album", crvId: c.crvAlbumId, aqId: d.albumIds.join(","), valor: d.canciones.map((x) => x.title), evidencia: evid });
      continue;
    }
    const seq: number[] = [];
    for (const song of d.canciones) {
      const matches = tracks.filter((t) => t.key === song.key || (trackAlias.get(t.id) ?? []).includes(song.key));
      const motivo = matches.length === 0 ? "sin_pista" : matches.length > 1 ? "titulo_ambiguo" : "";
      const t = matches.length === 1 ? matches[0]! : null;
      trackRows.push([song.songId, song.title, song.rawDuration, c.crvAlbumId, t?.id ?? null, t?.title ?? null, t?.seconds ?? null, motivo]);
      if (!t) continue;
      seq.push(t.disc * 1000 + t.n);
      if ((t.seconds === null || t.seconds === 0) && song.seconds !== null) {
        huecos.push({ hueco: "H3", kind: "track", crvId: t.id, aqId: song.songId, valor: song.seconds, evidencia: evid, detalle: `«${song.title}» en «${d.title}»` });
      } else if (t.seconds && song.seconds && Math.abs(t.seconds - song.seconds) > 15) {
        discrepancias.push(["duracion", "track", t.id, `${d.artist} — ${t.title}`, t.seconds, song.seconds]);
      }
      // H6 invitados
      for (const f of song.featurings) {
        if (f.id === d.aqArtistId) continue;
        huecos.push({ hueco: "H6", kind: "track", crvId: t.id, aqId: f.id, valor: f.name, evidencia: evid, detalle: `«${t.title}» de ${d.artist}` });
      }
    }
    if (seq.length >= 3) { ordenTot += 1; if (seq.every((v, i) => i === 0 || seq[i - 1]! < v)) ordenOk += 1; }
  }

  // Discrepancias de género (informativas, no se escriben)
  const primaryGenre = new Map<number, string>();
  for (const r of (await pool.query<{ album_id: string; name: string }>(`
      SELECT g.album_id::text, t.name FROM ingest.album_genres g JOIN ingest.genres t ON t.id=g.genre_id
       WHERE g.role='primary' AND g.status='confirmed'`)).rows) primaryGenre.set(Number(r.album_id), r.name);
  for (const c of cruces) {
    if (c.crvAlbumId === null || !c.disco.genres.length) continue;
    const g = primaryGenre.get(c.crvAlbumId);
    if (g && key(g) !== key(c.disco.genres[0]!.label)) discrepancias.push(["genero", "album", c.crvAlbumId, `${c.disco.artist} — ${c.disco.title}`, g, c.disco.genres[0]!.label]);
  }

  // H5 foto y H2 artistas sin género (solo artistas probados)
  const artistasConHueco = new Set<number>();
  for (const [aqId, crvId] of proven) {
    const a = artistsAq.get(aqId);
    const ca = crvArtist.get(crvId)!;
    if (a?.profile_image && !ca.picture) huecos.push({ hueco: "H5", kind: "artist", crvId, aqId, valor: a.profile_image, evidencia: `${API}/artist/${aqId}` });
    if (!ca.hasPrimary) artistasConHueco.add(crvId);
  }
  for (const crvId of artistasConHueco) {
    const recibe = genreRows.some((g) => crvAlbum.get(g.albumId)!.artistId === crvId);
    huecos.push({ hueco: "H2", kind: "artist", crvId, aqId: "", valor: recibe ? "derivado de sus discos (E2)" : "sin disco que reciba género", evidencia: "" });
  }

  // H6: resolver a quién acredita cada featuring
  const membersOf = new Map<number, Set<number>>();
  for (const r of (await pool.query<{ artist_id: string; person_id: string }>("SELECT artist_id::text, person_id::text FROM public.artist_members")).rows) {
    (membersOf.get(Number(r.artist_id)) ?? membersOf.set(Number(r.artist_id), new Set()).get(Number(r.artist_id))!).add(Number(r.person_id));
  }
  const creditedOn = new Map<number, Set<number>>(); // artista → personas con crédito en sus discos
  for (const r of (await pool.query<{ artist_id: string; person_id: string }>(`
      SELECT DISTINCT a.artist_id::text, c.person_id::text FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id
        JOIN public.albums a ON a.id=t.album_id WHERE c.person_id IS NOT NULL
      UNION SELECT DISTINCT a.artist_id::text, c.person_id::text FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id
       WHERE c.person_id IS NOT NULL`)).rows) {
    (creditedOn.get(Number(r.artist_id)) ?? creditedOn.set(Number(r.artist_id), new Set()).get(Number(r.artist_id))!).add(Number(r.person_id));
  }
  const existing = new Set((await pool.query<{ k: string }>(
    "SELECT track_id::text||'|'||coalesce('a'||artist_id::text,'p'||person_id::text,'o'||organization_id::text) k FROM public.track_credits")).rows.map((r) => r.k));
  for (const h of huecos.filter((x) => x.hueco === "H6")) {
    const track = [...tracksByAlbum.entries()].find(([, l]) => l.some((t) => t.id === h.crvId));
    const ownerArtist = track ? crvAlbum.get(track[0])!.artistId : null;
    const featArtist = proven.get(Number(h.aqId));
    let target: string | null = null; let via: string;
    if (featArtist !== undefined && featArtist !== ownerArtist) { target = `a${featArtist}`; via = "artista probado (id de Aqustico con disco en común)"; }
    else {
      const persons = [...(personByKey.get(key(String(h.valor))) ?? [])];
      const common = persons.filter((p) => ownerArtist !== null && (membersOf.get(ownerArtist)?.has(p) || creditedOn.get(ownerArtist)?.has(p)));
      if (common.length === 1) { target = `p${common[0]}`; via = "persona con proyecto en común (miembro o crédito en el artista)"; }
      else {
        const artistsByName = [...(artistByKey.get(key(String(h.valor))) ?? [])];
        via = artistsByName.length || persons.length ? "nombre en CRV sin segunda prueba" : "sin ficha en CRV";
      }
    }
    if (target && existing.has(`${h.crvId}|${target}`)) { via = "crédito ya existe"; target = null; }
    h.detalle = `${h.detalle ?? ""} · acredita: ${target ?? "—"} (${via})`;
    (h as Hueco & { target?: string | null }).target = target;
  }

  // H7 discos que faltan (solo de artistas probados) y H9 enlaces. Un alta nunca
  // se hace con duda: si el título, sin paréntesis, «feat.» ni marcas de edición
  // (Deluxe, Remix, Acústico, EP…), coincide con un disco del artista, va a
  // la lista de dudas (H7-duda) en vez de crearse.
  const PLACEHOLDER = new Set(["sencillos", "singles", "single", "varios", "otros", "demos", "demo", "inéditos", "ineditos"].map(key));
  const EDITION = /\b(deluxe|edition|edici[oó]n|remaster(ed)?|versi[oó]n|version|ac[uú]stic[oa]|acoustic|remix(es)?|live|en vivo|ep|single|sencillo|radio edit)\b/giu;
  const base = (title: string) => key(title.replace(/\s*[([].*?[)\]]/gu, " ").replace(/\s+(feat\.?|ft\.?|featuring|con)\s+.*$/iu, " ").replace(EDITION, " "));
  const baseByArtist = new Map<number, Map<string, string>>();
  for (const a of crvAlbum.values()) {
    const m = baseByArtist.get(a.artistId) ?? baseByArtist.set(a.artistId, new Map()).get(a.artistId)!;
    const b = base(a.title);
    if (b) m.set(b, a.title);
  }
  for (const c of cruces) {
    if (c.crvAlbumId !== null || c.motivo !== "disco_sin_ficha") continue;
    const crvArtistId = proven.get(c.disco.aqArtistId);
    if (crvArtistId === undefined) continue;
    const d = c.disco;
    const parecido = baseByArtist.get(crvArtistId)?.get(base(d.title));
    const dudaMotivo = PLACEHOLDER.has(d.key) ? "título de relleno, no es un disco"
      : parecido ? `variante de «${parecido}», que ya está en CRV`
      : d.genres.length === 0 && d.canciones.every((x) => x.genre && NO_GENRE.has(x.genre)) ? "contenido no musical" : null;
    if (dudaMotivo) {
      huecos.push({ hueco: "H7-duda", kind: "album", crvId: crvArtistId, aqId: d.albumIds.join(","), evidencia: `${API}/artist/all-songs/${d.aqArtistId}`,
        valor: { title: d.title, canciones: d.canciones.length }, detalle: dudaMotivo });
      continue;
    }
    const inTrack = [...(albumsByArtist.get(crvArtistId)?.values() ?? [])].flatMap((s) => [...s])
      .filter((albumId) => (tracksByAlbum.get(albumId) ?? []).some((t) => t.key === d.key)).map((id) => crvAlbum.get(id)!.title);
    huecos.push({ hueco: "H7", kind: "album", crvId: crvArtistId, aqId: d.albumIds.join(","), evidencia: `${API}/artist/all-songs/${d.aqArtistId}`,
      valor: { title: d.title, canciones: d.canciones.map((x) => ({ songId: x.songId, title: x.title, seconds: x.seconds })), cover: d.cover, genres: d.genres.map((g) => g.label) },
      detalle: `${d.canciones.length} canción(es)${inTrack.length ? ` · también pista de: ${[...new Set(inTrack)].join(" / ")}` : ""}` });
  }
  for (const [aqId, crvId] of proven) huecos.push({ hueco: "H9", kind: "artist", crvId, aqId, valor: `https://aqustico.com/artist/${aqId}`, evidencia: "" });

  // ---------- Salidas ----------
  tsv("cruces-artistas.tsv", ["aq_artist_id", "aq_nombre", "crv_artist_id", "crv_nombre", "via", "probado", "motivo_exclusion"], artistRows);
  tsv("cruces-discos.tsv", ["aq_artist_id", "aq_artista", "aq_album_ids", "aq_titulo", "canciones", "generos_aq", "crv_artist_id", "crv_album_id", "crv_titulo", "motivo_exclusion"], discRows);
  tsv("cruces-pistas.tsv", ["aq_song_id", "aq_titulo", "aq_duracion_cruda", "crv_album_id", "crv_track_id", "crv_titulo", "crv_duracion", "motivo_exclusion"], trackRows);
  tsv("huecos.tsv", ["hueco", "kind", "crv_id", "aq_id", "valor_propuesto", "detalle", "evidencia"],
    huecos.map((h) => [h.hueco, h.kind, h.crvId, h.aqId, typeof h.valor === "string" ? h.valor : JSON.stringify(h.valor), h.detalle ?? "", h.evidencia]));
  tsv("discrepancias.tsv", ["tipo", "kind", "crv_id", "ficha", "valor_crv", "valor_aqustico"], discrepancias);
  writeFileSync(path.join(OUT, "tabla-maestra.json"), JSON.stringify({ generado: new Date().toISOString(), huecos }, null, 1));

  const by = (h: string) => huecos.filter((x) => x.hueco === h);
  const h6 = by("H6") as Array<Hueco & { target?: string | null }>;
  const h7 = by("H7");
  const resumen = {
    artistas: { aqustico: artistsAq.size, conFichaSinEmpate: candidate.size, probados: proven.size },
    discos: { aqustico: discos.size, cruzados: cruces.filter((c) => c.crvAlbumId !== null).length },
    pistas: { cruzadas: trackRows.filter((r) => r[7] === "").length, ambiguas: trackRows.filter((r) => r[7] === "titulo_ambiguo").length },
    ordenAqusticoIgualAlDisco: `${ordenOk}/${ordenTot}`,
    H1: by("H1").length, H2: by("H2").length, H2_que_reciben: by("H2").filter((h) => String(h.valor).startsWith("derivado")).length,
    H3: by("H3").length, H3_discos: new Set(by("H3").map((h) => h.detalle?.split(" en ")[1])).size,
    H4: by("H4").length, H5: by("H5").length,
    H6: h6.length, H6_acreditables: h6.filter((h) => h.target).length,
    H7: h7.length, H7_una_cancion: h7.filter((h) => (h.valor as { canciones: unknown[] }).canciones.length === 1).length,
    H7_dudas: by("H7-duda").length, H8: by("H8").length, H9_artistas: by("H9").length,
    discrepancias: { genero: discrepancias.filter((d) => d[0] === "genero").length, duracion: discrepancias.filter((d) => d[0] === "duracion").length },
  };
  writeFileSync(path.join(OUT, "resumen-e0.json"), JSON.stringify(resumen, null, 1));
  const runsAfter = Number((await pool.query<{ n: string }>("SELECT count(*)::text n FROM ingest.scrape_runs")).rows[0]!.n);
  console.log(JSON.stringify(resumen, null, 1));
  console.log(`runs antes/después: ${runsBefore}/${runsAfter} (otras sesiones pueden crear runs; este script no escribe)`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
