import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { getPool,closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';

const root='reports/reproductores-artistas-2026-10-18';
const confirm=process.argv.includes('--confirm');
interface Input {id:number;artistId:number;platform:string;url:string;status:string;channelId?:string;externalIdResolved?:string;capture?:string;sha256?:string;evidence?:{type:string;id:number;item_url_root:string}}
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
async function main(){
  const youtubePath=`${root}/youtube-resolucion.json`,bandcampPath=`${root}/bandcamp-cache-resolucion.json`;
  const youtube=JSON.parse(readFileSync(youtubePath,'utf8')) as Input[];
  const bandcamp=JSON.parse(readFileSync(bandcampPath,'utf8')) as Input[];
  const candidates=[...youtube.filter(row=>row.status==='resolved'),...bandcamp.filter(row=>row.status==='resolved_from_cache')];
  const plans:Array<Input & {identifier:string}>=[];
  for(const item of candidates){
    let identifier:string;
    if(item.platform==='youtube'){
      if(!/^UC[\w-]{22}$/u.test(item.channelId??''))throw new Error('Identificador de canal inválido');
      identifier=item.channelId!;
    }else{
      if(!item.capture||hash(readFileSync(item.capture))!==item.sha256)throw new Error('Cambió la captura Bandcamp');
      if(!item.evidence||!['a','t'].includes(item.evidence.type)||!Number.isSafeInteger(item.evidence.id)||item.evidence.id<=0)throw new Error('No hay publicación documentada');
      if(new URL(item.url).hostname!==new URL(item.evidence.item_url_root).hostname)throw new Error('La publicación pertenece a otro perfil');
      identifier=`${item.evidence.type==='a'?'album':'track'}=${item.evidence.id}`;
      if(identifier!==item.externalIdResolved)throw new Error('El identificador no corresponde a la evidencia');
    }
    const row=(await getPool().query<{external_id:string|null;url:string;verified:boolean;artist_id:string;platform:string}>('SELECT external_id,url,verified,artist_id,platform FROM public.streaming_links WHERE id=$1',[item.id])).rows[0];
    if(!row||!row.verified||row.url!==item.url||Number(row.artist_id)!==item.artistId||row.platform!==item.platform)throw new Error('Cambió el enlace de perfil');
    if(row.external_id===identifier)continue;
    if(row.external_id)throw new Error('Un identificador existente necesita revisión');
    plans.push({...item,identifier});
  }
  writeFileSync(`${root}/identificadores-pendientes.json`,JSON.stringify(plans,null,2)+'\n');
  if(!plans.length){console.log('0 identificadores pendientes');return;}
  const result=await withOperatorRun({name:'catalogo:identificadores-reproductor-artista',operator:'Codex (encargo de Brian: colocar los reproductores)',
    note:'Completar únicamente external_id en perfiles verificados: canal resuelto por URL exacta en la API oficial de YouTube y publicación con subdominio Bandcamp exacto en capturas conservadas. Conservar URL, identidad, fuente y verificación.',
    params:{sourcePins:[youtubePath,bandcampPath].map(path=>({path,sha256:hash(readFileSync(path))})),plans}},async context=>{
      for(const item of plans){
        const result=await context.client.query(`UPDATE public.streaming_links SET external_id=$1 WHERE id=$2 AND artist_id=$3 AND platform=$4 AND url=$5 AND verified AND coalesce(external_id,'')=''`,[item.identifier,item.id,item.artistId,item.platform,item.url]);
        if(result.rowCount!==1)throw new Error('El perfil cambió durante la aplicación');
      }
      return {changed:plans.length,links:plans.map(item=>item.id)};
    },{rollbackOnly:!confirm});
  writeFileSync(`${root}/identificadores-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify({dryRun:!confirm,runId:confirm?result.runId:null,...result.result},null,2)+'\n');
  console.log(JSON.stringify({dryRun:!confirm,...result}));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
