// CRV · Plan del primo, etapa 1 (2026-10-12), punto 6: cada solista ligado a su persona.
//
// Barrido de los solistas (`artist_type = 'solo_artist'`) sin titular con las
// reglas duras del caso Ashwave (docs/curation/IDENTIDAD_PERSONA_PROYECTO.md):
//
//  1. Un homónimo (nombre o alias igual, sin mayúsculas ni tildes) con créditos
//     en los discos del solista → titular (`link_project`).
//  2. Un homónimo sin ningún crédito ni membresía (ficha suelta) y nombre con
//     forma de persona → titular.
//  3. Sin homónimo, nombre con forma de persona y sin integrantes → se crea la
//     persona titular (`create_titular`).
//  Todo lo demás queda con su motivo explícito en el informe. Solo se toca un
//  solista si su nombre parece de persona; no se usa Laya.
//
// Además clasifica los solistas sin discos propios (decisión del plan: si es
// solo un músico, la ficha de artista se retira y queda la persona).
//
//   uso: tsx scripts/primo-etapa1-solistas.ts   → reports/primo-etapa1/solistas-*.json
//        (aplicar el plan con `crv review persons --plan=… --note=… --confirm`)
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { loadCatalogSnapshot } from "../src/curation/snapshot.js";
import { buildContext } from "../src/curation/analyze.js";
import { isPersonShaped } from "../src/curation/lexicon.js";
import { classifyPersonName } from "../src/review/person-junk.js";
import { displayKey } from "../src/normalization/public-names.js";

const pool = getPool();
const snapshotClient = await pool.connect();
const context = buildContext(await loadCatalogSnapshot(snapshotClient).finally(() => snapshotClient.release()));

const soloists = (await pool.query<{ id: string; name: string; members: string; albums: string; biography: string | null }>(
  `SELECT a.id::text, a.name, a.biography,
          (SELECT count(*) FROM public.artist_members m WHERE m.artist_id = a.id)::text AS members,
          (SELECT count(*) FROM public.albums al WHERE al.artist_id = a.id)::text AS albums
     FROM public.artists a
    WHERE a.artist_type = 'solo_artist'
      AND NOT EXISTS (SELECT 1 FROM public.artist_members m WHERE m.artist_id = a.id AND m.role = 'Titular del proyecto')
    ORDER BY a.id`)).rows.map((row) => ({ id: Number(row.id), name: row.name, members: Number(row.members), albums: Number(row.albums), biography: row.biography }));

