// Auditoría de señales en títulos; no aplica clasificaciones ni modifica la BD.
// Uso: ./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/audit-album-title-metadata.ts --out reports/titulos-albumes-2026-10-15
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { B_SIDES_SQL, LIVE_SQL } from "../src/api/repositories/albums.js";
import { liveTitleVerdict } from "../src/normalization/live-title.js";

interface Album {
  id: number; artist: string | null; title: string; type: string; year: number | null; tracks: number;
  classes: Array<{ label: string; inferred: boolean }>;
  isBSides: boolean; isLive: boolean;
  versions: Array<{ title: string | null; details: string | null; source: string }>;
  series: Array<{ title: string; volume: string | null }>;
}
interface Rule {
  key: string; label: string; destination: string; pattern: RegExp;
  expectedType?: string; classification?: string;
}
const rules: Rule[] = [
  { key: "b_sides", label: "B-Side / B-Sides", destination: "clasificación complementaria B-Sides", pattern: /\bb[\s‐‑‒–—-]*sides?\b/iu, classification: "B-Sides" },
  { key: "lado_b", label: "Lado B / Cara B (ambiguo)", destination: "revisión; puede ser un título artístico o nombrar ambas caras", pattern: /\b(?:lado|cara)s?[ -]+b\b/iu },
  { key: "demo", label: "Demo / maqueta / ensayo", destination: "demo o atributo de una publicación; revisar recopilaciones y usos figurados", pattern: /\bdemos?\b|\bmaquetas?\b|\brehearsals?\b|\bensayos?\b/iu, expectedType: "demo" },
  { key: "ep", label: "EP explícito", destination: "ep; revisar títulos mixtos y colecciones de EP", pattern: /(?<![\p{L}\p{N}.])(?:ep|e\.p\.)(?![\p{L}\p{N}.])/iu, expectedType: "ep" },
  { key: "single", label: "Single / sencillo (singular)", destination: "single si describe la publicación", pattern: /\b(?:single|sencillo)\b/iu, expectedType: "single" },
  { key: "singles", label: "Singles / sencillos (plural)", destination: "revisión de recopilación; el plural no implica tipo single", pattern: /\b(?:singles|sencillos)\b/iu },
  { key: "compilation", label: "Compilado / grandes éxitos / best of", destination: "compilation; contrastar posibles títulos artísticos", pattern: /\b(?:compilations?|compilados?|compilacion|recopilatorios?|recopilacion|best of|greatest hits|(?:grandes|mejores) exitos|anthology)\b/iu, expectedType: "compilation" },
  { key: "collection", label: "Colección / antología (señal débil)", destination: "revisión de tipo o serie; no clasificar por esta palabra sola", pattern: /\b(?:coleccion|antologia)\b/iu },
  { key: "remix", label: "Remix / remixes", destination: "atributo Remix; conservar single o EP cuando corresponda", pattern: /\bremix(?:es|ed)?\b|\bremezclas?\b/iu, expectedType: "remix", classification: "Remix" },
  { key: "acoustic", label: "Acústico / unplugged / desenchufado", destination: "atributo acústico; por sí solo no demuestra grabación en vivo", pattern: /\bacustic[oa]s?\b|\bacoustic\b|\bunplugged\b|\bdesenchufad[oa]s?\b/iu },
  { key: "instrumental", label: "Instrumental / karaoke", destination: "atributo o versión instrumental; revisar usos descriptivos del título", pattern: /\binstrumental(?:es|s)?\b|\bkaraoke\b/iu },
  { key: "edition", label: "Deluxe / remaster / reedición / edición", destination: "ingest.album_versions; no cambiar el tipo de publicación", pattern: /\bdeluxe\b|\bremaster\w*\b|\breissue\b|\breedicion\b|\bexpanded\b|\b(?:edition|edicion)\b/iu },
  { key: "anniversary", label: "Aniversario / anniversary", destination: "revisión; puede nombrar un disco nuevo, no necesariamente una reedición", pattern: /\b(?:anniversary|aniversari[oa])\b/iu },
  { key: "bonus", label: "Bonus", destination: "pista o contenido adicional de una versión", pattern: /\bbonus\b/iu },
  { key: "soundtrack", label: "Soundtrack / OST / banda sonora", destination: "atributo banda sonora o tipo soundtrack; conservar EP/single si aplica", pattern: /\bsoundtrack\b|\bost\b|\bbanda sonora\b/iu, expectedType: "soundtrack" },
  { key: "split", label: "Split", destination: "atributo de publicación compartida; revisar participantes", pattern: /\bsplit\b/iu },
  { key: "volume", label: "Volumen / parte (números arábigos o romanos)", destination: "ingest.series_albums; verificar la serie antes de agrupar", pattern: /\b(?:vol(?:umen|ume)?\.?|parte|part)(?:\s*\d+|(?:\s+|\.\s*)[ivxlcdm]+)\b/iu },
];

