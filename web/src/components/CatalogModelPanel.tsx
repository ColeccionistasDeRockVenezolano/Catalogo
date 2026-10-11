import { useEffect, useId, useRef, useState } from "react";
import { catalogModelApi, genresApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { EntityPicker } from "./EntityPicker";
import { FormFields, type FieldConfig, type FieldValue } from "./FormFields";
import { dateValueText, type DateValue } from "../../../src/catalog/date-value";
import { formatDate } from "../lib/format";

type Operation = "identity" | "edition" | "support" | "work" | "genre";
const label: Record<Operation,string> = { identity: "Identidad musical", edition: "Obra y edición", support: "Soporte y pistas", work: "Nueva obra", genre: "Género por período" };
const periodHint = "AAAA, AAAA-MM o AAAA-MM-DD; ~ para aproximación e inicio/fin para un período.";
const configs: Record<Operation,readonly FieldConfig[]> = {
  identity: [{ key: "relationship", label: "Relación", type: "select", required: true, options: [{value:"solo_identity",label:"Identidad solista"},{value:"member",label:"Integrante"},{value:"collaborator",label:"Colaborador"}] }, {key:"period",label:"Período documentado",type:"text",hint:periodHint}],
  edition: [{key:"editionName",label:"Nombre de esta edición",type:"text"},{key:"releaseDate",label:"Fecha de publicación",type:"text",hint:periodHint}],
  support: [{key:"format",label:"Formato",type:"text",required:true,hint:"CD, DVD, LP, casete o digital, según la fuente."},{key:"discNumber",label:"Número de soporte",type:"number",required:true}],
  genre: [{key:"genreSlug",label:"Género",type:"select",required:true,options:[]},{key:"period",label:"Período documentado",type:"text",hint:periodHint}],
  work: [{key:"title",label:"Título de la obra",type:"text",required:true}],
};
const dateText = (value: unknown) => value ? dateValueText(value as DateValue) : "";

export function CatalogModelPanel({kind,id,artistId,tracks=[],onChanged}: {
  kind:"person"|"artist"|"album"; id:number; artistId?:number;
  tracks?:ReadonlyArray<{id:number;title:string;discNumber:number}>; onChanged:()=>void;
}) {
  const unique = useId();
  const {data,loading,error,reload} = useAsync(() => catalogModelApi.get(kind,id),[kind,id]);
  const {data:vocabulary} = useAsync(()=>genresApi.vocabulary(),[]);
  const [operation,setOperation] = useState<Operation>(kind==="album"?"edition":"identity");
  const [values,setValues] = useState<Record<string,FieldValue>>({relationship:"solo_identity",discNumber:1});
  const [picked,setPicked] = useState<{id:number;name:string}|null>(null);
  const [workId,setWorkId] = useState<number|null>(null);
  const [selectedTracks,setSelectedTracks] = useState<number[]>([]);
  const [editId,setEditId] = useState<number>();
  const initialized=useRef(false);
  useEffect(()=>{
    if(initialized.current||!data||kind!=="album") return;
    initialized.current=true;
    const edition=data.editions.find(row=>Number(row["album_id"])===id);
    setWorkId(edition?.["work_id"]?Number(edition["work_id"]):null);
    setValues({editionName:String(edition?.["edition_name"]??""),releaseDate:dateText(edition?.["release_date"])});
  },[data,kind,id]);
  const [note,setNote] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [failure,setFailure] = useState("");
  const options: Operation[] = kind==="album"?["edition","support","work","genre"]:kind==="artist"?["identity","work","genre"]:["identity","genre"];
  function choose(next:Operation) {
    setOperation(next);setEditId(undefined);setValues({relationship:"solo_identity",discNumber:1});setPicked(null);setSelectedTracks([]);setFailure("");
    if(next==="edition") {
      const edition=data?.editions.find(row=>Number(row["album_id"])===id);
      setWorkId(edition?.["work_id"]?Number(edition["work_id"]):null);
      setValues({editionName:String(edition?.["edition_name"]??""),releaseDate:dateText(edition?.["release_date"])});
    }
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();setFailure("");setMessage("");
    if(!note.trim()) {setFailure("Escribe el motivo del cambio.");return;}
    setBusy(true);
    try {
      const body: Record<string,unknown>={note:note.trim()};
      for(const field of configs[operation]) body[field.key]=typeof values[field.key]==="string"&&!String(values[field.key]).trim()?null:values[field.key]??null;
      if(operation==="identity") {
        if(!picked) throw new Error("Selecciona la ficha relacionada.");
        Object.assign(body,{personId:kind==="person"?id:picked.id,artistId:kind==="artist"?id:picked.id});
      } else if(operation==="genre") Object.assign(body,{[`${kind}Id`]:id});
      else if(operation==="work") Object.assign(body,{artistId:kind==="artist"?id:artistId});
      else if(operation==="edition") Object.assign(body,{albumId:id,workId});
      else Object.assign(body,{albumId:id,trackIds:selectedTracks});
      const edition = operation==="edition"?data?.editions.find(row=>Number(row["album_id"])===id):null;
      const currentId=editId??(edition?Number(edition["id"]):undefined);
      const result=await catalogModelApi.write(operation,body,currentId);
      setMessage(`Cambio guardado. Puedes deshacerlo desde el historial (operación ${result.runId}).`);
      setEditId(undefined);reload();onChanged();
    } catch(err) {setFailure(err instanceof Error?err.message:"No se pudo guardar. Intenta de nuevo.");}
    finally {setBusy(false);}
  }
  async function remove(type:Operation,rowId:number) {
    if(!note.trim()) {setFailure("Escribe el motivo antes de retirar el vínculo.");return;}
    setBusy(true);setFailure("");
    try {await catalogModelApi.remove(type,rowId,note.trim());reload();onChanged();setMessage("Vínculo retirado. Puedes deshacerlo desde el historial.");}
    catch(err){setFailure(err instanceof Error?err.message:"No se pudo retirar.");}
    finally{setBusy(false);}
  }
  function edit(type:Operation,row:Record<string,unknown>) {
    setOperation(type);setEditId(Number(row["id"]));setFailure("");
    setValues({relationship:String(row["relationship"]??"solo_identity"),period:dateText(row["period"]),format:String(row["format"]??""),discNumber:Number(row["disc_number"]??1)});
    setPicked({id:Number(row[kind==="person"?"artist_id":"person_id"]),name:String(row[kind==="person"?"artist_name":"person_name"]??"")});
    setSelectedTracks((row["track_ids"] as number[]|undefined)??[]);
  }
  if(error) return <div role="alert"><p>{error}</p><button className="btn" type="button" onClick={reload}>Reintentar</button></div>;
  if(loading&&!data) return <p role="status">Cargando vínculos…</p>;
  return <div>
    <p className="hint">Cada edición conserva sus pistas, créditos y sello. Vincular fichas mantiene sus identidades y deja historial.</p>
    <div className="entity-edit-nav" aria-label="Tipo de vínculo">
      {options.map(type=><button key={type} type="button" className={`btn btn--sm${operation===type?" btn--primary":""}`} aria-pressed={operation===type} disabled={busy} onClick={()=>choose(type)}>{label[type]}</button>)}
    </div>
    <form onSubmit={save}>
      {failure?<p role="alert" className="form-error-banner">{failure}</p>:null}
      {message?<p role="status">{message}</p>:null}
      {operation==="identity"?<EntityPicker kind={kind==="person"?"artist":"person"} label={kind==="person"?"Artista o proyecto":"Persona"} value={picked?.id??null} valueLabel={picked?.name??null} onSelect={(pickedId,name)=>setPicked({id:pickedId,name})}/>:null}
      {operation==="edition"?<div className="field"><label htmlFor={`${unique}-work`}>Obra compartida</label><select id={`${unique}-work`} value={workId??""} onChange={event=>setWorkId(event.target.value?Number(event.target.value):null)}><option value="">Sin vínculo documentado</option>{data?.works.map(work=><option key={String(work["id"])} value={Number(work["id"])}>{String(work["title"])}</option>)}</select><span className="hint">Selecciona una obra existente o créala en «Nueva obra». El parecido del título no establece este vínculo.</span></div>:null}
      <FormFields fields={operation==="genre"?configs.genre.map(field=>field.key==="genreSlug"?{...field,type:"select",options:(vocabulary??[]).map(genre=>({value:genre.slug,label:genre.name}))} as FieldConfig:field):configs[operation]} values={values} onChange={(key,value)=>setValues(prev=>({...prev,[key]:value}))}/>
      {operation==="support"&&tracks.length?<fieldset><legend>Pistas de este soporte</legend>{tracks.filter(track=>track.discNumber===Number(values["discNumber"])).map(track=><label key={track.id} className="checkbox-field"><input type="checkbox" checked={selectedTracks.includes(track.id)} onChange={event=>setSelectedTracks(prev=>event.target.checked?[...prev,track.id]:prev.filter(item=>item!==track.id))}/>{track.title}</label>)}</fieldset>:null}
      <div className="field"><label htmlFor={`${unique}-note`}>Motivo *</label><textarea id={`${unique}-note`} required value={note} onChange={event=>setNote(event.target.value)} rows={2}/></div>
      <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={busy}>{busy?"Guardando…":editId?"Guardar vínculo":"Guardar"}</button></div>
    </form>
    {data?.genres.length?<ul>{data.genres.map(row=><li key={String(row["id"])}>{String(row["genre_name"])}{row["period"]?` · ${formatDate(dateText(row["period"]))}`:""} <button className="btn btn--sm" type="button" disabled={busy} onClick={()=>remove("genre",Number(row["id"]))}>Retirar vínculo</button></li>)}</ul>:null}
    {data?.identities.length?<ul>{data.identities.map(row=><li key={String(row["id"])}>{String(row[kind==="person"?"artist_name":"person_name"])} · {({solo_identity:"Identidad solista",member:"Integrante",collaborator:"Colaborador"} as Record<string,string>)[String(row["relationship"])]}{row["period"]?` · ${formatDate(dateText(row["period"]))}`:""} <button type="button" className="btn btn--sm" disabled={busy} onClick={()=>edit("identity",row)}>Editar vínculo</button> <button type="button" className="btn btn--sm" disabled={busy} onClick={()=>remove("identity",Number(row["id"]))}>Retirar vínculo</button></li>)}</ul>:null}
    {data?.supports.length?<ul>{data.supports.map(row=><li key={String(row["id"])}>{String(row["format"])} · soporte {String(row["disc_number"])} · {((row["track_ids"] as unknown[])??[]).length} pistas <button className="btn btn--sm" type="button" disabled={busy} onClick={()=>edit("support",row)}>Editar soporte</button> <button className="btn btn--sm" type="button" disabled={busy} onClick={()=>remove("support",Number(row["id"]))}>Retirar soporte</button></li>)}</ul>:null}
    {data?.editions.some(row=>row["work_title"])?<ul>{data.editions.filter(row=>row["work_title"]).map(row=><li key={String(row["id"])}>{String(row["title"])} · obra: {String(row["work_title"])}{row["edition_name"]?` · ${String(row["edition_name"])}`:""}{row["release_date"]?` · ${formatDate(dateText(row["release_date"]))}`:""}</li>)}</ul>:null}
  </div>;
}
