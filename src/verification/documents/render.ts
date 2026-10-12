import {chromium} from "playwright";
import {assertPublicPageUrl} from "./public-url.js";
import {getEnv} from "../../config/env.js";
export interface RenderResult {html:string;complete:boolean;warnings:string[];acquired:boolean;}
export type PublicResourceFetcher=(url:string)=>Promise<Response>;
/** Empty context, no service workers or writes; subresources pass through the same URL guard. */
export async function renderDocument(url:string,original:string,fetcher:PublicResourceFetcher):Promise<RenderResult>{
 const env=getEnv(),browser=await chromium.launch({headless:true,timeout:getEnv().CRV_RESEARCH_RENDER_TIMEOUT_MS,args:["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const work=(async()=>{
  const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false});
  const warnings:string[]=[];let complete=true,served=false,downloaded=0;
  const rootUrl=new URL(url);rootUrl.hash="";
  await context.routeWebSocket("**/*",socket=>socket.close());
  await context.route("**/*",async route=>{
   const request=route.request();
   if(!["GET","HEAD"].includes(request.method()))return route.abort("blockedbyclient");
   if(!/^https?:\/\//u.test(request.url()))return route.abort("blockedbyclient");
   try{
    if(!served&&request.isNavigationRequest()&&new URL(request.url()).href===rootUrl.href){served=true;return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:original});}
    await assertPublicPageUrl(request.url());
    const response=await fetcher(request.url());
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const reader=response.body?.getReader(),parts:Uint8Array[]=[];
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;downloaded+=value.length;if(downloaded>env.CRV_RESEARCH_DOCUMENT_MAX_BYTES){await reader.cancel();throw new Error("Presupuesto de recursos renderizados alcanzado");}parts.push(value);}
    return route.fulfill({status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/octet-stream"},body:Buffer.concat(parts)});
   }catch(error){
    if(["script","xhr","fetch","document"].includes(request.resourceType())){complete=false;warnings.push(`Recurso de renderizado pendiente: ${request.url()}. ${error instanceof Error?error.message:"Error de red"}`);}
    return route.abort("failed");
   }
  });
  const page=await context.newPage();
  try{await page.goto(url,{waitUntil:"domcontentloaded",timeout:env.CRV_RESEARCH_RENDER_TIMEOUT_MS});await page.waitForLoadState("networkidle",{timeout:env.CRV_RESEARCH_RENDER_TIMEOUT_MS});}
  catch(error){complete=false;warnings.push(`Renderizado parcial: ${error instanceof Error?error.message:"Tiempo de espera"}`);}
  return {html:await page.content(),complete,warnings,acquired:true};
  })();
  return await Promise.race([work,new Promise<RenderResult>(resolve=>{timer=setTimeout(()=>resolve({html:original,complete:false,acquired:false,warnings:["El renderizado excedió su tiempo; se conserva el HTML obtenido y queda pendiente la página dinámica."]}),env.CRV_RESEARCH_RENDER_TIMEOUT_MS);})]);
 }finally{if(timer)clearTimeout(timer);await browser.close();}
}
