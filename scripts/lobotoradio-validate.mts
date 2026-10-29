import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { wordKey } from "../src/ambiguity/text.js";
import type { EntityMergePreview } from "../src/merge/entity-merge.js";
import type { AlbumMergePreview } from "../src/merge/album-merge.js";
const out = process.env["LOBOTO_OUT"];
if (!out) throw new Error("LOBOTO_OUT must point to SSD staging");
const load = <T,>(file: string): T => JSON.parse(readFileSync(path.join(out, file), "utf8")) as T;
const people = load<EntityMergePreview[]>("person-merge-previews.json");
const albums = load<AlbumMergePreview[]>("album-merge-previews.json");
const runs = [load<{runId:number}>("person-merges-applied.json").runId, load<{runId:number}>("album-merges-applied.json").runId];
const failures: string[] = [];
const checks: string[] = [];
const albumMap = new Map(albums.map(a => [a.drop.id, a.keep.id]));
const normalizeText = (value: string) => value.replace(/\s+/gu, " ").trim();
try {
  const db = getPool();
  const ids = [...new Set(people.map(p => p.keep.id))];
  const rows = (await db.query<{id:string;name:string;biography:string|null}>("SELECT id::text,name,biography FROM persons WHERE id=ANY($1::bigint[])", [ids])).rows;
  const by = new Map(rows.map(p => [Number(p.id), p]));
  const aliasRows = (await db.query<{person_id:string;alias:string}>("SELECT person_id::text,alias FROM ingest.person_aliases WHERE person_id=ANY($1::bigint[])", [ids])).rows;
  for (const p of people) {
    const keep = by.get(p.keep.id);
    if (!keep) { failures.push(`Missing person ${p.keep.id}`); continue; }
    const keys = new Set([wordKey(keep.name), ...aliasRows.filter(a => Number(a.person_id) === p.keep.id).map(a => wordKey(a.alias))]);
    for (const side of [p.keep, p.drop]) {
      const bio = side.fields["biography"];
      if (typeof bio === "string" && bio && !normalizeText(keep.biography ?? "").includes(normalizeText(bio))) failures.push(`Biography lost ${side.id}`);
      for (const alias of [side.name, ...side.aliases]) if (!keys.has(wordKey(alias))) failures.push(`Alias lost ${side.id}: ${alias}`);
    }
  }
  const drops = people.map(p => p.drop.id);
  if ((await db.query("SELECT id FROM persons WHERE id=ANY($1::bigint[])", [drops])).rowCount) failures.push("Retired persons remain");
  const redirects = (await db.query<{entity_kind:string;from_id:string;to_id:string}>("SELECT entity_kind,from_id::text,to_id::text FROM ingest.entity_redirects WHERE run_id=ANY($1::bigint[])", [runs])).rows;
  for (const p of people) if (!redirects.some(r => r.entity_kind === "person" && Number(r.from_id) === p.drop.id && Number(r.to_id) === p.keep.id)) failures.push(`Person redirect ${p.drop.id}`);
  for (const p of albums) if (!redirects.some(r => r.entity_kind === "album" && Number(r.from_id) === p.drop.id && Number(r.to_id) === p.keep.id)) failures.push(`Album redirect ${p.drop.id}`);
  const albumIds = albums.map(p => p.keep.id);
  const currentTracks = (await db.query<{id:string;album_id:string;title:string}>("SELECT id::text,album_id::text,title FROM tracks WHERE album_id=ANY($1::bigint[])", [albumIds])).rows;
  for (const p of albums) for (const t of [...p.keep.tracks,...p.drop.tracks]) if (!currentTracks.some(c => Number(c.album_id) === p.keep.id && wordKey(c.title) === wordKey(t.title))) failures.push(`Album track lost ${p.keep.id}: ${t.title}`);
  const videoBefore = load<Array<{album_id:string;video_id:string;start_seconds:number;end_seconds:number|null;title:string}>>("album-merge-video-tracks-before.json");
  const videoAfter = (await db.query<{album_id:string;video_id:string;start_seconds:number;end_seconds:number|null;title:string}>("SELECT t.album_id::text,v.video_id::text,v.start_seconds,v.end_seconds,t.title FROM media.video_tracks v JOIN tracks t ON t.id=v.track_id WHERE t.album_id=ANY($1::bigint[])", [albumIds])).rows;
  for (const v of videoBefore) if (!videoAfter.some(a => Number(a.album_id) === (albumMap.get(Number(v.album_id)) ?? Number(v.album_id)) && a.video_id === String(v.video_id) && a.start_seconds === v.start_seconds && a.end_seconds === v.end_seconds && wordKey(a.title) === wordKey(v.title))) failures.push(`Video timestamp lost ${v.video_id}/${v.start_seconds}`);
  const types = (await db.query<{id:string;album_type:string}>("SELECT id::text,album_type FROM albums WHERE id=ANY($1::bigint[])", [[56,40208,40001,40091,40279,40218,41013]])).rows;
  if (types.find(a => Number(a.id) === 56)?.album_type !== "ep") failures.push("EP type lost");
  if (types.find(a => Number(a.id) === 40208)?.album_type !== "demo") failures.push("Demo type lost");
  for (const id of [40001,40091,40279,40218]) if (types.find(a => Number(a.id) === id)?.album_type !== "single") failures.push(`Single changed ${id}`);
  const classes = (await db.query<{classification:string}>("SELECT classification FROM ingest.effective_album_classifications WHERE album_id=40208")).rows.map(r => r.classification);
  for (const value of ["Demos","Compilation Album"]) if (!classes.includes(value)) failures.push(`Missing category ${value}`);
  const separateIds = [1255,2423,1460,34685,40386,2044,3226,486,1112,15503,27655,4507,24876];
  if ((await db.query("SELECT id FROM persons WHERE id=ANY($1::bigint[])", [separateIds])).rowCount !== separateIds.length) failures.push("Distinct/mixed persons changed");
  checks.push("biographies_and_aliases","retired_persons","redirects","album_tracks","video_timestamps","combined_categories","protected_singles","distinct_people");
  const http: unknown[] = [];
  const jobs = [...people.map(p => ({kind:"person",resource:"persons",id:p.drop.id,to:p.keep.id})),...albums.map(p => ({kind:"album",resource:"albums",id:p.drop.id,to:p.keep.id})),...ids.map(id => ({kind:"person",resource:"persons",id,to:null})),...albumIds.map(id => ({kind:"album",resource:"albums",id,to:null}))];
  for (let i=0;i<jobs.length;i+=4) await Promise.all(jobs.slice(i,i+4).map(async job => {
    const response = await fetch(`http://127.0.0.1:8080/${job.resource}/${job.id}`);
    const body = await response.json() as {id?:number;error?:{details?:{movedTo?:{id:number}}}};
    const pass = job.to === null ? response.status === 200 && body.id === job.id : response.status === 404 && body.error?.details?.movedTo?.id === job.to;
    if (!pass) failures.push(`HTTP ${job.resource}/${job.id}`);
    http.push({...job,status:response.status,pass});
  }));
  const result = {at:new Date().toISOString(),runs,personGroups:ids.length,personMerges:people.length,albumMerges:albums.length,videoTimestampsBefore:videoBefore.length,videoTimestampsAfter:videoAfter.length,httpChecks:jobs.length,checks,failures,redirects,people:rows,albumTypes:types,combinedDemoCategories:classes,http};
  writeFileSync(path.join(out,"validation-final.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify({runs,personGroups:ids.length,personMerges:people.length,albumMerges:albums.length,videoTimestamps:videoBefore.length,httpChecks:jobs.length,failures}));
  if (failures.length) process.exitCode=1;
} finally { await closeDb(); }
