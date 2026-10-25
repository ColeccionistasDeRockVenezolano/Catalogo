// Aplicador de enlaces de la campaña 2026-10-19 (redes, tiendas y escucha).
//
// Entrada: JSONL, una línea por artista:
//   {"artistId":1765,"source":"linktr.ee/3duenos","evidence":"...","links":[
//      {"category":"streaming","platform":"spotify","url":"https://open.spotify.com/artist/...","externalId":"...","verified":true},
//      {"category":"social","platform":"tiktok","url":"https://tiktok.com/@...","handle":"...","verified":true}]}
//
// Reglas (no negociables):
//   · solo escribe lo que falta — una URL distinta en la ficha es un CONFLICTO y se reporta, no se pisa;
//   · si la ficha ya tiene el enlace con la misma URL pero sin external_id, lo completa;
//   · todo va en UN run reversible con nota firmada (withOperatorRun + writePlatformLink);
//   · dry-run por defecto; escribe solo con --apply.
import { readFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun, updateEntity } from "../../src/merge/operator.js";
import { writePlatformLink } from "../../src/merge/platform-links.js";

type LinkCategory = "streaming" | "social";
type ProposedLink = {
  category: LinkCategory;
  platform: string;
  url: string;
  handle?: string | null;
  externalId?: string | null;
  verified?: boolean;
};
type AlbumLink = { albumId: number; platform: string; url: string; externalId?: string | null };
type Row = { artistId: number; source?: string; evidence?: string; email?: string | null; links: ProposedLink[]; albumLinks?: AlbumLink[] };

const NOTE = "Campaña de enlaces 2026-10-19: linktree/web/Instagram de los artistas";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** Clave canónica del enlace: dos URLs que apuntan al mismo perfil no son un conflicto. */
function linkKey(platform: string, url: string): string {
  const low = url.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^(www|m)\./, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (platform === "spotify") {
    const m = low.match(/(?:intl-[a-z]{2}\/)?artist\/([a-z0-9]+)/);
    if (m) return `spotify:${m[1]}`;
    const album = low.match(/(?:intl-[a-z]{2}\/)?album\/([a-z0-9]+)/);
    if (album) return `spotify-album:${album[1]}`;
  }
  if (platform === "apple_music") {
    const album = low.match(/album\/[^/]+\/(\d+)/);
    if (album) return `apple-album:${album[1]}`;
    const m = low.match(/(?:id)?(\d{6,})$/);
    if (m) return `apple:${m[1]}`;
  }
  if (platform === "deezer") {
    const m = low.match(/artist\/(\d+)/);
    if (m) return `deezer:${m[1]}`;
  }
  if (platform === "tidal") {
    const m = low.match(/(?:browse\/)?artist\/(\d+)/);
    if (m) return `tidal:${m[1]}`;
  }
  if (platform === "qobuz") {
    const m = low.match(/interpreter\/[^/]+\/(\d+)/);
    if (m) return `qobuz:${m[1]}`;
  }
  if (platform === "youtube" || platform === "youtube_music") {
    const channel = low.match(/channel\/(uc[a-z0-9_-]{20,24})/);
    if (channel) return `yt:${channel[1]}`;
    const at = low.match(/@([a-z0-9._-]+)/);
    if (at) return `yt:@${at[1]}`;
    const user = low.match(/user\/([a-z0-9._-]+)/);
    if (user) return `yt:user:${user[1]}`;
  }
  if (platform === "facebook") {
    const id = low.match(/profile\.php\?id=(\d+)/);
    if (id) return `fb:${id[1]}`;
  }
  if (["instagram", "facebook", "tiktok", "x", "threads", "bluesky", "soundcloud", "bandcamp", "store", "website"].includes(platform)) {
    const parts = low.split("/").filter(Boolean);
    return `${platform}:${parts.slice(-1)[0] ?? low}`;
  }
  return `${platform}:${low}`;
}

