// Fichas faltantes para las 5 portadas de Fundación Bigott sin destino.
// Verifica primero que no existan; crea sólo lo que falte y deja la portada
// en su claim (los álbumes nuevos nacen SIN cover_url).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, withOperatorRun, OperatorError, type OperatorContext } from '../src/merge/operator.js';
import { normalizeIdentity } from '../src/normalization/claims.js';

const campaign = 'bigott-cds-2026-10-26';
const reports = path.resolve('reports', campaign);
const CLAIM_RUN = 34397;
const LABEL_BIGOTT = 2028; // organizations: Fundación Bigott
const SOURCE = 'https://fundacionbigott.org/fondo-editorial/cds/';

interface ArtistPlan { existingId?: number; name?: string; artistType?: string; personId?: number; }
interface Plan {
  claimId: number; position: number; title: string; sourceTitle: string; albumType: string;
  artist: ArtistPlan; year: number | null; note: string;
}

const PLAN: Plan[] = [
  { claimId: 2605928, position: 5, title: 'Tradición musical de Nueva Esparta', sourceTitle: 'Tradición de Nva. Esparta',
    albumType: 'compilation', artist: { existingId: 257 }, year: null,
    note: 'Antología de música tradicional neoespartana sin intérprete único documentado; se cuelga de Various Artists. Título según la portada impresa.' },
  { claimId: 2605933, position: 10, title: 'Ya eres abril', sourceTitle: 'Ya eres abril',
    albumType: 'other', artist: { name: 'Henry Martínez', artistType: 'solo_artist', personId: 33 }, year: null,
    note: 'Solista Henry Martínez (persona id 33 en el catálogo). Año de edición no documentado en la fuente.' },
  { claimId: 2605934, position: 11, title: 'Festividades Vol. III', sourceTitle: 'Festividades Vol. III',
    albumType: 'other', artist: { existingId: 3840 }, year: null,
    note: 'Tercer volumen de la serie Festividades de Pasacalle; Vol. I y II figuran con 1999. Año del Vol. III sin confirmar.' },
  { claimId: 2605941, position: 18, title: 'Tuyero', sourceTitle: 'Tuyero',
    albumType: 'other', artist: { name: 'Yustardi Laza', artistType: 'solo_artist', personId: 30945 }, year: null,
    note: 'Solista Yustardi Laza (persona id 30945). Año de edición no documentado en la fuente.' },
  { claimId: 2605945, position: 22, title: 'Yuruari', sourceTitle: 'Yuruari',
    albumType: 'other', artist: { existingId: 3860 }, year: null,
    note: 'Disco homónimo del grupo Yuruari (ya en el catálogo con La Fuerza Del Calipso). Título del CD según la portada.' },
];

function sqlLike(text: string): string { return `%${text.replace(/[%_]/g, '')}%`; }

/** Guardia: mismas palabras clave que se revisaron a mano, comparadas normalizadas. */
async function verifyNotExists(): Promise<{ artists: Map<string, number>; albums: Record<number, number> }> {
  const pool = getPool();
  const artistKey = new Map<string, number>();
  const artists = (await pool.query<{ id: number; name: string }>('SELECT id::int, name FROM public.artists')).rows;
  for (const row of artists) artistKey.set(normalizeIdentity(row.name), row.id);

  const albums: Record<number, number> = {};
  const wanted = [
    { claim: 2605928, words: ['esparta'] },
    { claim: 2605933, words: ['abril'] },
    { claim: 2605934, words: ['festividad'] },
    { claim: 2605941, words: ['tuyero'] },
    { claim: 2605945, words: ['yuruari'] },
  ];
  for (const want of wanted) {
    const rows = (await pool.query<{ id: number; title: string; artist_id: number }>(
      `SELECT id::int, title, artist_id FROM public.albums WHERE ${want.words.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ')}`,
      want.words.map(sqlLike))).rows;
    const plan = PLAN.find((p) => p.claimId === want.claim)!;
    const same = rows.find((row) => normalizeIdentity(row.title) === normalizeIdentity(plan.title));
    if (same) albums[want.claim] = same.id;
  }

  for (const plan of PLAN) {
    if (plan.artist.name && artistKey.has(normalizeIdentity(plan.artist.name))) {
      throw new Error(`Ya existe el artista «${plan.artist.name}» (id ${artistKey.get(normalizeIdentity(plan.artist.name))})`);
    }
    if (plan.artist.existingId) {
      const found = (await pool.query('SELECT 1 FROM public.artists WHERE id=$1', [plan.artist.existingId])).rows.length;
      if (!found) throw new Error(`No existe el artista ${plan.artist.existingId} de «${plan.title}»`);
    }
  }
  return { artists: artistKey, albums };
}

