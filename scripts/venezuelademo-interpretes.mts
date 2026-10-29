/**
 * VenezuelaDemo — completa los intérpretes de los 34 volúmenes.
 *
 * 1. Lee los tracks de los álbumes Venezuelademo 1-34 y extrae "Intérprete documentado: X" de notes.
 * 2. Resuelve X contra public.artists y public.persons (normalizado + fuzzy).
 *    - exacto en artists  -> usa ese id
 *    - exacto en persons  -> crea artist solo_artist vinculado a la persona (si no existe)
 *    - fuzzy >= 0.92      -> usa el existente (variante de grafía)
 *    - resto              -> crea artist (band/solo_artist por heurística)
 * 3. Crea track_credit (musician / Intérprete) para cada tema.
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-interpretes.mts [--apply]
 */
import {getPool, closeDb} from '../src/db/client.js';
import {withOperatorRun, createEntity, createRelation, OperatorError} from '../src/merge/operator.js';

const TAG = 'venezuelademo-interpretes-2026-10-26';
const APPLY = process.argv.includes('--apply');

const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/gu, ' ').replace(/\b(el|la|los|las|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

function dice(a: string, b: string): number {
  const A = new Set<string>(), B = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) A.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) B.add(b.slice(i, i + 2));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const SOLO_HINTS = /\b(y|&|orquesta|trio|trío|cuarteto|quinteto|ensamble|grupo|banda|conjunto|coro|duo|dúo|combo|sinfonic|sinfónic|filarmonic|filarmónic|jazz band|big band|proyecto|project|collective|colectivo|school|taller)\b/i;

const pool = getPool();
const albums = (await pool.query<{id: string; title: string}>(
  "SELECT id::text, title FROM public.albums WHERE title ~* '^venezuelademo [0-9]+$' ORDER BY id")).rows;
const albumIds = albums.map(a => Number(a.id));
const tracks = (await pool.query<{id: string; album_id: string; track_number: number; title: string; notes: string | null}>(
  `SELECT id::text, album_id::text, track_number, title, notes FROM public.tracks
   WHERE album_id = ANY($1::bigint[]) ORDER BY album_id, track_number`, [albumIds])).rows;

const interpretes = new Map<string, {name: string; tracks: number[]}>();
for (const t of tracks) {
  const m = /Intérprete documentado:\s*([^\n]+)/i.exec(t.notes ?? '');
  if (!m) continue;
  const name = m[1]!.trim();
  const key = norm(name);
  if (!key) continue;
  if (!interpretes.has(key)) interpretes.set(key, {name, tracks: []});
  interpretes.get(key)!.tracks.push(Number(t.id));
}
console.log(`tracks=${tracks.length} álbumes=${albums.length} intérpretes únicos=${interpretes.size}`);

const artists = (await pool.query<{id: string; name: string}>('SELECT id::text, name FROM public.artists')).rows
  .map(r => ({id: Number(r.id), name: r.name, key: norm(r.name)}));
const persons = (await pool.query<{id: string; name: string}>('SELECT id::text, name FROM public.persons')).rows
  .map(r => ({id: Number(r.id), name: r.name, key: norm(r.name)}));
const byKey = new Map<string, number>();
for (const a of artists) if (!byKey.has(a.key)) byKey.set(a.key, a.id);
const personByKey = new Map<string, number>();
for (const p of persons) if (!personByKey.has(p.key)) personByKey.set(p.key, p.id);

const plan: {key: string; name: string; action: 'exists' | 'variant' | 'create'; id?: number;
  personId?: number; type: string; variantOf?: string; score?: number; tracks: number[]}[] = [];
for (const [key, v] of interpretes) {
  const exId = byKey.get(key);
  if (exId !== undefined) { plan.push({key, name: v.name, action: 'exists', id: exId, type: '', tracks: v.tracks}); continue; }
  let best: {id: number; name: string; score: number} | undefined;
  for (const a of artists) {
    const d = dice(key, a.key);
    if (!best || d > best.score) best = {id: a.id, name: a.name, score: d};
  }
  const personId = personByKey.get(key);
  if (best && best.score >= 0.92) {
    plan.push({key, name: v.name, action: 'variant', id: best.id, variantOf: best.name, score: best.score, type: '', tracks: v.tracks});
  } else {
    const words = v.name.trim().split(/\s+/).length;
    const type = personId ? 'solo_artist' : (SOLO_HINTS.test(v.name) || words === 1 ? 'band' : 'solo_artist');
    plan.push({key, name: v.name, action: 'create', ...(personId ? {personId} : {}), type, tracks: v.tracks});
  }
}
const counts = plan.reduce((m, p) => (m[p.action] = (m[p.action] ?? 0) + 1, m), {} as Record<string, number>);
console.log('plan:', counts, '| créditos a crear:', plan.reduce((s, p) => s + p.tracks.length, 0));
console.log('variantes:', plan.filter(p => p.action === 'variant').slice(0, 6).map(p => `${p.name} ~ ${p.variantOf} (${p.score?.toFixed(2)})`));
console.log('crear:', plan.filter(p => p.action === 'create').slice(0, 10).map(p => `${p.name} [${p.type}]`));

if (!APPLY) { await closeDb(); process.exit(0); }

let createdArtists = 0, linkedCredits = 0, failedCredits = 0;
const BATCH = 40;
for (let start = 0; start < plan.length; start += BATCH) {
  const lote = plan.slice(start, start + BATCH);
  const {runId, result} = await withOperatorRun({
    name: `${TAG}:${start / BATCH + 1}`, operator: 'hermes (encargo de Brian)',
    note: 'Vinculación de intérpretes documentados en las fichas y tracklists de los 34 volúmenes VenezuelaDemo; artistas verificados contra artists/persons antes de crear.',
    params: {campaign: TAG, offset: start, count: lote.length},
  }, async ctx => {
    const out: {name: string; artistId: number | null; credits: number; created: boolean}[] = [];
    for (const p of lote) {
      let artistId = p.id ?? null;
      let created = false;
      if (p.action === 'create') {
        try {
          const a = await createEntity(ctx, 'artist', {
            name: p.name, artist_type: p.type, origin_country: 'Venezuela',
            notes: 'Intérprete documentado en el catálogo VenezuelaDemo. Tipo inferido del nombre; revisar si es agrupación o solista.'
              + (p.personId ? ` Persona existente en el catálogo (person ${p.personId}).` : ''),
          }, {allowSimilar: true});
          artistId = a.id; created = true; createdArtists++;
        } catch (e) {
          if (e instanceof OperatorError && e.code === 'already_exists') {
            const ex = (e.details as {existingId?: number} | undefined)?.existingId;
            if (ex) { artistId = ex; }
            else { out.push({name: p.name, artistId: null, credits: 0, created: false}); continue; }
          } else throw e;
        }
      }
      if (!artistId) { out.push({name: p.name, artistId: null, credits: 0, created}); continue; }
      let n = 0;
      for (const trackId of p.tracks) {
        try {
          await createRelation(ctx, 'track_credit', {trackId, artistId},
            {credit_type: 'musician', credit_role: 'Intérprete'});
          n++; linkedCredits++;
        } catch (e) {
          failedCredits++;
          if (!(e instanceof OperatorError)) throw e;
        }
      }
      out.push({name: p.name, artistId, credits: n, created});
    }
    return out;
  });
  console.log(`lote ${start / BATCH + 1}: run ${runId} artistas=${result.filter(r => r.created).length} créditos=${result.reduce((s, r) => s + r.credits, 0)}`);
  const sin = result.filter(r => r.artistId === null);
  if (sin.length) console.log('  sin artista:', sin.length, sin.slice(0, 3).map(s => s.name));
}
console.log(`TOTAL artistas creados=${createdArtists} créditos=${linkedCredits} fallos=${failedCredits}`);
await closeDb();
