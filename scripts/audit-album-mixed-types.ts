// Solo lectura: cruza tipos, características y ediciones, sin reclasificar discos.
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { ALBUM_CHARACTERISTICS } from "../src/shared/album-categories.js";
import { B_SIDES_SQL, LIVE_SQL } from "../src/api/repositories/albums.js";
import { ALBUM_EDITION_TYPES_SQL } from "../src/api/repositories/album-categories.js";
import { audiovisualAlbumException, audiovisualKind } from "../src/youtube/audiovisual-rules.js";

interface Album {
  albumId: number; artist: string; title: string; albumType: string; tracks: number;
  isLive: boolean; isBSides: boolean; editionTypes: string[];
  classifications: Array<{ classification: string; inferred: boolean }>;
}
const releaseLabels: Record<string, string> = {
  "Studio Album": "studio_album", "Live Album": "live", EP: "ep", Single: "single",
  "Compilation Album": "compilation", Demos: "demo", Soundtrack: "soundtrack", "Collaboration Album": "collaboration_album", "Remix Album": "remix",
};
const characteristics = Object.fromEntries(ALBUM_CHARACTERISTICS.map(item => [item.classification, item.key]));
const formatLabels = new Set(["Studio Album", "EP", "Single", "Compilation Album", "Live Album"]);
const summarize = (a: Album) => ({ albumId: a.albumId, artist: a.artist, title: a.title, albumType: a.albumType, tracks: a.tracks,
  classifications: a.classifications, editionTypes: a.editionTypes });
