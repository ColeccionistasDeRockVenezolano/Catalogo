import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Lectura real (texto nativo + OCR) de fanzines escaneados para el corpus documental.
// Sin red ni modelo. Conserva cada extracción y continúa desde su checkpoint.
// Uso: tsx scripts/stage2-corpus-ocr.ts <manifest.json> <cantidad> <directorio-salida>
export async function main([manifestPath,count,outDir]:string[]):Promise<void>{
  if(!manifestPath||!count||!outDir)throw Error("Uso: stage2-corpus-ocr <manifest.json> <cantidad> <salida>");
  const {extractPdf}=await import("../src/verification/documents/pdf.js");
  const manifest=JSON.parse(await readFile(manifestPath,"utf8")) as {documents:Array<{url:string;bytes:number;sha256:string;original:string;capturedAt:string}>};
  await mkdir(outDir,{recursive:true});
  const selected=[...manifest.documents].sort((a,b)=>a.bytes-b.bytes).slice(0,Number(count));
  for(const doc of selected){
    const target=`${outDir}/${doc.sha256}.extraction.json`;
    let resume:Awaited<ReturnType<typeof extractPdf>>|undefined;
    try{await access(target);resume=JSON.parse(await readFile(target,"utf8")).extraction;if(resume?.complete)continue;}catch{/* First pass. */}
    const bytes=await readFile(doc.original);
    for(let pass=0;pass<6;pass++){
      const before=resume?.processedPages?.length??0;
      const extraction=await extractPdf(bytes,{...(resume?{resume}:{}),checkpoint:async partial=>{await writeFile(target,JSON.stringify({url:doc.url,sha256:doc.sha256,capturedAt:doc.capturedAt,extraction:partial}));}});
      await writeFile(target,JSON.stringify({url:doc.url,sha256:doc.sha256,capturedAt:doc.capturedAt,extraction}));
      process.stderr.write(`${doc.url.split("/").pop()} pasada ${pass+1}: ${extraction.processedPages?.length??0}/${extraction.totalPages??"?"} páginas, ${extraction.content.length} caracteres, completo=${extraction.complete}\n`);
      resume=extraction;
      if(extraction.complete||(extraction.processedPages?.length??0)===before)break;
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
}
