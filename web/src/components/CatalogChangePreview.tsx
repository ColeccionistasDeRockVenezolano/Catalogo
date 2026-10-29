import type { ReactNode } from 'react';
import type { CatalogOperation, CatalogPreview, CatalogVocabulary } from '../../../src/curation/ai/types';
import { catalogFieldLabel, catalogOptionLabel, KIND_LABELS } from './CatalogOperationEditor';

const PATHS: Record<string,string> = {artist:'artistas',person:'personas',album:'discos',organization:'organizaciones'};
const camel = (key:string) => key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
/** Presentación para revisar el catálogo; los detalles técnicos no son el resumen. */
export function CatalogChangePreview({operation,preview,vocabulary}:{operation:CatalogOperation;preview:CatalogPreview|null;vocabulary:CatalogVocabulary}) {
  const item=preview?.items.find(p=>p.key===operation.key);
  const enumFields = new Set(['albumType','artistType','organizationType','status','role','creditType','aliasType','quality','archiveStatus','fieldChoices']);
  function value(v:unknown, field?:string):ReactNode {
    if(v===null||v===undefined||v==='')return <span className="ai-value-empty">Sin dato</span>;
    if(typeof v==='boolean')return v?'Sí':'No';
    if(typeof v==='string')return field && enumFields.has(field) ? catalogOptionLabel(v) : v;
    if(typeof v==='number')return v;
    if(Array.isArray(v))return v.length?<ol className="ai-value-list">{v.map((x,i)=><li key={i}>{value(x,field)}</li>)}</ol>:<span className="ai-value-empty">Sin registros</span>;
    const row=v as Record<string,unknown>;
    if(typeof row.kind==='string'&&('id' in row||'key' in row)){
      const known=preview?.affected.find(r=>r.kind===row.kind&&r.id===row.id);
      const name=known?.label??`${KIND_LABELS[row.kind as keyof typeof KIND_LABELS]??'Ficha'} #${row.id??row.key}`;
      return PATHS[row.kind]&&row.id?<a href={`${import.meta.env.BASE_URL}${PATHS[row.kind]}/${row.id}`}>{name}</a>:name;
    }
    return <dl className="ai-value-fields">{Object.entries(row).filter(([k])=>!['created_at','updated_at','id'].includes(k)).map(([k,x])=><div key={k}><dt>{catalogFieldLabel(camel(k))}</dt><dd>{value(x,field === 'fieldChoices' ? field : camel(k))}</dd></div>)}</dl>;
  }
  const before=item?.before as Record<string,unknown>|null|undefined;
  if(operation.op==='replace_fields'||operation.op==='replace_relation')return <div className="ai-change-table" role="table" aria-label="Cambios propuestos"><div className="ai-change-table__head" role="row"><span role="columnheader">Dato</span><span role="columnheader">Actual</span><span role="columnheader">Propuesto</span></div>{Object.entries(operation.values).map(([key,next])=><div className="ai-change-table__row" role="row" key={key}><strong role="cell">{catalogFieldLabel(key)}</strong><div role="cell"><span className="ai-change-mobile-label">Actual</span>{value(before?.[key]??before?.[key.replace(/[A-Z]/g,l=>'_'+l.toLowerCase())],key)}</div><div role="cell"><span className="ai-change-mobile-label">Propuesto</span>{next===null?<strong className="ai-value-empty">Vaciar este dato</strong>:value(next,key)}</div></div>)}</div>;
  let proposed:unknown;
  switch(operation.op){
    case 'create_album': proposed={...operation.values,artist:operation.artist,tracks:operation.tracks,credits:operation.credits,genres:operation.genres.map(g=>({...g,slug:vocabulary.genres.find(x=>x.slug===g.slug)?.name??g.slug})),aliases:operation.aliases,formats:operation.formats};break;
    case 'create_entity':proposed={...operation.values,...(operation.parent?{parent:operation.parent}:{})};break;
    case 'create_relation':proposed={...operation.endpoints,...operation.values};break;
    case 'add_social_link':proposed={target:operation.target,platform:operation.platform,url:operation.url,...(operation.handle?{handle:operation.handle}:{})};break;
    case 'add_alias':proposed={target:operation.target,alias:operation.alias,aliasType:operation.aliasType,isPrimary:operation.isPrimary};break;
    case 'assign_genre':case 'remove_genre':proposed={target:operation.target,genreSlug:vocabulary.genres.find(g=>g.slug===operation.genreSlug)?.name??operation.genreSlug,...('role' in operation?{role:operation.role}:{})};break;
    case 'reorder_tracks':proposed={album:operation.album,positions:operation.positions};break;
    case 'merge_entities':proposed={keep:operation.keep,drop:operation.drop,fieldChoices:operation.fieldChoices};break;
    case 'remove_entity':proposed={target:operation.target};break;
    case 'remove_relation':proposed=before??{id:operation.id};break;
  }
  return <div className="ai-change-summary">{value(proposed)}</div>;
}
