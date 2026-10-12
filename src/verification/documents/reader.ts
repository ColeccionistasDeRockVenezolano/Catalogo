import {getEnv} from "../../config/env.js";
import {extractHtml,extractJson} from "./html.js";
import {extractPdf} from "./pdf.js";
import {extractImage} from "./ocr.js";
import {DOCUMENT_EXTRACTION_VERSION,type DocumentExtraction,type DocumentReadOptions} from "./types.js";
export async function extractDocument(bytes:Uint8Array,mime:string,url:string,decode:(bytes:Uint8Array,mime:string,url:string)=>string,options:DocumentReadOptions={}):Promise<DocumentExtraction>{
 const prefix=Buffer.from(bytes.subarray(0,16));
 if(mime.toLowerCase().includes("application/pdf")||prefix.toString("ascii").startsWith("%PDF-"))return extractPdf(bytes,options);
 if(/^image\/(?:png|jpe?g|webp|bmp|tiff)/iu.test(mime)||prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||prefix.subarray(0,2).equals(Buffer.from([255,216]))){
  const result=await extractImage(bytes);
  const start=Buffer.byteLength(result.content,"utf8");
  result.content+=`\nRecursos visuales de la página: Imagen: Material discográfico original | URL: ${url} | Dimensiones no medidas; uso y calidad pendientes de inspección.\n`;
  result.locations.push({start,end:Buffer.byteLength(result.content,"utf8"),selector:"document:image-resources"});
  return result;
 }
 const body=decode(bytes,mime,url);
 if(/json/iu.test(mime))return extractJson(body);
 if(/html|xhtml/iu.test(mime)||/^\s*(?:<!doctype html|<html)/iu.test(body))return extractHtml(body,url);
 if(/^text\//iu.test(mime))return {version:DOCUMENT_EXTRACTION_VERSION,format:"text",method:"plain_text",title:new URL(url).pathname,content:body,complete:true,unreadParts:[],warnings:[],locations:[{start:0,end:Buffer.byteLength(body,"utf8"),selector:"document:plain-text"}],followLinks:[]};
 throw new Error(`Formato no legible: ${mime||"sin tipo declarado"}. El original se conserva.`);
}
export async function readBoundedResponse(response:Response):Promise<{bytes:Uint8Array;complete:boolean;reason:string|null}>{
 const max=getEnv().CRV_RESEARCH_DOCUMENT_MAX_BYTES,parts:Uint8Array[]=[];let length=0,reason:string|null=null;
 const reader=response.body?.getReader();
 if(reader){
  try{while(true){const {done,value}=await reader.read();if(done)break;const remaining=max-length;
   if(value.length>remaining){if(remaining>0)parts.push(value.subarray(0,remaining));length=max;await reader.cancel();reason=`Documento excede el límite de ${max} bytes; se conservó la captura parcial.`;break;}
   parts.push(value);length+=value.length;
  }}catch(error){reason=`Descarga interrumpida: ${error instanceof Error?error.message:"Error de red"}`;}
 }
 const declared=Number(response.headers.get("content-length"));
 // Content-Length describes encoded bytes when a server compresses the transfer.
 if(!reason&&!response.headers.get("content-encoding")&&declared>0&&declared!==length)reason=`Descarga incompleta: ${length} de ${declared} bytes.`;
 return {bytes:Buffer.concat(parts),complete:!reason,reason};
}
