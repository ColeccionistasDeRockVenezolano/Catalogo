import { useCallback, useState } from "react";
import { useOperator } from "./OperatorContext";
import { ENTITY_TOOL_PREFIX } from "./entityToolStorage";

/** Solo preferencias y búsqueda. Los informes privados permanecen en la API. */
export function useEntityToolDraft<T>(entity:string,initial:T,validate:(value:unknown)=>value is T) {
  const {user}=useOperator();
  const key=`${ENTITY_TOOL_PREFIX}${user?.username??"anonymous"}.${entity}`;
  const [drafts,setDrafts]=useState<Record<string,T>>({});
  let value=drafts[key]??initial;
  if(!(key in drafts)){
    try{const saved:unknown=JSON.parse(sessionStorage.getItem(key)??"null");if(validate(saved))value=saved;}catch{/* Almacenamiento deshabilitado o dato obsoleto. */}
  }
  const update=useCallback((next:T)=>{
    setDrafts(previous=>({...previous,[key]:next}));
    try{sessionStorage.setItem(key,JSON.stringify(next));}catch{/* La herramienta sigue funcionando sin almacenamiento. */}
  },[key]);
  return [value,update] as const;
}
