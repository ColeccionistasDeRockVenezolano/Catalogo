/** Suplemento autorizado: decisiones contrastadas, operador nativo y procedencia íntegra. */
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun,createEntity,updateEntity,createRelation,deleteRelation,deleteEntity,type OperatorContext} from '../../src/merge/operator.js';
import {previewEntityMerge,mergeEntities} from '../../src/merge/entity-merge.js';
import {WAYBACK_ARCHIVE_TAG as TAG} from '../../src/shared/artist-documents.js';
import {saveEphemeris} from '../../src/catalog/ephemerides.js';
import {createAlias} from '../../src/api/repositories/aliases.js';
import {previewAlbumMerge,mergeAlbums} from '../../src/merge/album-merge.js';
const O=process.env['WAYBACK_OUT'];if(!O)throw new Error('WAYBACK_OUT obligatorio');
const phase=process.argv[2];const pool=getPool();
const load=(name:string)=>JSON.parse(readFileSync(O+'/'+name+'.json','utf8'));
const rows=(file:string):any[]=>readFileSync(file,'utf8').split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x));
const log=(name:string,r:any)=>appendFileSync(O+'/'+name+'.jsonl',JSON.stringify(r)+'\n');
const key=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
const state:any=existsSync(O+'/applied-state.json')?load('applied-state'):{artists:{},publications:{}};
const redirect:Record<number,number>={1696:6806,2856:2794,118:4586,2229:101};
const canonical=(id:number)=>redirect[id]??id;
const plan=load('plan');
async function run(label:string,params:any,work:(ctx:OperatorContext)=>Promise<any>){
 try{const result=await withOperatorRun({name:'wayback-restantes:'+label,operator:'codex',note:'Brian autorizó aprovechar toda la información restante e investigar lo necesario. Decisión con fuentes y comparación de identidad conservadas en el suplemento.',params:{campaign:TAG,supplement:plan.supplement,...params}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);return work(ctx);
 });log('aplicaciones',{phase,label,...params,runId:result.runId,result:result.result});return result.result;
 }catch(e){log('errores',{phase,label,...params,error:String(e)});console.error(label,String(e));return null;}
}
const scrub=(s:string)=>s.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,'[contacto histórico omitido]');
async function doc(ctx:OperatorContext,aid:number,slug:string,category:string,title:string,content:string,e:any={},tags:string[]=[],metadata:any={}){
 const sk=TAG+':restantes:'+slug;
 const old=(await ctx.client.query('SELECT id FROM media.artist_documents WHERE artist_id=$1 AND source_key=$2',[aid,sk])).rows[0];if(old){
  if(slug.startsWith('credits:'))await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=metadata||$4::jsonb,updated_at=now() WHERE id=$1',[old.id,scrub(content),[TAG,'recuperacion-restantes',...tags],JSON.stringify(metadata)]);
  return Number(old.id);
 }
 const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,date_text,location,tags,metadata)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,[aid,sk,category,title,scrub(content),e.url??null,e.wayback??e.archiveUrl??null,metadata.dateText??null,metadata.location??null,[TAG,'recuperacion-restantes',...tags],JSON.stringify({supplement:plan.supplement,evidence:e,...metadata})]);return Number(r.rows[0].id);
}
if(phase==='identities'){
 const sources:Record<number,string[]>={
  1696:['https://lacreurecords.bandcamp.com/album/banco-insular-lp','https://revistaladosis.com/sr-presidente-el-banco-insular'],
  2856:['https://miguelnoya.com/','https://sincopa.com/new_age/artist_newage/miguel_noya.htm'],
  118:['https://roughtradepublishing.com/artist/joudy/','https://grungevenezuela.es.tl/Joudy-Ju-Entrevista.htm'],
  2229:['https://www.aboutgarnica.com/music/garnica','https://ra.co/news/19238','http://losandeselectronicos.net/english/index.html'],
 };
 for(const [drop,keep] of Object.entries(redirect)){
  const dropId=Number(drop);if(!(await pool.query('SELECT id FROM public.artists WHERE id=$1',[dropId])).rowCount)continue;
  const preview=await previewEntityMerge(pool,'artist',keep,dropId);writeFileSync(O+'/fusion-'+drop+'.json',JSON.stringify({preview,sources:sources[dropId]},null,2));
  await run('identity-merge',{keepId:keep,dropId,sources:sources[dropId],reason:'Coinciden repertorio, integrantes o titular y trayectoria documentada por fuente primaria.'},ctx=>mergeEntities(ctx,{kind:'artist',keepId:keep,dropId,previewHash:preview.previewHash,keepDropNameAsAlias:true,rewriteLater:false}));
 }
 for(const [slug,name,bio,kind,source] of [
  ['armando-alejandro','Armando y Alejandro','Dúo venezolano integrado por Armando Áñez, de Americania y Recordatorio, y Alejandro Sojo, de Los Colores. Publicó el sencillo «Cala» en 2014.','duo','https://www.ivoox.com/en/podcast-esto-si-suena_sq_f16450_15.html'],
  ['pachi-matamoro','Pachi Jiménez y los Matamoro Mackenzie','Proyecto del músico venezolano Pachi Jiménez acompañado por los Matamoro Mackenzie. Publicó el álbum «La Voz de los Perdedores» el 9 de junio de 2012, producido por Boston Rex y Max Martínez. Su grabación reúne aportes de músicos como Boston Rex, Chino Ágreda, Kike Franco, Juan Pablo Aroutine, Alfred Gómez Jr., Max Martínez y Vel France.','project','https://pachijimenez.bandcamp.com/'],
 ] as const){
  if(state.artists['new:'+slug])continue;
  const existing=(await pool.query('SELECT id FROM public.artists WHERE name=$1',[name])).rows;
  if(existing.length===1){state.artists['new:'+slug]=Number(existing[0].id);continue;}
  const result=await run('new-project',{name,source},ctx=>createEntity(ctx,'artist',{name,artist_type:kind,origin_country:'Venezuela',biography:bio},{allowSimilar:true}));
  if(result)state.artists['new:'+slug]=result.id;
  writeFileSync(O+'/applied-state.json',JSON.stringify(state,null,2));
 }
}
if(phase==='publications'){
 for(const item of plan.publications){
  const r=item.source,source=r.evidencia.url;const aids:number[]=item.artistIds.map((x:any)=>typeof x==='string'?state.artists[x]:canonical(x));if(aids.some(x=>!x))throw new Error('Falta proyecto '+r.artista_fuente);
  const albumId=await run('publication',{source,sourceArtist:r.artista_fuente,title:r.titulo_fuente},async ctx=>{
   let id=item.albumId??state.publications[source];
   if(!id&&item.create){
    // Una segunda referencia a la misma obra no crea otra edición por accidente.
    const title=r.titulo_fuente;const existing=(await ctx.client.query('SELECT id,title FROM public.albums WHERE artist_id=$1',[aids[0]])).rows.filter(a=>key(a.title)===key(title));
    if(existing.length===1)id=Number(existing[0].id);
    else if(!existing.length){const result=await createEntity(ctx,'album',{title,album_type:item.albumType,release_year:Number(r.anio_fuente)||null,description:`${title}. ${r.artista_fuente.startsWith('Varios.')?'Recopilación':r.artista_fuente}, documentado en el archivo de La Galería del Rock.`,notes:item.conflict?'La fuente presenta más de un tipo o fecha; consultar la documentación de la obra en Otros.':null},{artistId:aids[0]!,allowSimilar:true});id=result.id;}
   }
   for(const aid of aids)await doc(ctx,aid,'galeria:'+hash(source),'discography',r.titulo_fuente+' — archivo gráfico y créditos',`Artista o curador indicado: ${r.artista_fuente}\nObra: ${r.titulo_fuente}\nAño(s) de la fuente: ${r.anios_en_fuente.join(', ')}\nTipo(s) de la fuente: ${r.tipos_en_fuente.join(' · ')}\n\n${r.creditos_literales_variantes.join('\n\n')}${item.conflict?'\n\nSe conservan las variantes de la fuente. La fecha de grabación, publicación original y reedición requieren distinguirse.':''}`,r.evidencia,['discografia','creditos-graficos',...(item.conflict?['conflicto-documentado']:[])],{albumId:id??null,source:r,evidences:r.evidencias,relatedArtists:aids});
   return id??null;
  });
  if(albumId){state.publications[source]=albumId;writeFileSync(O+'/applied-state.json',JSON.stringify(state,null,2));}
 }
}
if(phase==='documents'){
 const exp=rows('reports/wayback-incorporacion-2026-10-23/expedientes-documentos.jsonl');
 for(const r of plan.documents){
  const i=r.original.item,s=r.source;
  if(!r.artistIds.length){log('disposiciones',{kind:'document',title:i.title,source:s.url,status:'contexto-internacional-en-informe',reason:r.reason});continue;}
  for(const target of r.artistIds){const aid=canonical(target);await run('document',{artistId:aid,originalArtistId:i.artistId,title:i.title,source:s.url},ctx=>{
   let content=i.content;
   if(s.url.endsWith('/fideld.htm')&&i.category==='interview'){
    const original=exp.find(e=>e.key===r.original.key)!;content='Entrevista histórica a Fidel Nadal realizada en Caracas. Las respuestas se presentan como declaraciones del entrevistado.\n\n'+original.text;
   }
   if(i.category==='event'&&i.title.startsWith('Anuncio'))content+='\n\nSe conserva como anuncio, sin afirmar que el concierto se celebró. El archivo también conserva un comentario atribuido a Devaluados que cuestiona haber sido informado de su participación.';
   return doc(ctx,aid,'document:'+r.original.key+':'+hash(i.title),'interview'===i.category?'interview':i.category,i.title,content,{url:s.url,wayback:s.archiveUrl,cita:i.quote},[i.category,'atribucion-revisada',...(i.artistId!==aid?['contexto-relacionado']:[])],{dateText:i.dateText,location:i.location,identityDecision:r.reason,originalArtistId:i.artistId});
  });}
 }
 // La ficha de Zion se identifica por Maracay y Valentino Thompson; no se adjudica al homónimo pop rock.
 const cases=rows('reports/wayback-incorporacion-2026-10-23/expedientes-artistas.jsonl');
 for(const [name,id] of [['Zion',1529],['Mind Shelter',2554]] as const){const c=cases.find(c=>c.name===name)!;
  await run('historical-identity-document',{artistId:id,source:c.source.evidencia},ctx=>doc(ctx,id,'identity:'+id,'biography',name+' — ficha histórica del directorio',c.source.biografia+'\n\nIntegrantes citados en el archivo: '+c.source.integrantes+(id===1529?'\n\nEl archivo sitúa su nacimiento en 1998; el catálogo conserva 1996. Se mantiene la diferencia sin sustituirla por una fecha elegida arbitrariamente.':'\n\nLa fuente sitúa la banda en Holanda y documenta miembros venezolanos. Se conserva su país de origen y la decisión editorial vigente de exclusión.'),c.source.evidencia,['biografia-historica',id===1529?'conflicto-fecha-formacion':'vinculo-venezolano'],{editorialHidden:id===2554,scopeDecision:id===2554?'Conservar evidencia sin levantar exclusión editorial.':null}));
 }
}
if(phase==='members'){
 for(const r of plan.members){
  if(r.decision==='document-only'){log('disposiciones',{kind:'member',...r,status:'conservado-en-biografia-y-documento',reason:'Nombre incompleto o ampliación no presente literalmente; no crear persona ni vincular homónimo.'});continue;}
  if(r.personId){log('disposiciones',{kind:'member',artistId:r.artistId,name:r.name,personId:r.personId,status:'ya-incluido-con-variante-documentada',evidence:r.evidence});continue;}
  await run('membership',{artistId:r.artistId,name:r.name,source:r.evidence,quote:r.quote,decision:r.decision},async ctx=>{
   let pid=r.personId;
   if(!pid){
    const exact=(await ctx.client.query('SELECT id,name FROM public.persons')).rows.filter(p=>key(p.name)===key(r.name));
    if(exact.length)throw new Error('La identidad cambió: cotejar persona existente '+r.name);
    pid=(await createEntity(ctx,'person',{name:r.name,notes:`Integrante histórico de ${r.artistName}, documentado como ${r.role}. ${r.evidence?.wayback??''}`},{allowSimilar:true})).id;
   }
   return createRelation(ctx,'artist_membership',{artistId:r.artistId,personId:pid},{role:r.role,is_current:false,notes:`Formación histórica documentada en el archivo. No se infiere permanencia actual. ${r.evidence?.wayback??''}`});
  });
 }
}
if(phase==='credits'){
 const manual:Record<string,number>={masa:306,han:1654,hebertoaneznovoa:1654,hebertoaneznovoahan:1654,alaingomez:710,robertojimenez:595,parratoro:42350,controlpluszeta:42366,alfredofernandezcastilloctrlz:42366,floressolano:8793,albertofloressolano:8793,dioger:15547,loocila:42303,diegoblanco:17332,luishenriquez:16848,alvarocastillo:16466};
 const people=(await pool.query('SELECT id,name FROM public.persons')).rows;
 const aliases=(await pool.query('SELECT person_id id,alias name FROM ingest.person_aliases')).rows;
 const index=new Map<string,Set<number>>();for(const p of [...people,...aliases]){const k=key(p.name);if(!index.has(k))index.set(k,new Set());index.get(k)!.add(Number(p.id));}
 const orgs=(await pool.query('SELECT id,name FROM public.organizations')).rows;
 let n=0;
 const onlyAlbums=new Set((process.env['WAYBACK_ONLY_ALBUMS']??'').split(',').filter(Boolean).map(Number));
 for(const r of plan.credits.filter((r:any)=>!onlyAlbums.size||onlyAlbums.has(Number(r.albumId??state.publications[r.sourceUrl])))){
  const albumId=r.albumId??state.publications[r.sourceUrl];if(!albumId)continue;
  await run('graphic-credits',{albumId,source:r.sourceUrl},async ctx=>{
   const album=(await ctx.client.query('SELECT artist_id FROM public.albums WHERE id=$1',[albumId])).rows[0];
   const seen=new Set<string>();const resolved:any[]=[],held:any[]=[];
   for(const item of r.items){
    if(!item.names.length){held.push({literal:item.literal,reason:'Descripción de obra o contexto; no representa una persona completa.'});continue;}
    for(let name of item.names){
     name=String(name).replace(/\s+Booklet\b.*$/iu,'').replace(/\s*\.\s*Todas? las?\b.*$/iu,'').replace(/^pintura\s+.*?hecha por\s+/iu,'').trim();
     if(/publicidad/i.test(name))name=name.replace(/\s*\([^)]*\)\s*$/,'').trim();
     const nk=key(name),k=nk+':'+key(item.role);if(seen.has(k))continue;seen.add(k);
     const forceOrganization=['capadelluvia','dgcvestir','laagencialocal','nodocolectivografico'].includes(nk);
     let pid=manual[nk]??null,oid:number|null=null;
     const selfArtist=key(r.sourceArtist)===nk?Number(album.artist_id):null;
     const type=/foto/i.test(item.role)?'photography':/producci/i.test(item.role)?'producer':'artwork';
     const candidates=[...(index.get(nk)??[])];
     if(!pid&&!selfArtist&&!forceOrganization&&candidates.length){
      const context=(await ctx.client.query(`SELECT DISTINCT c.person_id FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id=ANY($1::bigint[]) AND c.credit_type=$2::credit_type AND (c.album_id=$3 OR a.artist_id=$4)`,[candidates,type,albumId,album.artist_id])).rows;
      if(context.length===1)pid=Number(context[0].person_id);
      else if(candidates.length===1)pid=candidates[0]!;
     }
     const organization=orgs.filter(o=>key(o.name)===nk);
     if(!pid&&!selfArtist&&organization.length===1)oid=Number(organization[0].id);
     if(!pid&&!oid&&!selfArtist&&(!candidates.length||forceOrganization)){
      const isOrganization=forceOrganization||/studio|films|designs|graphics|publicidad|records|^pinch point$|^melao$/i.test(name);
      const cleanPerson=name.split(/\s+/).length>=2&&name.length<80&&!/[:;/“”]|\b(?:diseño|diagramación|fotograf|concepto|vestuario|montaje|producción|portada|intervención|obra|booklet|logo|ilustraciones?|todas?|parte|serie|pintura|hecha)\b|\d/iu.test(name)&&(!name.includes('(')||name.includes(')'));
      await ctx.client.query('SAVEPOINT credited_entity');
      try{
       if(isOrganization){const entity=await createEntity(ctx,'organization',{name,organization_type:'other',notes:`Crédito gráfico de ${r.sourceTitle}; la fuente identifica la entidad con este nombre. ${item.url}`},{allowSimilar:true});oid=entity.id;orgs.push({id:String(oid),name});}
       else if(cleanPerson){const entity=await createEntity(ctx,'person',{name,notes:`Crédito documentado como ${item.role} en ${r.sourceTitle}. ${item.url}`},{allowSimilar:true});pid=entity.id;index.set(nk,new Set([pid]));}
      }catch(e){await ctx.client.query('ROLLBACK TO SAVEPOINT credited_entity');held.push({name,role:item.role,reason:String(e),source:item.url});}
      await ctx.client.query('RELEASE SAVEPOINT credited_entity');
     }
     if(!pid&&!oid&&!selfArtist){held.push({name,role:item.role,candidates,reason:'Alias o identidad sin vínculo suficiente; conservar crédito literal y enlaces de autor.',links:item.links,source:item.url});continue;}
     const relation=await createRelation(ctx,'album_credit',{albumId,...(pid?{personId:pid}:selfArtist?{artistId:selfArtist}:{organizationId:oid!})},{credit_type:type,credit_role:item.role,notes:`Crédito transcrito del párrafo original, sin absorber otros cargos. ${item.url}`});resolved.push({name,role:item.role,personId:pid,organizationId:oid,artistId:selfArtist,created:relation.created});
    }
   }
   await doc(ctx,Number(album.artist_id),'credits:'+hash(r.sourceUrl),'discography',r.sourceTitle+' — créditos del arte y la fotografía',r.items.map((x:any)=>x.literal).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i).join('\n\n'),{url:r.sourceUrl,wayback:r.items[0]?.url},['creditos-graficos','transcripcion-por-parrafos',...(held.length?['identidad-de-creditos-en-revision']:[])],{albumId,parsedCredits:r.items,resolvedCredits:resolved,unassignedCredits:held});
   log('creditos-resueltos',{albumId,source:r.sourceUrl,resolved,held});return {newCredits:resolved.filter(x=>x.created).length,resolved:resolved.length,held:held.length};
  });
  if(++n%30===0)console.log('credits',n,'/',plan.credits.length);
 }
 // Reparar los tres fragmentos restantes detectados al revisar todos los nombres creados.
 for(const id of [42305,42324,42333])await run('malformed-credit-cleanup',{personId:id},async ctx=>{
  const person=(await ctx.client.query('SELECT * FROM public.persons WHERE id=$1',[id])).rows[0];if(!person)return {alreadyAbsent:true};
  const credits=(await ctx.client.query('SELECT id,album_id,role FROM public.album_credits WHERE person_id=$1',[id])).rows;
  for(const credit of credits)await deleteRelation(ctx,'album_credit',Number(credit.id));
  await deleteEntity(ctx,'person',id);return {removed:person.name,credits};
 });
 await run('masa-name-correction',{personId:306,sources:['https://www.latingrammy.com/es/awards/categories/best-recording-package/2012/']},ctx=>updateEntity(ctx,'person',306,{real_name:'Miguel Vásquez'}));
}
if(phase==='additional'){
 const variants=[
  [6038,'Bronceador (lotion solaire)'],[6063,'Starsky'],[6069,'*24 ° SPF UV'],[6082,'Restaurarse a Fé'],
  [6639,'Estrellador (Sunset Remix)'],[5159,'Playa Venus - Beach Mix'],[5183,'Playa Venus - Bateros con Ahh! Mix'],[4645,'Fluorestattica'],
 ] as const;
 for(const [id,alias] of variants)await run('track-source-variant',{trackId:id,alias},async ctx=>{
  if((await ctx.client.query('SELECT id FROM ingest.track_aliases WHERE track_id=$1 AND alias=$2',[id,alias])).rowCount)return {alreadyIncluded:true};
  return createAlias(ctx,'track',id,{alias,aliasType:'source_variant',isPrimary:false});
 });
 for(const id of [630,655])await run('edition-track-order',{albumId:id},async ctx=>{
  const source=rows('reports/wayback-analisis-catalogo-2026-10-22/lae-discografia-cotejada.jsonl').find(r=>r.titulo_fuente===(id===630?'Paramo Pictures: Alma EP':'Paramo Pictures: Vida EP'));
  if(!source)throw new Error('Falta edición');
  return doc(ctx,257,'track-order:'+id,'discography',source.titulo_fuente+' — orden de la edición del sello','La edición documentada por Los Andes Electrónicos tiene este repertorio:\n\n'+source.pistas.map((t:any)=>`${t.numero}. ${t.texto_creditos}`).join('\n')+'\n\nSe conserva como repertorio de esta edición. No se trasladan automáticamente sus posiciones a un video ni se sustituyen canciones diferentes de otra lista.',source.evidencia,['edicion-documentada','orden-de-pistas-por-edicion'],{albumId:id,sourceEdition:source});
 });
 const aliases=[['person',42303,'Loocila','stage_name'],['person',16848,'Luis Henríquez','name_variant'],['person',42366,'controlpluszeta','stage_name']] as const;
 for(const [kind,id,alias,type] of aliases)await run('documented-alias',{kind,entityId:id,alias},async ctx=>{
  if((await ctx.client.query('SELECT id FROM ingest.person_aliases WHERE person_id=$1 AND alias=$2',[id,alias])).rowCount)return {alreadyIncluded:true};
  return createAlias(ctx,kind,id,{alias,aliasType:type,isPrimary:false});
 });
 await run('loocila-identity',{artistId:7463,source:'https://www.analitica.com/entretenimiento/cultura/loocila-dira-presente-en-la-2da-edicion-de-la-ong-acustica/'},async ctx=>{
  await updateEntity(ctx,'artist',7463,{artist_type:'solo_artist',origin_city:'Caracas',biography:'Loocila es el proyecto solista de Lorena Orlando, cantante, compositora y fotógrafa venezolana nacida en Caracas en 1989. En 2005 desarrolló junto a Ezequiel «Cheky» Bertho el proyecto de pop-folk Jóvenes y Sexys, en el que participó como vocalista y coautora. En 2008 se estableció en Ciudad de México, donde estudió fotografía.\n\nSu discografía como Loocila incluye «Coclea» (2013) y «Sin Miedos y Sin Esperanzas» (2015). También desarrolla obra visual y ha firmado créditos gráficos como el arte del EP «Bruno» de Jóvenes y Sexys.'});
  return createRelation(ctx,'artist_membership',{artistId:7463,personId:42303},{role:'Titular del proyecto',is_current:false});
 });
 for(const [artistId,personId,role] of [[7798,971,'voz'],[7798,231,'voz'],[7799,4128,'voz y guitarra']] as const)await run('project-member',{artistId,personId},ctx=>createRelation(ctx,'artist_membership',{artistId,personId},{role,is_current:false,notes:artistId===7798?'Dúo documentado por Esto Sí Suena y por la entrevista de Recordatorio publicada por Cúsica.':'Titular y voz/guitarra documentados en la edición del artista.'}));
 const compact=rows('reports/wayback-analisis-catalogo-2026-10-22/paginas-compactas.jsonl');
 const profile=compact.find(p=>/^https?:\/\/fusiblefm\.com(?::80)?\/djelectrovenezuela\/?$/.test(p.url));
 if(profile){
  let aid=(await pool.query('SELECT id FROM public.artists WHERE name=$1',['DJ Electro (Daniel Arias)'])).rows[0]?.id;
  if(!aid){const created=await run('electro-project',{profile:profile.url,source:'http://fusiblefm.com:80/music/song/id_33/'},ctx=>createEntity(ctx,'artist',{name:'DJ Electro (Daniel Arias)',artist_type:'solo_artist',origin_country:'Venezuela',origin_city:'Los Teques',biography:'DJ Electro es el nombre artístico utilizado por Daniel Arias, DJ y productor cuyo perfil histórico de Fusible FM lo sitúa en Los Teques, Venezuela. En 2008 el catálogo de la plataforma documentó las sesiones «Tech Flavor 2008» y «Drum Madness 2008». En su presentación musical citaba dark tribal house y tech house. No se conoce una fecha de inicio de su actividad a partir de este archivo.'},{allowSimilar:true}));aid=created?.id;}
  if(aid)for(const sourceId of ['33','34']){const r=rows('reports/wayback-analisis-catalogo-2026-10-22/fusible-temas-por-revisar.jsonl').find(r=>r.id_fuente===sourceId)!;
   await run('dj-session-document',{artistId:Number(aid),source:r.evidencia.url},ctx=>doc(ctx,Number(aid),'dj-session:'+sourceId,'playlist',sourceId==='33'?'Tech Flavor 2008 — sesión de DJ Electro':'Drum Madness 2008 — sesión de DJ Electro','Sesión atribuida a Daniel Arias AKA DJ Electro en el catálogo de Fusible FM.\n\n'+r.texto.split('ALL').at(-1)!.split(/MEMBERS COMMENTS|TERMS & CONDITIONS/)[0]!.replace(/\[ Add To Favorites \]/g,'')+'\n\nLa referencia no acredita un álbum de composiciones propias ni una copia audiovisual reproducible.',r.evidencia,['archivo-fusible','sesion-dj','referencia-sonora'],{profileSource:profile.url}));
  }
 }
}
if(phase==='consolidate-publications'){
 const pairs=[
  {keep:3276,drop:34044,title:'El Soundtrack de Tus Historias Vol. 1',year:2010,parent:257,reason:'Mismo repertorio de 20 posiciones y artistas; la ficha previa tiene una errata en Soundtrack y fecha 2011 frente a julio de 2010 documentado por el editor.'},
  {keep:738,drop:34046,title:'Compilado - Festival Nuevas Bandas',year:2015,parent:257,reason:'Coinciden las 16 pistas, posiciones y duraciones con el Bandcamp de la Fundación Nuevas Bandas.'},
  {keep:2943,drop:34045,title:'En vivo en Carora',year:2009,parent:null,reason:'Mismo álbum en vivo de Cachicamoconcaspa de 2009, documentado con las variantes En vivo en Carora y En Vivo Desde Carora.'},
  {keep:27548,drop:34041,title:'Cala',year:2014,parent:7798,reason:'La ficha previa cita expresamente el mismo lanzamiento de Armando y Alejandro en RYM. El estreno original de Cala está documentado en abril de 2014; se conserva la fecha digital 2020 como variante de edición.'},
 ];
 for(const p of pairs){
  if(!(await pool.query('SELECT id FROM public.albums WHERE id=$1',[p.drop])).rowCount)continue;
  const preview=await previewAlbumMerge(pool,p.keep,p.drop);writeFileSync(O+'/fusion-album-'+p.drop+'.json',JSON.stringify({reason:p.reason,preview},null,2));
  // Una revisión explícita de las posiciones evita agrupar por parecido del título.
  if(p.keep===738&&preview.matchedTracks.length!==16)throw new Error('El compilado FNB no coincide en 16 pistas');
  if(p.keep===3276&&preview.matchedTracks.length!==20)throw new Error('El compilado TFV no coincide en 20 pistas');
  const result=await run('publication-merge',{keepId:p.keep,dropId:p.drop,reason:p.reason},async ctx=>{
   const result=await mergeAlbums(ctx,{keepId:p.keep,dropId:p.drop,previewHash:preview.previewHash,mode:'match',keepDropNameAsAlias:true,fieldChoices:{release_year:'drop'}});
   await updateEntity(ctx,'album',p.keep,{title:p.title,release_year:p.year,...(p.keep===3276?{album_type:'compilation'}:{})},p.parent?{parentId:p.parent}:{});
   await ctx.client.query(`UPDATE media.artist_documents SET metadata=jsonb_set(metadata,'{albumId}',to_jsonb($2::bigint)),updated_at=now() WHERE metadata->>'albumId'=$1`,[String(p.drop),p.keep]);
   if(p.keep===3276)await createRelation(ctx,'album_credit',{albumId:p.keep,artistId:1770},{credit_type:'producer',credit_role:'Colectivo editor y curador',notes:'Catálogo oficial de Tan Frío el Verano: https://tanfrioelverano.bandcamp.com/album/el-soundtrack-de-tus-historias-vol-1'});
   if(p.keep===27548){
    const exists=await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[p.keep,'https://rateyourmusic.com/release/single/armando-y-alejandro/cala']);
    if(!exists.rowCount)await ctx.client.query(`INSERT INTO ingest.album_versions(album_id,position,title,format,release_year,notes,source,source_ref,run_id) SELECT $1,coalesce(max(position),0)+1,'Referencia digital de 2020','Digital',2020,$2,$3,$4,$5 FROM ingest.album_versions WHERE album_id=$1`,[p.keep,'Fecha de la referencia RYM previamente catalogada. El estreno original está documentado en 2014; no se traslada 2020 al estreno.',TAG,'https://rateyourmusic.com/release/single/armando-y-alejandro/cala',ctx.runId]);
   }
   return result;
  });
  if(result){for(const [url,id] of Object.entries(state.publications))if(id===p.drop)state.publications[url]=p.keep;writeFileSync(O+'/applied-state.json',JSON.stringify(state,null,2));}
 }
}
if(phase==='credit-cleanup'){
 const invalidPeople=[42438,42447,42448,42449,42453,42459,42465,42466,42467,42470];
 for(const id of invalidPeople)await run('credit-target-correction',{personId:id},async ctx=>{
  const person=(await ctx.client.query('SELECT * FROM public.persons WHERE id=$1',[id])).rows[0];if(!person)return {alreadyAbsent:true};
  const own=await ctx.client.query(`SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE j.table_name='public.persons' AND j.op='I' AND j.row_pk=jsonb_build_object('id',$1::bigint) AND r.params->>'supplement'='wayback-restantes-2026-10-23' LIMIT 1`,[id]);if(!own.rowCount)throw new Error('Entidad ajena al suplemento');
  const credits=(await ctx.client.query('SELECT id,album_id,role FROM public.album_credits WHERE person_id=$1',[id])).rows;
  for(const c of credits){const owned=await ctx.client.query(`SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE j.table_name='public.album_credits' AND j.op='I' AND j.row_pk=jsonb_build_object('id',$1::bigint) AND r.params->>'supplement'='wayback-restantes-2026-10-23' LIMIT 1`,[c.id]);if(!owned.rowCount)throw new Error('Crédito ajeno al suplemento');await deleteRelation(ctx,'album_credit',Number(c.id));}
  await deleteEntity(ctx,'person',id);return {removed:person.name,credits,reason:'Separación de coautores, crédito de banda/colectivo o título de obra; texto íntegro conservado en Otros.'};
 });
 await run('collective-credit-correction',{albumId:33952},async ctx=>{
  const rows=(await ctx.client.query(`SELECT c.id FROM public.album_credits c WHERE c.album_id=33952 AND c.person_id IS NOT NULL AND EXISTS(SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id WHERE j.table_name='public.album_credits' AND j.op='I' AND j.row_pk=jsonb_build_object('id',c.id) AND r.params->>'supplement'='wayback-restantes-2026-10-23')`)).rows;
  for(const c of rows)await deleteRelation(ctx,'album_credit',Number(c.id));return {removedUnverifiedPersonCredits:rows.length,reason:'La fuente acredita al colectivo Nodo; no identifica a sus miembros con homónimos del catálogo.'};
 });
 await run('organization-credit-correction',{organizationId:4838},async ctx=>{
  const org=(await ctx.client.query('SELECT name FROM public.organizations WHERE id=4838')).rows[0];if(!org)return {alreadyAbsent:true};
  if(org.name!=='Ghersy Bates Publicidad (Alejandro Capó, Boris Felipe, Ana Sáenz)')throw new Error('Organización cambió');
  const credits=(await ctx.client.query('SELECT id FROM public.album_credits WHERE organization_id=4838')).rows;
  for(const c of credits)await deleteRelation(ctx,'album_credit',Number(c.id));await deleteEntity(ctx,'organization',4838);return {removed:org.name,canonicalOrganizationId:4839};
 });
 if((await pool.query('SELECT id FROM public.persons WHERE id=42458')).rowCount){
  const preview=await previewEntityMerge(pool,'person',35390,42458);writeFileSync(O+'/fusion-carito-rauseo.json',JSON.stringify(preview,null,2));
  await run('documented-person-variant',{keepId:35390,dropId:42458,source:'https://twitter.com/caritOrauseo',evidence:'La Galería del Rock acredita a María Carolina Rauseo con el perfil caritOrauseo; el Bandcamp de Kuámasi acredita a Carito Rauseo en la misma obra y función.'},ctx=>mergeEntities(ctx,{kind:'person',keepId:35390,dropId:42458,previewHash:preview.previewHash,keepDropNameAsAlias:true}));
 }
}
if(phase==='gallery'){
 const images=rows('reports/wayback-incorporacion-2026-10-23/imagenes-localizadas.jsonl').filter(r=>r.banda==='Loocila');
 const inspected=new Map(rows('reports/wayback-incorporacion-2026-10-23/imagenes-inspeccionadas.jsonl').map(r=>[r.key,r]));
 for(const img of images){const v=inspected.get(img.key);if(!v)throw new Error('Imagen sin inspección');
  if(!existsSync('web/public/media/'+img.imageUrl.replace('/crv/media/','')))throw new Error('Medio no publicado');
  await run('gallery',{artistId:7463,sha256:img.sha256},async ctx=>{
   const result=await ctx.client.query(`INSERT INTO media.artist_gallery(artist_id,image_url,category,title,description,source_key,source_url,tags,metadata) VALUES(7463,$1,'related',$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(artist_id,source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id`,[img.imageUrl,`${img.obra} — ${/Contraportada-Interna/i.test(img.archivo)?'contraportada interna':/Cara-Interna/i.test(img.archivo)?'cara interna':/Contraportada/i.test(img.archivo)?'contraportada':'portada'}`,v.description,TAG+':image:'+img.sha256,img.url_imagen,[TAG,'recuperacion-restantes','arte-discografico'],JSON.stringify({sha256:img.sha256,originalPath:img.archivo,inspection:v,albumId:34029})]);
   if(!/Contraportada|Cara-Interna/.test(img.archivo)){const album=(await ctx.client.query('SELECT cover_url FROM public.albums WHERE id=34029')).rows[0];if(!album.cover_url)await updateEntity(ctx,'album',34029,{cover_url:img.imageUrl});}
   return {created:result.rowCount};
  });
 }
}
if(phase==='music'){
 const releases=load('bandcamp-releases');
 const selected=[
  {url:'https://tanfrioelverano.bandcamp.com/album/el-soundtrack-de-tus-historias-vol-1',source:'http://lagaleriadelrock.com/portfolio/el-soundtrack-de-tus-historias-vol-1/',compilation:true},
  {url:'https://nuevasbandas.bandcamp.com/',source:'http://lagaleriadelrock.com/portfolio/festival-nuevas-bandas-2015/',compilation:true},
  {url:'https://pachijimenez.bandcamp.com/',source:'http://lagaleriadelrock.com/portfolio/la-voz-de-los-perdedores-2/',compilation:false},
 ];
 for(const item of selected){const r=releases.find((r:any)=>r.url===item.url);if(!r)throw new Error('Falta captura musical '+item.url);
  const albumId=state.publications[item.source];if(!albumId)throw new Error('Falta disco '+item.source);
  await run('musical-edition',{albumId,source:item.url},async ctx=>{
   const album=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
   const releaseDate=new Date(r.releaseDate).toISOString().slice(0,10);
   await updateEntity(ctx,'album',albumId,{release_date_text:releaseDate,release_year:Number(releaseDate.slice(0,4))});
   const added:any[]=[],held:any[]=[];
   for(const track of r.tracks){
    let title=track.title,performer:string|null=null;
    if(item.compilation){const parts=title.split(' - ');if(parts.length>=2){performer=parts.shift()!.trim();title=parts.join(' - ').trim();}}
    const current=(await ctx.client.query('SELECT id,title FROM public.tracks WHERE album_id=$1 AND disc_number=1 AND track_number=$2',[albumId,track.number])).rows[0];
    if(current&&key(current.title)!==key(title)){held.push({track,current,reason:'Posición ocupada por otra pista; no sustituir.'});continue;}
    let id=current?Number(current.id):null;
    if(!id){id=(await createEntity(ctx,'track',{title,track_number:track.number,disc_number:1,duration_seconds:Math.round(track.duration)},{albumId,allowSimilar:true})).id;added.push({id,title,number:track.number});}
    if(performer){
     const candidates=(await ctx.client.query(`SELECT a.id FROM public.artists a WHERE lower(a.name)=lower($1) UNION SELECT artist_id id FROM ingest.artist_aliases WHERE lower(alias)=lower($1)`,[performer])).rows;
     const ids=[...new Set(candidates.map(x=>canonical(Number(x.id))))];
     if(ids.length===1)await createRelation(ctx,'track_credit',{trackId:id,artistId:ids[0]!},{credit_type:'musician',credit_role:'Intérprete',notes:'Intérprete identificado por la publicación original del compilado: '+item.url});
     else held.push({trackId:id,performer,candidates:ids,reason:'Conservar intérprete literal; identidad sin resolución única.'});
    }
   }
   await doc(ctx,Number(album.artist_id),'music:'+albumId,'discography',album.title+' — repertorio y créditos de la edición',`Fecha declarada por el artista o editor: ${releaseDate}\n\n${r.about}\n\nRepertorio:\n${r.tracks.map((t:any)=>`${t.number}. ${t.title}`).join('\n')}\n\nCréditos:\n${r.credits}`,{url:item.url},['discografia','fuente-primaria','edicion-documentada'],{albumId,declaredReleaseDate:releaseDate,tracks:r.tracks,unassignedPerformerCredits:held});
   await saveEphemeris(ctx,{key:TAG+':restantes:release:'+albumId,title:`Publicación de ${album.title}`,description:`Publicación musical documentada por el artista o editor en su catálogo: ${album.title}.`,date:releaseDate,year:Number(releaseDate.slice(0,4)),dateNote:null,place:'',subject:album.title,originalArtistId:Number(album.artist_id),status:'verified',sources:[{title:'Catálogo del artista o editor',url:item.url}]});
   return {tracksCreated:added.length,added,held};
  });
 }
 const corrections=[
  [2929,'https://ernieband.bandcamp.com/album/a-o-m',2011],
  [333,'https://sofiainsomnia.bandcamp.com/album/breve-casi-eterno',2013],
  [1652,'https://losmelancolicosanonimos.bandcamp.com/album/el-segundo',2013],
  [198,'https://horacero.bandcamp.com/album/superllanero',2003],
  [2705,'https://lostelecaster.bandcamp.com/album/todo-muerto',2009],
 ] as const;
 const baseline=new Map(load('antes-albums').map((a:any)=>[Number(a.id),a]));
 for(const [albumId,url,year] of corrections){const r=releases.find((r:any)=>r.url===url);if(!r)throw new Error('Falta fuente '+url);
  await run('release-year-correction',{albumId,source:url,year,originalSource:'La Galería del Rock'},async ctx=>{
   const album=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];const before:any=baseline.get(albumId);
   if(Number(album.release_year)!==Number(before.release_year)&&Number(album.release_year)!==year)throw new Error('Año cambiado desde la revisión');
   const date=new Date(r.releaseDate).toISOString().slice(0,10);
   await updateEntity(ctx,'album',albumId,{release_year:year,release_date_text:date.endsWith('-01-01')?String(year):date});
   await doc(ctx,Number(album.artist_id),'year:'+albumId,'discography',album.title+' — fecha contrastada con el artista',`El catálogo conservaba ${before.release_year}; el archivo gráfico y el catálogo del propio artista coinciden en ${year}.\n\nFecha declarada en el catálogo del artista: ${r.releaseDate}. ${date.endsWith('-01-01')?'El 1 de enero se conserva como declaración de la plataforma; no se convierte en aniversario exacto.':''}\n\n${r.about}\n\n${r.credits}`,{url},['fecha-contrastada','fuente-primaria'],{albumId,previousYear:before.release_year,sourceYear:year,declaredReleaseDate:r.releaseDate});
   return {before:before.release_year,after:year,dateText:date.endsWith('-01-01')?String(year):date};
  });
 }
 // Las fechas de una canción incluida en otro álbum no se trasladan a un sencillo posterior.
 for(const r of releases.filter((r:any)=>['https://reyesmusic.bandcamp.com/album/chuckmix','https://elefreak.bandcamp.com/album/ep01','https://horacero.bandcamp.com/track/chiriguare-azul-desenchufado','https://americania.bandcamp.com/track/la-costura','https://horacero.bandcamp.com/album/sonicosubte'].includes(r.url))){
  const id=({'https://reyesmusic.bandcamp.com/album/chuckmix':801,'https://elefreak.bandcamp.com/album/ep01':675,'https://horacero.bandcamp.com/track/chiriguare-azul-desenchufado':530,'https://americania.bandcamp.com/track/la-costura':621,'https://horacero.bandcamp.com/album/sonicosubte':397} as Record<string,number>)[r.url]!;
  await run('date-evidence',{albumId:id,source:r.url},async ctx=>{
   const a=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1',[id])).rows[0];
   return doc(ctx,Number(a.artist_id),'date-evidence:'+id,'discography',a.title+' — contraste de publicación',`Fecha del catálogo: ${a.release_year}. Fecha declarada por esta fuente: ${r.releaseDate}.\n\n${r.about}\n\n${r.credits}\n\nSe conserva el ámbito de la referencia: una canción incluida en otro álbum o una selección parcial no determina por sí sola la fecha de una edición independiente.`,{url:r.url},['fuente-primaria','fechas-y-ediciones'],{albumId:id,sourceRelease:r});
  });
 }
}
if(phase==='contexts'){
 // Los hitos sin día/mes tienen una salida pública por año, conservando la cola del calendario.
 const events=(await pool.query(`SELECT e.* FROM ingest.ephemerides e WHERE e.event_key LIKE $1 AND e.status='pending' AND e.event_date IS NULL AND e.original_artist_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ingest.artist_editorial_policy p WHERE p.artist_id=e.original_artist_id) ORDER BY e.original_artist_id,e.event_year,e.id`,[TAG+':%'])).rows;
 const grouped=new Map<number,any[]>();for(const e of events){const aid=canonical(Number(e.original_artist_id));grouped.set(aid,[...(grouped.get(aid)??[]),e]);}
 for(const [aid,items] of grouped)await run('year-only-milestones',{artistId:aid,events:items.length},async ctx=>{
  const a=(await ctx.client.query('SELECT name FROM public.artists WHERE id=$1',[aid])).rows[0];
  return doc(ctx,aid,'year-only:'+aid,'event',`Hitos históricos de ${a.name} — cronología por año`,items.map(e=>`${e.event_year} — ${e.title}\n${e.description}\n${e.place?'Lugar documentado: '+e.place+'\n':''}Fecha: año documentado; día y mes pendientes de confirmación.\n${(e.sources??[]).map((s:any)=>`${s.title}: ${s.url}${s.quote?'\nCita: '+s.quote:''}`).join('\n')}`).join('\n\n'),{url:items[0].sources?.[0]?.url},['hitos-historicos','fecha-parcial','cronologia-por-ano'],{ephemerisIds:items.map(e=>Number(e.id)),events:items});
 });
 const punk=rows('reports/wayback-analisis-catalogo-2026-10-22/caracaspunk-obras-por-fila.jsonl');const byPage=new Map<string,any[]>();for(const r of punk){const u=r.evidencia.url;byPage.set(u,[...(byPage.get(u)??[]),r]);}
 for(const [url,items] of byPage)await run('distribution-archive',{source:url,entries:items.length},ctx=>doc(ctx,257,'distribution:'+hash(url),'discography','CaracasPunk — catálogo histórico de distribución '+new URL(url).pathname,'Catálogo de distribución conservado por CaracasPunk. Incluye bandas de distintos países; figurar en este listado no identifica a una banda como venezolana ni demuestra una edición propia del sitio.\n\n'+items.map(r=>`${r.banda_literal} — ${r.obra_literal}`).join('\n'),items[0].evidencia,['distribucion-historica','catalogo-internacional','origen-no-inferido'],{entries:items}));
 const skay=rows('reports/wayback-fuentes-2026-10-22/entidades/skaypunk-bandas.jsonl');
 await run('scene-index',{entries:skay.length},ctx=>doc(ctx,257,'skaypunk-band-index','article','Skaypunk — directorio histórico de bandas','Directorio de enlaces de Skaypunk. La clasificación original por secciones reúne bandas venezolanas y extranjeras; las etiquetas de país calculadas por el extractor no se usan para establecer nacionalidades.\n\n'+skay.map(r=>`${r.nombre}${r.href?' — '+r.href:''}`).join('\n'),{url:'http://www.skaypunk.com/bandas/'},['directorio-historico','escena-punk-ska','identidad-por-cotejar'],{entries:skay}));
 for(const r of rows('reports/wayback-fuentes-2026-10-22/entidades/eventos.jsonl'))await run('historical-announcement',{source:r.url_origen,date:r.fecha},ctx=>doc(ctx,257,'announcement:'+hash(r.url_origen+r.fecha+r.descripcion),'event','Anuncio de concierto — '+r.fecha,r.descripcion+'\n\nSe conserva el anuncio publicado, con su fecha y cartel literales. El archivo no confirma que el concierto se haya celebrado. Los nombres de locales, direcciones y horas no se convierten en artistas.',{url:r.url_origen,wayback:'https://web.archive.org/web/'+r.ts+'/'+r.url_origen},['anuncio-concierto','realizacion-no-confirmada'],{dateText:r.fecha,announcement:r}));
 const fusible=[...rows('reports/wayback-analisis-catalogo-2026-10-22/fusible-albumes-por-revisar.jsonl').map(r=>({...r,type:'album'})),...rows('reports/wayback-analisis-catalogo-2026-10-22/fusible-temas-por-revisar.jsonl').map(r=>({...r,type:'song'}))];
 for(const r of fusible){const match=String(r.texto).split('ALL').at(-1)!.trim();const useful=match.split(/Bookmark:|MEMBERS COMMENTS|TERMS & CONDITIONS/)[0]!.replace(/\[ Add To Favorite(?:s)? \]|\[ Add to your Profile \]/g,'').replace(/\n{3,}/g,'\n\n');
  await run('fusible-document',{source:r.evidencia.url},ctx=>doc(ctx,257,'fusible:'+r.type+':'+r.id_fuente,'playlist','Fusible FM — '+useful.split('\n')[0],useful+'\n\nReferencia del catálogo social de Fusible FM. Se conserva el repertorio y la atribución original. La casilla «album» de la plataforma puede contener mezclas o selecciones de terceros; no se toma como prueba de álbum original ni de nacionalidad de sus autores.',r.evidencia,['archivo-fusible','referencia-sonora','autoria-y-edicion-por-contrastar'],{source:r}));
 }
 console.log({yearOnlyEvents:events.length,artistChronologies:grouped.size,distributionEntries:punk.length,distributionPages:byPage.size,sceneNames:skay.length,fusibleReferences:fusible.length});
}
if(phase==='final-dates'){
 const dateIds=new Set((process.env['WAYBACK_ONLY_ALBUMS']??'').split(',').filter(Boolean).map(Number));
 const approved=load('fechas-resoluciones-aprobadas').filter((r:any)=>!dateIds.size||dateIds.has(Number(r.albumId)));
 const baseline=new Map(load('antes-albums').map((a:any)=>[Number(a.id),a]));
 for(const r of approved)await run('date-final-review',{albumId:r.albumId,decision:r.status,sources:r.sources},async ctx=>{
  const album=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[r.albumId])).rows[0];if(!album)throw new Error('Falta álbum revisado');
  const before:any=baseline.get(Number(r.albumId));
  if(r.status==='corrected-original-year'){
   if(![Number(before.release_year),r.newYear].includes(Number(album.release_year)))throw new Error('Cambio concurrente en año');
   const fields:any={release_year:r.newYear,release_date_text:r.exactDate??String(r.newYear)};
   if([3609,2736].includes(Number(r.albumId))&&album.description)fields.description=album.description.replace(new RegExp('en '+before.release_year+'\\.'), 'en '+r.newYear+'.');
   await updateEntity(ctx,'album',Number(r.albumId),fields);
   if(r.exactDate){
    const existing=await ctx.client.query("SELECT id FROM ingest.ephemerides WHERE original_artist_id=$1 AND event_date=$2 AND (subject_name=$3 OR title=$4) AND status='verified'",[album.artist_id,r.exactDate,album.title,'Publicación de '+album.title]);
    if(!existing.rowCount)await saveEphemeris(ctx,{key:TAG+':restantes:date-reviewed:'+r.albumId,title:'Publicación de '+album.title,description:'Fecha de publicación declarada por el artista en su catálogo. '+r.reason,date:r.exactDate,year:r.newYear,dateNote:null,place:'',subject:album.title,originalArtistId:Number(album.artist_id),status:'verified',sources:r.sources.map((url:string)=>({title:'Catálogo del artista',url}))});
   }
  }
  if(Number(r.albumId)===5592){
   const ref='https://music.amazon.in/albums/B01CKE7YS4';
   if(!(await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=5592 AND source_ref=$1',[ref])).rowCount)
    await ctx.client.query(`INSERT INTO ingest.album_versions(album_id,position,title,format,release_year,notes,source,source_ref,run_id) SELECT 5592,coalesce(max(position),0)+1,'Distribución digital de 2016','Digital',2016,$1,$2,$3,$4 FROM ingest.album_versions WHERE album_id=5592`,['Fecha digital del editor: 4 de febrero de 2016; el original está documentado en 2015.',TAG,ref,ctx.runId]);
  }
  return doc(ctx,Number(album.artist_id),'date-reviewed:'+r.albumId,'discography',album.title+' — fechas y ediciones contrastadas',`Año previo del catálogo: ${before.release_year}. Año(s) del archivo gráfico: ${(r.sourceYears??[r.sourceYear??'sin año']).join(', ')}.\n\n${r.reason}\n\n${r.status==='corrected-original-year'?'Año original corregido: '+r.newYear+'. ':''}${r.exactDate?'Fecha declarada por el artista: '+r.exactDate+'. ':''}\nFuentes consultadas:\n${r.sources.join('\n')}`,r.source,['fechas-y-ediciones','revision-editorial',...(r.status==='unresolved'||r.status==='type-conflict-preserved'?['conflicto-documentado']:[])],{albumId:Number(r.albumId),approvedDecision:r});
 });
 await run('manao-homonym-document-correction',{documentId:1500,artistId:6807},async ctx=>{
  const r=await ctx.client.query("UPDATE media.artist_documents SET metadata=metadata||$1::jsonb,updated_at=now() WHERE id=1500 AND artist_id=6807 AND source_url LIKE '%fnpr.htm%' RETURNING id",[JSON.stringify({editorialHidden:true,identityDecision:'La noticia de 2001 identifica al técnico Oswaldo Rodríguez, sin demostrar que sea el proyecto Manao. El premio se conserva públicamente en la ficha de Caramelos de Cianuro, documento 1496.'})]);return {hiddenMisattribution:r.rowCount,retainedDocument:1496};
 });
 // Los identificadores dentro de JSON no son claves foráneas: se actualizan tras la fusión documentada.
 await run('document-credit-metadata-reconciliation',{},async ctx=>{
  const docs=(await ctx.client.query("SELECT id,metadata FROM media.artist_documents WHERE metadata->>'supplement'=$1 AND metadata ? 'resolvedCredits'",[plan.supplement])).rows;
  let changed=0;
  for(const d of docs){const list=d.metadata.resolvedCredits??[];let edit=false;
   for(const c of list)if(Number(c.personId)===42458){c.personId=35390;edit=true;}
   if(edit){await ctx.client.query("UPDATE media.artist_documents SET metadata=jsonb_set(metadata,'{resolvedCredits}',$2::jsonb),updated_at=now() WHERE id=$1",[d.id,JSON.stringify(list)]);changed++;}
  }return {changed};
 });
}
await closeDb();
