export const DOCUMENT_EXTRACTION_VERSION=2;
export type DocumentFormat="html"|"rendered_html"|"json"|"text"|"pdf"|"image";
export interface DocumentLocation {
  start:number;end:number;selector:string;
  page?:number;
  bbox?:{x:number;y:number;width:number;height:number;unit:"px"|"pt"};
  confidence?:number;
  context?:"navigation"|"footer"|"header"|"body"|"structured";
}
export interface DocumentPart {page:number;method:string;content:string;locations:DocumentLocation[];warnings:string[];complete:boolean;}
export interface DocumentExtraction {
  version:number;format:DocumentFormat;method:string;title:string;content:string;
  complete:boolean;unreadParts:string[];warnings:string[];
  locations:DocumentLocation[];followLinks:string[];
  alternatives?:Array<{text:string;confidence:number}>;
  processedPages?:number[];totalPages?:number;parts?:DocumentPart[];
}
export interface DocumentMetadata {
  extractionHash?:string;
  captureId:number;rawHash:string;format:DocumentFormat;method:string;extractionVersion:number;
  complete:boolean;unreadParts:string[];warnings:string[];
  locations:DocumentLocation[];followLinks:string[];
}
export interface DocumentReadOptions {
  resume?:DocumentExtraction;
  continue?:()=>Promise<boolean>;
  checkpoint?:(extraction:DocumentExtraction)=>Promise<void>;
}
/** Transcript offsets use UTF-8 bytes, matching the persistent evidence inventory. */
export class Transcript {
  private bytes=0;
  private readonly parts:string[]=[];
  readonly locations:DocumentLocation[]=[];
  append(text:string,location?:Omit<DocumentLocation,"start"|"end">):void {
    if(!text)return;
    const start=this.bytes;this.parts.push(text);this.bytes+=Buffer.byteLength(text,"utf8");
    if(location)this.locations.push({...location,start,end:this.bytes});
  }
  get content():string{return this.parts.join("");}
}