// La biografía (escrita desde las fuentes del artista) da a veces el nombre real:
// «… cuyo nombre real es Pedro Luis Marquina». Con él se crea la persona titular.
const REAL_NAME = /nombre (?:real|verdadero|de pila) es ([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?: (?:de |del |la )?[A-ZÁÉÍÓÚÑ][\p{L}'-]+){1,4})/u;

// Personas por clave de nombre y de alias.
const keyToPersons = new Map<string, Set<number>>();
const personName = new Map<number, string>();
const add = (key: string, id: number) => { const set = keyToPersons.get(key) ?? new Set<number>(); set.add(id); keyToPersons.set(key, set); };
for (const row of (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons")).rows) {
  personName.set(Number(row.id), row.name);
  add(displayKey(row.name), Number(row.id));
}
for (const row of (await pool.query<{ person_id: string; alias: string }>(
  "SELECT person_id::text, alias FROM ingest.person_aliases WHERE alias_type::text <> 'source_variant'")).rows) add(displayKey(row.alias), Number(row.person_id));

// Créditos de cada persona en los discos de cada artista, y su actividad total.
const creditedOn = new Map<number, Map<number, string[]>>(); // artista → persona → roles
for (const row of (await pool.query<{ artist_id: string; person_id: string; role: string }>(
  `SELECT al.artist_id::text, ac.person_id::text, ac.role FROM public.album_credits ac JOIN public.albums al ON al.id = ac.album_id WHERE ac.person_id IS NOT NULL
   UNION ALL
   SELECT al.artist_id::text, tc.person_id::text, tc.role FROM public.track_credits tc JOIN public.tracks t ON t.id = tc.track_id JOIN public.albums al ON al.id = t.album_id WHERE tc.person_id IS NOT NULL`)).rows) {
  const byPerson = creditedOn.get(Number(row.artist_id)) ?? new Map<number, string[]>();
  const roles = byPerson.get(Number(row.person_id)) ?? [];
  roles.push(row.role);
  byPerson.set(Number(row.person_id), roles);
  creditedOn.set(Number(row.artist_id), byPerson);
}
const activity = new Map<number, number>();
for (const row of (await pool.query<{ person_id: string; n: string }>(
  `SELECT person_id::text, count(*)::text AS n FROM (
     SELECT person_id FROM public.album_credits WHERE person_id IS NOT NULL
     UNION ALL SELECT person_id FROM public.track_credits WHERE person_id IS NOT NULL
     UNION ALL SELECT person_id FROM public.artist_members) x GROUP BY person_id`)).rows) activity.set(Number(row.person_id), Number(row.n));

type Correction = Record<string, unknown>;
const corrections: Correction[] = [];
const pending: Array<{ artistId: number; artist: string; reason: string; candidates?: Array<{ id: number; name: string; credits: number }> }> = [];
const WHY = "Plan del primo, etapa 1 (punto 6): solista sin titular, reglas del caso Ashwave";

// Títulos y prefijos de nombre artístico: «Lord Brynner», «King Stephen», «Lil …».
const STAGE_PREFIXES = new Set(["lord", "king", "queen", "lady", "mighty", "dj", "mc", "sir", "baby", "lil", "kid", "mr", "mrs", "miss", "doctor", "dr", "el", "la", "los", "las", "don", "young", "big", "saint", "san", "santa"]);
const personLike = (name: string) => name.trim() === name.trim().replace(/^\p{Ll}/u, "") // empieza en mayúscula
  && !STAGE_PREFIXES.has(displayKey(name).split(" ")[0]!)
  && isPersonShaped(context.lexicon, name) && classifyPersonName(name).kind === "ok";

for (const artist of soloists) {
  const shaped = personLike(artist.name);
  const homonyms = [...(keyToPersons.get(displayKey(artist.name)) ?? [])];
  const credited = creditedOn.get(artist.id) ?? new Map<number, string[]>();
  if (artist.members > 0) {
    pending.push({ artistId: artist.id, artist: artist.name, reason: `tiene ${artist.members} integrante(s) sin rol de titular: revisar a mano` });
    continue;
  }
  if (homonyms.length > 0) {
    const withCredits = homonyms.filter((id) => credited.has(id));
    if (withCredits.length === 1) {
      const id = withCredits[0]!;
      corrections.push({ op: "link_project", person: { id, name: personName.get(id)! }, artist: { id: artist.id, name: artist.name }, why: `${WHY}: homónimo acreditado en sus discos (${[...new Set(credited.get(id))].slice(0, 3).join(", ")})` });
      continue;
    }
    if (withCredits.length > 1) {
      pending.push({ artistId: artist.id, artist: artist.name, reason: "varios homónimos acreditados en sus discos", candidates: withCredits.map((id) => ({ id, name: personName.get(id)!, credits: activity.get(id) ?? 0 })) });
      continue;
    }
    const bare = homonyms.filter((id) => !activity.has(id));
    if (homonyms.length === 1 && bare.length === 1 && shaped) {
      const id = bare[0]!;
      corrections.push({ op: "link_project", person: { id, name: personName.get(id)! }, artist: { id: artist.id, name: artist.name }, why: `${WHY}: homónimo sin otra trayectoria y nombre con forma de persona` });
      continue;
    }
    pending.push({ artistId: artist.id, artist: artist.name,
      reason: homonyms.length === 1 ? "homónimo con trayectoria en otros artistas y sin créditos en sus discos: puede ser otra persona" : "varios homónimos sin créditos en sus discos",
      candidates: homonyms.map((id) => ({ id, name: personName.get(id)!, credits: activity.get(id) ?? 0 })) });
    continue;
  }
  const realName = artist.biography ? REAL_NAME.exec(artist.biography)?.[1] : undefined;
  const realNameTaken = realName ? [...(keyToPersons.get(displayKey(realName)) ?? [])].filter((id) => !credited.has(id)) : [];
  if (!shaped && realName && realNameTaken.length) {
    pending.push({ artistId: artist.id, artist: artist.name, reason: `la biografía da el nombre real «${realName}», pero ese nombre es de otra ficha sin proyecto común: revisar a mano`,
      candidates: realNameTaken.map((id) => ({ id, name: personName.get(id)!, credits: activity.get(id) ?? 0 })) });
    continue;
  }
  if (!shaped && realName && classifyPersonName(realName).kind === "ok") {
    corrections.push({ op: "create_titular", name: realName, artist: { id: artist.id, name: artist.name }, why: `${WHY}: la biografía da su nombre real («${realName}»)` });
    continue;
  }
  if (!shaped) {
    pending.push({ artistId: artist.id, artist: artist.name, reason: "nombre artístico o no reconocido como nombre de persona (léxico de nombres y apellidos del catálogo) y sin persona homónima: falta identificar a la persona detrás",
      candidates: [...credited.keys()].slice(0, 5).map((id) => ({ id, name: personName.get(id)!, credits: credited.get(id)!.length })) });
    continue;
  }
  corrections.push({ op: "create_titular", name: artist.name, artist: { id: artist.id, name: artist.name }, why: `${WHY}: nombre con forma de persona y sin ficha de persona` });
}

// Solistas sin discos propios.
const withoutAlbums = (await pool.query<{ id: string; name: string; titular: string | null; titular_name: string | null; bio: number | null; credits: string }>(
  `SELECT a.id::text, a.name, m.person_id::text AS titular, p.name AS titular_name, length(a.biography) AS bio,
          ((SELECT count(*) FROM public.album_credits c WHERE c.artist_id = a.id) + (SELECT count(*) FROM public.track_credits c WHERE c.artist_id = a.id))::text AS credits
     FROM public.artists a
     LEFT JOIN public.artist_members m ON m.artist_id = a.id AND m.role = 'Titular del proyecto'
     LEFT JOIN public.persons p ON p.id = m.person_id
    WHERE a.artist_type = 'solo_artist' AND NOT EXISTS (SELECT 1 FROM public.albums al WHERE al.artist_id = a.id)
    ORDER BY a.id`)).rows;

const soloStats = { soloists: soloists.length, corrections: corrections.length, linkProject: corrections.filter((c) => c["op"] === "link_project").length, createTitular: corrections.filter((c) => c["op"] === "create_titular").length, pending: pending.length };
console.log(soloStats);
const reasons = new Map<string, number>();
for (const item of pending) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
console.log(Object.fromEntries(reasons));
writeFileSync("reports/primo-etapa1/solistas-plan.json", JSON.stringify({ decidedAt: "2026-10-12", evidence: WHY, corrections }, null, 2));
writeFileSync("reports/primo-etapa1/solistas-pendientes.json", JSON.stringify({ stats: soloStats, pending, withoutAlbums }, null, 2));
await closeDb();
