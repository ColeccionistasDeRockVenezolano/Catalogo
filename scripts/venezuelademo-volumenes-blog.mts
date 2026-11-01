/**
 * Crea los volúmenes VenezuelaDemo 25-34 (no existían en el catálogo) con el
 * tracklist completo publicado en AntologiaVenezuela, su año (2010), portada 1:1
 * y descripción documental. Idempotente: si el álbum o la pista ya existen, los salta.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-volumenes-blog.mts <plan.json> [--apply]
 */
import {readFileSync, existsSync} from 'node:fs';
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, createEntity, OperatorError} from '../src/merge/operator.js';

const TAG = 'venezuelademo-blog-2026-10-26';
const APPLY = process.argv.includes('--apply');
const planFile = process.argv[2];
if (!planFile || !existsSync(planFile)) throw new Error('falta el plan JSON');
const VARIOUS = 257;

interface T {n: number; tema: string; genero: string; autor: string; anio: number | null;
  grupo: string; duracion: number | null; tag_title: string}
interface P {vol: number; titulo: string; subtitulo: string; anio: number | null;
  source_url: string; portada: string; tracks: T[]}
const plan: P[] = JSON.parse(readFileSync(planFile, 'utf8'));

const pool = getPool();
const existing = new Map<string, number>();
for (const r of (await pool.query<{id: string; title: string}>(
  "SELECT id::text, title FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$'")).rows) {
  existing.set(r.title.toLowerCase().trim(), Number(r.id));
}

const todo = plan.filter(p => !existing.has(p.titulo.toLowerCase()));
console.log(`volúmenes en el plan: ${plan.length}; a crear: ${todo.length}`);

if (!APPLY) {
  for (const p of plan) console.log(`  ${p.vol}: ${existing.has(p.titulo.toLowerCase()) ? 'existe' : 'CREAR'} ${p.tracks.length} temas ${p.subtitulo}`);
  await closeDb();
  process.exit(0);
}

let createdAlbums = 0, createdTracks = 0, skippedTracks = 0;
const {runId, result} = await withOperatorRun({
  name: TAG + ':volumenes', operator: 'hermes (encargo de Brian)',
  note: 'Alta de los volúmenes VenezuelaDemo 25-34 con tracklist completo del blog AntologiaVenezuela, año 2010, portada y descripción documental.',
  params: {campaign: TAG, volumes: todo.map(p => p.vol)},
}, async ctx => {
  const out = [];
  for (const p of todo) {
    const desc = `Volumen ${p.vol} del catálogo VenezuelaDemo (producción musical independiente venezolana`
      + ` distribuida por el Ministerio de Comunicación e Información).`
      + (p.subtitulo ? ` Subtítulo: ${p.subtitulo}.` : '')
      + ` Contiene ${p.tracks.length} temas. Edición de ${p.anio ?? 'fecha no documentada'}.`;
    const album = await createEntity(ctx, 'album', {
      title: p.titulo, album_type: 'compilation', release_year: p.anio, cover_url: p.portada,
      media_format: 'CD', description: desc,
      notes: `Fuente del tracklist y la portada: ${p.source_url}`,
    }, {artistId: VARIOUS, allowSimilar: true});
    createdAlbums++;
    const albumId = album.id;
    let nt = 0;
    for (const t of p.tracks) {
      const notes = JSON.stringify({autor: t.autor, genero: t.genero, anio: t.anio,
        fuente: p.source_url, ...(t.tag_title ? {tag_id3: t.tag_title} : {})});
      try {
        await createEntity(ctx, 'track', {
          title: t.tema, track_number: t.n, disc_number: 1,
          ...(t.duracion ? {duration_seconds: Math.round(t.duracion)} : {}),
          notes: [t.grupo ? 'Intérprete documentado: ' + t.grupo : null, notes].filter(Boolean).join('\n'),
        }, {albumId, allowSimilar: true});
        createdTracks++; nt++;
      } catch (e) {
        skippedTracks++;
        if (e instanceof OperatorError) console.log(`  ! ${p.titulo} #${t.n}: ${e.code} ${e.message}`);
        else throw e;
      }
    }
    out.push({vol: p.vol, album: albumId, tracks: nt});
  }
  return out;
});
console.log(`run ${runId}: álbumes creados=${createdAlbums} pistas creadas=${createdTracks} saltadas=${skippedTracks}`);
for (const r of result) console.log(`  vol ${r.vol} album=${r.album} temas=${r.tracks}`);
await closeDb();
