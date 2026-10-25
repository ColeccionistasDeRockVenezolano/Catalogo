import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {load} from "cheerio";
import {getEnv} from "../../config/env.js";
import {extractImage} from "./ocr.js";
import {corroborateNativeLayer} from "./visibility.js";
import {DOCUMENT_EXTRACTION_VERSION,Transcript,type DocumentExtraction,type DocumentReadOptions,type DocumentPart} from "./types.js";
const run=promisify(execFile);
/** Read one original PDF page at a time, checkpointing native text even when that page's OCR fails. */
export async function extractPdf(bytes:Uint8Array,options:DocumentReadOptions={}):Promise<DocumentExtraction>{
 const env=getEnv(),directory=await mkdtemp(join(tmpdir(),"crv-research-pdf-")),path=join(directory,"original.pdf"),started=Date.now();
 try{
  await writeFile(path,bytes);
  const metadata=await run(env.CRV_RESEARCH_PDF_INFO_COMMAND,["-enc","UTF-8",path],{timeout:env.CRV_RESEARCH_DOCUMENT_TIMEOUT_MS,maxBuffer:1024*1024});
  const total=Number(/^Pages:\s+(\d+)/mu.exec(metadata.stdout)?.[1]);if(!Number.isSafeInteger(total)||total<1)throw new Error("No se pudo contar las páginas del PDF; el original se conserva.");
  const title=/^Title:\s+(.+)$/mu.exec(metadata.stdout)?.[1]??"Documento PDF";
  let imagePages:Set<number>|null=null;
  try{
   const images=await run(env.CRV_RESEARCH_PDF_IMAGES_COMMAND,["-list",path],{timeout:env.CRV_RESEARCH_DOCUMENT_TIMEOUT_MS,maxBuffer:env.CRV_RESEARCH_DOCUMENT_MAX_BYTES});
   imagePages=new Set(images.stdout.split("\n").flatMap(line=>{const match=/^\s*(\d+)\s+\d+\s+image\b/u.exec(line);return match?[Number(match[1])]:[];}));
  }catch{ /* Without image detection, OCR every page so mixed scans are not silently skipped. */ }
  const old=options.resume?.format==="pdf"&&options.resume.version===DOCUMENT_EXTRACTION_VERSION?options.resume:undefined;
  const parts=new Map((old?.parts??[]).map(part=>[part.page,part]));let read=0,failure:string|null=null;
  const report=():DocumentExtraction=>{
   const transcript=new Transcript(),ordered=[...parts.values()].sort((a,b)=>a.page-b.page);
   for(const part of ordered){const start=Buffer.byteLength(transcript.content,"utf8");transcript.append(part.content);transcript.locations.push(...part.locations.map(location=>({...location,start:location.start+start,end:location.end+start})));}
   const processed=ordered.filter(part=>part.complete).map(part=>part.page);
   return {version:DOCUMENT_EXTRACTION_VERSION,format:"pdf",method:ordered.some(part=>part.method.includes("ocr"))?"pdf_text+ocr":"pdf_text",title,content:transcript.content,
    complete:processed.length===total,unreadParts:Array.from({length:total},(_,n)=>n+1).filter(n=>!processed.includes(n)).map(n=>parts.get(n)?.warnings.find(warning=>warning.startsWith(`Página ${n}: `))??`Página ${n}${failure?`: ${failure}`:""}`),
    warnings:[...new Set(ordered.flatMap(part=>part.warnings))],locations:transcript.locations,followLinks:[],parts:ordered,processedPages:processed,totalPages:total};
  };
  for(let number=1;number<=total;number++){
   if(parts.get(number)?.complete)continue;
   if(read>=env.CRV_RESEARCH_DOCUMENT_MAX_PAGES){failure="Límite de páginas de esta ejecución alcanzado";break;}
   if(Date.now()-started>=env.CRV_RESEARCH_DOCUMENT_TIMEOUT_MS){failure="Tiempo de lectura de PDF alcanzado";break;}
   if(options.continue&&!await options.continue()){failure="Lectura pausada por el trabajo";break;}
   const transcript=new Transcript();transcript.append(`\nPágina PDF ${number}\n`);
   let part:DocumentPart={page:number,method:"pdf_text",content:"",locations:[],warnings:[],complete:false};
   try{
    const remaining=()=>Math.max(1,env.CRV_RESEARCH_DOCUMENT_TIMEOUT_MS-(Date.now()-started));
    const native=await run(env.CRV_RESEARCH_PDF_TEXT_COMMAND,["-f",String(number),"-l",String(number),"-bbox-layout","-enc","UTF-8",path,"-"],{timeout:remaining(),maxBuffer:env.CRV_RESEARCH_DOCUMENT_MAX_BYTES});
    const $=load(native.stdout,{xml:true}),page=$("page").first();
    page.find("line").each((_lineIndex,line)=>{
     $(line).find("word").each((_wordIndex,word)=>{
      const item=$(word),x=Number(item.attr("xMin")),y=Number(item.attr("yMin")),right=Number(item.attr("xMax")),bottom=Number(item.attr("yMax"));
      transcript.append(`${item.text()} `,{selector:"pdf:native-word",page:number,...([x,y,right,bottom].every(Number.isFinite)?{bbox:{x,y,width:right-x,height:bottom-y,unit:"pt" as const}}:{})});
     });transcript.append("\n");
    });
    // Save the useful native layer before attempting recognition of mixed/scanned material.
    part={...part,content:transcript.content,locations:transcript.locations};parts.set(number,part);await options.checkpoint?.(report());
    if(!page.find("word").length||imagePages===null||imagePages.has(number)){
     const prefix=join(directory,`page-${number}`);
     await run(env.CRV_RESEARCH_PDF_RENDER_COMMAND,["-f",String(number),"-l",String(number),"-singlefile","-scale-to",String(env.CRV_RESEARCH_PDF_RASTER_SIZE),"-png",path,prefix],{timeout:remaining(),maxBuffer:1024*1024});
     const raster=await readFile(`${prefix}.png`),ocr=await extractImage(raster,remaining());
     const width=raster.readUInt32BE(16),height=raster.readUInt32BE(20),sx=Number(page.attr("width"))/width,sy=Number(page.attr("height"))/height;
     const offset=Buffer.byteLength(transcript.content,"utf8");transcript.append(`\n${ocr.content}`);
     transcript.locations.push(...ocr.locations.map(location=>({...location,page:number,selector:"pdf:ocr-word",start:location.start+offset+1,end:location.end+offset+1,
      ...(location.bbox&&Number.isFinite(sx)&&Number.isFinite(sy)?{bbox:{x:location.bbox.x*sx,y:location.bbox.y*sy,width:location.bbox.width*sx,height:location.bbox.height*sy,unit:"pt" as const}}:{})})));
     part={...part,method:"pdf_text+ocr",warnings:ocr.warnings};await rm(`${prefix}.png`,{force:true});
     const uncorroborated=corroborateNativeLayer(transcript.content,transcript.locations);
     if(uncorroborated)part.warnings.push(`${uncorroborated} palabras de la capa nativa no coinciden con la lectura de sus posiciones visibles; se conservan como alternativas no corroboradas y no respaldan datos.`);
     if(!ocr.complete){
      // A page without legible text (illustrated cover, photo) stays unread without stopping the rest of the document.
      if(!ocr.content.trim()){part={...part,content:transcript.content,locations:transcript.locations,warnings:[...part.warnings,`Página ${number}: ${ocr.unreadParts.join("; ")}`]};parts.set(number,part);read++;await options.checkpoint?.(report());continue;}
      throw new Error(ocr.unreadParts.join("; "));
     }
    }
    part={...part,content:transcript.content,locations:transcript.locations,complete:true};
   }catch(error){failure=`Página ${number}: ${error instanceof Error?error.message:"Falló la lectura"}`;part={...part,content:transcript.content,locations:transcript.locations,warnings:[...part.warnings,failure]};}
   parts.set(number,part);read++;await options.checkpoint?.(report());if(failure)break;
  }
  return report();
 }finally{await rm(directory,{recursive:true,force:true});}
}
