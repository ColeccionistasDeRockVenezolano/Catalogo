// CRV · Plan del primo, etapa 2 (2026-10-12): créditos en frase (punto 8).
//
// Relee las secciones de créditos de las descripciones del canal (Other
// Credits, Artwork, Illustration, Photography) y guarda cada línea entera en
// `ingest.credit_statements` con sus tramos enlazados al núcleo existente
// (`credit_statement_parts`): rol, persona, estudio, año, lugar, alcance. No
// reingiere nada ni toca `album_credits`.
//
// Enlaces: primero lo que el disco ya acredita (persona, organización,
// artista); si no, una coincidencia global única. Lo que no se puede ligar con
// seguridad queda como texto. Los lugares se crean una vez con sus variantes
// como alias; las dudosas entran ligadas y marcadas para revisión.
//
//   npx tsx scripts/primo-etapa2-frases.ts [--confirm] [--album=ID]
import { mkdirSync, writeFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { parseYouTubeDescription } from "../src/youtube/parsers.js";
import { buildPersonIndex, nameKey } from "../src/youtube/credit-sections.js";
import {
  parseCreditStatement, parseRoleColonStatement, parseVenueContinuation, type ParsedStatement, type StatementPart,
} from "../src/discography/credit-statements.js";
import { placeAliasKey, resolvePlace, type ResolvedPlace } from "../src/discography/places.js";

const confirm = process.argv.includes("--confirm");
const onlyAlbum = process.argv.find((arg) => arg.startsWith("--album="))?.slice("--album=".length);
const OUT = "reports/primo-etapa2";
const SECTIONS = new Set(["other_credits", "artwork", "illustration", "photography"]);
const pool = getPool();
mkdirSync(OUT, { recursive: true });

interface Line { albumId: number; videoId: number; sectionKind: string; lineNumber: number; statement: ParsedStatement }

/** Líneas de crédito de una descripción, en orden, con la forma que tengan. */
function statementLines(description: string): Array<{ sectionKind: string; text: string; statement: ParsedStatement }> {
  const out: Array<{ sectionKind: string; text: string; statement: ParsedStatement }> = [];
  for (const section of parseYouTubeDescription(description).sections) {
    if (!SECTIONS.has(section.kind)) continue;
    const lines = section.content.split("\n").map((line) => line.trim()).filter(Boolean);
    // «Artwork: Samarith Liz» llega como encabezado + contenido: se recompone.
    if (section.kind !== "other_credits" && lines[0] && description.includes(`${section.heading}: ${lines[0]}`)) {
      lines[0] = `${section.heading}: ${lines[0]}`;
    }
    let previous = "";
    for (const text of lines) {
      if (/^(?:#\S+\s*)+$|^https?:\/\/\S+$/iu.test(text)) continue;
      const statement = parseCreditStatement(text) ?? parseRoleColonStatement(text)
        ?? (/(?:&|,)\s*$/u.test(previous) ? parseVenueContinuation(text) : null)
        ?? { text: text.replace(/\s+/gu, " "), trackNumbers: [], parts: [] };
      out.push({ sectionKind: section.kind, text, statement });
      previous = text;
    }
  }
  return out;
}

interface Catalog {
  person: ReturnType<typeof buildPersonIndex>;
  organization: Map<string, Set<number>>;
  artist: Map<string, Set<number>>;
  albumTargets: Map<number, { person: Map<string, number>; organization: Map<string, number>; artist: Map<string, number> }>;
}

function addKey(map: Map<string, Set<number>>, name: string, id: number): void {
  const key = nameKey(name);
  if (!key) return;
  const set = map.get(key) ?? new Set<number>();
  set.add(id);
  map.set(key, set);
}

async function readCatalog(client: PoolClient, albumIds: number[]): Promise<Catalog> {
  const persons = await client.query<{ id: string; names: string[] }>(`
    SELECT p.id::text, array_remove(array_agg(DISTINCT x.alias) || ARRAY[p.name], NULL) AS names
      FROM public.persons p LEFT JOIN ingest.person_aliases x ON x.person_id = p.id GROUP BY p.id`);
  const organizations = await client.query<{ id: string; names: string[] }>(`
    SELECT o.id::text, array_remove(array_agg(DISTINCT x.alias) || ARRAY[o.name], NULL) AS names
      FROM public.organizations o LEFT JOIN ingest.organization_aliases x ON x.organization_id = o.id GROUP BY o.id`);
  const artists = await client.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists");
  const organization = new Map<string, Set<number>>();
  for (const row of organizations.rows) for (const name of row.names) addKey(organization, name, Number(row.id));
  const artist = new Map<string, Set<number>>();
  for (const row of artists.rows) addKey(artist, row.name, Number(row.id));
  const person = buildPersonIndex(persons.rows.map((row) => ({ id: Number(row.id), names: row.names })));
  const personNames = new Map(persons.rows.map((row) => [Number(row.id), row.names]));
  const organizationNames = new Map(organizations.rows.map((row) => [Number(row.id), row.names]));

  const credited = await client.query<{ album_id: string; person_id: string | null; organization_id: string | null; artist_id: string | null }>(`
    SELECT ac.album_id::text, ac.person_id::text, ac.organization_id::text, ac.artist_id::text FROM public.album_credits ac WHERE ac.album_id = ANY($1::bigint[])
    UNION SELECT t.album_id::text, tc.person_id::text, tc.organization_id::text, tc.artist_id::text
      FROM public.track_credits tc JOIN public.tracks t ON t.id = tc.track_id WHERE t.album_id = ANY($1::bigint[])
    UNION SELECT a.id::text, NULL, a.label_id::text, a.artist_id::text FROM public.albums a WHERE a.id = ANY($1::bigint[])`, [albumIds]);
  const albumTargets: Catalog["albumTargets"] = new Map();
  const artistNames = new Map(artists.rows.map((row) => [Number(row.id), row.name]));
  for (const row of credited.rows) {
    const albumId = Number(row.album_id);
    const targets = albumTargets.get(albumId) ?? { person: new Map(), organization: new Map(), artist: new Map() };
    albumTargets.set(albumId, targets);
    if (row.person_id) for (const name of personNames.get(Number(row.person_id)) ?? []) targets.person.set(nameKey(name), Number(row.person_id));
    if (row.organization_id) for (const name of organizationNames.get(Number(row.organization_id)) ?? []) targets.organization.set(nameKey(name), Number(row.organization_id));
    if (row.artist_id && artistNames.has(Number(row.artist_id))) targets.artist.set(nameKey(artistNames.get(Number(row.artist_id))!), Number(row.artist_id));
  }
  return { person, organization, artist, albumTargets };
}

type Link = { kind: "person" | "organization" | "artist"; id: number; how: string } | null;

const unique = (set: Set<number> | undefined): number | null => (set?.size === 1 ? [...set][0]! : null);

/** Persona, estudio o artista de un tramo: el disco primero, luego coincidencia global única. */
function linkName(part: StatementPart, albumId: number, catalog: Catalog): Link {
  const key = nameKey(part.text);
  if (!key) return null;
  const local = catalog.albumTargets.get(albumId);
  const order: Array<"person" | "organization" | "artist"> = part.type === "organization" ? ["organization", "artist", "person"] : ["person", "artist", "organization"];
  for (const kind of order) {
    const id = local?.[kind].get(key);
    if (id) return { kind, id, how: "disco" };
  }
  for (const kind of order) {
    const id = unique(kind === "person" ? catalog.person.byKey.get(key) : catalog[kind].get(key));
    if (id) return { kind, id, how: "global" };
  }
  return null;
}

/**
 * «Borrachos y Bolingas Records» se parte en «Borrachos» y «Bolingas Records»
 * al separar nombres por «y». Si la unión es un nombre del catálogo, vuelve a
 * ser un solo tramo.
 */
function joinKnownNames(line: Line, catalog: Catalog): void {
  const chars = Array.from(line.statement.text);
  const known = (name: string) => {
    const key = nameKey(name);
    return catalog.organization.has(key) || catalog.artist.has(key) || catalog.person.byKey.has(key);
  };
  const parts = line.statement.parts;
  for (let index = 0; index + 1 < parts.length; index++) {
    const [a, b] = [parts[index]!, parts[index + 1]!];
    if (!["person", "organization"].includes(a.type) || !["person", "organization"].includes(b.type)) continue;
    if (!/^\s+(?:y|&|and)\s+$/iu.test(chars.slice(a.end, b.start).join(""))) continue;
    const joined = chars.slice(a.start, b.end).join("");
    if (!known(joined)) continue;
    const type = catalog.organization.has(nameKey(joined)) ? "organization" : "person";
    parts.splice(index, 2, { start: a.start, end: b.end, type, text: joined });
  }
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    const videos = await client.query<{ album_id: string; video_id: string; description: string | null }>(`
      SELECT DISTINCT ON (va.album_id) va.album_id::text, v.id::text AS video_id,
             coalesce(v.metadata->'snippet'->>'description', v.description) AS description
        FROM media.video_albums va JOIN media.youtube_videos v ON v.id = va.video_id
       WHERE EXISTS (SELECT 1 FROM media.youtube_description_sections s WHERE s.video_id = v.id AND s.section_kind = ANY($1::text[]))
         AND ($2::bigint IS NULL OR va.album_id = $2::bigint)
       ORDER BY va.album_id, va.is_primary_link DESC, va.video_id`, [[...SECTIONS], onlyAlbum ? Number(onlyAlbum) : null]);
    const lines: Line[] = [];
    for (const row of videos.rows) {
      let lineNumber = 0;
      for (const item of statementLines(row.description ?? "")) {
        lines.push({ albumId: Number(row.album_id), videoId: Number(row.video_id), sectionKind: item.sectionKind, lineNumber: ++lineNumber, statement: item.statement });
      }
    }
    const catalog = await readCatalog(client, [...new Set(lines.map((line) => line.albumId))]);
    for (const line of lines) joinKnownNames(line, catalog);

    // Lugares: uno por nombre canónico; cada escritura de la fuente es un alias.
    const placeRaw = new Map<string, ResolvedPlace>();
    for (const line of lines) for (const part of line.statement.parts) {
      if (part.type !== "place" || placeRaw.has(part.text)) continue;
      const resolved = resolvePlace(part.text);
      if (resolved) placeRaw.set(part.text, resolved);
    }
    const stats = { videos: videos.rowCount, lines: lines.length, withParts: lines.filter((line) => line.statement.parts.length).length,
      parts: 0, linked: { person: 0, organization: 0, artist: 0, place: 0 }, linkedHow: { disco: 0, global: 0 }, unlinked: 0 };
    const unlinked = new Map<string, number>();
    const linkPlan = lines.map((line) => line.statement.parts.map((part) => {
      stats.parts++;
      if (part.type === "person" || part.type === "organization") {
        const link = linkName(part, line.albumId, catalog);
        if (link) { stats.linked[link.kind]++; stats.linkedHow[link.how as "disco" | "global"]++; }
        else { stats.unlinked++; unlinked.set(`${part.type}: ${part.text}`, (unlinked.get(`${part.type}: ${part.text}`) ?? 0) + 1); }
        return link;
      }
      if (part.type === "place" && placeRaw.has(part.text)) stats.linked.place++;
      return null;
    }));
    const places = new Map<string, ResolvedPlace>();
    for (const resolved of placeRaw.values()) places.set(resolved.name, resolved);
    const doubts = [...placeRaw.entries()].filter(([, resolved]) => resolved.doubt);

    const report = [`# Créditos en frase — ${confirm ? "aplicado" : "ensayo"}`, "",
      `- Videos con créditos: ${stats.videos}; líneas: ${stats.lines} (con tramos: ${stats.withParts}); tramos: ${stats.parts}.`,
      `- Enlazados: ${stats.linked.person} personas, ${stats.linked.organization} organizaciones, ${stats.linked.artist} artistas (${stats.linkedHow.disco} por el disco, ${stats.linkedHow.global} por coincidencia única), ${stats.linked.place} lugares.`,
      `- Nombres sin enlace: ${stats.unlinked} (${unlinked.size} distintos).`,
      `- Lugares: ${places.size} canónicos a partir de ${placeRaw.size} escrituras; ${doubts.length} variantes dudosas a revisión.`, "",
      "## Variantes dudosas (ligadas, en revisión)", "", ...doubts.map(([raw, resolved]) => `- «${raw}» → ${resolved.name}: ${resolved.doubt}`), "",
      "## Lugares", "", ...[...places.values()].sort((a, b) => a.name.localeCompare(b.name)).map((place) => `- ${place.name} (${place.placeType})`), "",
      "## Nombres sin enlace (más frecuentes)", "", ...[...unlinked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([name, count]) => `- ${name} ×${count}`)];
    writeFileSync(`${OUT}/frases-${confirm ? "aplicado" : "ensayo"}${onlyAlbum ? `-${onlyAlbum}` : ""}.md`, report.join("\n") + "\n");
    console.log(report.slice(0, 7).join("\n"));
    if (!confirm) return;

    const { runId, result } = await withOperatorRun({ name: "primo-etapa2:frases", operator: "claude-code",
      note: "Plan del primo, etapa 2 (2026-10-12): créditos en frase del canal con tramos enlazados y lugares (punto 8)" }, async (context) => {
      const db = context.client;
      const placeId = new Map<string, number>();
      const ensurePlace = async (name: string, values: { placeType: string; city: string | null; region: string | null; country: string | null; parentId: number | null }): Promise<number> => {
        const cached = placeId.get(name.toLowerCase());
        if (cached) return cached;
        const found = await db.query<{ id: string }>("SELECT id::text FROM ingest.places WHERE lower(name) = lower($1)", [name]);
        const id = Number(found.rows[0]?.id ?? (await db.query<{ id: string }>(`
          INSERT INTO ingest.places(name, place_type, city, region, country, parent_id, run_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
        [name, values.placeType, values.city, values.region, values.country, values.parentId, context.runId])).rows[0]!.id);
        placeId.set(name.toLowerCase(), id);
        return id;
      };
      const rawPlace = new Map<string, number>();
      for (const [raw, resolved] of placeRaw) {
        let parentId: number | null = null;
        if (resolved.placeType !== "country" && resolved.country) {
          parentId = await ensurePlace(resolved.country, { placeType: "country", city: null, region: null, country: resolved.country, parentId: null });
        }
        const id = resolved.placeType === "country" ? await ensurePlace(resolved.name, { placeType: "country", city: null, region: null, country: resolved.country, parentId: null })
          : await ensurePlace(resolved.name, { placeType: resolved.placeType, city: resolved.city, region: resolved.region, country: resolved.country, parentId });
        rawPlace.set(raw, id);
        await db.query(`
          INSERT INTO ingest.place_aliases(place_id, alias, alias_key, needs_review, notes, run_id) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (alias_key) DO NOTHING`, [id, raw, placeAliasKey(raw), resolved.doubt !== null, resolved.doubt, context.runId]);
      }
      let statements = 0; let parts = 0; let studios = 0;
      for (const [index, line] of lines.entries()) {
        const inserted = await db.query<{ id: string }>(`
          INSERT INTO ingest.credit_statements(album_id, video_id, section_kind, line_number, text, track_numbers, run_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id::text`,
        [line.albumId, line.videoId, line.sectionKind, line.lineNumber, line.statement.text, line.statement.trackNumbers, context.runId]);
        if (!inserted.rows[0]) continue;
        statements++;
        const statementId = Number(inserted.rows[0].id);
        const links = linkPlan[index]!;
        let place: number | null = null;
        const organizations: number[] = [];
        for (const [partIndex, part] of line.statement.parts.entries()) {
          const link = links[partIndex] ?? null;
          const type = link?.kind === "artist" ? "artist" : link ? link.kind : part.type;
          const placeRef = part.type === "place" ? rawPlace.get(part.text) ?? null : null;
          if (placeRef) place = placeRef;
          if (link?.kind === "organization") organizations.push(link.id);
          await db.query(`
            INSERT INTO ingest.credit_statement_parts(statement_id, start_offset, end_offset, part_type, role_key, person_id, artist_id, organization_id, place_id, year)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [statementId, part.start, part.end, type, part.roleKey ?? null,
            link?.kind === "person" ? link.id : null, link?.kind === "artist" ? link.id : null, link?.kind === "organization" ? link.id : null,
            placeRef, part.type === "year" ? Number(part.text) : null]);
          parts++;
        }
        // Un estudio ligado y un lugar en la misma frase: el estudio está ahí.
        if (place) for (const organizationId of organizations) {
          const result = await db.query(`
            INSERT INTO ingest.organization_places(organization_id, place_id, source, run_id) VALUES ($1, $2, 'youtube_description', $3)
            ON CONFLICT (organization_id, place_id) DO NOTHING`, [organizationId, place, context.runId]);
          studios += result.rowCount ?? 0;
        }
      }
      return { statements, parts, places: placeId.size, studios };
    });
    console.log(`run ${runId}:`, result);
  } finally {
    client.release();
  }
}

await run();
await closeDb();