async function apply(dryRun: boolean): Promise<void> {
  const { albums: alreadyAlbums } = await verifyNotExists();
  const pool = getPool();

  const claimRows = (await pool.query<{ id: number; album_id: number | null; identity_raw: string; raw_value: string }>(
    `SELECT id::int, album_id::int, identity_raw, raw_value #>> '{}' AS raw_value
       FROM ingest.claims WHERE id = ANY($1::int[]) AND run_id = $2`, [PLAN.map((p) => p.claimId), CLAIM_RUN])).rows;
  if (claimRows.length !== PLAN.length) throw new Error('No están los 27 claims de la campaña');

  const { runId, result } = await withOperatorRun({
    name: 'bigott_fichas_faltantes', operator: 'brian',
    note: 'Brian: Crea las fichas que faltan para las 5 portadas de Fundación Bigott, después de verificar que no existían. Sin portada: el claim sigue pendiente de revisión.',
    params: { campaign, source: SOURCE, claims: PLAN.map((p) => p.claimId) },
  }, async (context: OperatorContext) => {
    const created: Array<{ claimId: number; kind: string; id: number; title: string; existedBefore?: number }> = [];
    for (const plan of PLAN) {
      let artistId = plan.artist.existingId ?? null;
      if (artistId === null) {
        const artist = await createEntity(context, 'artist', {
          name: plan.artist.name!, artist_type: plan.artist.artistType ?? 'solo_artist',
          origin_country: 'Venezuela',
          notes: `Alta para el CD «${plan.sourceTitle}» del Fondo Editorial de Fundación Bigott (${SOURCE}). ` +
            (plan.artist.personId ? `Ya existía como persona (id ${plan.artist.personId}).` : ''),
        }, { allowSimilar: true });
        artistId = artist.id;
        created.push({ claimId: plan.claimId, kind: 'artist', id: artist.id, title: plan.artist.name! });
      }

      const existingAlbumId = alreadyAlbums[plan.claimId];
      if (existingAlbumId !== undefined) {
        created.push({ claimId: plan.claimId, kind: 'album', id: existingAlbumId, title: plan.title, existedBefore: existingAlbumId });
      } else {
        const album = await createEntity(context, 'album', {
          title: plan.title, album_type: plan.albumType, label_id: LABEL_BIGOTT,
          notes: `CD del Fondo Editorial de Fundación Bigott (${SOURCE}). ${plan.note} ` +
            `Portada propuesta en el claim ${plan.claimId} (${campaign}), pendiente de aceptar.`,
        }, { artistId, allowSimilar: true });
        created.push({ claimId: plan.claimId, kind: 'album', id: album.id, title: plan.title });
      }
    }

    // El claim de portada pasa a apuntar a la ficha nueva; sigue en 'candidate'.
    const link: Array<{ claimId: number; albumId: number }> = [];
    for (const plan of PLAN) {
      const row = created.find((c) => c.claimId === plan.claimId && c.kind === 'album')!;
      const updated = await context.client.query(
        `UPDATE ingest.claims SET album_id=$2,
           notes = COALESCE(notes,'') || $3
         WHERE id=$1 AND run_id=$4 AND album_id IS NULL`, [
          plan.claimId, row.id,
          ` Ficha «${plan.title}» creada (album_id ${row.id}); la portada sigue pendiente de aceptación.`, CLAIM_RUN]);
      if (updated.rowCount !== 1) throw new OperatorError('stale_preview', `El claim ${plan.claimId} ya tenía destino`);
      await context.client.query(
        `UPDATE ingest.review_queue SET status='approved', resolved_by='human', resolved_at=now(), updated_at=now(),
           resolution_note = COALESCE(resolution_note,'') || $2
         WHERE claim_a_id=$1 AND status='open'`, [
          plan.claimId, ` Ficha creada: album_id ${row.id} (${plan.title}).`]);
      link.push({ claimId: plan.claimId, albumId: row.id });
    }

    const counts = (await context.client.query(`SELECT
      (SELECT count(*)::int FROM public.albums WHERE id = ANY($1::int[])) AS albumes,
      (SELECT count(*)::int FROM public.albums WHERE id = ANY($1::int[]) AND cover_url IS NOT NULL) AS con_portada,
      (SELECT count(*)::int FROM ingest.claims WHERE id = ANY($2::int[]) AND album_id IS NOT NULL AND status='candidate') AS claims_vinculados,
      (SELECT count(*)::int FROM ingest.review_queue WHERE claim_a_id = ANY($2::int[]) AND status='open') AS revisiones_abiertas`,
      [link.map((l) => l.albumId), PLAN.map((p) => p.claimId)])).rows[0];
    if (counts.albumes !== PLAN.length || counts.con_portada !== 0 || counts.claims_vinculados !== PLAN.length || counts.revisiones_abiertas !== 0) {
      throw new Error(JSON.stringify(counts));
    }
    return { created, link, counts };
  }, { rollbackOnly: dryRun });

  await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, dryRun ? 'fichas-dry-run.json' : 'fichas-applied.json'),
    JSON.stringify({ dryRun, runId, ...result }, null, 2));
  console.log(JSON.stringify({ dryRun, runId, creado: result.created, counts: result.counts }, null, 2));
}

try {
  if (process.argv.includes('--verify')) {
    const { albums } = await verifyNotExists();
    console.log({ existentesPorClaim: albums, artistasNuevos: PLAN.filter((p) => p.artist.name).map((p) => p.artist.name) });
  } else if (process.argv.includes('--apply') || process.argv.includes('--dry-run')) await apply(!process.argv.includes('--apply'));
  else throw new Error('Usar --verify, --dry-run o --apply');
} finally { await closeDb(); }
