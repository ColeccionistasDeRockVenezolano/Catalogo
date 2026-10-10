export const ENTITY_TOOL_PREFIX="crv.entity-tool.";
export function clearEntityToolDrafts(){
  try{for(const key of Object.keys(sessionStorage))if(key.startsWith(ENTITY_TOOL_PREFIX))sessionStorage.removeItem(key);}catch{/* Sin acceso al almacenamiento. */}
}
