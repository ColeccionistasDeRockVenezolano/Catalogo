import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { inventoryResearchUrls, loadSourceInventory } from "../src/verification/source-inventory.js";
import type { VerificationSnapshot } from "../src/verification/types.js";

interface ArtistRow {
  id: string; name: string; artist_type: string; biography: string | null;
  origin_country: string; formed_year: number | null; status: string | null;
  members: number; undated_members: number; albums: number; undated_albums: number;
  empty_tracklists: number; aliases: string[]; source_urls: string[];
}
const output = resolve(process.argv[2] ?? "reports/official-enrichment-2026-10-13");
const normalize = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();
const db = await getPool().connect();
try {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const capturedAt = new Date().toISOString();
  const artists = (await db.query<ArtistRow>(`
    WITH memberships AS (
      SELECT artist_id,count(*)::int members,count(*) FILTER(WHERE from_year IS NULL)::int undated_members
      FROM public.artist_members GROUP BY artist_id
    ), releases AS (
      SELECT al.artist_id,count(*)::int albums,count(*) FILTER(WHERE al.release_year IS NULL)::int undated_albums,
        count(*) FILTER(WHERE t.album_id IS NULL)::int empty_tracklists
      FROM public.albums al LEFT JOIN (SELECT DISTINCT album_id FROM public.tracks) t ON t.album_id=al.id GROUP BY al.artist_id
    ), aliases AS (
      SELECT artist_id,array_agg(alias ORDER BY id) aliases FROM ingest.artist_aliases GROUP BY artist_id
    ), links AS (
      SELECT artist_id,array_agg(DISTINCT raw_value #>> '{}' ORDER BY raw_value #>> '{}') source_urls
      FROM ingest.claims WHERE artist_id IS NOT NULL AND entity_kind='artist' AND status='accepted'
      AND field IN ('source_url','website_url','official_website') AND raw_value #>> '{}' LIKE 'http%'
      GROUP BY artist_id
    )
    SELECT a.id::text,a.name,a.artist_type,a.biography,a.origin_country,a.formed_year,a.status::text,
      coalesce(m.members,0) members,coalesce(m.undated_members,0) undated_members,
      coalesce(r.albums,0) albums,coalesce(r.undated_albums,0) undated_albums,coalesce(r.empty_tracklists,0) empty_tracklists,
      coalesce(x.aliases,ARRAY[]::text[]) aliases,coalesce(l.source_urls,ARRAY[]::text[]) source_urls
    FROM public.artists a LEFT JOIN memberships m ON m.artist_id=a.id LEFT JOIN releases r ON r.artist_id=a.id
      LEFT JOIN aliases x ON x.artist_id=a.id LEFT JOIN links l ON l.artist_id=a.id ORDER BY a.id
  `)).rows;
  const counts = (await db.query("SELECT (SELECT count(*)::int FROM public.persons) persons,(SELECT count(*)::int FROM public.albums) albums,(SELECT count(*)::int FROM public.tracks) tracks")).rows[0] as { persons: number; albums: number; tracks: number };
  const cache = (await db.query<{ url: string; captured_at: string | null; characters: number }>("SELECT url,captured_at::text,length(content)::int characters FROM ingest.person_web_page_cache")).rows;
  const inventory = loadSourceInventory();
  const known = new Set(inventory.projects.flatMap(project => [project.name, ...project.aliases].map(normalize)));
  const worklist = artists.map(artist => {
    const snapshot: VerificationSnapshot = { kind: "artist", id: Number(artist.id), name: artist.name, identity: [artist.name],
      identityProfile: { names: [artist.name], legalNames: [], relatedNames: [], repertoire: [], country: artist.origin_country },
      units: [], albums: [], catalogAlbums: [], sourceUrls: [] };
    const inventoryUrls = inventoryResearchUrls(snapshot);
    const gaps = [
      ...(!artist.biography?.trim() ? ["biography"] : []),
      ...(artist.formed_year === null ? ["formation_date"] : []),
      ...(artist.artist_type !== "solo_artist" && artist.members === 0 ? ["members"] : []),
      ...(artist.undated_members ? ["membership_periods"] : []),
      ...(!artist.albums ? ["discography"] : []),
      ...(artist.undated_albums ? ["release_dates"] : []),
      ...(artist.empty_tracklists ? ["tracklists"] : []),
      ...(!artist.status ? ["project_activity"] : []),
    ];
    return { artistId: Number(artist.id), name: artist.name, artistType: artist.artist_type,
      originCountry: artist.origin_country, aliases: artist.aliases, gaps,
      counts: { members: artist.members, undatedMembers: artist.undated_members, albums: artist.albums,
        undatedAlbums: artist.undated_albums, emptyTracklists: artist.empty_tracklists },
      inventoryUrls, existingSourceUrls: artist.source_urls,
      reusableCaptures: cache.filter(page => inventoryUrls.includes(page.url)).map(page => ({ url: page.url, capturedAt: page.captured_at, characters: page.characters })),
      priority: inventoryUrls.length ? "known_primary_candidate" : "discover_primary_sources",
    };
  });
  const summary = {
    capturedAt, artists: artists.length, ...counts, modelCalls: 0,
    artistsWithInventoryEntrypoints: worklist.filter(item => item.inventoryUrls.length).length,
    artistsMatchingInventoryName: artists.filter(artist => known.has(normalize(artist.name))).length,
    artistsRequiringSourceDiscovery: worklist.filter(item => !item.inventoryUrls.length).length,
    artistsWithExistingSourceUrls: worklist.filter(item => item.existingSourceUrls.length).length,
    gapCounts: Object.fromEntries(["biography", "formation_date", "members", "membership_periods", "discography", "release_dates", "tracklists", "project_activity"].map(gap => [gap, worklist.filter(item => item.gaps.includes(gap)).length])),
    interpretation: "Los vacíos describen el estado del catálogo, no hechos externos. Un período abierto no prueba actividad actual; falta de integrantes no demuestra que un proyecto sea solista.",
  };
  await db.query("COMMIT");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "audit.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(output, "worklist.json"), `${JSON.stringify(worklist, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, ...summary }, null, 2)}\n`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await closeDb();
}
