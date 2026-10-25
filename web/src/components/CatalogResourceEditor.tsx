import { useId, useState } from "react";
import { catalogEditorApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { FormFields, type FieldConfig, type FieldValue } from "./FormFields";
import { EntityPicker } from "./EntityPicker";
import { ALBUM_EDITION_TYPES } from "../../../src/shared/album-categories";
import { STREAMING_PLATFORMS } from "../../../src/shared/platforms";
import { platformLabel } from "./PlatformLinks";
import { formatDate } from "../lib/format";
import { hasPendingImageUploads, useImageUploadsPending } from "../lib/imageUploads";

const dateHint="AAAA, AAAA-MM o AAAA-MM-DD; ~ para aproximación e inicio/fin para un intervalo.";
const F=(key:string,label:string,type:"text"|"textarea"|"number"|"url"|"mediaUrl"|"checkbox"="text",required=false):FieldConfig=>({key,label,type,required} as FieldConfig);
const configs:Record<string,readonly FieldConfig[]>={
 version:[F("title","Nombre de la versión"),F("position","Orden","number",true),{key:"editionTypes",label:"Características de esta versión",type:"multiselect",options:ALBUM_EDITION_TYPES.map(t=>({value:t.key,label:t.label})),span2:true},F("format","Formato"),F("formatDetails","Descripción del formato","textarea"),F("catalogNumber","Número de catálogo"),F("country","País"),F("releaseYear","Año de publicación","number"),{key:"releaseDate",label:"Fecha de la versión",type:"text",hint:dateHint},F("coverUrl","Portada de esta versión","mediaUrl"),F("distinctTracks","Tiene una lista de pistas diferente","checkbox"),F("isPrimary","Versión principal","checkbox"),F("sourceRef","Fuente o referencia documental"),F("notes","Notas de la versión","textarea")],
 label:[{key:"role",label:"Rol",type:"select",required:true,options:[{value:"label",label:"Sello"},{value:"distributor",label:"Distribuidor"},{value:"licensee",label:"Licenciatario"}]},F("position","Orden","number",true),F("sourceText","Nombre literal en la fuente"),F("notes","Notas del vínculo","textarea")],
 disc:[F("discNumber","CD/lado N.º","number",true),F("title","Nombre del CD/lado","text",true),F("notes","Notas","textarea")],
 discLink:[F("discNumber","CD/lado N.º","number",true),{key:"platform",label:"Plataforma",type:"select",required:true,options:STREAMING_PLATFORMS.map(value=>({value,label:platformLabel(value)}))},F("url","URL","url",true),F("verified","Identidad confirmada","checkbox"),F("notes","Notas del enlace","textarea")],
 audiovisual:[F("title","Título de la pieza audiovisual","text",true),F("releaseYear","Año de publicación","number"),{key:"kind",label:"Tipo de pieza",type:"select",required:true,options:[{value:"documentary",label:"Documental"},{value:"live_concert",label:"Concierto o sesión"},{value:"music_video",label:"Videoclip"},{value:"interview",label:"Entrevista"},{value:"short",label:"Short"},{value:"other",label:"Otro audiovisual"}]},F("url","URL del video de YouTube","url"),F("description","Descripción editorial","textarea")],
 time:[F("startSeconds","Inicio en este video (segundos)","number",true),F("endSeconds","Final en este video (segundos)","number")],
};
const labels:Record<string,string>={version:"Versiones",label:"Sellos y roles",disc:"CD y lados",discLink:"Enlaces de CD/lado",audiovisual:"Audiovisuales",time:"Marcas por video"};
const hints:Record<string,string>={version:"Cada versión conserva sus características, fecha, portada, sellos y discos asociados. El año de la obra se edita en Datos de la ficha.",label:"Vincula sellos, distribuidores y licenciatarios a todo el disco o a una versión concreta.",disc:"Estos nombres identifican los CD/lados de la lista de pistas y del reproductor. Los soportes físicos se documentan en Obra y soportes.",discLink:"Un enlace confirmado de YouTube determina el video de ese CD/lado. Sus marcas pertenecen a ese video.",audiovisual:"Sólo se publica si la sincronización oficial confirma que YouTube permite incrustarlo; la evidencia no reproducible queda aquí, fuera de la pestaña pública.",time:"Selecciona la ocurrencia exacta de una pista en su video. Cero es un inicio válido. La corrección conserva la evidencia y los tiempos de otros videos."};
export function AlbumPublishingEditor({id,onChanged}:{id:number;onChanged:()=>void}) {
 const [resource,setResource]=useState("version");
 return <><div className="entity-edit-nav" aria-label="Datos de publicación">{["version","label","disc","discLink","time"].map(key=><button type="button" className={`btn btn--sm${resource===key?" btn--primary":""}`} aria-pressed={resource===key} key={key} onClick={()=>setResource(key)}>{labels[key]}</button>)}</div><CatalogResourceEditor key={resource} owner="album" id={id} resource={resource} onChanged={onChanged}/></>;
}
export function CatalogResourceEditor({owner,id,resource,onChanged}:{owner:"album"|"artist";id:number;resource:string;onChanged:()=>void}) {
 const {data,loading,error,reload}=useAsync(()=>catalogEditorApi.list(owner,id,resource),[owner,id,resource]);
 const {data:versions,error:versionsError,reload:reloadVersions}=useAsync(()=>resource==="label"?catalogEditorApi.list("album",id,"version"):Promise.resolve([]),[id,resource]);
 const {data:discs}=useAsync(()=>resource==="version"?catalogEditorApi.list("album",id,"disc"):Promise.resolve([]),[id,resource]);
 const {data:rawAlbum}=useAsync(()=>(resource==="version"||resource==="time")?catalogEditorApi.entity("album",id):Promise.resolve(null),[id,resource]);
 // La lista de pistas puede tener discos sin un nombre explícito en album_discs.
 const {data:times}=useAsync(()=>resource==="version"?catalogEditorApi.list("album",id,"time"):Promise.resolve([]),[id,resource]);
 const [draft,setDraft]=useState<Record<string,FieldValue>|null>(null);
 const [original,setOriginal]=useState<Record<string,FieldValue>>({});
 const [editId,setEditId]=useState<number>();const [removing,setRemoving]=useState(false);
 const [organization,setOrganization]=useState<{id:number;name:string}|null>(null);
 const [note,setNote]=useState("");const [saving,setBusy]=useState(false);const [failure,setFailure]=useState<string>();
 const uploading=useImageUploadsPending();const busy=saving||uploading;
 const uid=useId();const {notify}=useToast();
 function open(row?:Record<string,unknown>,remove=false) {
  const defaults:Record<string,FieldValue>={position:(data?.length??0)+1,discNumber:1,role:"label",platform:"youtube",kind:"documentary",editionTypes:[],discNumbers:[],distinctTracks:false,isPrimary:!data?.length,verified:false,startSeconds:0,endSeconds:null};
  const values=row?Object.fromEntries([...configs[resource]!.map(f=>f.key),"versionId","discNumbers","organizationId"].map(key=>[key,row[key] as FieldValue])):defaults;
  if(Array.isArray(values["discNumbers"])) values["discNumbers"]=values["discNumbers"].map(String);
  setDraft(values);setOriginal(row?values:{});setEditId(row?Number(row["id"]):undefined);setRemoving(remove);setNote("");setFailure(undefined);
  setOrganization(row?.["organizationId"]?{id:Number(row["organizationId"]),name:String(row["organizationName"]??row["organizationId"])}:null);
 }
 async function save(event:React.FormEvent) {
  event.preventDefault();if(!draft||busy||hasPendingImageUploads())return;setBusy(true);setFailure(undefined);
  try {
   if(removing) await catalogEditorApi.remove(owner,id,resource,editId!,note.trim());
   else {
    const values:Record<string,FieldValue>={...draft,...(resource==="label"?{organizationId:organization?.id}: {})};
    if(resource==="label"&&!organization) throw new Error("Selecciona una organización.");
    const body:Record<string,unknown>={note:note.trim()};
    const keys=[...configs[resource]!.map(f=>f.key),...(resource==="label"?["organizationId","versionId"]:[]),...(resource==="version"?["discNumbers"]:[]),...(resource==="time"&&editId===undefined?["trackId","videoId"]:[])];
    for(const key of keys) {
     const value=values[key];
     if(value===undefined || (editId!==undefined&&JSON.stringify(value)===JSON.stringify(original[key]))) continue;
     body[key]=key==="discNumbers"?(value as string[]).map(Number):typeof value==="string"&&!value.trim()?null:value;
    }
    await catalogEditorApi.save(owner,id,resource,body,editId);
   }
   setDraft(null);reload();onChanged();notify("success",removing?"Vínculo retirado.":"Datos guardados.");
  }catch(cause){setFailure(cause instanceof Error?cause.message:"No se pudo guardar.");}finally{setBusy(false);}
 }
 const discNumbers=[...new Set([...(discs??[]).map(r=>Number(r["discNumber"])),...(rawAlbum?.values["discNumbers"] as number[]??[]),...(times??[]).map(r=>Number(r["discNumber"])),...((draft?.["discNumbers"] as string[]|undefined)??[]).map(Number)])].filter(Number.isFinite).sort((a,b)=>a-b);
 function rowLabel(row:Record<string,unknown>) {
  if(resource==="time") return `${String(row["trackTitle"])} · ${String(row["videoTitle"]??row["youtubeId"])} · ${String(row["startSeconds"])} s`;
  if(resource==="label") return `${String(row["organizationName"])} · ${{label:"Sello",distributor:"Distribuidor",licensee:"Licenciatario"}[String(row["role"])]??String(row["role"])} · ${row["versionId"]?`versión ${String(row["versionId"])}`:"Todo el disco"}`;
  if(resource==="discLink") return `CD/lado ${String(row["discNumber"])} · ${platformLabel(String(row["platform"]))}`;
  return `${resource==="disc"?`CD/lado ${String(row["discNumber"])} · `:""}${String(row["title"]??row["format"]??"Versión sin nombre")}${row["releaseDate"]?` · ${formatDate(String(row["releaseDate"]))}`:row["releaseYear"]?` · ${String(row["releaseYear"])}`:""}${row["isPrimary"]?" · Principal":""}`;
 }
 return <section className="relation-editor" aria-label={labels[resource]}><h3>{labels[resource]}</h3><p className="hint">{hints[resource]}</p>
  {error?<p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p>:loading&&!data?<p role="status">Cargando…</p>:<>
  {!data?.length?<p>Sin registros.</p>:<ul className="relation-editor__list">{data.map(row=><li key={Number(row["id"])}><div><strong>{rowLabel(row)}</strong>{row["url"]?<a href={String(row["url"])} target="_blank" rel="noreferrer noopener">{String(row["url"])}</a>:null}{row["youtubeId"]?<a href={`https://youtu.be/${String(row["youtubeId"])}`} target="_blank" rel="noreferrer noopener">Abrir este video</a>:null}</div><div className="relation-editor__actions"><button type="button" className="btn btn--sm" disabled={busy} onClick={()=>open(row)}>Editar</button><button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={()=>open(row,true)}>Retirar</button></div></li>)}</ul>}
  {!draft?<button type="button" className="btn" onClick={()=>open()}>Añadir {labels[resource]?.toLowerCase()}</button>:null}
  </>}
  {draft?<form className="relation-editor__form" onSubmit={save}>
   <h4>{removing?"Retirar vínculo":editId?"Editar registro":"Nuevo registro"}</h4>
   {failure?<p className="form-error-banner" role="alert">{failure}</p>:null}
   <fieldset disabled={saving} className="image-upload-fields">{removing?<p>Se retira este vínculo. {resource==="version"?"También se retiran sus vínculos de sellos.":""} El cambio puede deshacerse desde el historial.</p>:<>
   {resource==="label"?<><EntityPicker kind="organization" label="Organización" value={organization?.id??null} valueLabel={organization?.name??null} onSelect={(pickedId,name)=>setOrganization({id:pickedId,name})}/>{versionsError?<p role="alert">{versionsError} <button type="button" className="btn" onClick={reloadVersions}>Reintentar versiones</button></p>:<div className="field"><label htmlFor={`${uid}-version`}>Ámbito del vínculo</label><select id={`${uid}-version`} value={String(draft["versionId"]??"")} onChange={e=>setDraft({...draft,versionId:e.target.value?Number(e.target.value):null})}><option value="">Todo el disco</option>{versions?.map(v=><option value={Number(v["id"])} key={Number(v["id"])}>{String(v["title"]??`Versión ${String(v["id"])}`)}</option>)}</select></div>}</>:null}
   {resource==="time"&&editId===undefined?<FormFields fields={[
     {key:"trackId",label:"Pista de este disco",type:"select",required:true,options:((rawAlbum?.values["editorTracks"] as Array<{id:number;title:string;discNumber:number;trackNumber:number}>|undefined)??[]).map(t=>({value:String(t.id),label:`CD/lado ${t.discNumber} · ${t.trackNumber}. ${t.title}`}))},
     {key:"videoId",label:"Video concreto",type:"select",required:true,options:((rawAlbum?.values["editorVideos"] as Array<{id:number;title:string|null;videoId:string}>|undefined)??[]).map(v=>({value:String(v.id),label:`${v.title??v.videoId} · ${v.videoId}`}))}
    ]} values={draft} onChange={(key,value)=>setDraft({...draft,[key]:value?Number(value):null})}/>:null}
   <FormFields fields={configs[resource]!} values={draft} onChange={(key,value)=>setDraft({...draft,[key]:value})}/>
   {resource==="version"?<FormFields fields={[{key:"discNumbers",label:"CD/lados asociados a esta versión",type:"multiselect",options:discNumbers.map(n=>({value:String(n),label:`CD/lado ${n}`}))}]} values={{discNumbers:((draft["discNumbers"] as unknown[]|undefined)??[]).map(String)}} onChange={(_key,value)=>setDraft({...draft,discNumbers:value})}/>:null}
   </>}</fieldset>
   <div className="field"><label htmlFor={`${uid}-note`}>Motivo y evidencia *</label><textarea id={`${uid}-note`} required maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></div><div className="form-actions"><button className="btn" type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancelar</button><button className={`btn ${removing?"btn--danger":"btn--primary"}`} disabled={busy || (resource==="label"&&Boolean(versionsError))}>{busy?"Guardando…":removing?"Retirar":"Guardar"}</button></div>
  </form>:null}
 </section>;
}
