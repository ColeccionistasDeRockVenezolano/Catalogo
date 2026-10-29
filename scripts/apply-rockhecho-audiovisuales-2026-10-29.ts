// Audiovisuales de rockhechovenezuela.com → media.artist_audiovisuals (2026-10-29).
//
// Toma los enlaces de YouTube de las 511 fichas (youtube_enlaces.json), confirma cada video con la
// API de YouTube (videos.list: snippet+status+contentDetails) y lo carga:
//   · media.youtube_videos: siempre (es la obra, aunque no se pueda incrustar)
//   · media.artist_audiovisuals: solo si status.embeddable=true y privacidad public/unlisted
//     (regla de AGENTS.md: lo publicado en la pestaña tiene que ser reproducible)
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-rockhecho-audiovisuales-2026-10-29.ts [--confirm]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { audiovisualKey, type AudiovisualKind } from "../src/youtube/audiovisual-rules.js";

const DIR = process.env["RHV_DIR"] ?? "/home/brian/data/rockhecho";
const OUT = "reports/rockhecho-2026-10-29";
const TAG = "rhv-audiovisuales-2026-10-29";
const CONFIRM = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";

interface Enlace {
  banda: string; url_ficha: string; href: string; texto: string;
  video_id: string; canal: string; lista: string; zona: string;
}
interface Match { title: string; url: string; matches: Array<{ score: number; id: number; name: string }> }

function apiKey(): string {
  if (process.env["YOUTUBE_API_KEY"]) return process.env["YOUTUBE_API_KEY"]!;
  const env = readFileSync(path.resolve(".env"), "utf8");
  const m = /^YOUTUBE_API_KEY=(.+)$/mu.exec(env);
  if (!m) throw new Error("falta YOUTUBE_API_KEY");
  return m[1]!.trim();
}

/**
 * Clasificación por el texto del enlace y el título real del video.
 * `enPestana=false` para lo que no es una pieza audiovisual: álbum completo subido a YouTube y
 * pistas de audio de los canales «- Topic» (YouTube Music). Se conservan como obra, fuera de la pestaña.
 */
