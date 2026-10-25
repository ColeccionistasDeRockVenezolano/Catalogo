/**
 * Archiva en el catálogo lo recuperado del volcado MP3.com 2003:
 *   - discografía (discos, pistas, sello, créditos)  → media.artist_documents (category=discography)
 *   - enlaces declarados + web propia               → media.artist_documents (category=other)
 *   - web propia viva                               → public.social_links (platform=website, sin pisar)
 *
 * Entradas: data/raw/mp3com-2003/{discografia,songs,links}-venezolanos.jsonl
 *           reports/mp3com-2003/cruce.jsonl   (para mapear clave → artista ya existente)
 *           /tmp/mp3com-web-vivas.json        ({"url": true|false}, comprobación HTTP)
 *
 * Uso: tsx scripts/mp3com-archivo.mts [--confirm]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from 'node:os';
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { discographyCounts, discographyTitle, renderDiscography } from "./lib/mp3com-discography.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = '/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/mp3com-2003';
const REP = path.join(ROOT, 'reports/mp3com-2003');
const OUT = process.env['MP3COM_OUT'] ?? path.join(homedir(),'crv-staging/reports/mp3com-archivo-2026-10-24');
const TAG = 'mp3com-2003';
const CONFIRM = process.argv.includes('--confirm');

interface Disco { media: string | null; album: string | null; label: string | null; tracks: Array<{ song_id: string; title: string; credits: string | null; size: string | null; url: string }> }
interface Discografia { key: string; name: string; uri: string | null; location?: string; url: string; albums: Disco[]; plays: number | null }
interface Enlaces { key: string; name: string; uri: string | null; location?: string; url: string; website: string | null; links: Array<{ url: string | null; text: string }>; artists_we_like: Array<{ url: string | null; text: string }>; plays: number | null; messageboard: number | null }
interface Cancion { song_id: string; name: string; title: string | null; genre: string | null; credits: string | null; description: string | null; size: string | null; url: string }

const jsonl = <T,>(f: string): T[] => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : [];
const ts = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

function playsDeInfo(): Map<string, number> {
  const m = new Map<string, number>();
  const f = path.join(RAW, 'info-all.jsonl');
  if (!existsSync(f)) return m;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { dir: string; page: string; plays?: number };
      if (typeof d.plays === 'number') m.set(`${d.dir}/${d.page}`, d.plays);
    } catch { /* línea rota: se ignora */ }
  }
  return m;
}


function textoEnlaces(e: Enlaces): string {
  const out: string[] = [`Enlaces declarados por el artista en MP3.com (noviembre de 2003) · ${e.name}`];
  if (e.website) out.push(`Web propia: ${e.website}`);
  if (e.links.length) { out.push('', 'Enlaces:'); for (const l of e.links) out.push(`  · ${l.text}${l.url ? ` — ${l.url}` : ''}`); }
  if (e.artists_we_like.length) { out.push('', 'Artistas que recomienda:'); for (const l of e.artists_we_like) out.push(`  · ${l.text}${l.url ? ` — ${l.url}` : ''}`); }
  if (e.plays) out.push('', `Reproducciones acumuladas en MP3.com: ${e.plays.toLocaleString('es-VE')}`);
  out.push('', `Ficha de origen: ${e.url}`);
  return out.join('\n').slice(0, 20000);
}

