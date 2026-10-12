import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {Readable} from "node:stream";
import {createGunzip,createInflate,createBrotliDecompress} from "node:zlib";
import {getEnv} from "../../config/env.js";
function privateAddress(address:string):boolean{
 const ip=address.toLowerCase();
 if(ip.includes(":")){
  const first=parseInt(ip.split(":")[0]!,16);
  return !(first>=0x2000&&first<=0x3fff)||ip.startsWith("2001:db8:")||ip.startsWith("2002:")||ip.startsWith("2001:0:");
 }
 const p=ip.split(".").map(Number);
 return p[0]===0||p[0]===10||p[0]===127||p[0]!>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]!>=16&&p[1]!<=31)||
  (p[0]===192&&(p[1]===168||p[1]===0))||(p[0]===100&&p[1]!>=64&&p[1]!<=127)||(p[0]===198&&(p[1]===18||p[1]===19));
}
async function publicTarget(raw:string){
 const url=new URL(raw),host=url.hostname.replace(/^\[|\]$/gu,"");
 if(!["https:","http:"].includes(url.protocol)||url.username||url.password||(url.port&&!["80","443"].includes(url.port)))throw new Error("URL de página no permitida");
 if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("host interno no permitido");
 const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
 if(!addresses.length||addresses.some(item=>privateAddress(item.address)))throw new Error("dirección interna no permitida");
 return {url,addresses};
}
export async function assertPublicPageUrl(raw:string):Promise<URL>{return (await publicTarget(raw)).url;}
/** Pin the validated DNS result in the connection; redirects are validated separately by the caller. */
export async function publicPageFetch(raw:string|URL):Promise<Response>{
 const {url,addresses}=await publicTarget(String(raw));
 return new Promise<Response>((resolve,reject)=>{
  const request=(url.protocol==="https:"?httpsRequest:httpRequest)(url,{
   signal:AbortSignal.timeout(getEnv().CRV_RESEARCH_RENDER_TIMEOUT_MS),
   headers:{"user-agent":getEnv().CRAWL_USER_AGENT,accept:"text/html,application/json,application/pdf,image/*,text/plain","accept-encoding":"identity"},
   lookup:(_hostname,options,callback)=>{
    const selected=options.family?addresses.filter(item=>item.family===options.family):addresses;
    if(!selected.length)return callback(new Error("La dirección validada no pertenece a la familia solicitada"),"",0);
    if(options.all)return callback(null,selected);
    callback(null,selected[0]!.address,selected[0]!.family);
   },
  },response=>{
   const headers=new Headers();
   for(const [name,value] of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(","):value);
   let stream:Readable=response;
   const encoding=headers.get("content-encoding");
   if(encoding==="gzip")stream=response.pipe(createGunzip());
   else if(encoding==="deflate")stream=response.pipe(createInflate());
   else if(encoding==="br")stream=response.pipe(createBrotliDecompress());
   if(stream!==response){response.on("error",error=>stream.destroy(error));headers.delete("content-encoding");headers.delete("content-length");}
   const status=response.statusCode??502;
   resolve(new Response([204,205,304].includes(status)?null:Readable.toWeb(stream) as ReadableStream<Uint8Array>,{status,headers}));
  });
  request.once("error",reject);request.once("upgrade",(_response,socket)=>{socket.destroy();reject(new Error("No se permite cambiar el protocolo de lectura"));});request.end();
 });
}
