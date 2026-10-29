/** Aplicación autorizada por Brian. Todo cambio core pasa por el operador y su diario. */
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun,createEntity,updateEntity,createRelation,type OperatorContext} from '../../src/merge/operator.js';
import {saveEphemeris} from '../../src/catalog/ephemerides.js';
import {confirmGenre} from '../../src/genres/human.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
const O=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const S='reports/wayback-analisis-catalogo-2026-10-22';
const rows=(dir:string,n:string):any[]=>existsSync(join(dir,n+'.jsonl'))?readFileSync(join(dir,n+'.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const key=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const contactFree=(s:string)=>s.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,'[contacto histórico omitido]').replace(/(?:https?:\/\/|www\.)\S+/giu,'[enlace conservado en la referencia]');
const cases=new Map(rows(O,'expedientes-artistas').map(r=>[r.key,r]));
const synth=new Map(rows(O,'sintesis-artistas').map(r=>[r.key,r]));
const mapping:Record<string,number>=existsSync(join(O,'artistas-aplicados.json'))?JSON.parse(readFileSync(join(O,'artistas-aplicados.json'),'utf8')):{};
const counters:Record<string,number>={};const inc=(s:string,n=1)=>counters[s]=(counters[s]??0)+n;
const log=(name:string,r:any)=>appendFileSync(join(O,name+'.jsonl'),JSON.stringify(r)+'\n');
const phase=process.argv[2]??'artists';
const pool=getPool();
for(const r of (await pool.query("SELECT artist_id,metadata->>'caseKey' case_key FROM media.artist_documents WHERE tags @> $1::text[] AND metadata ? 'caseKey'",[[TAG]])).rows)mapping[r.case_key]=Number(r.artist_id);
const artistRows=(await pool.query('SELECT * FROM public.artists')).rows;
const artists=new Map(artistRows.map(a=>[Number(a.id),a]));
const names=new Map<string,Set<number>>();function index(name:string,id:number){const k=key(name);if(!names.has(k))names.set(k,new Set());names.get(k)!.add(id);}
for(const a of artistRows)index(a.name,Number(a.id));
for(const a of (await pool.query('SELECT artist_id,alias FROM ingest.artist_aliases')).rows)index(a.alias,Number(a.artist_id));
const excluded=new Set((await pool.query('SELECT artist_id FROM ingest.artist_editorial_policy')).rows.map(x=>Number(x.artist_id)));
function artistId(name:string):number|null{
 const exactCase=[...cases.values()].find(c=>key(c.name)===key(name)||key(c.source?.nombre_fuente??'')===key(name));if(exactCase&&mapping[exactCase.key])return mapping[exactCase.key]!;
 if(exactCase&&(synth.get(exactCase.key)?.identity==='conflict'||(exactCase.source?.nombre_fuente&&exactCase.name!==exactCase.source.nombre_fuente)))return null;
 if(key(name)==='rafaellgarnica')return 101;
 if(/^(Varios Artistas|Varios\. Banda Sonora)$/i.test(name))return 257;
 const ids=[...(names.get(key(name))??[])].filter(id=>!excluded.has(id));return ids.length===1?ids[0]!:null;
}
async function run(name:string,params:any,fn:(ctx:OperatorContext)=>Promise<any>){
 return withOperatorRun({name:`wayback:${name}`,operator:'codex',note:'Brian autorizó incorporar el archivo Wayback, fusionar biografías y conservar conflictos y procedencia (2026-10-23).',params:{campaign:TAG,...params}},async ctx=>{await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);return fn(ctx);});
}
async function doc(ctx:OperatorContext,id:number,sourceKey:string,category:string,title:string,content:string,e:any={},tags:string[]=[],metadata:any={}){
 const safeUrl=(u:any)=>typeof u==='string'&&/^https?:\/\//.test(u)?u:null;
 const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,date_text,location,tags,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(artist_id,source_key) DO NOTHING RETURNING id`,
 [id,sourceKey,category,title,contactFree(content),safeUrl(e.url),safeUrl(e.wayback),metadata.dateText??null,metadata.location??null,[TAG,...tags],JSON.stringify({campaign:TAG,evidence:e,...metadata})]);
 if(r.rowCount)inc('documents');
}
const pnames=new Map<string,number[]>();for(const p of (await pool.query('SELECT id,name FROM public.persons')).rows){const k=key(p.name);pnames.set(k,[...(pnames.get(k)??[]),Number(p.id)]);}
for(const p of (await pool.query('SELECT person_id,alias FROM ingest.person_aliases')).rows){const k=key(p.alias);pnames.set(k,[...new Set([...(pnames.get(k)??[]),Number(p.person_id)])]);}
async function person(ctx:OperatorContext,name:string):Promise<number|null>{
 if(/(?:fotograf[ií]as?|dise[ñn]o|dise[ñn]ador|producci[oó]n|vestuario|diagramaci[oó]n|caligraf[ií]a|concepto|montaje|intervenci[oó]n|artista pl[aá]stico|creative studio|graphics|films|pinch point|^en El Tigre$|^obra de |\sArte$|“El Sol”|\s[e/]\s)/iu.test(name))return null;
 if(!name||name.length>110||/\d|https?:|@|^s\/?i$|por confirmar/i.test(name))return null;
 let ps=pnames.get(key(name))??[];
 if(ps.length===1&&name.trim().split(/\s+/).length>=2){if((await ctx.client.query('SELECT id FROM public.persons WHERE id=$1',[ps[0]])).rowCount)return ps[0]!;pnames.delete(key(name));ps=[];}
 if(ps.length||name.trim().split(/\s+/).length<2)return null;
 const result=await createEntity(ctx,'person',{name},{allowSimilar:true});pnames.set(key(name),[result.id]);return result.id;
}
function exactDate(date:any,quote:string):string|null{
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const [y,m,d]=date.split('-').map(Number);const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 const q=quote.toLowerCase();if(!q.includes(String(y)))return null;
 return (new RegExp(`\\b0?${d}\\s*(?:de\\s+)?${months[m!-1]}`).test(q)||q.includes(`${d}/${m}/${y}`)||q.includes(date))?date:null;
}
if(phase==='artists'){
 for(const [caseKey,c] of cases){
  if(mapping[caseKey])continue;
  const r=synth.get(caseKey);if(!r){log('pendientes',{key:caseKey,reason:'síntesis pendiente'});continue;}
  if(['conflict','insufficient'].includes(r.identity)||!r.biography){log('conflictos',{key:caseKey,decision:r});continue;}
  // Los homónimos sin documentación adicional no se fuerzan como nuevas bandas.
  if(c.name==='Némesis'){log('conflictos',{key:caseKey,reason:'Proyecto de Felix Zilinskas; no asignar a bandas de metal ni aceptar nueva identidad sin corroboración.',source:c.source});continue;}
  let id=r.artistId??artistId(c.name);if(id&&excluded.has(id)){log('conflictos',{key:caseKey,reason:'Decisión editorial de exclusión existente',id});continue;}
  try{
   const result=await run('artist',{caseKey,artistId:id,source:c.source.evidencia??null,promptHash:r.promptHash},async ctx=>{
    if(!id){const created=await createEntity(ctx,'artist',{name:c.name,artist_type:r.artistType??'project',biography:r.biography,origin_country:'Venezuela',...(r.city?{origin_city:r.city}:{}),...(r.formedYear?{formed_year:r.formedYear}:{})},{allowSimilar:true});id=created.id;inc('artists_created');}
    else{
     const current=(await ctx.client.query('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE',[id])).rows[0];
     const expected=c.candidates.find((a:any)=>a.id===id);
     if(expected&&current.biography!==expected.biography)throw new Error('La biografía cambió después del expediente; se requiere nueva síntesis.');
     const values:any={};
     if(current.biography&&r.biography.length<current.biography.length*.75)throw new Error('La síntesis acorta demasiado el texto actual: revisar conservación de hechos.');
     if(current.biography!==r.biography)values.biography=r.biography;
     if(!current.origin_city&&r.city)values.origin_city=r.city;
     if(!current.formed_year&&r.formedYear)values.formed_year=r.formedYear;
     if(Object.keys(values).length){await updateEntity(ctx,'artist',id!,values);inc('artists_enriched');}
    }
    const src=c.source;const content=src.biografia?`${src.biografia}${src.integrantes?'\n\nIntegrantes documentados: '+src.integrantes:''}${src.genero_pie||src.ciudad_pie?'\n\nClasificación histórica: '+[src.genero_pie,src.ciudad_pie].filter(Boolean).join(' · '):''}`:(src.publicaciones??[]).map((p:any)=>`${p.titulo??p.titulo_fuente}${p.anio||p.anio_fuente?' ('+(p.anio??p.anio_fuente)+')':''}${p.tipo?' — '+p.tipo:''}${p.produccion?'\nProducción: '+p.produccion:''}`).join('\n\n');
    await doc(ctx,id!,TAG+':'+caseKey,'biography',`Historia de ${c.name}`,content,src.evidencia??src.publicaciones?.[0]?.evidencia??{},['biografia-historica'],{caseKey,promptHash:r.promptHash});
    if(r.conflicts?.length){await doc(ctx,id!,TAG+':conflicts:'+caseKey,'other',`Datos por contrastar — ${c.name}`,r.conflicts.map((x:any)=>`${x.field}\nDato conservado: ${x.current??'sin dato'}\nAfirmación del archivo: ${x.source}\nCita: ${x.quote}`).join('\n\n'),src.evidencia??{},['conflicto-documentado']);log('conflictos',{key:caseKey,artistId:id,conflicts:r.conflicts});}
    for(const m of r.members??[]){
     if(!m.role||!m.quote||!key(JSON.stringify(src)).includes(key(m.name)))continue;
     const existing=(await ctx.client.query(`SELECT p.id FROM public.artist_members am JOIN public.persons p ON p.id=am.person_id WHERE am.artist_id=$1 AND lower(p.name)=lower($2)`,[id,m.name])).rows[0];
     if(existing)continue;
     await ctx.client.query('SAVEPOINT member');
     try{const pid=await person(ctx,m.name);if(pid){const rel=await createRelation(ctx,'artist_membership',{artistId:id!,personId:pid},{role:m.role,is_current:false});if(rel.created)inc('memberships_created');}}
     catch(e){await ctx.client.query('ROLLBACK TO SAVEPOINT member');log('miembros-revision',{artistId:id,...m,error:String(e)});}
     await ctx.client.query('RELEASE SAVEPOINT member');
    }
    for(const e of r.events??[]){
     if(!e.year||!String(e.quote).includes(String(e.year)))continue;
     const date=exactDate(e.date,e.quote);const epkey=TAG+':'+caseKey+':'+hash(key(e.title)+e.year).slice(0,14);
     await saveEphemeris(ctx,{key:epkey,title:`${c.name}: ${e.title}`,description:e.description,date,year:e.year,dateNote:date?null:'El archivo documenta el año; no se asigna día ni mes.',place:e.place??r.city??'',subject:c.name,originalArtistId:id!,status:date?'verified':'pending',sources:[{title:src.evidencia?'Musica.com.ve — archivo histórico':'Archivo musical venezolano',url:src.evidencia?.wayback??src.evidencia?.url??src.publicaciones?.[0]?.evidencia?.wayback??'https://web.archive.org/'}]});inc(date?'ephemerides_verified':'ephemerides_partial');
    }
    return id;
   });
   mapping[caseKey]=result.result!;index(c.name,result.result!);writeFileSync(join(O,'artistas-aplicados.json'),JSON.stringify(mapping,null,2));log('aplicaciones',{phase,key:caseKey,id:result.result,runId:result.runId});
  }catch(e){log('errores-aplicacion',{phase,key:caseKey,error:String(e)});}
 }
}
if(phase==='gallery'){
 const inspection=new Map(rows(O,'imagenes-inspeccionadas').map(r=>[r.key,r]));
 for(const r of rows(O,'imagenes-localizadas')){
  const id=artistId(r.banda);if(!id){log('imagenes-sin-artista',{...r,reason:'Identidad sin resolver'});continue;}
  const v=inspection.get(r.key);if(!v){log('imagenes-sin-inspeccion',{key:r.key});continue;}
  const previous=(await pool.query('SELECT g.id,g.category,a.logo_url FROM media.artist_gallery g JOIN public.artists a ON a.id=g.artist_id WHERE g.artist_id=$1 AND g.source_key=$2',[id,TAG+':image:'+r.sha256])).rows[0];
  if(previous&&(previous.category!=='logo'||previous.logo_url))continue;
  if(!existsSync(join('web/public/media',r.imageUrl.replace('/crv/media/',''))))throw new Error('Publicar primero los archivos multimedia: '+r.imageUrl);
  try{const result=await run('gallery',{artistId:id,source:r.url_imagen},async ctx=>{
   const category=r.obra?'related':v.category;
   const title=r.obra?`${r.obra} — material gráfico`:category==='logo'?`Logotipo de ${r.banda}`:category==='concert'?`${r.banda} en concierto`:category==='poster'?`Afiche — ${r.banda}`:`${r.banda} — imagen del archivo`;
   const date=v.date&&v.visibleText?exactDate(v.date,v.visibleText):null;
   const description=[v.description,r.obra?`Material gráfico de ${r.obra}.`:null,v.dateText?`Fecha escrita en la imagen: ${v.dateText}.`:null,'Procedencia: archivo Wayback; la fecha de captura no se atribuye a la imagen.'].filter(Boolean).join('\n\n');
   const inserted=await ctx.client.query(`INSERT INTO media.artist_gallery(artist_id,image_url,category,title,description,photo_date,location,source_key,source_url,tags,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(artist_id,source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`,
    [id,r.imageUrl,category,title,description,date,v.location,TAG+':image:'+r.sha256,r.url_imagen,[TAG,category],JSON.stringify({originalPath:r.archivo,sha256:r.sha256,width:r.width,height:r.height,inspection:v,sourcePage:r.evidencia_ficha??null})]);
   if(inserted.rowCount)inc('gallery_images');
   if(category==='logo'){
    const a=(await ctx.client.query('SELECT logo_url FROM public.artists WHERE id=$1',[id])).rows[0];
    if(!a.logo_url){await updateEntity(ctx,'artist',id,{logo_url:r.imageUrl});inc('logos_completed');}
   }
  });log('aplicaciones',{phase,key:r.key,artistId:id,runId:result.runId});}catch(e){log('errores-aplicacion',{phase,key:r.key,error:String(e)});}
 }
}
if(phase==='publications'){
 const albums=(await pool.query('SELECT * FROM public.albums')).rows;const byId=new Map(albums.map(a=>[Number(a.id),a]));
 const byTitle=new Map<string,Set<number>>();
 const addAlbum=(id:number,aid:number,title:string)=>{const k=aid+':'+key(title);if(!byTitle.has(k))byTitle.set(k,new Set());byTitle.get(k)!.add(id);};
 for(const a of albums)addAlbum(Number(a.id),Number(a.artist_id),a.title);
 for(const a of (await pool.query('SELECT album_id,alias FROM ingest.album_aliases')).rows){const album=byId.get(Number(a.album_id));if(album)addAlbum(Number(a.album_id),Number(album.artist_id),a.alias);}
 const orgs=(await pool.query('SELECT id,name FROM public.organizations')).rows;const orgIndex=new Map<string,number[]>();
 for(const x of orgs)orgIndex.set(key(x.name),[...(orgIndex.get(key(x.name))??[]),Number(x.id)]);
 async function organization(ctx:OperatorContext,name:string):Promise<number|null>{
  const found=orgIndex.get(key(name))??[];if(found.length===1)return found[0]!;if(found.length>1)return null;
  const r=await createEntity(ctx,'organization',{name,organization_type:'label'},{allowSimilar:true});orgIndex.set(key(name),[r.id]);inc('labels_created');return r.id;
 }
 async function credit(ctx:OperatorContext,albumId:number,name:string,role:string,type:string,trackId?:number){
  name=name.trim().replace(/\s+Booklet\b.*$/iu,'').replace(/[.;]+$/,'');if(!name||/https?:|www\.|©|^s\/?i$|desconocido|sin inform/i.test(name))return;
  const artist=artistId(name);let pid:number|null=null;let organizationId:number|null=null;
  if(!artist){const org=orgIndex.get(key(name))??[];if(org.length===1)organizationId=org[0]!;else pid=await person(ctx,name);}
  if(!artist&&!pid&&!organizationId){log('creditos-revision',{albumId,trackId,name,role,reason:'Autor ambiguo o alias sin vínculo documentado; conservado en el documento.'});return;}
  const result=await createRelation(ctx,trackId?'track_credit':'album_credit',{...(trackId?{trackId}:{albumId}),...(artist?{artistId:artist}:pid?{personId:pid}:organizationId?{organizationId}:{})},{credit_type:type,credit_role:role});
  if(result.created)inc(trackId?'track_credits_created':'album_credits_created');
 }
 const mapType=(types:string[])=>{
  const t=types.join(' ').toLowerCase();return /sencillo/.test(t)?'single':/ep/.test(t)?'ep':/recopila/.test(t)?'compilation':/soundtrack|banda sonora/.test(t)?'soundtrack':/demo/.test(t)?'demo':/álbum en vivo|album en vivo/.test(t)?'live_album':/álbum|album/.test(t)?'studio_album':'other';
 };
 const gallery=rows(S,'galeria-obras-cotejadas');
 for(const r of gallery){
  const aid=r.artist_ids_candidatos?.length===1&&!excluded.has(r.artist_ids_candidatos[0])?r.artist_ids_candidatos[0]:artistId(r.artista_fuente);if(!aid){log('publicaciones-revision',{source:'galeria',artista:r.artista_fuente,titulo:r.titulo_fuente,reason:'Artista sin identidad resuelta'});continue;}
  const skey=TAG+':galeria:'+hash(key(r.artista_fuente)+':'+key(r.titulo_fuente)).slice(0,24);
  if((await pool.query('SELECT id FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2',[aid,skey])).rowCount)continue;
  const ids=[...(byTitle.get(aid+':'+key(r.titulo_fuente))??[])];let albumId=ids.length===1?ids[0]!:null;
  const kinds=r.tipos_en_fuente.map((v:string)=>mapType([v]));const typeConflict=new Set(kinds).size>1&&!r.tipos_en_fuente.every((s:string)=>/recopila|soundtrack/i.test(s));
  const yearConflict=r.anios_en_fuente.length>1;
  try{const result=await run('publication',{artistId:aid,source:r.evidencia,sourceKey:skey},async ctx=>{
   if(ids.length<=1&&!typeConflict&&!yearConflict&&!albumId){
    const type=mapType(r.tipos_en_fuente);const year=Number(r.anio_fuente)||null;
    const created=await createEntity(ctx,'album',{title:r.titulo_fuente,album_type:type,release_year:year,description:`${r.titulo_fuente}, de ${r.artista_fuente}. Publicación documentada como ${r.campos.tipo.toLowerCase()}${year?' de '+year:''}.`},{artistId:aid,allowSimilar:true});albumId=created.id;inc('albums_created');
   }
   const text=`Artista: ${r.artista_fuente}\nObra: ${r.titulo_fuente}\nAños indicados: ${r.anios_en_fuente.join(', ')}\nTipos indicados: ${r.tipos_en_fuente.join(' · ')}\n\n${r.creditos_literales_variantes.join('\n\n')}`;
   const current=albumId?(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0]:null;
   const dateConflict=current?.release_year&&Number(current.release_year)!==Number(r.anio_fuente);
   const conflict=typeConflict||yearConflict||ids.length>1||dateConflict;
   await doc(ctx,aid,skey,'discography',`${r.titulo_fuente} — documentación gráfica`,text+(dateConflict?`\n\nFecha del catálogo: ${current.release_year}. La diferencia de fechas queda pendiente de distinguir edición y lanzamiento original.`:''),r.evidencia,['discografia','creditos-graficos',...(conflict?['conflicto-documentado']:[])],{albumId,evidences:r.evidencias,conflict:!!conflict});
   if(!albumId)return null;
   if(conflict)log('publicaciones-conflicto',{albumId,artistId:aid,source:r.evidencia,titulo:r.titulo_fuente,currentYear:current?.release_year,sourceYears:r.anios_en_fuente,sourceTypes:r.tipos_en_fuente});
   const credits=new Set<string>();
   for(const fields of r.variantes_campos){for(const [role,value] of Object.entries(fields)){
    if(role==='tipo'||typeof value!=='string'||!value.trim())continue;
    for(const name of value.split(/\s+y\s+|\s+&\s+|,\s*/u)){
     const k=key(role+name);if(credits.has(k))continue;credits.add(k);
     await ctx.client.query('SAVEPOINT credit');try{await credit(ctx,albumId,name,role,/foto/i.test(role)?'photography':'artwork');}catch(e){await ctx.client.query('ROLLBACK TO SAVEPOINT credit');log('creditos-revision',{albumId,name,role,error:String(e)});}await ctx.client.query('RELEASE SAVEPOINT credit');
    }
   }}
   if(!current.cover_url){
    const picture=rows(O,'imagenes-localizadas').find(p=>p.obra===r.titulo_fuente&&key(p.banda)===key(r.artista_fuente)&&!/(?:contraportada|interna|interior|\bCD\b)/i.test(p.archivo));
    if(picture){await updateEntity(ctx,'album',albumId,{cover_url:picture.imageUrl});inc('covers_completed');}
   }
   // Añadir características explícitas sin ocultar las clasificaciones existentes.
   if(!typeConflict)for(const classification of [...new Set(r.tipos_en_fuente.flatMap((t:string)=>[...(/en vivo/i.test(t)?['Live Album']:[]),...(/soundtrack/i.test(t)?['Soundtrack']:[])]))]){
    await ctx.client.query(`INSERT INTO ingest.album_classifications(album_id,classification,position,inferred) SELECT $1,$2,coalesce(max(position),0)+1,false FROM ingest.album_classifications WHERE album_id=$1 ON CONFLICT(album_id,classification) DO NOTHING`,[albumId,classification]);
   }
   return albumId;
  });if(result.result){addAlbum(result.result,aid,r.titulo_fuente);log('publicaciones-aplicadas',{source:'galeria',albumId:result.result,artistId:aid,runId:result.runId});}}
  catch(e){log('errores-aplicacion',{phase,source:'galeria',title:r.titulo_fuente,error:String(e)});
   if(String(e).includes('pertenece a Audiovisuales'))await run('publication-conflict',{artistId:aid},ctx=>doc(ctx,aid,skey,'discography',`${r.titulo_fuente} — publicación por contrastar`,`La Galería del Rock documenta esta obra como ${r.campos.tipo}, con año ${r.anio_fuente}. El catálogo conserva una obra audiovisual con ese título. Se requiere distinguir una edición musical independiente antes de crear un disco.\n\n${r.creditos_literales_variantes.join('\n')}`,r.evidencia,['conflicto-documentado','publicacion-musical-por-contrastar'],{albumId:null}));
  }
 }
 const lae=rows(S,'lae-discografia-cotejada');
 const special:Record<string,number>={'Paramo Pictures: Alma EP':630,'Paramo Pictures: Vida EP':655,'Paramo Pictures: Sentido EP':654,'música para los apostoles madres':176};
 for(const r of lae){
  const aid=artistId(r.artista_fuente);if(!aid){log('publicaciones-revision',{source:'LAE',artista:r.artista_fuente,titulo:r.titulo_fuente,reason:'Identidad pendiente'});continue;}
  const title=r.titulo_fuente.startsWith('naif EP:')?'Naif':r.titulo_fuente;const skey=TAG+':lae:'+hash(key(r.artista_fuente)+':'+key(title)).slice(0,24);
  if((await pool.query('SELECT id FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2',[aid,skey])).rowCount)continue;
  const ids=[...(byTitle.get(aid+':'+key(title))??[])];let albumId=special[r.titulo_fuente]??(ids.length===1?ids[0]!:null);
  try{const result=await run('label-publication',{artistId:aid,source:r.evidencia,sourceKey:skey},async ctx=>{
   const labelName=/Microbio/i.test(r.sello)?'Microbio Records':'Los Andes Electrónicos';const label=await organization(ctx,labelName);
   if(!albumId){
    const created=await createEntity(ctx,'album',{title,album_type:/\bEP\b/i.test(r.titulo_fuente)||title==='ways'?'ep':'other',release_year:Number(r.anio_fuente)||null,release_date_text:r.fecha_literal,...(label?{label_id:label}:{}),...(r.codigo_catalogo?{catalog_id:r.codigo_catalogo}:{}),description:`${title}, de ${r.artista_fuente}. Publicación documentada por ${labelName}.`},{artistId:aid,allowSimilar:true});albumId=created.id;inc('albums_created');
   }else{
    const a=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];const fields:any={};
    if(!a.label_id&&label)fields.label_id=label;if(!a.catalog_id&&r.codigo_catalogo)fields.catalog_id=r.codigo_catalogo;if(!a.release_date_text&&(!a.release_year||Number(a.release_year)===Number(r.anio_fuente)))fields.release_date_text=r.fecha_literal;
    if(Object.keys(fields).length){await updateEntity(ctx,'album',albumId,fields);inc('albums_enriched');}
    if(a.release_year&&Number(a.release_year)!==Number(r.anio_fuente))log('publicaciones-conflicto',{albumId,source:'LAE',currentYear:a.release_year,sourceYear:r.anio_fuente,sourceUrl:r.evidencia.wayback});
   }
   await doc(ctx,aid,skey,'discography',`${title} — documentación del sello`,`Fecha indicada: ${r.fecha_literal}\nSello: ${r.sello}\nCódigo: ${r.codigo_catalogo||'no indicado'}\nProducción: ${r.produccion}\n\n${r.pistas.map((t:any)=>`${t.numero}. ${t.texto_creditos}`).join('\n')}`,r.evidencia,['discografia','fuente-primaria'],{albumId});
   if(r.codigo_catalogo&&!(await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=$1 AND catalog_number=$2',[albumId,r.codigo_catalogo])).rowCount){
    await ctx.client.query(`INSERT INTO ingest.album_versions(album_id,position,title,format,catalog_number,release_year,notes,source,source_ref,run_id) SELECT $1,coalesce(max(position),0)+1,$2,$3,$4,$5,$6,$7,$8,$9 FROM ingest.album_versions WHERE album_id=$1`,[albumId,'Edición documentada por Los Andes Electrónicos',r.codigo_catalogo.endsWith('CD')?'CD':r.codigo_catalogo.endsWith('MP3')?'Digital':null,r.codigo_catalogo,Number(r.anio_fuente),'Fecha y código transcritos del catálogo del sello; no sustituyen automáticamente la fecha de lanzamiento original.',TAG,r.evidencia.wayback,ctx.runId]);inc('documented_editions');
   }
   for(const t of r.pistas){
    const raw=String(t.texto_creditos);let piece=raw.split(/\s+(?:letras?|música|producido)\s*(?:por\s*)?:/iu)[0]!.trim();let performer:string|null=null;
    if(/Paramo Pictures:/.test(r.titulo_fuente)){const split=piece.split(' - ');piece=split[0]!.trim();performer=split.slice(1).join(' - ').trim()||null;}
    else if(r.titulo_fuente==='venus mixes'){const split=piece.split(' - ');performer=split.pop()!.trim();piece=split.join(' - ').trim();}
    const occupied=(await ctx.client.query('SELECT id,title FROM public.tracks WHERE album_id=$1 AND disc_number=1 AND track_number=$2',[albumId,t.numero])).rows[0];let tid:number|undefined;
    if(occupied){if(key(occupied.title)===key(piece))tid=Number(occupied.id);else{log('pistas-conflicto',{albumId,number:t.numero,catalogTitle:occupied.title,sourceTitle:piece,raw});continue;}}
    else {const tr=await createEntity(ctx,'track',{title:piece,track_number:t.numero,disc_number:1},{albumId,allowSimilar:true});tid=tr.id;inc('tracks_created');}
    if(performer){await ctx.client.query('SAVEPOINT trackcredit');try{await credit(ctx,albumId,performer,r.titulo_fuente==='venus mixes'?'Remezcla':'Intérprete',r.titulo_fuente==='venus mixes'?'mixing':'musician',tid!);}catch(e){await ctx.client.query('ROLLBACK TO SAVEPOINT trackcredit');log('creditos-revision',{albumId,trackId:tid,name:performer,error:String(e)});}await ctx.client.query('RELEASE SAVEPOINT trackcredit');}
   }
   const prod=r.produccion==='dlp'?'dioslepague':r.produccion==='l.garnica'?'Garnica':r.produccion;
   if(r.artista_fuente!=='sebas&charles')for(const name of prod.split(/\s+y\s+|\s+&\s+/i)){
    await ctx.client.query('SAVEPOINT producer');try{await credit(ctx,albumId,name,'Producción','producer');}catch(e){await ctx.client.query('ROLLBACK TO SAVEPOINT producer');log('creditos-revision',{albumId,name,error:String(e)});}await ctx.client.query('RELEASE SAVEPOINT producer');
   }
   return albumId;
  });if(result.result){addAlbum(result.result,aid,title);log('publicaciones-aplicadas',{source:'LAE',albumId:result.result,artistId:aid,runId:result.runId});}}
  catch(e){log('errores-aplicacion',{phase,source:'LAE',title,error:String(e)});}
 }
}
if(phase==='credits'){
 const source=rows(O,'creditos-revision');const seen=new Set<string>();
 for(const r of source){
  if(!r.error?.includes('credit_role obligatorio'))continue;
  const name=String(r.name).replace(/\s+Booklet\b.*$/iu,'').trim().replace(/[.;]+$/,'');if(!name)continue;
  const role=r.role??(r.trackId?(r.albumId===437?'Remezcla':'Intérprete'):'Producción');
  const type=/foto/i.test(role)?'photography':/diseñ|arte|ilustr|concept|direcci[oó]n/i.test(role)?'artwork':/remezcla/i.test(role)?'mixing':/producci/i.test(role)?'producer':'musician';
  const k=[r.albumId,r.trackId??'',key(name),type].join(':');if(seen.has(k))continue;seen.add(k);
  try{const result=await run('credit',{albumId:r.albumId,trackId:r.trackId,name},async ctx=>{
   const album=(await ctx.client.query('SELECT artist_id FROM public.albums WHERE id=$1',[r.albumId])).rows[0];
   const candidate=artistId(name);const aid=candidate&&(!['artwork','photography'].includes(type)||candidate===Number(album.artist_id))?candidate:null;
   const pid=aid?null:await person(ctx,name);if(!aid&&!pid){log('creditos-aun-ambiguos',{...r,name,role,type});return;}
   const rel=await createRelation(ctx,r.trackId?'track_credit':'album_credit',{...(r.trackId?{trackId:r.trackId}:{albumId:r.albumId}),...(aid?{artistId:aid}:{personId:pid!})},{credit_type:type,credit_role:role});
   if(rel.created)inc(r.trackId?'track_credits_created':'album_credits_created');
  });log('creditos-aplicados',{albumId:r.albumId,trackId:r.trackId,name,role,type,runId:result.runId});}
  catch(e){log('errores-aplicacion',{phase,albumId:r.albumId,name,error:String(e)});}
 }
}
if(phase==='documents'){
 const aliases=new Map<number,string[]>();for(const a of (await pool.query('SELECT artist_id,alias FROM ingest.artist_aliases')).rows){const id=Number(a.artist_id);aliases.set(id,[...(aliases.get(id)??[]),a.alias]);}
 for(const r of rows(O,'documentos-extraidos')){
  for(const i of r.items){
   if(excluded.has(i.artistId))continue;
   const art=artists.get(i.artistId);if(!art)continue;
   const labels=[art.name,...(aliases.get(i.artistId)??[])].filter((s:string)=>key(s).length>=4);
   const inQuote=labels.some((n:string)=>key(i.quote).includes(key(n)));
   const inTitle=labels.some((n:string)=>key(i.title).includes(key(n)));
   if(!inQuote&&!inTitle){log('documentos-revision',{key:r.key,item:i,reason:'La cita y el título no sustentan el artista seleccionado.'});continue;}
   // Un índice de enlaces no duplica las entrevistas completas que conserva la campaña.
   if(/\/entrevistas\.asp$/.test(r.source.url)&&i.category==='interview')continue;
   const category=i.category==='interview'&&!inTitle?'article':i.category;
   const skey=TAG+':document:'+r.key+':'+i.artistId+':'+hash(key(i.title)).slice(0,12);
   try{const result=await run('document',{artistId:i.artistId,source:r.source},async ctx=>{
    await doc(ctx,i.artistId,skey,category,i.title,i.content,{url:r.source.url,wayback:r.source.archiveUrl,archivo:r.source.file,snapshot:r.source.snapshotDeclared,cita:i.quote},[category,...(i.category==='interview'&&!inTitle?['entrevista-relacionada']:[])],{dateText:i.dateText,location:i.location,promptHash:r.promptHash});
   });log('documentos-aplicados',{artistId:i.artistId,category,title:i.title,sourceKey:skey,runId:result.runId});}catch(e){log('errores-aplicacion',{phase,key:r.key,error:String(e)});}
  }
 }
 // Intervalo explícito que el extractor de años puntuales había apartado.
 const compact=rows(S,'paginas-compactas');const held=compact.find(d=>d.site==='lagaleriadelrock'&&/Tristeza Poptimista/i.test(d.texto)&&/2013\s*[-–]\s*2014/.test(d.texto)&&d.url.includes('/portfolio/'));
 const carlos=artistId('Carlos Angola');
 if(held&&carlos)await run('document',{artistId:carlos},ctx=>doc(ctx,carlos,TAG+':tristeza-poptimista-intervalo','discography','Tristeza Poptimista — fecha expresada como intervalo',held.texto.split('Artista:').slice(1).join('Artista:').split('Otras obras')[0]??held.texto,{url:held.url,wayback:'https://web.archive.org/web/'+held.ts+'/'+held.url},['discografia','fecha-parcial'],{dateText:'2013–2014'}));
}
if(phase==='genres'){
 const slugs:Record<string,string>={Rock:'rock',Punk:'punk',Ska:'ska',HipHop:'hip-hop',Reggae:'reggae'};
 const available=new Set((await pool.query('SELECT slug FROM ingest.genres WHERE active')).rows.map(r=>r.slug));
 for(const c of cases.values()){
  const id=mapping[c.key];const slug=slugs[c.source.genero_pie];if(!id||!slug||!available.has(slug))continue;
  // Una clasificación general del directorio no sustituye decisiones más precisas.
  if((await pool.query("SELECT 1 FROM ingest.artist_genres WHERE artist_id=$1 AND status IN ('confirmed','rejected') AND decision_rule<>'derived_from_albums' LIMIT 1",[id])).rowCount)continue;
  try{await run('genre',{artistId:id},async ctx=>{await confirmGenre(ctx.client,{kind:'artist',entityId:id,genreSlug:slug,actor:'codex',reason:`Clasificación explícita del directorio histórico Musica.com.ve: ${c.source.genero_pie}. ${c.source.evidencia?.wayback??''}`,runId:ctx.runId,role:'primary'});inc('genres_completed');});}catch(e){log('generos-revision',{artistId:id,genre:slug,error:String(e)});}
 }
}
if(phase==='thinkok'){
 const D=rows(S,'thinkok-compilado-documentos');const credits=D.find(d=>d.url.endsWith('/creditos.htm'));const mp3=D.find(d=>d.url.endsWith('/mp3s.htm'));const bandDoc=D.find(d=>d.url.endsWith('/bandas.htm'));
 const tracks=(await pool.query('SELECT id,track_number,title FROM public.tracks WHERE album_id=640 ORDER BY track_number')).rows;
 // Tres títulos publicados por el editor coinciden con las posiciones de Vol. 1, no Vol. 2.
 if(tracks.length!==17||key(tracks[1]?.title??'')!=='sepia'||key(tracks[13]?.title??'')!=='respiro'||!key(tracks[15]?.title??'').endsWith('suena'))throw new Error('El repertorio del compilado no coincide: no aplicar la corrección.');
 const lineup=['Fray','Subconsciente?','Metempsicosis','Nación Prozak','Factor Mental','K.F.D.','Biophobia','Stridor Stupor','Sunú','Candy 66','Parkas','Subsonus','Liqüet','Ricochet','Despuésdevieja','BigBang Altanero','Invytro'];
 const result=await run('thinkok',{artistId:257,albumId:640,source:credits.evidencia},async ctx=>{
  await updateEntity(ctx,'album',640,{release_year:2003,release_date_text:'13 de febrero de 2003'});inc('album_dates_corrected');
  await doc(ctx,257,TAG+':thinkok-vol1','discography','Rock: El Compilado Vol. 1 — documentación del editor',credits.texto+'\n\n'+mp3.texto,credits.evidencia,['discografia','fecha-contrastada','fuente-primaria'],{albumId:640,identityEvidence:'17 posiciones, Sepia nº2, Respiro nº14 y Suena nº16 distinguen Vol. 1 de Vol. 2.'});
  for(const [name,role,type] of [['Marco J. Riverol','Producción general','producer'],['Lisbeth Rodríguez','Producción general','producer'],['Mariliz Bettiol','Producción general','producer'],['Mariliz Bettiol','Fotografía','photography'],['Marco J. Riverol','Diseño gráfico','artwork'],['Zuleyma Monagas','Modelo','other']]){
   const pid=await person(ctx,name!);if(pid){const r=await createRelation(ctx,'album_credit',{albumId:640,personId:pid},{credit_type:type!,credit_role:role!});if(r.created)inc('album_credits_created');}
  }
  for(let n=0;n<lineup.length;n++){const id=artistId(lineup[n]!);if(!id)continue;const r=await createRelation(ctx,'track_credit',{trackId:Number(tracks[n].id),artistId:id},{credit_type:'musician',credit_role:'Intérprete'});if(r.created)inc('track_credits_created');
   await doc(ctx,id,TAG+':thinkok-lineup:'+n,'discography','Participación en Rock: El Compilado',`El editor documenta la participación de ${lineup[n]} en la posición ${n+1}.\n\n${bandDoc.texto}`,bandDoc.evidencia,['compilacion','fuente-primaria'],{albumId:640});}
  await saveEphemeris(ctx,{key:TAG+':thinkok-2003',title:'Rock: El Compilado, en circulación',description:'Think ok! Records anuncia la circulación de Rock: El Compilado desde el 13 de febrero. Los créditos del editor lo sitúan en febrero de 2003. El repertorio identifica el volumen 1.',date:'2003-02-13',year:2003,dateNote:null,place:'Venezuela',subject:'Rock: El Compilado Vol. 1',originalArtistId:257,status:'verified',sources:[{title:'Créditos del editor: febrero de 2003',url:credits.evidencia.wayback},{title:'MP3 y anuncio de circulación desde el 13 de febrero',url:mp3.evidencia.wayback}]});inc('ephemerides_verified');
 });log('aplicaciones',{phase,albumId:640,runId:result.runId});
}
writeFileSync(join(O,`resultado-${phase}.json`),JSON.stringify(counters,null,2));console.log(counters);await closeDb();