async function main() {
  mkdirSync(OUT,{recursive:true});
  const discos = jsonl<Discografia>(path.join(RAW, 'discografia-venezolanos.jsonl'));
  const enlaces = jsonl<Enlaces>(path.join(RAW, 'links-venezolanos.jsonl'));
  const canciones = jsonl<Cancion>(path.join(RAW, 'songs-venezolanos.jsonl'));
  const vivas: Record<string, boolean> = existsSync('/tmp/mp3com-web-vivas.json') ? JSON.parse(readFileSync('/tmp/mp3com-web-vivas.json', 'utf8')) : {};
  const plays = playsDeInfo();
  const pool = getPool();

  // clave (dir/page) → artist_id
  const mapa = new Map<string, number>();
  const cruce = jsonl<{ page: string; tiene: boolean; match_kind: string | null; match_id: number | null; tier: string }>(path.join(REP, 'cruce.jsonl'));
  for (const c of cruce) if (c.tiene && c.match_kind === 'artist' && c.match_id) mapa.set(c.page, c.match_id);
  const claims = await pool.query<{ artist_id: string; key: string }>(
    `SELECT c.artist_id::text, substring(c.identity_key from 'mp3com:(.*):name$') AS key
       FROM ingest.claims c
      WHERE c.source_id=(SELECT id FROM ingest.sources WHERE slug='mp3-com-2003-project')
        AND c.field='name' AND c.artist_id IS NOT NULL`);
  for (const r of claims.rows) if (r.key) mapa.set(r.key, Number(r.artist_id));

  // Sólo ids que existen hoy: una fusión pudo borrar la ficha que dejó el claim.
  const ids = [...new Set(mapa.values())];
  const vivos = new Set((await pool.query<{ id: string }>(
    `SELECT a.id::text FROM public.artists a
      WHERE a.id = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM ingest.artist_editorial_names n WHERE n.name_key = ingest.editorial_name_key(a.name))`,
    [ids])).rows.map((r) => Number(r.id)));
  const huerfanos = [...mapa.entries()].filter(([, id]) => !vivos.has(id)).map(([k]) => k);
  for (const [k, id] of [...mapa.entries()]) if (!vivos.has(id)) mapa.delete(k);
  if (huerfanos.length) console.log(`aviso: ${huerfanos.length} claves apuntaban a fichas fusionadas, borradas o excluidas editorialmente: ${huerfanos.slice(0, 5).join(', ')}`);
  console.log(`mapa: ${mapa.size} artistas · discografías ${discos.length} · enlaces ${enlaces.length} · canciones ${canciones.length}`);
  const informes = { discografias: 0, enlaces: 0, webs: 0, webs_muertas: 0, sin_artista: [] as string[], runs: [] as number[] };

  if (!CONFIRM) {
    const sin = [...discos, ...enlaces].filter((x) => !mapa.has(x.key)).map((x) => x.key);
    console.log(`EN SECO: ${new Set(sin).size} claves sin artista en el catálogo; ${discos.length + enlaces.length} documentos a insertar; ${enlaces.filter((e) => e.website && vivas[e.website!]).length} webs vivas para social_links.`);
    writeFileSync(path.join(OUT, `archivo-dry-run-${ts()}.json`), JSON.stringify({ sin_artista: [...new Set(sin)] }, null, 1));
    await closeDb();
    return;
  }

  const { runId } = await withOperatorRun({
    name: 'hermes:mp3com-2003-archivo',
    operator: 'hermes (delegado por Brian)',
    note: 'Archivo documental de la discografía y los enlaces que cada artista venezolano declaró en MP3.com (noviembre de 2003); fuente mp3-com-2003-project.',
  }, async (ctx) => {
    for (const d of discos) {
      const artistId = mapa.get(d.key);
      if (!artistId) { informes.sin_artista.push(d.key); continue; }
      const p = d.plays ?? plays.get(d.key);
      const contenido = renderDiscography(d, canciones, p);
      const tracks = d.albums.reduce((n, a) => n + a.tracks.length, 0);
      const r = await ctx.client.query(
        `INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,tags,metadata)
         VALUES($1,$2,'discography',$3,$4,$5,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING`,
        [artistId, `${TAG}:discografia:${d.key}`, discographyTitle(d),
         contenido, d.url, [TAG, 'discografia'], JSON.stringify({ campaign: TAG, mp3comUri: d.uri, mp3comPage: d.key, ...discographyCounts(d), tracks, plays: p })]);
      if (r.rowCount) informes.discografias += 1;
    }
    for (const e of enlaces) {
      if (!e.website && !e.links.length && !e.artists_we_like.length) continue;
      const artistId = mapa.get(e.key);
      if (!artistId) { informes.sin_artista.push(e.key); continue; }
      const vivo = e.website ? vivas[e.website] === true : false;
      const r = await ctx.client.query(
        `INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,tags,metadata)
         VALUES($1,$2,'other',$3,$4,$5,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING`,
        [artistId, `${TAG}:enlaces:${e.key}`, `Enlaces declarados en MP3.com (2003) — ${e.name}`,
         textoEnlaces(e), e.url, [TAG, 'enlaces'], JSON.stringify({ campaign: TAG, mp3comUri: e.uri, mp3comPage: e.key, website: e.website, websiteLive: vivo, plays: e.plays, messageboard: e.messageboard })]);
      if (r.rowCount) informes.enlaces += 1;
      if (e.website && vivo) {
        const ins = await ctx.client.query(
          `INSERT INTO public.social_links(artist_id,platform,url,source,method,verified,notes)
           VALUES($1,'website',$2,'mp3-com-2003-project','exact',false,$3) ON CONFLICT(artist_id,platform) DO NOTHING`,
          [artistId, e.website, 'Web declarada en MP3.com (noviembre de 2003); respondió por HTTP al archivar. Titularidad pendiente de verificación.']);
        if (ins.rowCount) informes.webs += 1;
      } else if (e.website) informes.webs_muertas += 1;
    }
    return informes;
  });
  informes.runs.push(runId);
  writeFileSync(path.join(OUT, `archivo-aplicado-${ts()}.json`), JSON.stringify(informes, null, 1));
  console.log(JSON.stringify({ ...informes, sin_artista: new Set(informes.sin_artista).size }, null, 1));
  await closeDb();
}

main().catch(async (e: unknown) => { console.error(e); await closeDb(); process.exit(1); });
