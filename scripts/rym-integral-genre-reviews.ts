import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';
import {assertRymIdentity,readRymIdentityLedger,verifyRymPin,type RymCross} from '../src/verification/rym-identity.js';

const directory=(()=>{const i=process.argv.indexOf('--dir'),v=process.argv[i+1];if(i<0||!v)throw new Error('--dir obligatorio');return v;})();
const confirm=process.argv.includes('--confirm');
const decisions=[
 {id:1859691,kind:'artist',entityId:3801,required:[577],preserved:[128,481],genreCase:'compound_value',reason:'«Tradicional» es un descriptor amplio, no un subgénero nuevo que deba inventarse. Se conserva el texto original y las sugerencias de Música tradicional y Pop, junto a Onda nueva confirmada por RYM; no hay evidencia para forzar un principal ni para descartar una de las etiquetas.'},
 {id:1859692,kind:'artist',entityId:3801,required:[577],preserved:[128,481],genreCase:'source_disagreement',reason:'Traditional y «tradicional, pop» no son afirmaciones mutuamente excluyentes. Se conservan ambas sugerencias, sus fuentes y Onda nueva documentada en RYM. La advertencia no justifica elegir un único género o borrar evidencia.'},
 {id:1859693,kind:'artist',entityId:277,required:[127,144,230],preserved:[],genreCase:'primary_disagreement',reason:'Rockabilly, Punk y Ska punk coexisten en las asignaciones confirmadas de Los Mentas. Las fuentes describen facetas compatibles; se conservan todas y no se impone un principal a partir de su orden en una lista.'},
 {id:1859694,kind:'artist',entityId:4661,required:[125,139,156],preserved:[],genreCase:'compound_value',reason:'El descriptor «rock, alternativo» ya tiene contexto de Rock y Rock alternativo en la ficha, además del Noise Rock documentado en RYM. Se conserva la evidencia y las asignaciones actuales, sin inventar un género independiente llamado «alternativo».'},
 {id:1859695,kind:'artist',entityId:259,required:[125,139,295],preserved:[],genreCase:'compound_value',reason:'La ficha de Viniloversus ya conserva Rock y Rock alternativo; RYM documenta además Indie Rock, Alternative Rock, Power Pop, Post-Grunge, Neo-Psychedelia y New Wave. El adjetivo aislado «alternativo» no requiere otro término ni una tarea pendiente.'},
 {id:1860065,kind:'album',entityId:7114,required:[131,142,467,578],preserved:[],genreCase:'human_contradiction',reason:'En Tercera Etapa permanecen confirmados Fusión latina, Gaita y Pop rock junto a Salsa romántica, refinamiento documentado por RYM de la Salsa añadida por esta campaña. La diferencia de principal con «Latin/Gaita-Salsa» no niega esos géneros; se conservan todos y sus fuentes.'},
] as const;
async function main(){
 const ledger=readRymIdentityLedger(path.join(directory,'identity-ledger.json'));
 const cross=readFileSync(path.join(directory,'cruce.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as RymCross);
 const result=await withOperatorRun({name:'catalogo:rym-integral-resolver-avisos-generos',operator:'Codex (encargo de Brian: resolver sin dejar cola)',note:'Revisión de seis avisos secundarios abiertos por el recálculo: conservar géneros compatibles, sugerencias y evidencia; no borrar ni reclasificar fichas para silenciar avisos.',params:{campaign:'rym-integral-2026-10-21',phase:'genre_reviews',decisions}},async ctx=>{
  const output=[];
  for(const decision of decisions){
   const review=(await ctx.client.query<{id:number;kind:string;status:string;payload:{origin:string;genreCase:string;entityKind:string;entityId:number;fingerprint:string}}>('SELECT id::int,kind,status,payload FROM ingest.review_queue WHERE id=$1 FOR UPDATE',[decision.id])).rows[0];
   if(!review||review.kind!=='genre_unknown'||review.payload.origin!=='genres'||review.payload.genreCase!==decision.genreCase||review.payload.entityKind!==decision.kind||review.payload.entityId!==decision.entityId)throw new Error(`Aviso inesperado: ${decision.id}`);
   const release=decision.kind==='album'?cross.find(r=>r.albumId===decision.entityId):undefined;
   const identity=ledger.identities.find(e=>e.status==='resolved'&&e.artistId===(release?.artistId??decision.entityId));
   if(!identity)throw new Error('Identidad RYM no acreditada');
   await assertRymIdentity(ctx.client,ledger,identity.href,identity.artistId!);
   for(const pin of release?.capturePins??identity.pins)verifyRymPin(pin);
   const table=decision.kind==='album'?'ingest.album_genres':'ingest.artist_genres',column=decision.kind==='album'?'album_id':'artist_id';
   const genres=(await ctx.client.query<{genre_id:number;status:string;role:string;decision_note:string|null}>(`SELECT genre_id::int,status,role,decision_note FROM ${table} WHERE ${column}=$1`,[decision.entityId])).rows;
   if(decision.required.some(id=>!genres.some(g=>g.genre_id===id&&g.status==='confirmed'))||decision.preserved.some(id=>!genres.some(g=>g.genre_id===id)))throw new Error(`Las asignaciones contrastadas cambiaron: ${decision.id}`);
   if(['open','in_progress'].includes(review.status))await ctx.client.query("UPDATE ingest.review_queue SET status='dismissed',resolved_by='human',resolution_note=$2,resolved_at=now(),updated_at=now() WHERE id=$1",[decision.id,`Codex · Encargo de Brian de resolver los avisos al agotar RYM. ${decision.reason}`]);
   output.push({reviewId:decision.id,previousStatus:review.status,reason:decision.reason,retainedGenres:genres,sourcePins:release?.capturePins??identity.pins});
  }
  return output;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory,`avisos-generos-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({runId:result.runId,reviews:result.result.map(r=>r.reviewId)}));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