function categories(a: Album): string[] {
  const keys = new Set(a.albumType === "other" ? [] : [a.albumType === "live_album" ? "live" : a.albumType]);
  if (a.isBSides) keys.add("b_sides");
  if (a.isLive) keys.add("live");
  for (const { classification } of a.classifications) {
    const key = releaseLabels[classification] ?? characteristics[classification] ?? (classification === "Unplugged" ? "acoustic" : undefined);
    if (key) keys.add(key);
  }
  for (const key of a.editionTypes) keys.add(key);
  return [...keys].sort();
}
async function main(): Promise<void> {
  // Ejecutar la proyección real del frontend con tsx, sin incorporar sus
  // imports Bundler al grafo NodeNext del backend.
  const frontendLabelsModule = "../web/src/lib/labels.ts";
  const { discographyChipKeys } = await import(frontendLabelsModule) as { discographyChipKeys: (album: Album) => string[] };
  const out = "reports/tipos-mixtos-discos";
  const client = await getPool().connect();
  let albums: Album[];
  let snapshotAt: string;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    snapshotAt = (await client.query<{ at: string }>("SELECT now()::text AS at")).rows[0]!.at;
    albums = (await client.query<Album>(`SELECT al.id::int AS "albumId", ar.name AS artist, al.title, al.album_type::text AS "albumType",
      (SELECT count(*)::int FROM public.tracks t WHERE t.album_id=al.id) AS tracks,
      ${B_SIDES_SQL} AS "isBSides", ${LIVE_SQL} AS "isLive", ${ALBUM_EDITION_TYPES_SQL} AS "editionTypes",
      (SELECT coalesce(jsonb_agg(jsonb_build_object('classification',c.classification,'inferred',c.inferred) ORDER BY c.position,c.id),'[]')
       FROM ingest.album_classifications c WHERE c.album_id=al.id) AS classifications
      FROM public.albums al JOIN public.artists ar ON ar.id=al.artist_id ORDER BY al.id`)).rows;
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const audiovisualLabels = albums.filter(a => !audiovisualAlbumException(a.artist, a.title)
    && audiovisualKind(a.classifications.map(c => c.classification).join(",")) !== null);
  // Auditar las fichas existentes no certifica que un audiovisual sea edición
  // musical. Las etiquetas audiovisuales se señalan para revisar la evidencia;
  // una edición musical documentada puede conservar disco y audiovisual.
  const musical = albums;
  const mixed = musical.map(a => ({ ...summarize(a), categories: categories(a), discographyChips: discographyChipKeys(a) })).filter(a => a.categories.length > 1);
  const groups = new Map<string, typeof mixed>();
  for (const a of mixed) {
    const key = a.categories.join(" + ");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const pairs = new Map<string, number>();
  for (const a of mixed) for (let i=0; i<a.categories.length; i++) for (let j=i+1; j<a.categories.length; j++) {
    const key = `${a.categories[i]} + ${a.categories[j]}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const hidden = mixed.map(a => ({ ...a, missingChips: a.categories.filter(key =>
    ["single","ep","studio_album","compilation","demo","remix","live","b_sides","acoustic","instrumental",...a.editionTypes].includes(key) && !a.discographyChips.includes(key)) }))
    .filter(a => a.missingChips.length);
  const unresolvedRemix = musical.filter(a => a.albumType === "remix" && !a.classifications.some(c => formatLabels.has(c.classification)));
  const formatStats = Object.fromEntries(["single","ep","studio_album","compilation","demo","live_album","remix","other"].map(type => [type,
    Object.fromEntries(["Remix","Acústico","Instrumental","En vivo","B-Sides"].map(label => [label,
      musical.filter(a => a.albumType===type && a.classifications.some(c=>c.classification===label)).length]))]));
  mkdirSync(out,{recursive:true});
  const report={snapshotAt,readOnly:true,totalAlbums:albums.length,mixedAlbums:mixed.length,
    formatStats,pairs:Object.fromEntries([...pairs].sort((a,b)=>b[1]-a[1])),
    groups:[...groups].map(([combination,items])=>({combination,count:items.length,items})).sort((a,b)=>b.count-a.count),
    issues:{hiddenDiscographyCategories:hidden,unresolvedRemixFormat:unresolvedRemix.map(summarize),
      unresolvedRemixOneTrack:unresolvedRemix.filter(a=>a.tracks===1).map(summarize),
      audiovisualLabelsToReview:audiovisualLabels.map(summarize),
      otherWithMusicalClassification:musical.filter(a=>a.albumType==='other'&&a.classifications.some(c=>releaseLabels[c.classification])).map(summarize)},
    examples:albums.filter(a=>[155,306,437,13929,14426,561,14063,28512,566,487,2006,2018,23106].includes(a.albumId)).map(a=>({...summarize(a),categories:categories(a)})),
    interpretation:['Las categorías son acumulables; no se suman sus totales como discos distintos.',
      'Remix solo no demuestra que la publicación sea sencillo, EP o álbum; tampoco lo demuestra el número de pistas.',
      'Los títulos con originales y remixes o EP/demo y directo requieren revisar el contenido; no se dividen automáticamente.',
      'Las características de una pista no se propagan a todas las pistas ni a todo el disco.',
      'Los tipos audiovisuales compuestos siguen las reglas de AGENTS.md; no se reinterpretan como discos musicales.']};
  writeFileSync(`${out}/analisis.json`,JSON.stringify(report,null,2)+"\n");
  const rows=[['albumId','artist','title','albumType','categories','discographyChips'],...mixed.map(a=>[a.albumId,a.artist,a.title,a.albumType,a.categories.join(' + '),a.discographyChips.join(' + ')])];
  writeFileSync(`${out}/mixtos.csv`,rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')+'\n');
  console.log(JSON.stringify({snapshotAt,totalAlbums:albums.length,mixed: mixed.length,hidden:hidden.length,unresolvedRemix:unresolvedRemix.length,unresolvedRemixOneTrack:unresolvedRemix.filter(a=>a.tracks===1).length,audiovisualLabelsToReview:audiovisualLabels.length,pairs:report.pairs}));
}
main().catch((error: unknown)=>{console.error(error);process.exitCode=1}).finally(closeDb);
