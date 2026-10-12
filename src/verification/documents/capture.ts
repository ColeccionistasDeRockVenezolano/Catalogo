import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rename,unlink,statfs} from "node:fs/promises";
import {join,resolve} from "node:path";
import type {Pool,PoolClient} from "pg";
import {getEnv} from "../../config/env.js";
import type {DocumentExtraction} from "./types.js";
type Database=Pick<Pool|PoolClient,"query">;
export interface SourceCapture {
 id:number;key:string;url:string;finalUrl:string;rawHash:string;storedPath:string;contentType:string;byteSize:number;
 capturedAt:string|null;method:"http"|"raw_archive"|"local_archive"|"rendered";
 status:number|null;complete:boolean;reason:string|null;parentId:number|null;extraction:DocumentExtraction|null;
}
export class SourceReadError extends Error {
 constructor(message:string,readonly category:"inaccessible"|"failed"|"storage",readonly captureId?:number){super(message);}
}
export const contentHash=(body:Uint8Array|string)=>createHash("sha256").update(body).digest("hex");
export async function ensureSourceSpace():Promise<void>{
 const root=resolve(getEnv().DATA_DIR);await mkdir(root,{recursive:true});
 const info=await statfs(root,{bigint:true});
 if(info.bavail*info.bsize<BigInt(getEnv().CRV_RESEARCH_MIN_FREE_MB)*1024n*1024n)throw new SourceReadError("Espacio insuficiente para nuevas adquisiciones; las capturas existentes se conservan.","storage");
}
async function atomicWrite(path:string,body:Uint8Array|string):Promise<void>{
 const temporary=`${path}.${randomUUID()}.tmp`;
 try{await writeFile(temporary,body,{flag:"wx"});await rename(temporary,path);}finally{await unlink(temporary).catch(()=>undefined);}
}
export async function preserveCapture(db:Database,input:Omit<SourceCapture,"id"|"key"|"rawHash"|"storedPath"|"byteSize"|"extraction">&{parentKey?:string},bytes:Uint8Array):Promise<SourceCapture>{
 await ensureSourceSpace();
 const rawHash=contentHash(bytes),storedPath=join("research","originals",`${rawHash}.bin`),root=resolve(getEnv().DATA_DIR);
 await mkdir(join(root,"research","originals"),{recursive:true});await mkdir(join(root,"research","captures"),{recursive:true});
 const path=join(root,storedPath);
 let existing:Uint8Array|undefined;
 try{existing=await readFile(path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 if(existing&&contentHash(existing)!==rawHash)throw new SourceReadError("El original conservado no coincide con su hash.","failed");
 if(!existing)await atomicWrite(path,bytes);
 const parentKey=input.parentKey??null;
 const {parentId:_parentId,...identity}=input;
 const key=contentHash(JSON.stringify({...identity,parentKey,rawHash,byteSize:bytes.length}));
 // The receipt survives database failure and is not overwritten by later captures.
 await atomicWrite(join(root,"research","captures",`${key}.json`),JSON.stringify({...input,key,rawHash,storedPath,byteSize:bytes.length,parentKey:parentKey??null}));
 await atomicWrite(join(root,"research","captures",`url-${contentHash(input.url)}.json`),JSON.stringify({url:input.url,key}));
 const result=await db.query<{id:string;extraction:DocumentExtraction|null}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,parent_capture_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,$13) ON CONFLICT(capture_key) DO UPDATE SET capture_key=EXCLUDED.capture_key RETURNING id::text,extraction`,
 [key,input.url,input.finalUrl,rawHash,storedPath,input.contentType,bytes.length,input.capturedAt,input.method,input.status,input.complete,input.reason,input.parentId]);
 return {...input,id:Number(result.rows[0]!.id),key,rawHash,storedPath,byteSize:bytes.length,extraction:result.rows[0]!.extraction};
}
export async function saveExtraction(db:Database,capture:SourceCapture,extraction:DocumentExtraction):Promise<void>{
 const root=resolve(getEnv().DATA_DIR);
 await atomicWrite(join(root,"research","captures",`${capture.key}.extraction.json`),JSON.stringify(extraction));
 await db.query("UPDATE ingest.research_source_captures SET extraction=$2::jsonb WHERE id=$1",[capture.id,JSON.stringify(extraction)]);
 capture.extraction=structuredClone(extraction);
}
export async function loadCapture(db:Database,id:number):Promise<SourceCapture|null>{
 const row=(await db.query<{id:string;capture_key:string;url:string;final_url:string;raw_hash:string;stored_path:string;content_type:string;byte_size:string;captured_at:string|null;acquisition_method:SourceCapture["method"];http_status:number|null;acquisition_complete:boolean;reason:string|null;parent_capture_id:string|null;extraction:DocumentExtraction|null}>("SELECT *,id::text,byte_size::text,captured_at::text,parent_capture_id::text FROM ingest.research_source_captures WHERE id=$1",[id])).rows[0];
 return row?{id:Number(row.id),key:row.capture_key,url:row.url,finalUrl:row.final_url,rawHash:row.raw_hash,storedPath:row.stored_path,contentType:row.content_type,byteSize:Number(row.byte_size),capturedAt:row.captured_at,method:row.acquisition_method,status:row.http_status,complete:row.acquisition_complete,reason:row.reason,parentId:row.parent_capture_id===null?null:Number(row.parent_capture_id),extraction:row.extraction}:null;
}
export async function readCaptureOriginal(capture:SourceCapture):Promise<Uint8Array>{
 if(!/^[a-f0-9]{64}$/u.test(capture.rawHash))throw new SourceReadError("Hash de original inválido.","failed",capture.id);
 const body=await readFile(join(resolve(getEnv().DATA_DIR),"research","originals",`${capture.rawHash}.bin`));
 if(contentHash(body)!==capture.rawHash||body.length!==capture.byteSize)throw new SourceReadError("El original fue alterado o quedó incompleto.","failed",capture.id);
 return body;
}

/** Recover a receipt left between the filesystem capture and its database commit. */
export async function recoverSourceCapture(db:Database,url:string):Promise<SourceCapture|null>{
 const directory=join(resolve(getEnv().DATA_DIR),"research","captures");
 let pointer:{url:string;key:string};
 try{pointer=JSON.parse(await readFile(join(directory,`url-${contentHash(url)}.json`),"utf8")) as typeof pointer;}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
 if(pointer.url!==url||!/^[a-f0-9]{64}$/u.test(pointer.key))throw new SourceReadError("Referencia de captura recuperable inválida.","failed");
 if((await db.query("SELECT id FROM ingest.research_source_captures WHERE capture_key=$1",[pointer.key])).rowCount)return null;
 const restore=async(key:string,depth=0):Promise<SourceCapture>=>{
  if(depth>8||!/^[a-f0-9]{64}$/u.test(key))throw new SourceReadError("Cadena de captura inválida.","failed");
  const existing=(await db.query<{id:string}>("SELECT id::text FROM ingest.research_source_captures WHERE capture_key=$1",[key])).rows[0];
  if(existing)return (await loadCapture(db,Number(existing.id)))!;
  const receipt=JSON.parse(await readFile(join(directory,`${key}.json`),"utf8")) as Omit<SourceCapture,"id"|"extraction">&{parentKey?:string|null};
  if(receipt.key!==key||!/^[a-f0-9]{64}$/u.test(receipt.rawHash)||!Number.isSafeInteger(receipt.byteSize)||receipt.byteSize<0||!['http','raw_archive','local_archive','rendered'].includes(receipt.method))throw new SourceReadError("Recibo de captura inválido.","failed");
  await readCaptureOriginal({...receipt,id:0,extraction:null});
  const parentId=receipt.parentKey?(await restore(receipt.parentKey,depth+1)).id:receipt.parentId;
  const row=(await db.query<{id:string}>(`INSERT INTO ingest.research_source_captures(capture_key,url,final_url,raw_hash,stored_path,content_type,byte_size,captured_at,acquisition_method,http_status,acquisition_complete,reason,parent_capture_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,$13) ON CONFLICT(capture_key) DO UPDATE SET capture_key=EXCLUDED.capture_key RETURNING id::text`,[key,receipt.url,receipt.finalUrl,receipt.rawHash,receipt.storedPath,receipt.contentType,receipt.byteSize,receipt.capturedAt,receipt.method,receipt.status,receipt.complete,receipt.reason,parentId])).rows[0]!;
  const capture=(await loadCapture(db,Number(row.id)))!;
  try{const extraction=JSON.parse(await readFile(join(directory,`${key}.extraction.json`),"utf8")) as DocumentExtraction;await saveExtraction(db,capture,extraction);}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  return capture;
 };
 const capture=await restore(pointer.key);
 return capture.complete&&capture.status!==null&&capture.status>=200&&capture.status<300?capture:null;
}