/** Resuelve un enlace de YouTube (canal, @handle o /user/) a su channelId UC… */
const ytCache = new Map<string, string | null>();
async function youtubeChannelOf(url: string): Promise<string | null> {
  const direct = url.match(/channel\/(UC[A-Za-z0-9_-]{20,24})/);
  if (direct) return direct[1] ?? null;
  const at = url.match(/youtube\.com\/@([A-Za-z0-9._-]+)/);
  const user = url.match(/youtube\.com\/user\/([A-Za-z0-9._-]+)/);
  if (!at && !user) return null;
  const key = at ? `@${at[1]}` : `user:${user![1]}`;
  if (ytCache.has(key)) return ytCache.get(key)!;
  const target = at ? `https://www.youtube.com/@${at[1]}` : `https://www.youtube.com/user/${user![1]}`;
  try {
    const res = await fetch(target, { headers: { "user-agent": UA, "accept-language": "en" }, redirect: "follow" });
    const html = await res.text();
    const id = html.match(/"channelId":"(UC[A-Za-z0-9_-]{20,24})"/)?.[1]
      ?? html.match(/"externalId":"(UC[A-Za-z0-9_-]{20,24})"/)?.[1] ?? null;
    ytCache.set(key, id);
    return id;
  } catch {
    ytCache.set(key, null);
    return null;
  }
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("Falta --file=<jsonl>");
  const apply = process.argv.includes("--apply");
  const rows = readFileSync(file, "utf8").split("\n").filter((line) => line.trim())
    .map((line, index) => {
      try { return JSON.parse(line) as Row; } catch (error) {
        throw new Error(`JSON inválido en la línea ${index + 1}: ${(error as Error).message}`, { cause: error });
      }
    });
  const pool = getPool();

  type Op = { row: Row; link: ProposedLink; action: "insert" | "fill-id"; existingUrl?: string };
  const ops: Op[] = [];
  const emailOps: Array<{ row: Row; email: string }> = [];
  const albumOps: Array<{ row: Row; link: AlbumLink; albumTitle: string }> = [];
  const conflicts: Array<{ artistId: number; platform: string; catalog: string; proposed: string }> = [];
  const artistNames = new Map<number, string>();

  for (const row of rows) {
    const artist = (await pool.query<{ name: string; email: string | null }>("SELECT name, email FROM public.artists WHERE id=$1", [row.artistId])).rows[0];
    if (!artist) { conflicts.push({ artistId: row.artistId, platform: "-", catalog: "(no existe el artista)", proposed: row.source ?? "" }); continue; }
    artistNames.set(row.artistId, artist.name);
    if (row.email) {
      if (!artist.email) emailOps.push({ row, email: row.email.toLowerCase().trim() });
      else if (artist.email.toLowerCase().trim() !== row.email.toLowerCase().trim()) {
        conflicts.push({ artistId: row.artistId, platform: "email", catalog: artist.email, proposed: row.email });
      }
    }
    for (const link of row.links ?? []) {
      const social = link.category === "social";
      const table = social ? "social_links" : "streaming_links";
      const extra = social ? "handle" : "external_id";
      const existing = (await pool.query<{ url: string; extra: string | null }>(
        `SELECT url, ${extra} AS extra FROM public.${table} WHERE artist_id=$1 AND platform=$2`, [row.artistId, link.platform])).rows[0];
      const proposedExtra = social ? link.handle : link.externalId;
      if (!existing) { ops.push({ row, link, action: "insert" }); continue; }
      if (linkKey(link.platform, existing.url) !== linkKey(link.platform, link.url)) {
        if (link.platform === "youtube" || link.platform === "youtube_music") {
          const [a, b] = [await youtubeChannelOf(existing.url), await youtubeChannelOf(link.url)];
          if (a && b && a === b) {
            if (!existing.extra) ops.push({ row, link: { ...link, externalId: a }, action: "fill-id", existingUrl: existing.url });
            continue;
          }
        }
        conflicts.push({ artistId: row.artistId, platform: link.platform, catalog: existing.url, proposed: link.url });
        continue;
      }
      if (!existing.extra && proposedExtra) ops.push({ row, link, action: "fill-id", existingUrl: existing.url });
    }
    for (const link of row.albumLinks ?? []) {
      const existing = (await pool.query<{ url: string }>(
        "SELECT url FROM public.streaming_links WHERE album_id=$1 AND platform=$2", [link.albumId, link.platform])).rows[0];
      const title = (await pool.query<{ title: string }>("SELECT title FROM public.albums WHERE id=$1", [link.albumId])).rows[0]?.title ?? "";
      if (!existing) albumOps.push({ row, link, albumTitle: title });
      else if (linkKey(link.platform, existing.url) !== linkKey(link.platform, link.url)) {
        conflicts.push({ artistId: row.artistId, platform: `album:${link.platform}`, catalog: existing.url, proposed: link.url });
      }
    }
  }

  for (const op of ops) {
    console.log(`  ${op.action === "insert" ? "+" : "~"} ${op.row.artistId} ${artistNames.get(op.row.artistId)} · ` +
      `${op.link.category}/${op.link.platform} ${op.link.url}`);
  }
  for (const op of emailOps) {
    console.log(`  @ ${op.row.artistId} ${artistNames.get(op.row.artistId)} · email ${op.email}`);
  }
  for (const op of albumOps) {
    console.log(`  ♪ ${op.row.artistId} ${artistNames.get(op.row.artistId)} · disco «${op.albumTitle}» (${op.link.albumId}) ` +
      `${op.link.platform} ${op.link.url}`);
  }
  if (conflicts.length) {
    console.log(`\nConflictos (NO se tocan): ${conflicts.length}`);
    for (const c of conflicts) console.log(`  ! ${c.artistId} ${c.platform}: ficha ${c.catalog} ≠ propuesto ${c.proposed}`);
  }
  console.log(`\n${rows.length} artistas · ${ops.length} escrituras · ${emailOps.length} correos · ${albumOps.length} discos · ${conflicts.length} conflictos`);
  if (!apply) { console.log("(dry-run: usa --apply)"); await closeDb(); return; }

  const { runId } = await withOperatorRun(
    { name: "campana-enlaces-2026-10-19", operator: "hermes", note: NOTE, params: { file } },
    async (ctx) => {
      for (const op of emailOps) {
        await updateEntity(ctx, "artist", op.row.artistId, { email: op.email });
      }
      for (const op of albumOps) {
        await writePlatformLink(ctx, "album", op.link.albumId, "streaming", op.link.platform, {
          url: op.link.url, handle: null, verified: true, externalId: op.link.externalId ?? null,
        });
      }
      for (const op of ops) {
        await writePlatformLink(ctx, "artist", op.row.artistId, op.link.category, op.link.platform, {
          url: op.action === "fill-id" && op.existingUrl ? op.existingUrl : op.link.url,
          handle: op.link.handle ?? null,
          verified: op.link.verified ?? true,
          externalId: op.link.externalId ?? null,
        });
      }
      return { runId: ctx.runId, writes: ops.length };
    },
  );
  console.log(`\nrun ${runId} aplicado: ${ops.length} enlaces.`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exitCode = 1; });
