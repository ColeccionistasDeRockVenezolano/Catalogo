import {createHash} from "node:crypto";
import type {DocumentMetadata} from "./types.js";
const keys=new WeakMap<DocumentMetadata,string>();
/** A new interpretation never rewrites an older document's positional evidence. */
export function extractionKey(document:DocumentMetadata):string{
 const previous=keys.get(document);if(previous)return previous;
 const key=createHash("sha256").update(JSON.stringify({rawHash:document.rawHash,format:document.format,method:document.method,version:document.extractionVersion,complete:document.complete,locations:document.locations})).digest("hex");
 keys.set(document,key);return key;
}
