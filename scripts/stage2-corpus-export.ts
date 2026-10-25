import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";

// Congela los documentos del corpus como páginas serializadas con hash.
// Entrada: [{"id":"d001","evidenceDocumentId":123}|{"id":"d050","ocr":"ruta/<sha>.extraction.json"}] (extracción conservada de PDF/OCR)
// |{"id":"d060","derivedFrom":"d001","inject":{"after":"texto ancla","text":"instrucción ajena"}}: variante sintética marcada, para pruebas de inyección.
// Lee la base en solo lectura; las lecturas OCR se toman de su extracción conservada.
// Uso: tsx scripts/stage2-corpus-export.ts <selección.json> <directorio-corpus>
export async function main([selectionPath,corpusDir]:string[]):Promise<void>{
  if(!selectionPath||!corpusDir)throw Error("Uso: stage2-corpus-export <selección.json> <directorio-corpus>");
  const env=parse(await readFile(".env"));
  const url=new URL(env["DATABASE_URL"]!);url.searchParams.set("options","-c default_transaction_read_only=on");process.env["DATABASE_URL"]=url.href;
  const {getPool,closeDb}=await import("../src/db/client.js");
  const {DOCUMENT_EXTRACTION_VERSION}=await import("../src/verification/documents/types.js");
  const selection=JSON.parse(await readFile(selectionPath,"utf8")) as Array<{id:string;evidenceDocumentId?:number;ocr?:string;derivedFrom?:string;inject?:{after:string;text:string}}>;
  await mkdir(`${corpusDir}/documents`,{recursive:true});
  const manifest:Array<{id:string;file:string;url:string;sha256:string;format:string;bytes:number;origin:string;synthetic?:true}>=[];
  const pages=new Map<string,import("../src/ambiguity/web-search.js").WebPage>(),formats=new Map<string,string>();
  const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
  try{
    // Synthetic variants need their base document first, whatever the selection order.
    for(const item of [...selection.filter(entry=>!entry.derivedFrom),...selection.filter(entry=>entry.derivedFrom)]){
      let page:import("../src/ambiguity/web-search.js").WebPage,origin:string;
      if(item.evidenceDocumentId){
        const row=(await getPool().query<{url:string;title:string;content_text:string;content_hash:string;captured_at:string|null;acquisition_method:string;extraction_metadata:import("../src/verification/documents/types.js").DocumentMetadata|null}>(
          "SELECT url,title,content_text,content_hash,captured_at::text,acquisition_method,extraction_metadata FROM ingest.evidence_documents WHERE id=$1",[item.evidenceDocumentId])).rows[0];
        if(!row||hash(row.content_text)!==row.content_hash)throw Error(`Documento ${item.evidenceDocumentId} ausente o alterado`);
        page={url:row.url,title:row.title,content:row.content_text,contentHash:row.content_hash,fetchedAt:row.captured_at??"",capturedAt:row.captured_at,acquisitionMethod:row.acquisition_method as "http",origin:"page",...(row.extraction_metadata?{document:row.extraction_metadata}:{})};
        origin=`ingest.evidence_documents#${item.evidenceDocumentId}`;
      }else if(item.ocr){
        const saved=JSON.parse(await readFile(item.ocr,"utf8")) as {url:string;sha256:string;capturedAt:string;extraction:import("../src/verification/documents/types.js").DocumentExtraction};
        const content=`${saved.extraction.content}\n[Extracción de documento v${DOCUMENT_EXTRACTION_VERSION}]`;
        page={url:saved.url,title:saved.extraction.title||saved.url.split("/").pop()!,content,contentHash:hash(content),fetchedAt:saved.capturedAt,capturedAt:saved.capturedAt,acquisitionMethod:"http",origin:"page",
          document:{captureId:0,rawHash:saved.sha256,format:saved.extraction.format,method:saved.extraction.method,extractionVersion:saved.extraction.version,complete:saved.extraction.complete,
            unreadParts:saved.extraction.unreadParts,warnings:saved.extraction.warnings,locations:saved.extraction.locations,followLinks:saved.extraction.followLinks}};
        origin=`ocr:${item.ocr}`;
      }else if(item.derivedFrom&&item.inject){
        const base=pages.get(item.derivedFrom),at=base?.content.indexOf(item.inject.after)??-1;
        if(!base||at<0)throw Error(`Selección ${item.id}: base o ancla ausente`);
        const cut=at+item.inject.after.length,content=`${base.content.slice(0,cut)}\n${item.inject.text}\n${base.content.slice(cut)}`;
        page={...base,url:`${base.url}#corpus-injection-${item.id}`,content,contentHash:hash(content)};
        origin=`synthetic-injection:${item.derivedFrom}`;
      }else throw Error(`Selección ${item.id} sin origen`);
      const file=`documents/${item.id}.json`;
      await writeFile(`${corpusDir}/${file}`,`${JSON.stringify(page)}\n`);
      // A PDF counts as scanned when most of its located text comes from OCR rather than the native layer.
      const layer=(kind:string)=>(page.document?.locations??[]).filter(l=>l.selector.startsWith(`pdf:${kind}`)).reduce((n,l)=>n+l.end-l.start,0);
      const format=page.document?.format==="rendered_html"?"rendered":page.document?.format==="pdf"?(layer("ocr")>layer("native")?"ocr":"pdf"):page.document?.format==="json"?"structured":page.document?.format==="image"?"ocr":"html";
      const finalFormat=item.derivedFrom?formats.get(item.derivedFrom)!:format;
      pages.set(item.id,page);formats.set(item.id,finalFormat);
      manifest.push({id:item.id,file,url:page.url,sha256:page.contentHash,format:finalFormat,bytes:Buffer.byteLength(page.content),origin,...(item.derivedFrom?{synthetic:true as const}:{})});
    }
    await writeFile(`${corpusDir}/documents.json`,`${JSON.stringify(manifest,null,2)}\n`);
    process.stdout.write(`${JSON.stringify({documents:manifest.length,synthetic:manifest.filter(d=>d.synthetic).length,byFormat:manifest.filter(d=>!d.synthetic).reduce<Record<string,number>>((n,d)=>({...n,[d.format]:(n[d.format]??0)+1}),{})})}\n`);
  }finally{await closeDb();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
}
