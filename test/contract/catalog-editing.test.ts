import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startPgContainer, type PgContainer } from '../support/pg-container.js';
import { applyCore } from '../support/apply-core.js';
import { closeDb, getPool } from '../../src/db/client.js';
import { resetEnvCache } from '../../src/config/env.js';
import { migrateUp } from '../../src/db/migrate.js';
import { buildApp } from '../../src/api/app.js';
import { syncAlbumVideoTrackTimes } from '../../src/youtube/track-playback.js';
import { syncAlbumClassifications } from '../../src/youtube/classifications.js';

const TOKEN='catalog-editing-contract-token-0123456789';
describe('edición conectada con las fichas públicas',()=>{
 let container:PgContainer;let app:FastifyInstance;let artist:number;let album:number;let other:number;let track:number;let org:number;
 const headers={authorization:`Bearer ${TOKEN}`};
 const sql=async(query:string,values:unknown[]=[])=>getPool().query(query,values);
 const get=(url:string)=>app.inject({method:'GET',url,headers});
 const write=(method:'POST'|'PATCH'|'DELETE',url:string,payload?:Record<string,unknown>)=>app.inject({method,url,headers,...(payload?{payload:{note:'Corrección documentada del contrato',...payload}}:{})});
 const undo=(runId:number)=>write('POST',`/changes/${runId}/undo`,{});
 const path=(resource:string,id?:number,owner=album)=>`/catalog-editor/album/${owner}/${resource}${id===undefined?'':`/${id}`}`;
 beforeAll(async()=>{
  container=await startPgContainer();process.env['DATABASE_URL']=container.databaseUrl;process.env['CRV_OPERATOR_TOKEN']=TOKEN;resetEnvCache();await applyCore(container.name);await migrateUp();app=await buildApp();
  artist=(await write('POST','/artists',{name:'Artista de edición'})).json().id;
  album=(await write('POST','/albums',{artistId:artist,title:'Obra editorial B-Sides',albumType:'ep',youtubeUrl:'https://youtu.be/abcdefghijk',youtubeStatus:'copyright_blocked',catalogId:'CRV-123'})).json().id;
  const another=await write('POST','/albums',{artistId:artist,title:'Zafiro de medianoche',allowSimilar:true});expect(another.statusCode,another.body).toBe(201);other=another.json().id;
  track=(await write('POST','/tracks',{albumId:album,title:'Pista exacta',discNumber:1,trackNumber:1})).json().id;
  org=(await write('POST','/organizations',{name:'Sello editorial',organizationType:'record_label'})).json().id;
 },120000);
 afterAll(async()=>{await app?.close();await closeDb();delete process.env['CRV_OPERATOR_TOKEN'];resetEnvCache();await container?.stop();},60000);
 it('lee datos originales de forma privada y guarda clasificaciones sin mandar tipo null',async()=>{
  expect((await app.inject({url:`/catalog-editor/entity/album/${album}`})).statusCode).toBe(401);
  const raw=await get(`/catalog-editor/entity/album/${album}`);expect(raw.headers['cache-control']).toBe('private, no-store');
  expect(raw.json().values).toMatchObject({albumType:'ep',youtubeUrl:'https://youtu.be/abcdefghijk',catalogId:'CRV-123'});
  expect(raw.json().values.classifications).toContain('B-Sides');
  expect((await get(`/albums/${album}`)).json().youtubeUrl).toBeNull();
  const saved=await write('PATCH',`/albums/${album}`,{classifications:['B-Sides','Ensayo musical']});expect(saved.statusCode,saved.body).toBe(200);
  expect((await get(`/albums/${album}`)).json()).toMatchObject({albumType:'ep',isBSides:true});
  expect((await get(`/catalog-editor/entity/album/${album}`)).json().vocabulary.classifications).toContain('Ensayo musical');
  expect((await get(`/albums?albumType=ep,classification:Ensayo%2520musical`)).json().data.map((a:{id:number})=>a.id)).toContain(album);
  expect((await get('/albums/facets')).json().types).toContainEqual({value:'classification:Ensayo%20musical',count:1});
  expect((await write('PATCH',`/albums/${album}`,{description:'Solo cambia la descripción'})).statusCode).toBe(200);
  expect((await get(`/catalog-editor/entity/album/${album}`)).json().values.youtubeUrl).toBe('https://youtu.be/abcdefghijk');
  expect((await write('PATCH',`/albums/${album}`,{albumType:null})).statusCode).toBe(400);
 });
 it('un rechazo prevalece al título y a la sincronización, y se puede deshacer',async()=>{
  const saved=await write('PATCH',`/albums/${album}`,{classifications:[]});expect(saved.statusCode,saved.body).toBe(200);
  await syncAlbumClassifications();expect((await get(`/albums/${album}`)).json()).toMatchObject({isBSides:false,classifications:[]});
  const filtered=(await get('/albums?albumType=b_sides')).json();expect(filtered.data.some((a:{id:number})=>a.id===album)).toBe(false);
  expect((await undo(saved.json().runId)).statusCode).toBe(200);expect((await get(`/albums/${album}`)).json().isBSides).toBe(true);
 });
 it('versiones, tipos combinados, fechas, discos y sellos alimentan la ficha pública y deshacer',async()=>{
  const disc=await write('POST',path('disc'),{discNumber:1,title:'Lado A'});expect(disc.statusCode,disc.body).toBe(200);
  const created=await write('POST',path('version'),{title:'Edición documentada',editionTypes:['deluxe','remastered','reissue'],releaseDate:'2001-05',isPrimary:true,discNumbers:[1],sourceRef:'https://fixture.invalid/edicion'});expect(created.statusCode,created.body).toBe(200);
  const version=created.json().id;
  const linked=await write('POST',path('label'),{organizationId:org,versionId:version,role:'licensee'});expect(linked.statusCode,linked.body).toBe(200);
  const detail=(await get(`/albums/${album}`)).json();expect(detail.versions[0]).toMatchObject({id:version,title:'Edición documentada',releaseDate:'2001-05',releaseYear:2001,discNumbers:[1],editionTypes:['deluxe','remastered','reissue'],labels:[expect.objectContaining({organizationId:org,role:'licensee'})]});
  expect(detail.discs[0].title).toBe('Lado A');expect(detail.labels).toEqual([expect.objectContaining({organizationId:org,role:'licensee'})]);
  expect((await write('PATCH',path('version',version,other),{title:'Cruce inválido'})).statusCode).toBe(404);
  expect((await write('PATCH',path('version',version),{releaseDate:'2002',releaseYear:2003})).statusCode).toBe(422);
  expect((await write('POST',path('label',undefined,other),{organizationId:org,versionId:version,role:'label'})).statusCode).toBe(422);
  expect((await undo(linked.json().runId)).statusCode).toBe(200);expect((await get(`/albums/${album}`)).json().labels).toEqual([]);
 });
 it('proyecta una fecha de obra coherente sin inventar día ni sobrescribir el literal',async()=>{
  const saved=await write('PATCH',`/albums/${album}`,{releaseDate:'1999-04',releaseDateText:'Abril de 1999, según el sello'});expect(saved.statusCode,saved.body).toBe(200);
  expect((await get(`/albums/${album}`)).json()).toMatchObject({releaseYear:1999,releaseDateValue:'1999-04',releaseDateText:'Abril de 1999, según el sello'});
  expect((await write('PATCH',`/albums/${album}`,{releaseDate:'2000',releaseYear:2001})).statusCode).toBe(422);
  const year=await write('PATCH',`/albums/${album}`,{releaseYear:1998});expect(year.statusCode,year.body).toBe(200);
  expect((await get(`/albums/${album}`)).json()).toMatchObject({releaseYear:1998,releaseDateValue:null});
 });
 it('edita letras y conserva la nulabilidad',async()=>{
  const saved=await write('PATCH',`/tracks/${track}`,{lyrics:'Primera línea\nSegunda línea'});expect(saved.statusCode,saved.body).toBe(200);expect((await get(`/tracks/${track}`)).json().lyrics).toBe('Primera línea\nSegunda línea');
  expect((await undo(saved.json().runId)).statusCode).toBe(200);expect((await get(`/tracks/${track}`)).json().lyrics).toBeNull();
 });
 it('reemplaza un vínculo de video en lugar de agregar otro y puede restaurarlo',async()=>{
  expect((await write('PATCH',`/albums/${album}/videos/abcdefghijk`,{kind:'full_album',isPrimaryLink:true})).statusCode).toBe(200);
  const saved=await write('PATCH',`/albums/${album}/videos/lmnopqrstuv`,{kind:'full_album',isPrimaryLink:true,previousVideoId:'abcdefghijk'});expect(saved.statusCode,saved.body).toBe(200);
  const linked=await sql('SELECT v.video_id FROM media.video_albums a JOIN media.youtube_videos v ON v.id=a.video_id WHERE a.album_id=$1',[album]);expect(linked.rows).toEqual([{video_id:'lmnopqrstuv'}]);
  expect((await undo(saved.json().runId)).statusCode).toBe(200);expect((await sql('SELECT v.video_id FROM media.video_albums a JOIN media.youtube_videos v ON v.id=a.video_id WHERE a.album_id=$1',[album])).rows).toEqual([{video_id:'abcdefghijk'}]);
 });
 it('nombres y videos de CD se leen en el reproductor; tiempos por video conservan cero y evidencia',async()=>{
  const link=await write('POST',path('discLink'),{discNumber:1,platform:'youtube',url:'https://youtu.be/abcdefghijk',verified:true});expect(link.statusCode,link.body).toBe(200);
  const video=(await sql("UPDATE media.youtube_videos SET publication_status='published',duration_seconds=200 WHERE video_id='abcdefghijk' RETURNING id")).rows[0]!.id;
  const video2=(await sql("INSERT INTO media.youtube_videos(video_id,url,publication_status,duration_seconds) VALUES('zyxwvutsrqp','https://youtu.be/zyxwvutsrqp','published',200) RETURNING id")).rows[0]!.id;
  const occurrence=(await sql('INSERT INTO media.video_tracks(video_id,track_id,start_seconds,end_seconds) VALUES($1,$2,10,100) RETURNING id',[video,track])).rows[0]!.id;
  await sql('INSERT INTO media.video_tracks(video_id,track_id,start_seconds,end_seconds) VALUES($1,$2,50,100)',[video2,track]);
  await sql("INSERT INTO media.youtube_tracklist_entries(video_id,position,title,start_seconds) VALUES($1,0,'Pista exacta',10)",[video]);
  const times=(await get(path('time'))).json();expect(times).toHaveLength(2);expect(times[0].youtubeId).toBe('abcdefghijk');
  expect((await write('PATCH',path('time',occurrence),{startSeconds:200})).statusCode).toBe(422);
  const corrected=await write('PATCH',path('time',occurrence),{startSeconds:0,endSeconds:90});expect(corrected.statusCode,corrected.body).toBe(200);
  const client=await getPool().connect();try{await syncAlbumVideoTrackTimes(client);}finally{client.release();}
  expect((await sql('SELECT start_seconds,end_seconds FROM media.video_tracks WHERE video_id=$1 AND track_id=$2',[video,track])).rows).toEqual([{start_seconds:0,end_seconds:90}]);
  expect((await sql('SELECT start_seconds FROM media.video_tracks WHERE video_id=$1 AND track_id=$2',[video2,track])).rows).toEqual([{start_seconds:50}]);
  const detail=(await get(`/albums/${album}`)).json();expect(detail.tracklist[0].youtubeStartSeconds).toBe(0);expect(detail.discs[0].platforms).toEqual(expect.arrayContaining([expect.objectContaining({platform:'youtube',url:'https://youtu.be/abcdefghijk'})]));
  expect((await undo(corrected.json().runId)).statusCode).toBe(200);
  const manual=await write('POST',path('time'),{trackId:track,videoId:Number(video),startSeconds:120,endSeconds:180});expect(manual.statusCode,manual.body).toBe(200);
  expect((await write('POST',path('time',undefined,other),{trackId:track,videoId:Number(video),startSeconds:140})).statusCode).toBe(422);
  expect((await undo(manual.json().runId)).statusCode).toBe(200);
  await sql('UPDATE public.tracks SET youtube_start_seconds=77 WHERE id=$1',[track]);
  const removed=await write('DELETE',`${path('time',occurrence)}?note=Retirar%20marca%20sin%20respaldo`);expect(removed.statusCode,removed.body).toBe(200);
  expect((await get(`/albums/${album}`)).json().tracklist[0].youtubeStartSeconds).toBeNull();
  expect((await sql('SELECT youtube_start_seconds FROM public.tracks WHERE id=$1',[track])).rows[0]!.youtube_start_seconds).toBe(77);
  expect((await undo(removed.json().runId)).statusCode).toBe(200);
 });
 it('gestiona audiovisuales sin crear discos ni pistas y sólo publica reproductores verificadamente embebibles',async()=>{
  const before=Number((await sql('SELECT count(*) AS n FROM public.albums')).rows[0]!.n);
  const url=`/catalog-editor/artist/${artist}/audiovisual`;
  const created=await write('POST',url,{title:'Documental del artista',kind:'documentary',url:'https://youtu.be/zyxwvutsrqp',description:'Descripción editorial'});expect(created.statusCode,created.body).toBe(200);
  const id=created.json().id;await sql("UPDATE media.youtube_videos SET publication_status='published',metadata=jsonb_build_object('status',jsonb_build_object('embeddable',true)) WHERE video_id='zyxwvutsrqp'");
  const published=(await get(`/artists/${artist}`)).json();expect(published.audiovisuals).toEqual(expect.arrayContaining([expect.objectContaining({id,title:'Documental del artista',playable:true,description:'Descripción editorial'})]));
  await sql("UPDATE media.youtube_videos SET metadata=jsonb_build_object('status',jsonb_build_object('embeddable',false)) WHERE video_id='zyxwvutsrqp'");
  const notEmbeddable=(await get(`/artists/${artist}`)).json();expect(notEmbeddable.audiovisuals).not.toEqual(expect.arrayContaining([expect.objectContaining({id})]));
  await sql("UPDATE media.youtube_videos SET publication_status='copyright_blocked' WHERE video_id='zyxwvutsrqp'");
  const detail=(await get(`/artists/${artist}`)).json();expect(detail.audiovisuals).not.toEqual(expect.arrayContaining([expect.objectContaining({id})]));
  expect((await get(url)).json()[0].url).toBe('https://youtu.be/zyxwvutsrqp');expect(Number((await sql('SELECT count(*) AS n FROM public.albums')).rows[0]!.n)).toBe(before);
  const removed=await write('DELETE',`${url}/${id}?note=Retiro%20editorial`);expect(removed.statusCode,removed.body).toBe(200);expect((await get(url)).json()).toHaveLength(0);
  expect((await sql('SELECT metadata FROM media.artist_audiovisuals WHERE id=$1',[id])).rows[0]!.metadata).toMatchObject({editorialHidden:true});expect((await undo(removed.json().runId)).statusCode).toBe(200);expect((await get(url)).json()).toHaveLength(1);
 });
 it('propone términos, publica ámbitos y devuelve conflictos tipados de jerarquía',async()=>{
  await sql("INSERT INTO ingest.genres(slug,name,level) VALUES('rock','Rock','family')");
  await sql("INSERT INTO ingest.genres(slug,name,level,parent_genre_id) SELECT 'hard-rock','Hard Rock','genre',id FROM ingest.genres WHERE slug='rock'");
  const proposal=await write('POST',`/genres/album/${album}/proposal`,{proposedName:'Rock de prueba',familySlug:'rock',rawValue:'Descripción y URL de la fuente'});expect(proposal.statusCode,proposal.body).toBe(200);
  expect((await sql('SELECT payload FROM ingest.review_queue WHERE id=$1',[proposal.json().reviewId])).rows[0]!.payload).toMatchObject({genreCase:'new_term',proposedName:'Rock de prueba'});
  const assigned=await write('POST',`/genres/album/${album}/decision`,{action:'add_secondary',genreSlug:'hard-rock'});expect(assigned.statusCode,assigned.body).toBe(200);
  const conflict=await write('POST',`/genres/album/${album}/decision`,{action:'confirm_primary',genreSlug:'rock'});expect(conflict.statusCode,conflict.body).toBe(409);
  const scoped=await write('POST','/catalog-model/genre',{albumId:album,genreSlug:'rock',period:'1990/1995'});expect(scoped.statusCode,scoped.body).toBe(201);
  expect((await get(`/genres/album/${album}/periods`)).json()).toEqual([expect.objectContaining({name:'Rock',period:'1990/1995'})]);
 });
});
