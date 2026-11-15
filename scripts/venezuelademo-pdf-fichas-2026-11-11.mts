/**
 * VenezuelaDemo (PDF) — géneros, integrantes y créditos del tema promocional.
 *
 * - Géneros: solo fichas sin principal confirmado (regla: una fuente basta).
 * - Integrantes: solo artistas sin membresías; persona exacta se reutiliza, homónimos a revisión.
 * - Créditos: crea la pista del tema promocional si el disco existe y la pista falta;
 *   enlaza personas que ya existen (no crea personas por un crédito).
 *
 * Uso: PATH="$PWD/node_modules/.bin:$PATH" ./scripts/with-node22.sh tsx \
 *        scripts/venezuelademo-pdf-fichas-2026-11-11.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { loadTaxonomy } from '../src/genres/store.js';
import { applySourceRow } from './genre-source-rows.js';
import { createEntity, createRelation, OperatorError, withOperatorRun } from '../src/merge/operator.js';

const TAG = 'venezuelademo-pdf-fichas-2026-11-11';
const APPLY = process.argv.includes('--apply');
const plan = JSON.parse(readFileSync('reports/venezuelademo-pdf-2026-11-11/fichas.json', 'utf8')) as {
  generos: Array<{ artist_id: number; nombre: string; raw: string[]; url: string }>;
  miembros: Array<{ artist_id: number; nombre: string; miembros: Array<{ nombre: string; rol: string }>; url: string }>;
  temas: Array<{ artist_id: number; nombre: string; titulo: string; disco: string | null; duracion: string | null; genero: string | null; creditos: Array<{ rol: string; valor: string }>; url: string }>;
};
console.log(`géneros ${plan.generos.length} · artistas con integrantes ${plan.miembros.length} (${plan.miembros.reduce((n, m) => n + m.miembros.length, 0)} personas) · temas ${plan.temas.length} (${plan.temas.reduce((n, t) => n + t.creditos.length, 0)} créditos)`);
if (!APPLY) { console.log('ensayo; usar --apply'); await closeDb(); process.exit(0); }

const fold = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
const CREDIT_TYPE: Array<[RegExp, string]> = [
  [/producci/iu, 'producer'], [/mezcla|mix/iu, 'mixing'], [/master/iu, 'mastering'],
  [/grabaci|ingenier/iu, 'recording'], [/letra|m[uú]sica|autor|composici/iu, 'composer'],
  [/arregl/iu, 'other'], [/m[uú]sico|instrument|guitarra|bajo|bater|piano|saxo|tromp|percus|voz|voces|cant/iu, 'musician'],
];

const pool = getPool();
const report: Record<string, unknown> = { at: new Date().toISOString() };

// ---------- 1. Géneros ----------
{
  const { runId, result } = await withOperatorRun({
    name: `${TAG}:generos`, operator: 'hermes (encargo de Brian 2026-11-11)',
    note: 'Géneros que nombra la reseña PDF de VenezuelaDemo; solo fichas sin principal confirmado.',
  }, async (context) => {
    const taxonomy = await loadTaxonomy(context.client);
    const count = { aceptados: 0, sinResolver: 0, yaTenían: 0, especifico: 0, errores: 0 };
    const detalle: unknown[] = [];
    for (const row of plan.generos) {
      const live = await context.client.query("SELECT 1 FROM ingest.artist_genres WHERE artist_id=$1 AND role='primary' AND status='confirmed' LIMIT 1", [row.artist_id]);
      if (live.rowCount) { count.yaTenían++; continue; }
      await context.client.query('SAVEPOINT genero');
      try {
        const out = await applySourceRow(context.client, taxonomy, {
          caseId: `vd-pdf-${row.artist_id}`, kind: 'artist', entityId: row.artist_id,
          source: 'venezuelademo', url: row.url, rawGenres: row.raw, order: 'orden de la reseña',
        }, context.runId, 'la reseña del propio artista lo nombra');
        if (out.kind === 'accepted') { count.aceptados++; detalle.push({ artist: row.nombre, primary: out.primary, secondaries: out.secondaries }); }
        else if (out.kind === 'unresolved') { count.sinResolver++; detalle.push({ artist: row.nombre, raw: out.raw, fragments: out.fragments }); }
        else count.especifico++;
        await context.client.query('RELEASE SAVEPOINT genero');
      } catch (error) {
        await context.client.query('ROLLBACK TO SAVEPOINT genero');
        count.errores++;
        detalle.push({ artist: row.nombre, error: (error as Error).message.slice(0, 200) });
      }
    }
    return { count, detalle };
  });
  report['generos'] = { runId, ...result };
  console.log('géneros', JSON.stringify(result.count));
}

// ---------- 2. Integrantes ----------
{
  const { runId, result } = await withOperatorRun({
    name: `${TAG}:integrantes`, operator: 'hermes (encargo de Brian 2026-11-11)',
    note: 'Integrantes que lista la reseña PDF de VenezuelaDemo, solo en artistas sin membresías.',
  }, async (context) => {
    const persons = (await context.client.query<{ id: string; name: string }>('SELECT id::text, name FROM public.persons')).rows;
    const index = new Map<string, number[]>();
    for (const p of persons) {
      const key = fold(p.name);
      const list = index.get(key) ?? [];
      list.push(Number(p.id));
      index.set(key, list);
    }
    const count = { artistas: 0, creadas: 0, reutilizadas: 0, homonimos: 0, yaEstaba: 0, errores: 0 };
    for (const block of plan.miembros) {
      const exists = await context.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=$1 LIMIT 1', [block.artist_id]);
      if (exists.rowCount) continue;
      await context.client.query('SAVEPOINT integrantes');
      try {
        for (const m of block.miembros) {
          if (fold(m.nombre) === fold(block.nombre)) continue;
          const hits = index.get(fold(m.nombre)) ?? [];
          if (hits.length > 1) { count.homonimos++; continue; }
          let personId = hits[0];
          if (!personId) {
            const created = await createEntity(context, 'person', {
              name: m.nombre, nationality: 'Venezuela',
              notes: `Integrante de ${block.nombre} según la reseña de VenezuelaDemo (MCI).`,
            }, { allowSimilar: true });
            personId = created.id;
            index.set(fold(m.nombre), [personId]);
            count.creadas++;
          } else count.reutilizadas++;
          const already = await context.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=$2', [block.artist_id, personId]);
          if (already.rowCount) { count.yaEstaba++; continue; }
          await createRelation(context, 'artist_membership', { artistId: block.artist_id, personId }, {
            role: (m.rol || 'Integrante').slice(0, 120), is_current: 'true',
            notes: `Integrante en la reseña de VenezuelaDemo: ${block.url}`,
          });
        }
        count.artistas++;
        await context.client.query('RELEASE SAVEPOINT integrantes');
      } catch (error) {
        await context.client.query('ROLLBACK TO SAVEPOINT integrantes');
        if (!(error instanceof OperatorError)) throw error;
        count.errores++;
      }
    }
    return count;
  });
  report['integrantes'] = { runId, ...result };
  console.log('integrantes', JSON.stringify(result));
}

// ---------- 3. Tema promocional y créditos ----------
{
  const { runId, result } = await withOperatorRun({
    name: `${TAG}:creditos`, operator: 'hermes (encargo de Brian 2026-11-11)',
    note: 'Tema promocional de la reseña PDF de VenezuelaDemo: pista y créditos documentados.',
  }, async (context) => {
    const count = { pistasCreadas: 0, pistasYaEstaban: 0, sinDisco: 0, creditos: 0, personasNoResueltas: 0, errores: 0 };
    for (const t of plan.temas) {
      const albums = (await context.client.query<{ id: string; title: string }>(
        'SELECT id::text, title FROM public.albums WHERE artist_id=$1', [t.artist_id])).rows;
      let album = t.disco ? albums.find(a => fold(a.title) === fold(t.disco!)) : undefined;
      if (!album && albums.length === 1) album = albums[0];
      if (!album) { count.sinDisco++; continue; }
      await context.client.query('SAVEPOINT tema');
      try {
        const albumId = Number(album.id);
        let trackId: number;
        const existing = (await context.client.query<{ id: string }>(
          "SELECT id::text FROM public.tracks WHERE album_id=$1 AND lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($2,'[^a-zA-Z0-9]','','g')) LIMIT 1",
          [albumId, t.titulo])).rows[0];
        if (existing) { trackId = Number(existing.id); count.pistasYaEstaban++; }
        else {
          const max = (await context.client.query<{ n: string | null }>('SELECT max(track_number)::text n FROM public.tracks WHERE album_id=$1', [albumId])).rows[0];
          const seconds = /^\d{1,2}:\d{2}$/u.test(t.duracion ?? '')
            ? Number(t.duracion!.split(':')[0]) * 60 + Number(t.duracion!.split(':')[1]) : undefined;
          const created = await createEntity(context, 'track', {
            title: t.titulo, track_number: max?.n ? Number(max.n) + 1 : 1, disc_number: 1,
            ...(seconds ? { duration_seconds: seconds } : {}),
            notes: `Tema promocional de la reseña de VenezuelaDemo${t.genero ? ` (${t.genero})` : ''}. ${t.url}`,
          }, { albumId, allowSimilar: true });
          trackId = created.id;
          count.pistasCreadas++;
        }
        for (const credit of t.creditos) {
          const type = CREDIT_TYPE.find(([re]) => re.test(credit.rol))?.[1] ?? 'other';
          const names = credit.valor.split(/\s*(?:,|;|\/|&|\by\b)\s*/u).map(n => n.trim()).filter(n => n.length > 3);
          for (const name of names) {
            const person = (await context.client.query<{ id: string }>(
              "SELECT id::text FROM public.persons WHERE lower(regexp_replace(name,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace($1,'[^a-zA-Z0-9]','','g')) LIMIT 2", [name])).rows;
            if (person.length !== 1) { count.personasNoResueltas++; continue; }
            try {
              await createRelation(context, 'track_credit', { trackId, personId: Number(person[0]!.id) }, {
                credit_type: type, credit_role: credit.rol.slice(0, 80),
                notes: `Crédito impreso en la reseña de VenezuelaDemo: ${t.url}`,
              });
              count.creditos++;
            } catch (error) {
              if (!(error instanceof OperatorError)) throw error;
            }
          }
        }
        await context.client.query('RELEASE SAVEPOINT tema');
      } catch (error) {
        await context.client.query('ROLLBACK TO SAVEPOINT tema');
        if (!(error instanceof OperatorError)) throw error;
        count.errores++;
      }
    }
    return count;
  });
  report['creditos'] = { runId, ...result };
  console.log('créditos', JSON.stringify(result));
}

writeFileSync('reports/venezuelademo-pdf-2026-11-11/run-fichas.json', JSON.stringify(report, null, 1));
await closeDb();
