/** Aplica exclusivamente los dictámenes manuales de los 16 expedientes. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,createEntity,createRelation,updateEntity,type OperatorContext} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');
const planText=readFileSync(out+'/decisiones-aprobadas.json','utf8');const plan=JSON.parse(planText);
if(plan.cases.length!==16||plan.cases.filter((c:any)=>c.status==='confirmed').length!==9)throw new Error('Plan distinto del revisado');
const before=JSON.parse(readFileSync(out+'/antes-catalogo.json','utf8'));
const campaign=plan.campaign as string;
const file=out+'/aplicado.json';const results:any[]=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
const digest=createHash('sha256').update(planText).digest('hex');
const norm=(s:string)=>s.normalize('NFC').toLocaleLowerCase().trim();
async function run(key:string,note:string,work:(ctx:OperatorContext)=>Promise<any>){
 if(results.some(r=>r.key===key)){console.log('ya aplicado',key);return;}
 const result=await withOperatorRun({name:'wayback-editorial:'+key,operator:'codex (encargo de Brian)',note,params:{campaign,approvedPlanSha256:digest}},async ctx=>{
  await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);return work(ctx);
 });
 results.push({key,...result});writeFileSync(file,JSON.stringify(results,null,2));console.log(JSON.stringify({key,...result}));
}
async function document(ctx:OperatorContext,id:number,caseData:any,publicConclusion:string,patch:any={}){
 const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!d)throw new Error('Documento ausente '+id);
 const expected=before.documents.find((x:any)=>Number(x.id)===id);
 if(expected&&Number(expected.artist_id)!==Number(d.artist_id))throw new Error('Pertenencia del documento cambió '+id);
 const metadata={...d.metadata,...patch,editorialReviewCampaign:campaign,editorialReviews:[...(d.metadata.editorialReviews??[]),{caseId:caseData.caseId,status:caseData.status,reviewedAt:new Date().toISOString(),conclusion:publicConclusion,evidence:caseData.evidence}]};
 const tags=new Set<string>(d.tags);tags.add('revision-editorial-2026-10-25');
 if(caseData.group==='credit'){
  if(caseData.status==='confirmed'){tags.add('identidad-de-creditos-verificada');if(!(metadata.unassignedCredits??[]).some((c:any)=>c.name))tags.delete('identidad-de-creditos-en-revision');}
  else tags.add('identidad-de-creditos-en-revision');
 }
 if(caseData.group==='release-type'){tags.add('tipo-de-publicacion-verificado');tags.delete('tipo-de-publicacion-en-revision');}
 const section='\n\nRevisión editorial del 25 de octubre de 2026\n'+publicConclusion+'\n\nFuentes de contraste:\n'+[...new Set(caseData.evidence.map((e:any)=>e.url))].join('\n');
 const content=d.content+section;
 await ctx.client.query('UPDATE media.artist_documents SET content=$2,tags=$3,metadata=$4::jsonb,source_url=coalesce(source_url,$5),updated_at=now() WHERE id=$1',[id,content,[...tags],JSON.stringify(metadata),caseData.evidence[0]?.url??null]);
 return {documentId:id,artistId:Number(d.artist_id)};
}
try{
for(const c of plan.cases.filter((c:any)=>c.group==='credit')){
 const orig=c.original;
 await run(c.caseId,c.reason,async ctx=>{
  const d=(await ctx.client.query('SELECT metadata FROM media.artist_documents WHERE id=$1 FOR UPDATE',[orig.documentId])).rows[0];
  if(!d)throw new Error('Documento de crédito ausente');
  if(c.status!=='confirmed'){
   return document(ctx,orig.documentId,c,'El nombre y el crédito se conservan tal como aparecen en la fuente. Esta revisión no pudo confirmar su correspondencia con una identidad normalizada; la asociación permanece pendiente.');
  }
  let targetId=c.target.id as number|undefined;const kind=c.target.kind as 'person'|'organization';
  if(!targetId){
   const table=kind==='person'?'public.persons':'public.organizations';
   const exact=(await ctx.client.query(`SELECT id FROM ${table} WHERE lower(name)=lower($1)`,[c.target.name])).rows;
   if(exact.length)throw new Error('Identidad nueva apareció; revisar antes de asociar '+c.target.name);
   const entity=await createEntity(ctx,kind,{name:c.target.name,biography:c.biography,notes:c.notes,...(kind==='organization'?{organization_type:'other'}:{})},{allowSimilar:true});
   targetId=entity.id;
  }else{
   const p=(await ctx.client.query('SELECT name,biography,notes FROM public.persons WHERE id=$1 FOR UPDATE',[targetId])).rows[0];
   if(!p)throw new Error('Persona ausente');
   const fields:Record<string,string>={notes:[p.notes,'Identidad y crédito contrastados el 25 de octubre de 2026. '+c.evidence.map((e:any)=>e.url).join(' ')].filter(Boolean).join('\n\n')};
   if(!p.biography?.trim())fields['biography']=c.biography;
   await updateEntity(ctx,'person',targetId,fields);
  }
  if(!targetId)throw new Error('No se obtuvo identidad');
  const endpoint=kind==='person'?{personId:targetId}:{organizationId:targetId};
  const relation=await createRelation(ctx,'album_credit',{albumId:orig.albumId,...endpoint},{credit_type:/foto/i.test(orig.role)?'photography':'artwork',credit_role:orig.role,notes:'Crédito contrastado por identidad, perfil y obra. '+c.evidence.map((e:any)=>e.url).join(' ')});
  let member:any=null;
  if(c.membership)member=await createRelation(ctx,'artist_membership',{artistId:c.membership.artistId,personId:targetId},{role:c.membership.role,is_current:false,notes:'Vínculo histórico documentado; no se infiere una formación actual. '+c.evidence.map((e:any)=>e.url).join(' ')});
  const unassigned=(d.metadata.unassignedCredits??[]).filter((x:any)=>!x.name||norm(x.name)!==norm(orig.name));
  const resolved=[...(d.metadata.resolvedCredits??[]),{name:orig.name,role:orig.role,...endpoint,editorialCase:c.caseId,sourceUrls:c.evidence.map((e:any)=>e.url)}];
  const conclusion=kind==='organization'?`Crédito asociado a ${c.target.name}, entidad de creación visual documentada por las fuentes. Se conserva el nombre literal del crédito.`:`Crédito asociado a ${c.target.name??orig.name}. La relación entre el nombre, el perfil y la obra quedó contrastada; se conserva el crédito literal.`;
  const doc=await document(ctx,orig.documentId,c,conclusion,{unassignedCredits:unassigned,resolvedCredits:resolved});
  return {...doc,albumId:orig.albumId,targetKind:kind,targetId,credit:relation,membership:member};
 });
}
for(const c of plan.cases.filter((c:any)=>c.group==='release-type')){
 await run(c.caseId,c.reason,async ctx=>{
  const a=(await ctx.client.query('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[c.albumId])).rows[0];if(!a)throw new Error('Álbum ausente');
  if(a.album_type!=='studio_album')await updateEntity(ctx,'album',c.albumId,{album_type:'studio_album'});
  if(c.albumId===23178&&!a.description?.trim())await updateEntity(ctx,'album',c.albumId,{description:'Clásico es el álbum debut de Los Colores, publicado en 2013 por Discos Caracas y All of the Above. Su título coincide con el del sencillo promocional que acompañó el lanzamiento.'});
  let version:any=null;
  if(c.albumId===2671){
   const ref='https://music.apple.com/es/album/sin-otro-sentido/1443537379';
   if(!(await ctx.client.query('SELECT id FROM ingest.album_versions WHERE album_id=$1 AND source_ref=$2',[c.albumId,ref])).rowCount){
    version=(await ctx.client.query("INSERT INTO ingest.album_versions(album_id,position,title,format,release_year,notes,source,source_ref,run_id) SELECT $1,coalesce(max(position),0)+1,'Referencia digital de 2016','Digital',2016,$2,$3,$4,$5 FROM ingest.album_versions WHERE album_id=$1 RETURNING id",[c.albumId,'Apple Music documenta una edición de trece canciones fechada el 10 de junio de 2016, con fonograma Universal Music Latino/Arju Productions. La nota de prensa de julio de 2011 documenta el álbum original de doce canciones: no se cambia 2011 ni se añaden pistas a esa edición.',campaign,ref,ctx.runId])).rows[0];
   }
  }
  const conclusion='Se confirma la clasificación como álbum de estudio. La prensa de época distingue el álbum del sencillo promocional homónimo. Se conserva el año original del catálogo y se mantienen separadas las referencias de ediciones posteriores. Esta decisión no fija una fecha exacta nueva.';
  const doc=await document(ctx,c.documentId,c,conclusion,{classificationConflictResolved:true,confirmedAlbumType:'studio_album'});
  return {...doc,albumId:c.albumId,confirmedType:'studio_album',previousType:a.album_type,originalYearPreserved:a.release_year,version};
 });
}
for(const albumId of [630,655]){
 const cases=plan.cases.filter((c:any)=>c.albumId===albumId&&c.group.startsWith('track-'));
 const aggregate={caseId:'repertoire:'+albumId,group:'track-repertoire',status:'pending',evidence:cases.flatMap((c:any)=>c.evidence)};
 await run(aggregate.caseId,'Documentar por edición los repertorios discrepantes. Conservar posiciones y marcas del video seleccionado.',async ctx=>{
  const repertoire=before.documents.find((d:any)=>Number(d.id)===(albumId===630?1329:1330))?.content;if(!repertoire)throw new Error('Falta repertorio congelado');
  const video=albumId===630?'nrctsTnYo7o':'d_aIiMjuXFM';
  const note=albumId===630?'El catálogo del sello lista 1. Manglar (Submarino), 2. Carne y Hueso (Dúplex), 3. Salir de Aquí (V’lis). El video del catálogo reproduce las posiciones segunda y tercera en orden inverso. Se preservan sus marcas de tiempo y se mantiene pendiente identificar la secuencia del audio histórico.':'El catálogo del sello anuncia Tema Rojo 2003 de Sebas&Charles en la segunda posición; el video del catálogo indica Solamente Tú. El mismo catálogo lista ambas composiciones por separado en otra publicación de Sebas&Charles. No se tratan como alias ni se intercambian sus marcas de reproducción.';
  const version=(await ctx.client.query('SELECT * FROM ingest.album_versions WHERE id=$1 AND album_id=$2 FOR UPDATE',[cases[0].versionId,albumId])).rows[0];if(!version)throw new Error('Edición no encontrada');
  const notes=[version.notes,note,'Repertorio literal del sello:\n'+repertoire,'Contraste del video: https://www.youtube.com/watch?v='+video].filter(Boolean).join('\n\n');
  await ctx.client.query('UPDATE ingest.album_versions SET notes=$2 WHERE id=$1',[version.id,notes]);
  const doc=await document(ctx,albumId===630?2589:2590,aggregate,note,{repertoireConflict:{status:'pending',caseIds:cases.map((c:any)=>c.caseId),videoId:video,sourceVersionId:Number(version.id)}});
  return {...doc,albumId,versionId:Number(version.id),cases:cases.map((c:any)=>c.caseId),tracksModified:0,timestampsModified:0};
 });
}
for(const c of plan.cases.filter((c:any)=>c.group==='member')){
 await run(c.caseId,c.reason,ctx=>document(ctx,c.artistId===6994?9:37,c,'Se conserva el nombre histórico documentado del bajista. La investigación adicional no confirmó un apellido ni un perfil inequívoco, por lo que la identidad sigue pendiente de normalización.',{membershipIdentityPending:true}));
}
console.log(JSON.stringify({runs:results.length,credits:results.filter(r=>r.result.credit).length,cases:plan.cases.length}));
}finally{await closeDb();}
