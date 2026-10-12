import {load,type CheerioAPI} from "cheerio";
import {pageImageResources} from "../../ambiguity/page-images.js";
import {DOCUMENT_EXTRACTION_VERSION,Transcript,type DocumentExtraction} from "./types.js";
const clean=(text:string)=>text.replace(/\s+/gu," ");
const blocks=new Set(["article","section","div","p","h1","h2","h3","h4","h5","h6","li","ul","ol","tr","blockquote","main","dl","dt","dd"]);
function selector($:CheerioAPI,node:Parameters<CheerioAPI>[0]):string {
  const element=$(node);
  return [...element.parents().toArray().reverse(),...element.toArray()].flatMap(n=>{
    if(!("name" in n))return [];
    const item=$(n);return [`${n.name}:nth-of-type(${item.prevAll(n.name).length+1})`];
  }).join(" > ");
}
export function extractHtml(body:string,url:string,rendered=false):DocumentExtraction {
  const $=load(body),transcript=new Transcript(),warnings:string[]=[],unreadParts:string[]=[],followLinks=new Set<string>();
  const title=clean($("title").first().text()).trim();
  // JSON-LD is parsed as data and indexed by original script plus JSON pointer.
  $('script[type="application/ld+json"]').each((index,element)=>{
    const source=selector($,element);
    try{
      const visit=(value:unknown,pointer:string,depth:number)=>{
        if(depth>64){unreadParts.push(`JSON-LD ${index+1} ${pointer}: profundidad excedida`);return;}
        if(value!==null&&typeof value==="object"){
          for(const [key,child] of Object.entries(value))visit(child,`${pointer}/${key.replace(/~/gu,"~0").replace(/\//gu,"~1")}`,depth+1);
        }else if(value!==null){
          transcript.append(`JSON-LD ${index+1} ${pointer}: `);
          transcript.append(String(value),{context:"structured",selector:`${source} | json-pointer:${pointer}`});transcript.append("\n");
        }
      };
      visit(JSON.parse($(element).text()),"",0);
    }catch{warnings.push(`JSON-LD ${index+1} inválido; el original y el resto de la página se conservan.`);unreadParts.push(`JSON-LD ${index+1}`);}
  });
  // Selectors refer to the unmodified snapshot. Skip template ancestors without
  // deleting DOM nodes or changing their nth-of-type positions.
  const visit=(node:ReturnType<CheerioAPI>[number])=>{
    if(node.type==="text"){
      const text=clean(node.data);if(text.trim())transcript.append(text,{selector:selector($,node.parent??node),context:$(node.parent??node).closest("nav,[role=navigation]").length?"navigation":$(node.parent??node).closest("footer").length?"footer":$(node.parent??node).closest("header").length?"header":"body"});
      else if(text)transcript.append(" ");return;
    }
    if(node.type!=="tag")return;
    const tag=node.name;
    if(["script","style","noscript"].includes(tag))return;
    if(tag==="br"){transcript.append("\n");return;}
    if(blocks.has(tag))transcript.append("\n");
    for(const child of node.children)visit(child);
    if(tag==="td"||tag==="th")transcript.append("\t");
    if(blocks.has(tag))transcript.append("\n");
  };
  for(const node of $("body").toArray())visit(node);
  transcript.append("\nEnlaces de la página:\n");
  $("a[href],iframe[src],object[data],embed[src]").each((_index,element)=>{
    const item=$(element);
    const href=item.attr("href")??item.attr("src")??item.attr("data");if(!href)return;
    try{
      const link=new URL(href,url);if(!/^https?:$/u.test(link.protocol)||link.username||link.password)return;
      const label=clean(item.text()||item.attr("title")||item.attr("aria-label")||"").trim();
      transcript.append(`Enlace: ${label} ${link.href}\n`,{selector:selector($,element)});
      if(/\.pdf(?:$|[?#])/iu.test(link.href)||/application\/pdf/iu.test(item.attr("type")??""))followLinks.add(link.href);
    }catch{ /* Preserve malformed href in the original; it cannot authorize a request. */ }
  });
  $("img").each((_index,element)=>{
    const item=$(element),label=`${item.attr("alt")??""} ${item.attr("title")??""} ${item.closest("figure").find("figcaption").text()}`;
    if(!/tracklist|cr[eé]ditos|libreto|contraportada|liner|booklet|back cover/iu.test(label))return;
    const raw=item.attr("data-original")??item.attr("data-src")??item.attr("src");
    if(raw)try{const target=new URL(raw,url);if(/^https?:$/u.test(target.protocol))followLinks.add(target.href);}catch{ /* Invalid resource. */ }
  });
  transcript.append(`\n${pageImageResources($,url)}\n`,{selector:"document:image-resources"});
  const content=transcript.content;
  return {version:DOCUMENT_EXTRACTION_VERSION,format:rendered?"rendered_html":"html",method:rendered?"rendered_dom":"html+json_ld",title,content,
    complete:!unreadParts.length,unreadParts,warnings,locations:transcript.locations,followLinks:[...followLinks]};
}
export function needsRendering(body:string,extraction:DocumentExtraction):boolean {
  if(/client challenge|just a moment|access denied|attention required/iu.test(extraction.title))return false;
  const $=load(body);
  const text=clean($("body").clone().find("script,style,nav,footer,header").remove().end().text()).trim();
  return $("script[src],script:not([type]),script[type=module]").length>0&&($("#root,#app,#__next,[data-reactroot]").length>0||text.length<100);
}
export function extractJson(body:string):DocumentExtraction {
  const transcript=new Transcript(),unreadParts:string[]=[];
  const visit=(value:unknown,pointer:string,depth:number)=>{
    if(depth>64){unreadParts.push(pointer||"/");return;}
    if(value!==null&&typeof value==="object")for(const [key,child] of Object.entries(value))visit(child,`${pointer}/${key.replace(/~/gu,"~0").replace(/\//gu,"~1")}`,depth+1);
    else{transcript.append(`${pointer||"/"}: `);transcript.append(String(value),{selector:`json-pointer:${pointer||"/"}`,context:"structured"});transcript.append("\n");}
  };
  visit(JSON.parse(body),"",0);
  return {version:DOCUMENT_EXTRACTION_VERSION,format:"json",method:"structured_json",title:"Documento estructurado",content:transcript.content,complete:!unreadParts.length,unreadParts,warnings:[],locations:transcript.locations,followLinks:[]};
}