const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");
function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
const item = (album: Album) => ({
  albumId: album.id, artist: album.artist, title: album.title, albumType: album.type,
  year: album.year, tracks: album.tracks, classifications: album.classes,
  isBSides: album.isBSides, isLive: album.isLive,
});

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex < 0 ? "reports/album-title-metadata-audit" : process.argv[outIndex + 1];
  if (!out || out.startsWith("--")) throw new Error("--out requiere un directorio");
  const client = await getPool().connect();
  let albums: Album[];
  let snapshotAt: string;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    snapshotAt = (await client.query<{ at: string }>("SELECT now()::text AS at")).rows[0]!.at;
    albums = (await client.query<Album>(`
      SELECT al.id::int, ar.name AS artist, al.title, al.album_type::text AS type, al.release_year AS year,
             (SELECT count(*)::int FROM public.tracks t WHERE t.album_id=al.id) AS tracks,
             ${B_SIDES_SQL} AS "isBSides", ${LIVE_SQL} AS "isLive",
             (SELECT coalesce(json_agg(json_build_object('label', c.classification, 'inferred', c.inferred) ORDER BY c.position), '[]')
                FROM ingest.album_classifications c WHERE c.album_id=al.id) AS classes,
             (SELECT coalesce(json_agg(json_build_object('title', v.title, 'details', v.format_details, 'source', v.source) ORDER BY v.id), '[]')
                FROM ingest.album_versions v WHERE v.album_id=al.id) AS versions,
             (SELECT coalesce(json_agg(json_build_object('title', s.title, 'volume', sa.volume_label) ORDER BY s.id), '[]')
                FROM ingest.series_albums sa JOIN ingest.series s ON s.id=sa.series_id WHERE sa.album_id=al.id) AS series
        FROM public.albums al LEFT JOIN public.artists ar ON ar.id=al.artist_id ORDER BY al.id
    `)).rows;
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const groups = rules.map(rule => {
    const matched = albums.filter(album => rule.pattern.test(normalized(album.title)));
    return {
      key: rule.key, label: rule.label, destination: rule.destination, pattern: rule.pattern.source,
      total: matched.length, byType: counts(matched.map(album => album.type)),
      sameType: rule.expectedType ? matched.filter(album => album.type === rule.expectedType).length : null,
      unresolvedType: matched.filter(album => album.type === "other").length,
      items: matched.map(album => ({
        ...item(album),
        marker: normalized(album.title).match(rule.pattern)?.[0] ?? null,
        hasClassification: rule.classification ? album.classes.some(c => c.label === rule.classification) : null,
        versions: rule.key === "edition" ? album.versions : undefined,
        series: rule.key === "volume" || rule.key === "collection" ? album.series : undefined,
      })),
    };
  });
  const bsides = albums.filter(album => rules[0]!.pattern.test(normalized(album.title)));
  const live = albums.map(album => ({ album, verdict: liveTitleVerdict(album.title, album.artist) }));
  const report = {
    snapshotAt, mode: "read-only", totalAlbums: albums.length,
    scope: "Títulos canónicos. Coincidencias léxicas, no cambios aprobados. Grupos solapados; no sumar totales. No se consultaron fuentes externas ni se dedujo el tipo por número de pistas.",
    byType: counts(albums.map(album => album.type)),
    uniqueMatchedAlbums: new Set(groups.flatMap(group => group.items.map(entry => entry.albumId))).size,
    bsides: {
      explicitTitles: bsides.length,
      classified: bsides.filter(album => album.classes.some(c => c.label === "B-Sides")).length,
      missingClassification: bsides.filter(album => !album.classes.some(c => c.label === "B-Sides")).map(item),
      missedByCurrentFilter: bsides.filter(album => !album.isBSides).map(item),
    },
    live: {
      rule: "src/normalization/live-title.ts (regla existente)",
      recognized: live.filter(entry => entry.verdict.live).length,
      unrepresented: live.filter(entry => entry.verdict.live && !entry.album.isLive).map(entry => ({ ...item(entry.album), verdict: entry.verdict })),
      doubts: live.filter(entry => entry.verdict.doubt).map(entry => ({ ...item(entry.album), verdict: entry.verdict })),
    },
    groups,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "hallazgos.json"), JSON.stringify(report, null, 2) + "\n");
  const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [["señal", "id", "artista", "título", "tipo", "clasificaciones", "pistas", "en_filtro_b_sides"]];
  for (const group of groups) for (const entry of group.items) lines.push([
    group.key, String(entry.albumId), entry.artist ?? "", entry.title, entry.albumType,
    entry.classifications.map(c => c.label).join("; "), String(entry.tracks), String(entry.isBSides),
  ]);
  writeFileSync(join(out, "hallazgos.csv"), "\uFEFF" + lines.map(line => line.map(csv).join(",")).join("\n") + "\n");
  console.log(JSON.stringify({ snapshotAt, totalAlbums: albums.length, groups: groups.map(({ items: _items, ...group }) => group), bsides: report.bsides, live: report.live.unrepresented, out }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
