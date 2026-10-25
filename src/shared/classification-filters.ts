/** Nombres conservados de las fuentes y categorías combinables de consulta. */
export const CLASSIFICATION_CATEGORIES:Readonly<Record<string,string>> = {
 'Studio Album':'studio_album','Live Album':'live','EP':'ep','Single':'single','Demos':'demo','Compilation Album':'compilation',
 'Soundtrack':'soundtrack','Collaboration Album':'collaboration_album','B-Sides':'b_sides','En vivo':'live','Acústico':'acoustic','Unplugged':'acoustic','Instrumental':'instrumental','Remix':'remix',
};
export const classificationFilterKey=(label:string)=>CLASSIFICATION_CATEGORIES[label]??`classification:${encodeURIComponent(label)}`;
export function classificationFilterLabel(key:string):string|null {
 if(!key.startsWith('classification:'))return null;
 try{return decodeURIComponent(key.slice('classification:'.length));}catch{return null;}
}
