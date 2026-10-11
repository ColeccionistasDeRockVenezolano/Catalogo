// CRV · Veto temporal a la fusión de personas (Brian, 2026-10-06, caso Víctor
// Valerio). Dos fichas cuyas trayectorias son imposibles juntas —un crédito
// antes del nacimiento o después de la muerte de la otra, o carreras separadas
// por ≥20 años sin proyecto ni colegas en común— no se fusionan sin que una
// persona lo confirme (`allowEraConflict`). La regla «apellido poco común» de
// Fichas repetidas (run 13285) volvió a juntar al Valerio de Niuno Niotro con
// el ingeniero de Los Melódicos que la ER ya había separado; con este veto en
// `mergeInto`, ninguna fusión automática puede hacerlo.
import type { PoolClient } from "pg";
import { OperatorError } from "./operator.js";
import { mergeEraConflict, VARIOUS_ARTISTS_ID, type PersonTimeline, type TimelineEvent } from "../curation/person-timeline.js";

type Queryable = Pick<PoolClient, "query">;

export interface LoadedTimeline {
  timeline: PersonTimeline;
  artists: Set<number>;
  albums: Set<number>;
  colleagues: Set<number>;
}

export async function loadPersonTimelines(queryable: Queryable, ids: number[], options: { colleagues?: boolean } = {}): Promise<Map<number, LoadedTimeline>> {
  const out = new Map<number, LoadedTimeline>();
  const { rows: persons } = await queryable.query<{ id: string; birth: number | null; death: number | null }>(`
    SELECT id::text, CASE WHEN birth_date_value ~ '^[0-9]{4}(-[0-9]{2}){0,2}$' THEN left(birth_date_value,4)::int END AS birth, CASE WHEN death_date_value ~ '^[0-9]{4}(-[0-9]{2}){0,2}$' THEN left(death_date_value,4)::int END AS death
      FROM public.persons WHERE id = ANY($1::bigint[])`, [ids]);
  for (const row of persons) {
    out.set(Number(row.id), {
      timeline: { personId: Number(row.id), birthYear: row.birth, deathYear: row.death, events: [], ownArtists: new Set() },
      artists: new Set(), albums: new Set(), colleagues: new Set(),
    });
  }
  const { rows: events } = await queryable.query<{
    person_id: string; source: TimelineEvent["source"]; ref_id: string; year: number | null; credit_type: string;
    role: string; artist_id: string; album_id: string | null; album_type: string | null;
  }>(`
    SELECT c.person_id::text, 'album' AS source, c.id::text AS ref_id, al.release_year::int AS year, c.credit_type::text,
           c.role, al.artist_id::text, al.id::text AS album_id, al.album_type::text
      FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE c.person_id = ANY($1::bigint[])
    UNION ALL
    SELECT c.person_id::text, 'track', c.id::text, al.release_year::int, c.credit_type::text, c.role, al.artist_id::text, al.id::text, al.album_type::text
      FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id
     WHERE c.person_id = ANY($1::bigint[])
    UNION ALL
    SELECT m.person_id::text, 'member', m.id::text, y.year::int, 'member', m.role, m.artist_id::text, NULL, NULL
      FROM public.artist_members m CROSS JOIN LATERAL (VALUES (m.from_year), (m.to_year)) y(year)
     WHERE m.person_id = ANY($1::bigint[])`, [ids]);
  for (const row of events) {
    const loaded = out.get(Number(row.person_id));
    if (!loaded) continue;
    const artistId = Number(row.artist_id);
    // Various Artists no es un proyecto común; un recopilatorio sí lo es si es el mismo disco.
    if (artistId !== VARIOUS_ARTISTS_ID) loaded.artists.add(artistId);
    if (row.album_id !== null) loaded.albums.add(Number(row.album_id));
    if (row.source === "member") (loaded.timeline.ownArtists as Set<number>).add(artistId);
    if (row.year === null) continue;
    loaded.timeline.events.push({
      year: row.year, source: row.source, refId: Number(row.ref_id), creditType: row.credit_type, role: row.role,
      artistId, albumId: row.album_id === null ? null : Number(row.album_id), albumType: row.album_type,
    });
  }
  if (options.colleagues === false) return out;
  const { rows: colleagues } = await queryable.query<{ person_id: string; other: string }>(`
    WITH mine AS (
      SELECT c.person_id, c.album_id FROM public.album_credits c WHERE c.person_id = ANY($1::bigint[])
      UNION SELECT c.person_id, t.album_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE c.person_id = ANY($1::bigint[])
    )
    SELECT DISTINCT mine.person_id::text, o.person_id::text AS other FROM mine
      JOIN (SELECT album_id, person_id FROM public.album_credits WHERE person_id IS NOT NULL
            UNION SELECT t.album_id, c.person_id FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE c.person_id IS NOT NULL) o
        ON o.album_id = mine.album_id AND o.person_id <> mine.person_id
     WHERE mine.album_id NOT IN (SELECT id FROM public.albums WHERE artist_id = $2)`, [ids, VARIOUS_ARTISTS_ID]);
  for (const row of colleagues) out.get(Number(row.person_id))?.colleagues.add(Number(row.other));
  return out;
}

/** Motivo por el que fusionar estas dos personas exige confirmación humana, o null. */
export async function eraConflictBetween(queryable: Queryable, keepId: number, dropId: number): Promise<string | null> {
  const loaded = await loadPersonTimelines(queryable, [keepId, dropId]);
  const keep = loaded.get(keepId); const drop = loaded.get(dropId);
  if (!keep || !drop) return null;
  const shared = <T>(a: Set<T>, b: Set<T>) => [...a].filter((item) => b.has(item)).length;
  keep.colleagues.delete(dropId); drop.colleagues.delete(keepId);
  return mergeEraConflict(keep.timeline, drop.timeline, {
    sharedArtists: shared(keep.artists, drop.artists),
    sharedAlbums: shared(keep.albums, drop.albums),
    sharedColleagues: shared(keep.colleagues, drop.colleagues),
  });
}

/** La fusión crearía una trayectoria imposible: la API lo traduce a 409. */
export class EraConflictError extends OperatorError {
  constructor(keepId: number, dropId: number, readonly reason: string) {
    super("needs_review", `No se fusionan ${keepId} y ${dropId} sin confirmación: ${reason}.`, { keepId, dropId, eraConflict: reason });
  }
}

/** Lanza `EraConflictError` si la fusión de dos personas choca por épocas. */
export async function assertEraCompatible(queryable: Queryable, keepId: number, dropId: number): Promise<void> {
  const reason = await eraConflictBetween(queryable, keepId, dropId);
  if (reason !== null) throw new EraConflictError(keepId, dropId, reason);
}
