/** Archivo editorial reclasificable, independiente de discografía y audiovisuales. */
export const DOCUMENT_CATEGORIES = ['interview','article','review','news','event','biography','discography','playlist','other'] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory,string> = {
 interview:'Entrevistas',article:'Artículos',review:'Reseñas',news:'Noticias',event:'Eventos',
 biography:'Historia y biografías',discography:'Documentación discográfica',playlist:'Listas de radio',other:'Otros documentos',
};
export const WAYBACK_ARCHIVE_TAG = 'archivo-wayback-2026-10-22';
export interface ArtistDocument {
 id:number; category:DocumentCategory; title:string; content:string;
 sourceUrl:string|null; archiveUrl:string|null; dateText:string|null; location:string|null; tags:string[];
}
