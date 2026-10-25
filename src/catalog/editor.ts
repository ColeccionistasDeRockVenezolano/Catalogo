import { isBSidesTitle } from "../normalization/b-sides-title.js";
import { getPool } from "../db/client.js";
import { updateEntity, OperatorError, type OperatorContext } from "../merge/operator.js";
import { dateValueText, dateYear, parseDateValue } from "./date-value.js";
import { isMusicalClassification } from "./album-classifications.js";
import { ALBUM_EDITABLE_CLASSIFICATIONS } from "../shared/album-categories.js";
import { youtubeVideoId } from "../shared/youtube-playback.js";

export const EDITOR_RESOURCES = {
 version: {table:"ingest.album_versions", owner:"album", fields:["position","title","format","formatDetails","catalogNumber","country","releaseYear","releaseDate","coverUrl","notes","distinctTracks","discNumbers","isPrimary","sourceRef","editionTypes"]},
 label: {table:"ingest.album_labels",owner:"album",fields:["versionId","organizationId","role","position","sourceText","notes"]},
 disc: {table:"public.album_discs",owner:"album",fields:["discNumber","title","notes"]},
 discLink: {table:"public.album_disc_links",owner:"album",fields:["discNumber","platform","url","verified","notes"]},
 audiovisual: {table:"media.artist_audiovisuals",owner:"artist",fields:["title","releaseYear","kind","description","url"]},
 time: {table:"media.video_tracks",owner:"album",fields:["startSeconds","endSeconds","trackId","videoId"]},
} as const;
export type EditorResource = keyof typeof EDITOR_RESOURCES;
export const snake = (key:string) => key.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`);
const numericIds=new Set(['id','artist_id','person_id','organization_id','album_id','track_id','version_id','video_id','genre_id','seed_upload_id','run_id','source_id','label_id','album_format_id','work_id']);
const camel = (key:string) => key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase());
export function editorRow(row:Record<string,unknown>) {
 return Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key), key==='release_date' && value ? dateValueText(value as Parameters<typeof dateValueText>[0]) : numericIds.has(key) && value!==null ? Number(value) : value]));
}
export async function readEditorEntity(kind:string,id:number) {
 const table:Record<string,string>={album:'albums',artist:'artists',person:'persons',organization:'organizations',track:'tracks'};
 const row=(await getPool().query(`SELECT * FROM public.${table[kind]} WHERE id=$1`,[id])).rows[0] as Record<string,unknown>|undefined;
 if(!row) throw new OperatorError('not_found','Ficha inexistente.');
 const values=editorRow(row);
 if(kind==='album') {
  values['classifications']=(await getPool().query<{classification:string}>("SELECT classification FROM ingest.effective_album_classifications WHERE album_id=$1 ORDER BY position,id",[id])).rows.map(r=>r.classification).filter(isMusicalClassification);
  const rejected=(await getPool().query<{classification:string}>("SELECT classification FROM ingest.album_classification_decisions WHERE album_id=$1 AND NOT selected",[id])).rows.map(r=>r.classification);
  if(isBSidesTitle(String(values['title'])) && !rejected.includes('B-Sides')) values['classifications']=[...new Set([...(values['classifications'] as string[]),'B-Sides'])];
  values['editorTracks']=(await getPool().query('SELECT id::int,title,disc_number AS "discNumber",track_number AS "trackNumber" FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id',[id])).rows;
  values['editorVideos']=(await getPool().query(`SELECT DISTINCT v.id::int,v.video_id AS "videoId",v.title,v.duration_seconds AS "durationSeconds" FROM media.youtube_videos v LEFT JOIN media.video_albums a ON a.video_id=v.id AND a.album_id=$1 WHERE a.video_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.album_disc_links l WHERE l.album_id=$1 AND l.platform='youtube' AND strpos(l.url,v.video_id)>0)`,[id])).rows;
  const date=(await getPool().query<{release_date:unknown}>('SELECT release_date FROM ingest.catalog_edition_details WHERE album_id=$1',[id])).rows[0]?.release_date;
  values['discNumbers']=(await getPool().query<{n:number}>('SELECT disc_number AS n FROM public.tracks WHERE album_id=$1 UNION SELECT disc_number AS n FROM public.album_discs WHERE album_id=$1',[id])).rows.map(r=>r.n);
  values['releaseDate']=date?dateValueText(date as Parameters<typeof dateValueText>[0]):null;
 }
 return {values,vocabulary:await readEditorVocabulary()};
}
export async function readEditorVocabulary() {
 const types=(await getPool().query<{value:string}>("SELECT enumlabel AS value FROM pg_enum WHERE enumtypid='public.album_type'::regtype ORDER BY enumsortorder")).rows.map(r=>r.value);
 const classifications=[...new Set([...ALBUM_EDITABLE_CLASSIFICATIONS.map(i=>i.classification),...(await getPool().query<{classification:string}>('SELECT DISTINCT classification FROM ingest.album_classifications ORDER BY classification')).rows.map(r=>r.classification).filter(isMusicalClassification)])];
 return {albumTypes:types,classifications};
}

export async function readEditorResource(resource:EditorResource,ownerId:number) {
 const cfg=EDITOR_RESOURCES[resource];
 if(!(await getPool().query(`SELECT 1 FROM public.${cfg.owner==='album'?'albums':'artists'} WHERE id=$1`,[ownerId])).rowCount) throw new OperatorError('not_found','Ficha inexistente.');
 const sql=resource==='time' ? `SELECT t.*,v.video_id AS youtube_id,v.title AS video_title,tr.title AS track_title,tr.disc_number,v.duration_seconds FROM media.video_tracks t JOIN public.tracks tr ON tr.id=t.track_id JOIN media.youtube_videos v ON v.id=t.video_id WHERE tr.album_id=$1 ORDER BY v.id,t.start_seconds,t.id`
 : resource==='audiovisual' ? `SELECT t.*,v.url FROM ${cfg.table} t LEFT JOIN media.youtube_videos v ON v.id=t.video_id WHERE t.artist_id=$1 AND NOT (t.metadata @> '{"editorialHidden":true}'::jsonb) ORDER BY t.id`
 : resource==='label' ? `SELECT t.*,o.name AS organization_name FROM ${cfg.table} t JOIN public.organizations o ON o.id=t.organization_id WHERE t.album_id=$1 ORDER BY t.position,t.id`
 : `SELECT * FROM ${cfg.table} WHERE ${cfg.owner}_id=$1 ORDER BY id`;
 return (await getPool().query(sql,[ownerId])).rows.map(editorRow);
}
export async function writeEditorResource(ctx:OperatorContext,resource:EditorResource,ownerId:number,input:Record<string,unknown>|null,id?:number):Promise<number> {
 const cfg=EDITOR_RESOURCES[resource];const db=ctx.client;
 if(!(await db.query(`SELECT id FROM public.${cfg.owner==='album'?'albums':'artists'} WHERE id=$1 FOR UPDATE`,[ownerId])).rowCount) throw new OperatorError('not_found','Ficha inexistente.');
 let before:Record<string,unknown>|undefined;
 if(id!==undefined) {
  before=(await db.query(resource==='time'?`SELECT t.* FROM media.video_tracks t JOIN public.tracks tr ON tr.id=t.track_id WHERE t.id=$1 AND tr.album_id=$2 FOR UPDATE OF t`:`SELECT * FROM ${cfg.table} WHERE id=$1 AND ${cfg.owner}_id=$2 FOR UPDATE`,[id,ownerId])).rows[0] as Record<string,unknown>|undefined;
  if(!before) throw new OperatorError('not_found','El vínculo no pertenece a esta ficha.');
 }
 if(resource==='time') {
  if(before && input && (input['trackId']!==undefined || input['videoId']!==undefined)) throw new OperatorError('invalid','La ocurrencia conserva su pista y su video. Añade otra marca si corresponde a otro video.');
  if(id===undefined && input) {
   const track=(await db.query('SELECT id FROM public.tracks WHERE id=$1 AND album_id=$2 FOR KEY SHARE',[input['trackId'],ownerId])).rows[0];
   if(!track) throw new OperatorError('invalid','Selecciona una pista existente de este disco.');
   const video=(await db.query<{id:string;duration_seconds:number|null}>(`SELECT v.id::text,v.duration_seconds FROM media.youtube_videos v WHERE v.id=$1 AND (EXISTS(SELECT 1 FROM media.video_albums a WHERE a.video_id=v.id AND a.album_id=$2) OR EXISTS(SELECT 1 FROM public.album_disc_links l WHERE l.album_id=$2 AND l.platform='youtube' AND strpos(l.url,v.video_id)>0)) FOR SHARE`,[input['videoId'],ownerId])).rows[0];
   if(!video) throw new OperatorError('invalid','Selecciona un video vinculado a este disco o a uno de sus CD/lados.');
   const start=Number(input['startSeconds']);const end=input['endSeconds']??null;
   if(!Number.isInteger(start)||start<0||(end!==null&&(!Number.isInteger(end)||Number(end)<=start))||(video.duration_seconds!==null&&(start>=video.duration_seconds||(end!==null&&Number(end)>video.duration_seconds)))) throw new OperatorError('invalid','La marca debe estar dentro de la duración del video.');
   id=Number((await db.query<{id:string}>(`INSERT INTO media.video_tracks(video_id,track_id,start_seconds,end_seconds,confidence,source_id,notes) VALUES($1,$2,$3,$4,'high',$5,$6) RETURNING id::text`,[video.id,input['trackId'],start,end,ctx.sourceId,ctx.note])).rows[0]!.id);
   before=(await db.query('SELECT * FROM media.video_tracks WHERE id=$1',[id])).rows[0] as Record<string,unknown>;
  }
  if(!before||id===undefined) throw new OperatorError('invalid','Selecciona una ocurrencia existente del video.');
  const video=(await db.query<{duration_seconds:number|null}>('SELECT duration_seconds FROM media.youtube_videos WHERE id=$1 FOR SHARE',[before['video_id']])).rows[0]!;
  const start=Number(input?.['startSeconds']??before['start_seconds']);const end=input && 'endSeconds' in input?input['endSeconds']:before['end_seconds'];
  if(!Number.isInteger(start)||start<0||(end!==null&&(!Number.isInteger(end)||Number(end)<=start))||(video.duration_seconds!==null&&(start>=video.duration_seconds||(end!==null&&Number(end)>video.duration_seconds)))) throw new OperatorError('invalid','La marca debe estar dentro de la duración del video y el final debe ser posterior al inicio.');
  const decision=(await db.query<{original_start:number}>(`SELECT original_start FROM ingest.video_track_decisions WHERE video_id=$1 AND track_id=$2 AND start_seconds=$3 AND NOT suppressed FOR UPDATE`,[before['video_id'],before['track_id'],before['start_seconds']])).rows[0];
  await db.query(`INSERT INTO ingest.video_track_decisions(video_id,track_id,original_start,start_seconds,end_seconds,suppressed,reason,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(video_id,track_id,original_start) DO UPDATE SET start_seconds=EXCLUDED.start_seconds,end_seconds=EXCLUDED.end_seconds,suppressed=EXCLUDED.suppressed,reason=EXCLUDED.reason,run_id=EXCLUDED.run_id`,[before['video_id'],before['track_id'],decision?.original_start??before['start_seconds'],start,end,input===null,ctx.note,ctx.runId]);
  if(input===null) await db.query('DELETE FROM media.video_tracks WHERE id=$1',[id]);
  else await db.query("UPDATE media.video_tracks SET start_seconds=$2,end_seconds=$3,confidence='high',source_id=$4,notes=$5 WHERE id=$1",[id,start,end,ctx.sourceId,ctx.note]);
  return id;
 }
 if(input===null) {
  if(id===undefined) throw new OperatorError('invalid','Falta el vínculo que se retira.');
  if(resource==='audiovisual') await db.query(`UPDATE media.artist_audiovisuals SET metadata=metadata || '{"editorial":true,"editorialHidden":true}'::jsonb,updated_at=now() WHERE id=$1`,[id]);
  else await db.query(`DELETE FROM ${cfg.table} WHERE id=$1`,[id]);
  // El respaldo del core no debe resucitar un sello retirado.
  if(resource==='label') await db.query('UPDATE public.albums SET label_id=NULL WHERE id=$1 AND label_id=$2',[ownerId,before!['organization_id']]);
  return id;
 }
 const values:Record<string,unknown>={};
 for(const [key,value] of Object.entries(input)) {
  if(!(cfg.fields as readonly string[]).includes(key)) throw new OperatorError('invalid',`Campo ${key} no admitido.`);
  if(value!==undefined) values[snake(key)]=key==='releaseDate' && value!==null ? JSON.stringify(parseDateValue(String(value))) : value;
 }
 const merged={...before,...values};
 if(resource==='version') {
  const ds=merged['disc_numbers'] as number[]|undefined;
  if(ds?.length) {
   const actual=(await db.query<{n:number}>('SELECT disc_number AS n FROM public.tracks WHERE album_id=$1 UNION SELECT disc_number AS n FROM public.album_discs WHERE album_id=$1',[ownerId])).rows.map(r=>r.n);
   if(ds.some(n=>!actual.includes(n))) throw new OperatorError('invalid','Selecciona discos existentes en esta ficha.');
  }
  if('release_date' in values) {
   const year=values['release_date']===null?null:dateYear(String(input['releaseDate']));
   if('release_year' in values && values['release_year']!==null && year!==null && values['release_year']!==year) throw new OperatorError('invalid','El año y la fecha de la versión no coinciden.');
   values['release_year']=year;
  }
  if('release_year' in values && !('release_date' in values) && merged['release_date'] && dateYear(dateValueText(merged['release_date'] as Parameters<typeof dateValueText>[0]))!==values['release_year']) values['release_date']=null;
  if(values['is_primary']===true) await db.query('UPDATE ingest.album_versions SET is_primary=false WHERE album_id=$1 AND is_primary AND id<>$2',[ownerId,id??0]);
  values['run_id']=ctx.runId;if(id===undefined) values['source']='operador';
 }
 if(resource==='label') {
  if(merged['version_id']!==null&&merged['version_id']!==undefined && !(await db.query('SELECT id FROM ingest.album_versions WHERE id=$1 AND album_id=$2 FOR KEY SHARE',[merged['version_id'],ownerId])).rowCount) throw new OperatorError('invalid','La versión no pertenece a este disco.');
  if(!(await db.query('SELECT id FROM public.organizations WHERE id=$1 FOR KEY SHARE',[merged['organization_id']])).rowCount) throw new OperatorError('not_found','Organización inexistente.');
  values['run_id']=ctx.runId;
 }
 if(resource==='discLink') {
  if(!(await db.query('SELECT 1 FROM public.tracks WHERE album_id=$1 AND disc_number=$2 UNION SELECT 1 FROM public.album_discs WHERE album_id=$1 AND disc_number=$2',[ownerId,merged['disc_number']])).rowCount) throw new OperatorError('invalid','El CD/lado no existe en esta ficha.');
  if(merged['platform']==='youtube'&&!youtubeVideoId(String(merged['url']))) throw new OperatorError('invalid','URL de YouTube inválida.');
  values['method']='exact';values['source']='crv-operador';
 }
 if(resource==='audiovisual') {
  const url=input['url'];delete values['url'];
  if(url!==undefined) {
   const videoId=url===null?null:youtubeVideoId(String(url));
   if(url!==null&&!videoId) throw new OperatorError('invalid','URL de YouTube inválida.');
   values['video_id']=videoId?(await db.query<{id:string}>(`INSERT INTO media.youtube_videos(video_id,url) VALUES($1,$2) ON CONFLICT(video_id) DO UPDATE SET video_id=EXCLUDED.video_id RETURNING id::text`,[videoId,`https://youtu.be/${videoId}`])).rows[0]!.id:null;
  }
  if(input['title']!==undefined) values['title_key']=String(input['title']).normalize('NFKC').trim().toLowerCase();
  if(id===undefined) {values['source_key']=`operator:${ctx.runId}`;values['source_type']='editorial';}
  values['metadata']=JSON.stringify({...before?.['metadata'] as object,editorial:true,editorialHidden:false});
  values['updated_at']=new Date();
 }
 const entries=Object.entries(values);
 let result=id;
 if(id===undefined) {
  entries.push([`${cfg.owner}_id`,ownerId]);
  result=Number((await db.query<{id:string}>(`INSERT INTO ${cfg.table}(${entries.map(([key])=>key).join(',')}) VALUES(${entries.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id::text`,entries.map(([,v])=>v))).rows[0]!.id);
 } else if(entries.length) await db.query(`UPDATE ${cfg.table} SET ${entries.map(([key],i)=>`${key}=$${i+2}`).join(',')} WHERE id=$1`,[id,...entries.map(([,v])=>v)]);
 if(resource==='label' && before && before['organization_id']!==merged['organization_id']) {
  const core=(await db.query<{label_id:string|null}>('SELECT label_id::text FROM public.albums WHERE id=$1',[ownerId])).rows[0];
  if(core?.label_id && Number(core.label_id)===Number(before['organization_id'])) await updateEntity(ctx,'album',ownerId,{label_id:merged['organization_id']});
 }
 return result!;
}
