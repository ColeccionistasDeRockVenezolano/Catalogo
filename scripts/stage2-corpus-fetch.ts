import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Adquiere documentos reales para el corpus documental: descarga pública con DNS
// fijado, original conservado por SHA-256 y extracción con checkpoint. Sin modelo.
// Entrada: lista de URL (una por línea). Uso: tsx scripts/stage2-corpus-fetch.ts <urls.txt> <directorio>
export async function main([listPath,outDir]:string[]):Promise<void>{
  if(!listPath||!outDir)throw Error("Uso: stage2-corpus-fetch <urls.txt> <directorio>");
  const {publicPageFetch}=await import("../src/verification/documents/public-url.js");
  const {readBoundedResponse,extractDocument}=await import("../src/verification/documents/reader.js");
  const {decodeWebPage}=await import("../src/ambiguity/web-search.js");
  const urls=(await readFile(listPath,"utf8")).split("\n").map(line=>line.trim()).filter(line=>line&&!line.startsWith("#"));
  await mkdir(`${outDir}/originals`,{recursive:true});
  const manifestPath=`${outDir}/manifest.json`;
  let manifest:{documents:Array<Record<string,unknown>>}={documents:[]};
  try{manifest=JSON.parse(await readFile(manifestPath,"utf8"));}catch{/* New acquisition directory. */}
  for(const url of urls){
    if(manifest.documents.some(d=>d["url"]===url&&d["extraction"]))continue;
    const entry:Record<string,unknown>={url,capturedAt:new Date().toISOString(),groundTruthReviewed:false};
    try{
      let response=await publicPageFetch(url),target=new URL(url);
      // Each redirect target passes the public-address check again.
      for(let hop=0;hop<5&&response.status>=300&&response.status<400&&response.headers.get("location");hop++){target=new URL(response.headers.get("location")!,target);response=await publicPageFetch(target);}
      const {bytes,complete,reason}=await readBoundedResponse(response);
      const sha256=createHash("sha256").update(bytes).digest("hex");
      Object.assign(entry,{status:response.status,finalUrl:target.href,mime:response.headers.get("content-type")??"",bytes:bytes.length,complete,reason,sha256,original:`${outDir}/originals/${sha256}.bin`});
      if(response.status!==200)throw Error(`HTTP ${response.status}`);
      await writeFile(entry["original"] as string,bytes);
      const target2=`${outDir}/${sha256}.extraction.json`;
      let resume;try{await access(target2);resume=JSON.parse(await readFile(target2,"utf8")).extraction;}catch{/* First pass. */}
      const extraction=await extractDocument(bytes,entry["mime"] as string,target.href,decodeWebPage,{...(resume?{resume}:{}),
        checkpoint:async partial=>{await writeFile(target2,JSON.stringify({url,sha256,capturedAt:entry["capturedAt"],extraction:partial}));}});
      await writeFile(target2,JSON.stringify({url,sha256,capturedAt:entry["capturedAt"],extraction}));
      Object.assign(entry,{extraction:target2,format:extraction.format,method:extraction.method,characters:extraction.content.length,extractionComplete:extraction.complete,pages:extraction.totalPages??null});
    }catch(error){entry["error"]=error instanceof Error?error.message:String(error);}
    manifest.documents=[...manifest.documents.filter(d=>d["url"]!==url),entry];
    await writeFile(manifestPath,`${JSON.stringify(manifest,null,2)}\n`);
    process.stderr.write(`${url} → ${entry["error"]??`${entry["format"]} ${entry["method"]} ${entry["characters"]} car. completo=${entry["extractionComplete"]}`}\n`);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
}