function decisionDe(texto: string, titulo: string, segundos: number, canal: string):
  { kind: AudiovisualKind; enPestana: boolean } {
  const t = `${texto} ${titulo}`.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  if (/full ?album|album completo|disco completo|full disc|\|\| *album *\|\|/.test(t)) return { kind: "other", enPestana: false };
  if (/- Topic$/u.test(canal)) return { kind: "other", enPestana: false };
  if (segundos > 0 && segundos < 15) return { kind: "other", enPestana: false };
  // fragmento corto sin marcas de videoclip: es un short, no un concierto
  if (segundos > 0 && segundos < 60 && !/video ?oficial|videoclip|official video/.test(t)) return { kind: "short", enPestana: true };
  if (/documental|documentary/.test(t)) return { kind: "documentary", enPestana: true };
  if (/entrevista|interview/.test(t)) return { kind: "interview", enPestana: true };
  if (/en vivo|conciert|unplugged|sesion|live at|live from|presentacion/.test(t)) return { kind: "live_concert", enPestana: true };
  if (/#shorts?\b/.test(t)) return { kind: "short", enPestana: true };
  if (/video ?oficial|videoclip|official video|video musical|lyric video/.test(t)) return { kind: "music_video", enPestana: true };
  return { kind: "music_video", enPestana: true };
}

function parseDuracion(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(iso ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function videos(ids: string[], key: string): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&maxResults=50&id=${lote.join(",")}&key=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
    if (!r.ok) throw new Error(`YouTube API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    console.log(`  lote ${i / 50}: pedidos=${lote.length} devueltos=${(data.items ?? []).length}`);
    for (const item of data.items ?? []) out.set(String(item["id"]), item);
    await new Promise((res) => setTimeout(res, 250));
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const enlaces = (JSON.parse(readFileSync(path.join(DIR, "youtube_enlaces.json"), "utf8")) as Enlace[])
    .filter((e) => e.video_id);
  const matches: Match[] = JSON.parse(readFileSync(path.join(DIR, "match.json"), "utf8")) as Match[];
  const artistByUrl = new Map<string, { id: number; name: string }>();
  for (const m of matches) {
    const top = m.matches?.[0];
    if (top && top.score >= 0.92) artistByUrl.set(m.url, { id: top.id, name: top.name });
  }

  // un enlace por video: nos quedamos con el primero que tenga artista resuelto
  const porVideo = new Map<string, Enlace & { artistId: number; artistName: string }>();
  let sinArtista = 0;
  for (const e of enlaces) {
    if (porVideo.has(e.video_id)) continue;
    const a = artistByUrl.get(e.url_ficha);
    if (!a) { sinArtista += 1; continue; }
    porVideo.set(e.video_id, { ...e, artistId: a.id, artistName: a.name });
  }
  const ids = [...porVideo.keys()];
  console.log(`enlaces con video=${enlaces.length} únicos=${ids.length} sin artista=${sinArtista}`);

  const key = apiKey();
  const info = await videos(ids, key);
  console.log("resueltos por la API:", info.size);

  const filas: Array<Record<string, unknown>> = [];
  for (const [videoId, e] of porVideo) {
    const item = info.get(videoId);
    if (!item) continue;
    const snippet = (item["snippet"] ?? {}) as Record<string, unknown>;
    const status = (item["status"] ?? {}) as Record<string, unknown>;
    const det = (item["contentDetails"] ?? {}) as Record<string, unknown>;
    const titulo = String(snippet["title"] ?? e.texto ?? "");
    const canal = String(snippet["channelTitle"] ?? "");
    const seg = parseDuracion(String(det["duration"] ?? ""));
    const embeddable = status["embeddable"] === true;
    const priv = String(status["privacyStatus"] ?? "unknown");
    const dec = decisionDe(e.texto, titulo, seg, canal);
    filas.push({
      videoId, youtubeDbId: null, artistId: e.artistId, artistName: e.artistName,
      enPestana: dec.enPestana,
      title: titulo, description: String(snippet["description"] ?? "").slice(0, 4000),
      channelId: snippet["channelId"] ?? null, channelTitle: canal, publishedAt: snippet["publishedAt"] ?? null,
      duration: seg, thumbnail: ((snippet["thumbnails"] ?? {}) as Record<string, Record<string, string>>)["high"]?.["url"] ?? null,
      privacy: priv, embeddable, kind: dec.kind,
      ficha: e.url_ficha, zona: e.zona, texto: e.texto,
    });
  }
  const publicables = filas.filter((f) => f["embeddable"] && f["enPestana"]
    && ["public", "unlisted"].includes(String(f["privacy"])));
  console.log(`videos=${filas.length} publicables=${publicables.length} no_incrustables=${filas.length - publicables.length}`);

  const res = await withOperatorRun({
    name: "catalogo:rockhecho-audiovisuales",
    operator: "Hermes (encargo de Brian)",
    note: "Audiovisuales enlazados desde las fichas de rockhechovenezuela.com: cada video se confirma " +
      "contra la API de YouTube (título, canal, duración, privacidad e embeddable). Solo los public/unlisted " +
      "con embeddable=true aparecen en la pestaña; el resto queda como obra fuera de la pestaña.",
    params: { videos: filas.length, publicables: publicables.length, confirm: CONFIRM },
  }, async (ctx) => {
    const report = { audiovisuales: [] as unknown[], fuera: [] as unknown[], errores: [] as unknown[] };
    for (const f of filas) {
      const pub = f["embeddable"] && f["enPestana"] && ["public", "unlisted"].includes(String(f["privacy"]));
      try {
        await ctx.client.query("SAVEPOINT av");
        const yt = await ctx.client.query<{ id: string }>(`
          INSERT INTO media.youtube_videos(video_id,url,title,description,channel_id,channel_title,published_at,
                                           duration_seconds,thumbnail_url,publication_status,metadata,last_fetched_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())
          ON CONFLICT(video_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
            channel_id=EXCLUDED.channel_id,channel_title=EXCLUDED.channel_title,duration_seconds=EXCLUDED.duration_seconds,
            thumbnail_url=EXCLUDED.thumbnail_url,publication_status=EXCLUDED.publication_status,
            metadata=EXCLUDED.metadata,last_fetched_at=now()
          RETURNING id::text`,
        [f["videoId"], `https://www.youtube.com/watch?v=${f["videoId"]}`, f["title"], f["description"],
          f["channelId"], f["channelTitle"], f["publishedAt"], f["duration"], f["thumbnail"],
          f["privacy"] === "unlisted" ? "unlisted" : f["privacy"] === "public" ? "published" : "unpublished",
          JSON.stringify({ campaign: TAG, ficha: f["ficha"], zona: f["zona"], texto: f["texto"],
            // la API pública filtra por metadata.status.embeddable = 'true'
            status: { embeddable: f["embeddable"], privacyStatus: f["privacy"] } })]);
        const videoDbId = Number(yt.rows[0]!.id);
        if (!pub) {
          report.fuera.push({ videoId: f["videoId"], artistId: f["artistId"], title: f["title"],
            priv: f["privacy"], embeddable: f["embeddable"], kind: f["kind"],
            motivo: f["enPestana"] ? "no incrustable o no público" : "álbum completo / pista de audio" });
          await ctx.client.query("RELEASE SAVEPOINT av");
          continue;
        }
        const ya = await ctx.client.query("SELECT 1 FROM media.artist_audiovisuals WHERE video_id=$1 LIMIT 1", [videoDbId]);
        if (ya.rowCount) {
          await ctx.client.query("RELEASE SAVEPOINT av");
          report.fuera.push({ videoId: f["videoId"], artistId: f["artistId"], title: f["title"],
            motivo: "el video ya está asociado a otro artista" });
          continue;
        }
        await ctx.client.query(`
          INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,release_year,kind,
                                                description,source_type,metadata)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'rockhecho',$9::jsonb)
          ON CONFLICT(artist_id,source_key) DO NOTHING`,
        [f["artistId"], `${TAG}:${f["videoId"]}`, videoDbId, f["title"], audiovisualKey(String(f["title"])),
          f["publishedAt"] ? Number(String(f["publishedAt"]).slice(0, 4)) : null, f["kind"],
          String(f["description"] ?? "").slice(0, 1000),
          JSON.stringify({ campaign: TAG, ficha: f["ficha"], zona: f["zona"], canal: f["channelTitle"],
            embeddable: true, privacy: f["privacy"] })]);
        await ctx.client.query(`
          INSERT INTO media.video_artists(video_id,artist_id,relation_kind,confidence)
          VALUES($1,$2,$3,'high') ON CONFLICT DO NOTHING`,
        [videoDbId, f["artistId"],
          ["documentary", "interview", "short"].includes(String(f["kind"])) ? "subject" : "performer"]);
        await ctx.client.query("RELEASE SAVEPOINT av");
        report.audiovisuales.push({ videoId: f["videoId"], artistId: f["artistId"], banda: f["artistName"],
          title: f["title"], kind: f["kind"], dur: f["duration"] });
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT av");
        report.errores.push({ videoId: f["videoId"], error: (error as Error).message.slice(0, 200) });
      }
    }
    await ctx.client.query("UPDATE ingest.scrape_runs SET counters=$2::jsonb WHERE id=$1",
      [ctx.runId, JSON.stringify({ videos: filas.length, audiovisuales: report.audiovisuales.length,
        fuera: report.fuera.length, errores: report.errores.length })]);
    return report;
  }, { rollbackOnly: !CONFIRM });

  const r = res.result as { audiovisuales: unknown[]; fuera: unknown[]; errores: unknown[] };
  writeFileSync(path.join(OUT, `audiovisuales-${CONFIRM ? "real" : "ensayo"}.json`),
    JSON.stringify({ dryRun: !CONFIRM, runId: CONFIRM ? res.runId : null, total: filas.length, ...r, filas }, null, 2) + "\n");
  const kinds: Record<string, number> = {};
  for (const f of filas) kinds[String(f["kind"])] = (kinds[String(f["kind"])] ?? 0) + 1;
  console.log(`${CONFIRM ? "APLICADO" : "ENSAYO"} run=${res.runId} audiovisuales=${r.audiovisuales.length} ` +
    `fuera_de_pestana=${r.fuera.length} errores=${r.errores.length}`);
  console.log("por tipo:", kinds);
  for (const e of r.errores.slice(0, 8)) console.log("  !", JSON.stringify(e).slice(0, 200));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
