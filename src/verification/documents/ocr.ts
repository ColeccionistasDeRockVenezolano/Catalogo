import {mkdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createWorker,OEM,PSM,type Worker} from "tesseract.js";
import {getEnv} from "../../config/env.js";
import {DOCUMENT_EXTRACTION_VERSION,Transcript,type DocumentExtraction} from "./types.js";
let queue:Promise<unknown>=Promise.resolve();
/** Bounded worker lifetime; original images are preserved before recognition starts. */
export async function extractImage(bytes:Uint8Array,timeoutMs=getEnv().CRV_RESEARCH_DOCUMENT_TIMEOUT_MS):Promise<DocumentExtraction>{
 const previous=queue;let release:()=>void=()=>undefined;
 queue=new Promise<void>(resolve=>{release=resolve;});await previous.catch(()=>undefined);
 let worker:Worker|undefined,timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const env=getEnv(),cachePath=join(resolve(env.DATA_DIR),"research","ocr");await mkdir(cachePath,{recursive:true});
  const work=(async()=>{
   const created=await createWorker(env.CRV_RESEARCH_OCR_LANGUAGES,OEM.LSTM_ONLY,{cachePath,...(env.CRV_RESEARCH_OCR_LANG_PATH?{langPath:env.CRV_RESEARCH_OCR_LANG_PATH}:{}),errorHandler:()=>undefined});
   if(timedOut){await created.terminate();throw new Error("Tiempo de OCR agotado");}worker=created;
   await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO,preserve_interword_spaces:"1"});
   const {data}=await worker.recognize(Buffer.from(bytes),{},{text:true,blocks:true});
   const transcript=new Transcript(),alternatives:Array<{text:string;confidence:number}>=[];
   // A whole-page reading can join letters and numbers across spaces (editions,
   // dates and positions). Re-read those lines using their actual image rectangle.
   for(const block of data.blocks??[])for(const paragraph of block.paragraphs)for(const line of paragraph.lines){
    if(!line.words.some(word=>/\p{L}/u.test(word.text)&&/\p{N}/u.test(word.text)))continue;
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,preserve_interword_spaces:"1"});
    const result=await worker.recognize(Buffer.from(bytes),{rectangle:{left:line.bbox.x0,top:line.bbox.y0,width:line.bbox.x1-line.bbox.x0,height:line.bbox.y1-line.bbox.y0}},{text:true,blocks:true});
    const words=(result.data.blocks??[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.flatMap(line=>line.words)));
    if(!words.length)continue;
    const mean=(items:typeof words)=>items.reduce((sum,word)=>sum+word.confidence,0)/items.length;
    if(words.map(word=>word.text).join(" ")!==line.words.map(word=>word.text).join(" ")){
      alternatives.push({text:line.words.map(word=>word.text).join(" "),confidence:mean(line.words)},{text:words.map(word=>word.text).join(" "),confidence:mean(words)});
      if(mean(words)>mean(line.words))line.words=words;
    }
   }

   for(const block of data.blocks??[])for(const paragraph of block.paragraphs)for(const line of paragraph.lines){
    for(const word of line.words){
     transcript.append(`${word.text} `,{selector:"image:ocr-word",confidence:word.confidence,bbox:{x:word.bbox.x0,y:word.bbox.y0,width:word.bbox.x1-word.bbox.x0,height:word.bbox.y1-word.bbox.y0,unit:"px"}});
    }
    transcript.append("\n");
   }
   if(!transcript.content.trim())transcript.append(data.text,{selector:"image:ocr-text",confidence:data.confidence});
   return {version:DOCUMENT_EXTRACTION_VERSION,format:"image" as const,method:"tesseract_ocr",title:"Material discográfico escaneado",content:transcript.content,complete:Boolean(transcript.content.trim()),unreadParts:transcript.content.trim()?[]:["El OCR no recuperó texto; el original queda pendiente de lectura."],
     alternatives,
     warnings:[...(alternatives.length?["Hubo lecturas OCR alternativas; se conservan con su confianza y requieren comprobar el original."]:[]),`Texto obtenido mediante OCR; confianza media declarada: ${data.confidence.toFixed(1)} %. Revisa el original para comprobar nombres, fechas y posiciones.`],locations:transcript.locations,followLinks:[]};
  })();
  return await Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error("Tiempo de OCR agotado; el original se conserva para reanudar."));},timeoutMs);})]);
 }finally{if(timer)clearTimeout(timer);await worker?.terminate().catch(()=>undefined);release();}
}
