// Incorpora una web por artista a Síguelo/Síguelos, con evidencia y run reversible.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPool,closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
import {writePlatformLink} from '../../src/merge/platform-links.js';
const root='reports/webs-oficiales-2026-10-18',dir=`${root}/revision-990`;
const apply=process.argv.includes('--apply');
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
interface Evidence {artistId:number;name:string;url:string;status:string;siteType?:string;evidence?:Array<{quote:string}>;reason:string;record:string;pages?:Array<{url:string;capture:string;sha256:string;content:string}>;capture?:string;sha256?:string;readContent?:string;identityQuotes?:string[];publisherQuotes?:string[];reviewVersion:number}
const fold=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
const hostname=(s:string)=>new URL(s).hostname.replace(/^www\./u,'');
const sameWebsite=(a:string,b:string)=>{const x=new URL(a),y=new URL(b);return hostname(a)===hostname(b)&&x.pathname.replace(/\/$/u,'')===y.pathname.replace(/\/$/u,'')&&x.search===y.search;};
async function main(){
 const current=(await getPool().query<{id:number;name:string;aliases:string[]}>('select a.id::int,a.name,coalesce((select jsonb_agg(alias) from ingest.artist_aliases where artist_id=a.id),\'[]\'::jsonb) aliases from public.artists a')).rows;
 const byId=new Map(current.map(a=>[a.id,a]));const all:Evidence[]=[];
 const v2:Evidence[]=[];
 for(const f of readdirSync(`${dir}/casos`).filter(f=>f.endsWith('.json'))){const path=`${dir}/casos/${f}`,d=JSON.parse(readFileSync(path,'utf8'));v2.push({...d,url:d.selectedUrl??d.url,record:path});}
 for(const f of readdirSync(`${root}/verificaciones`).filter(f=>f.endsWith('.json'))){const record=`${root}/verificaciones/${f}`,d=JSON.parse(readFileSync(record,'utf8'));if(d.status!=='artist_site')continue;
  const newer=v2.find(v=>v.artistId===d.artistId&&hostname(v.url)===hostname(d.finalUrl));
  if(newer&&newer.status!=='matched')continue;
  all.push({...d,url:d.finalUrl,record,siteType:'artist_site',reviewVersion:1});
 }
 all.push(...v2.filter(d=>d.status==='matched'));
 const scraplingDir=`${dir}/scrapling/evaluacion/casos`;
 // Evaluaciones de reintentos dirigidos, separadas por «:».
 const extraCasosDirs=(process.env['WEBS_EXTRA_CASOS']??'').split(':').filter(Boolean);
 const manualBlocks:Array<{artistId:number;url:string;reason:string}>=[];
 if(existsSync(scraplingDir))for(const f of readdirSync(scraplingDir).filter(f=>f.endsWith('.json'))){
  const record=`${scraplingDir}/${f}`,d=JSON.parse(readFileSync(record,'utf8'));
  if(d.manualReview&&d.status!=='matched')manualBlocks.push({artistId:d.artistId,url:d.url,reason:d.reason});
  if(d.status==='matched')all.push({...d,url:d.selectedUrl??d.url,record});
 }
 for(const extraDir of extraCasosDirs)if(existsSync(extraDir))for(const f of readdirSync(extraDir).filter(f=>f.endsWith('.json'))){
  const record=`${extraDir}/${f}`,d=JSON.parse(readFileSync(record,'utf8'));
  if(d.manualReview&&d.status!=='matched')manualBlocks.push({artistId:d.artistId,url:d.url,reason:d.reason});
  if(d.status==='matched')all.push({...d,url:d.selectedUrl??d.url,record});
 }
 const rejected:Array<{artistId:number;url:string;reason:string}>=[];
 const PROPIAS=new Set(['artist_site','official_shop','artist_blog','artist_archive']);
 const valid=all.filter(e=>{
  if(!PROPIAS.has(e.siteType??'other')){rejected.push({artistId:e.artistId,url:e.url,reason:'Referencia de terceros o página no propia: no se publica como Web'});return false;}
  const blocked=manualBlocks.find(b=>b.artistId===e.artistId&&sameWebsite(b.url,e.url));
  if(blocked){rejected.push(blocked);return false;}
  const a=byId.get(e.artistId);if(!a||![a.name,...a.aliases].some(n=>fold(n)===fold(e.name))){rejected.push({artistId:e.artistId,url:e.url,reason:'La ficha ya no corresponde a la identidad investigada'});return false;}
  if(!/^https?:$/u.test(new URL(e.url).protocol))throw new Error('Protocolo inválido');
  if(e.reviewVersion===1){
   if(!e.capture||!e.sha256||digest(e.capture)!==e.sha256)throw new Error(`Captura alterada: ${e.record}`);
   if(!e.identityQuotes?.length||!e.publisherQuotes?.length||[...e.identityQuotes,...e.publisherQuotes].some(q=>!e.readContent?.includes(q)))throw new Error(`Citas inválidas: ${e.record}`);
  }else{
   if(!e.evidence?.length||!e.pages?.length)throw new Error(`Sin evidencia: ${e.record}`);
   for(const p of e.pages??[]){if(!existsSync(p.capture)||digest(p.capture)!==p.sha256)throw new Error(`Captura alterada: ${e.record}`);}
   const text=e.pages.map(p=>`URL: ${p.url}\n${p.content}`).join('\n\n');
   if(e.evidence.some(q=>!text.includes(q.quote)))throw new Error(`Cita no literal: ${e.record}`);
  }return true;
 });
 const grouped=new Map<number,Evidence[]>();for(const e of valid)grouped.set(e.artistId,[...(grouped.get(e.artistId)??[]),e]);
 const priorities:Record<string,number>={artist_site:100,official_shop:75,artist_blog:70,artist_archive:65,artist_profile:50,third_party:30,other:20};
 const rank=(e:Evidence)=>{const u=new URL(e.url);return (priorities[e.siteType??'other']??20)+(u.pathname==='/'?15:0)+(u.protocol==='https:'?3:0)+(e.reviewVersion>=2?3:0);};
 const selected=[...grouped.values()].map(es=>es.sort((a,b)=>rank(b)-rank(a)||a.url.localeCompare(b.url))[0]!);
 const byUrl=new Map<string,Set<number>>();for(const e of selected){const u=new URL(e.url);const key=hostname(e.url)+u.pathname.replace(/\/$/u,'');byUrl.set(key,new Set([...(byUrl.get(key)??[]),e.artistId]));}
 const plans:Array<{artistId:number;name:string;url:string;siteType:string|undefined;evidenceRecord:string;evidenceHash:string;reason:string}>=[];
 for(const e of selected){const u=new URL(e.url);if((byUrl.get(hostname(e.url)+u.pathname.replace(/\/$/u,''))?.size??0)>1){rejected.push({artistId:e.artistId,url:e.url,reason:'La misma web quedó atribuida a dos fichas; revisar identidades antes de publicar'});continue;}
  const stored=(await getPool().query('select url,verified from public.social_links where artist_id=$1 and platform=\'website\'',[e.artistId])).rows[0];
  if(stored){if(sameWebsite(stored.url,e.url)&&stored.verified)continue;rejected.push({artistId:e.artistId,url:e.url,reason:'Hay una web existente: conservar la decisión y revisar el reemplazo'});continue;}
  plans.push({artistId:e.artistId,name:byId.get(e.artistId)!.name,url:e.url,siteType:e.siteType,evidenceRecord:e.record,evidenceHash:digest(e.record),reason:e.reason});
 }
 const oldPlans=existsSync(`${dir}/plan-webs.json`)?JSON.parse(readFileSync(`${dir}/plan-webs.json`,'utf8')).plans:[];
 const planHistory=new Map<number,unknown>((oldPlans as Array<{artistId:number}>).map(p=>[p.artistId,p]));for(const p of plans)planHistory.set(p.artistId,p);
 writeFileSync(`${dir}/plan-webs.json`,JSON.stringify({plans:[...planHistory.values()],pendingPlans:plans,rejected},null,2)+'\n');
 if(!plans.length){console.log(JSON.stringify({changes:0,rejected:rejected.length}));return;}
 const result=await withOperatorRun({name:'catalogo:webs-artistas-990',operator:'Codex por encargo de Brian',note:'Añadir Web a Síguelo/Síguelos. Brian autorizó usar páginas cuya identidad musical coincida por nombre y contexto, biografía, discografía o enlaces de streaming del catálogo; incluye landings y tiendas del artista. Evidencia y capturas conservadas por página.',params:{criteria:'Brian 2026-10-18: identidad por contenido o streaming',plans}},async context=>{
  for(const p of plans){
   if(digest(p.evidenceRecord)!==p.evidenceHash)throw new Error('Cambió la evidencia antes de escribir');
   const row=(await context.client.query('select name from public.artists where id=$1 for key share',[p.artistId])).rows[0];if(row?.name!==p.name)throw new Error('La identidad cambió durante la aplicación');
   const existing=await context.client.query('select id from public.social_links where artist_id=$1 and platform=\'website\'',[p.artistId]);if(existing.rowCount)throw new Error('Se añadió una web durante la aplicación');
   await writePlatformLink({...context,note:`${context.note}\nArtista: ${p.name}. Evidencia: ${p.evidenceRecord} (sha256 ${p.evidenceHash}). ${p.reason}`},'artist',p.artistId,'social','website',{url:p.url,handle:null,verified:true});
  }return {changed:plans.length,artistIds:plans.map(p=>p.artistId)};
 },{rollbackOnly:!apply});
 const previous=apply&&existsSync(`${dir}/aplicacion.json`)?JSON.parse(readFileSync(`${dir}/aplicacion.json`,'utf8')):null;
 const individual={dryRun:!apply,...result,rejected};
 if(apply)writeFileSync(`${dir}/aplicacion-${result.runId}.json`,JSON.stringify(individual,null,2)+'\n');
 if(previous&&!existsSync(`${dir}/aplicacion-${previous.runId}.json`))writeFileSync(`${dir}/aplicacion-${previous.runId}.json`,JSON.stringify(previous,null,2)+'\n');
 const aggregate=previous?{...individual,runIds:[...(previous.runIds??[previous.runId]),result.runId],result:{changed:previous.result.changed+result.result.changed,artistIds:[...new Set([...previous.result.artistIds,...result.result.artistIds])]}}:individual;
 writeFileSync(`${dir}/${apply?'aplicacion':'ensayo'}.json`,JSON.stringify(aggregate,null,2)+'\n');console.log(JSON.stringify({dryRun:!apply,runId:result.runId,changed:result.result.changed,rejected:rejected.length}));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
