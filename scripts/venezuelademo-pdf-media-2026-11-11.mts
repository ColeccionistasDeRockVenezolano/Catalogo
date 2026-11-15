/**
 * VenezuelaDemo (PDF): fotos de artistas y portadas de discos.
 *
 * - Artista sin foto y álbum sin portada: se aplican directamente (encargo de Brian).
 * - Ficha que ya tiene imagen: se propone como candidata en Curaduría · Portadas y fotos.
 * - Las candidatas nuevas se inspeccionan (calidad, uso, huella) en el mismo run.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-media-2026-11-11.mts [--apply]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { proposeImageCandidate } from '../src/merge/image-candidates.js';
import { inspectImageCandidates } from '../src/merge/image-inspection.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-media-2026-11-11';
const APPLY = process.argv.includes('--apply');
const PLAN_FILE = 'reports/venezuelademo-pdf-2026-11-11/plan.json';
const PREFIX = '/crv/media/venezuelademo-pdf-2026-11-11';
const MEDIA = path.resolve('web/public/media/venezuelademo-pdf-2026-11-11');
const SOURCE = 'Venezuela Demo — MCI';

interface Foto { artist_id: number; artista: string; slug: string; file: string; sha256: string; w: number; h: number; actual: string | null }
interface Portada extends Foto { album_id: number; titulo: string; leido: string; via: string }
interface Plan {
  fotos_aplicar: Foto[]; fotos_proponer: Foto[];
  portadas_aplicar: Portada[]; portadas_proponer: Portada[];
}

const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8')) as Plan;

function publish(file: string, sha256: string, kind: 'fotos' | 'portadas'): string {
  if (!existsSync(file)) throw new Error(`falta el archivo ${file}`);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (digest !== sha256) throw new Error(`sha256 no coincide: ${file}`);
  const dir = path.join(MEDIA, kind);
  const dest = path.join(dir, `${sha256}.jpg`);
  if (APPLY) {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(dest)) copyFileSync(file, dest);
    if (createHash('sha256').update(readFileSync(dest)).digest('hex') !== sha256) throw new Error(`copia corrupta ${dest}`);
  }
  return `${PREFIX}/${kind}/${sha256}.jpg`;
}

const fotosAplicar = plan.fotos_aplicar.map(f => ({ ...f, url: publish(f.file, f.sha256, 'fotos') }));
const fotosProponer = plan.fotos_proponer.map(f => ({ ...f, url: publish(f.file, f.sha256, 'fotos') }));
const portadasAplicar = plan.portadas_aplicar.map(p => ({ ...p, url: publish(p.file, p.sha256, 'portadas') }));
const portadasProponer = plan.portadas_proponer.map(p => ({ ...p, url: publish(p.file, p.sha256, 'portadas') }));

console.log(`fotos: ${fotosAplicar.length} directas, ${fotosProponer.length} a curaduría`);
console.log(`portadas: ${portadasAplicar.length} directas, ${portadasProponer.length} a curaduría`);
if (!APPLY) {
  console.log('ensayo; usar --apply');
  await closeDb();
  process.exit(0);
}

const pool = getPool();
const { runId, result } = await withOperatorRun({
  name: TAG,
  operator: 'hermes (encargo de Brian 2026-11-11)',
  note: 'Fotos y portadas extraídas de las reseñas PDF de VenezuelaDemo: aplicadas a fichas sin imagen y propuestas como candidatas donde ya había una.',
  params: { campaign: TAG, fotos: fotosAplicar.length + fotosProponer.length, portadas: portadasAplicar.length + portadasProponer.length },
}, async (context) => {
  const count = { fotosAplicadas: 0, fotosPropuestas: 0, fotosYaTenían: 0, portadasAplicadas: 0, portadasPropuestas: 0, portadasYaTenían: 0 };
  const candidatas: number[] = [];
  const liveArtists = new Map<number, string | null>();
  for (const f of [...fotosAplicar, ...fotosProponer]) {
    if (!liveArtists.has(f.artist_id)) {
      const row = (await context.client.query<{ picture_url: string | null }>('SELECT picture_url FROM public.artists WHERE id=$1', [f.artist_id])).rows[0];
      liveArtists.set(f.artist_id, row?.picture_url ?? null);
    }
    const current = liveArtists.get(f.artist_id) ?? null;
    if (!current) {
      await updateEntity(context, 'artist', f.artist_id, { picture_url: f.url });
      liveArtists.set(f.artist_id, f.url);
      count.fotosAplicadas++;
      continue;
    }
    if (current === f.url) { count.fotosYaTenían++; continue; }
    const proposed = await proposeImageCandidate(context.client, {
      kind: 'artist', targetId: f.artist_id, currentUrl: current, candidateUrl: f.url,
      source: SOURCE, pageUrl: `https://web.archive.org/web/2008/http://www.venezuelademo.com/musicos/artistas/${f.slug}.pdf`,
      origin: TAG, runId: context.runId, width: f.w, height: f.h,
      context: `Foto de ${f.artista} en su reseña de VenezuelaDemo (${f.w}×${f.h})`,
    });
    if (proposed === 'proposed') count.fotosPropuestas++;
    const found = (await context.client.query<{ id: string }>(
      "SELECT id::text FROM ingest.image_candidates WHERE entity_kind='artist' AND artist_id=$1 AND candidate_url=$2 AND status='open' ORDER BY id DESC LIMIT 1",
      [f.artist_id, f.url])).rows[0];
    if (found) candidatas.push(Number(found.id));
  }
  for (const p of [...portadasAplicar, ...portadasProponer]) {
    const row = (await context.client.query<{ cover_url: string | null }>('SELECT cover_url FROM public.albums WHERE id=$1 FOR UPDATE', [p.album_id])).rows[0];
    const current = row?.cover_url ?? null;
    if (!current) {
      await updateEntity(context, 'album', p.album_id, { cover_url: p.url });
      count.portadasAplicadas++;
      continue;
    }
    if (current === p.url) { count.portadasYaTenían++; continue; }
    const proposed = await proposeImageCandidate(context.client, {
      kind: 'album', targetId: p.album_id, currentUrl: current, candidateUrl: p.url,
      source: SOURCE, pageUrl: `https://web.archive.org/web/2008/http://www.venezuelademo.com/musicos/artistas/${p.slug}.pdf`,
      origin: TAG, runId: context.runId, width: p.w, height: p.h,
      context: `Portada de «${p.titulo}» en la reseña de ${p.artista} (leído en la imagen: ${p.leido || 'sin texto'})`,
    });
    if (proposed === 'proposed') count.portadasPropuestas++;
    const found = (await context.client.query<{ id: string }>(
      "SELECT id::text FROM ingest.image_candidates WHERE entity_kind='album' AND album_id=$1 AND candidate_url=$2 AND status='open' ORDER BY id DESC LIMIT 1",
      [p.album_id, p.url])).rows[0];
    if (found) candidatas.push(Number(found.id));
  }
  const inspected = candidatas.length ? await inspectImageCandidates(context, { ids: candidatas }) : { inspected: 0, failed: 0, visual: 0 };
  return { ...count, candidatas: candidatas.length, inspeccionadas: inspected.inspected, ilegibles: inspected.failed };
});

writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-media.json', JSON.stringify({ runId, ...result, at: new Date().toISOString() }, null, 1));
console.log(JSON.stringify({ runId, ...result }));
await closeDb();
