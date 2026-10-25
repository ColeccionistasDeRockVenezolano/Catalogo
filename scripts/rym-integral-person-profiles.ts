import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {closeDb,getPool} from '../src/db/client.js';
import {updateEntity,withOperatorRun,OperatorError} from '../src/merge/operator.js';
import {assertRymIdentity,readRymIdentityLedger,validateRymCross,verifyRymPin,rymHref,normalizeRymIdentity as norm} from '../src/verification/rym-identity.js';
import {rymPersonDate,rymProfilePersonMatches} from '../src/verification/rym-person-resolution.js';
import {creditTypeForRole} from '../src/merge/relations.js';

const arg=(s:string)=>{const i=process.argv.indexOf(s);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const confirm=process.argv.includes('--confirm'),limit=Number(arg('--limit')??0);
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const jsonl=<T>(name:string):T[]=>readFileSync(path.join(directory!,name),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
interface Pin{path:string;sha256:string}
interface Profile{href:string;nombre:string;info:Record<string,string>;capturePins:Pin[]}
interface Baseline{persons:Array<{id:number;name:string}>;personAliases:Array<{person_id:number;alias:string}>;credits:Array<{id:number;album_id:number;person_id:number|null;credit_type:string}>}
interface Anchor{creditId:number;albumId:number;personId:number;artistId:number;artistHref:string;url:string;pins:Pin[]}
const compatible=(a:string|null,b:string|null)=>!a||!b||a.slice(0,Math.min(a.length,b.length))===b.slice(0,Math.min(a.length,b.length));
function agreed(values:Array<string|null>):string|null{const known=values.filter((v):v is string=>!!v);if(known.some(a=>known.some(b=>!compatible(a,b))))return null;return known.sort((a,b)=>b.length-a.length)[0]??null;}

async function main(){
 const cross=await validateRymCross(getPool(),directory!),ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
 const baseline=JSON.parse(readFileSync(path.join(directory!,'catalogo-inicial.json'),'utf8')) as Baseline;
 const names=new Map(baseline.persons.map(p=>[p.id,new Set([norm(p.name)])]));
 for(const a of baseline.personAliases)names.get(a.person_id)?.add(norm(a.alias));
 const credits=new Map<number,Baseline['credits']>();for(const c of baseline.credits)if(c.person_id)credits.set(c.album_id,[...(credits.get(c.album_id)??[]),c]);
 const profiles=new Map(jsonl<Profile>('corpus/artistas.jsonl').map(p=>[rymHref(p.href),p]));
 const links=new Map<string,Anchor[]>();
 for(const release of jsonl<{slug:string;url:string;creditos:Array<{nombre:string;roles:string|null;href:string|null}>}>('corpus/albumes.jsonl')){
  const proof=cross.get(release.slug);if(!proof)continue;
  for(const credit of release.creditos??[]){
   const profile=credit.href?profiles.get(rymHref(credit.href)):undefined;
   if(!profile||!profile.info['Born']&&!profile.info['Died']||profile.capturePins.length<2)continue;
   const profileNames=[profile.nombre,...(profile.info['Also Known As']??'').split(/[,;|]/u).map(s=>s.replace(/\s*\[[^\]]*\]/gu,'').trim())];
   if(!profileNames.some(n=>norm(n)===norm(credit.nombre)))continue;
   const type=credit.roles?creditTypeForRole(credit.roles):null;
   const existing=(credits.get(proof.albumId)??[]).filter(c=>c.person_id&&names.get(c.person_id)?.has(norm(credit.nombre))&&(!type||c.credit_type===type));
   if(new Set(existing.map(c=>c.person_id)).size!==1)continue;
   const c=existing[0]!;
   links.set(rymHref(profile.href),[...(links.get(rymHref(profile.href))??[]),{creditId:c.id,albumId:proof.albumId,personId:c.person_id!,artistId:proof.artistId,artistHref:proof.artistHref,url:release.url,pins:proof.capturePins}]);
  }
 }
 const jobs=new Map<number,Array<{profile:Profile;anchor:Anchor}>>(),held:Array<Record<string,unknown>>=[];
 for(const [href,anchors] of links){
  if(new Set(anchors.map(a=>a.personId)).size!==1){held.push({href,reason:'profile_points_to_multiple_existing_people'});continue;}
  const anchor=anchors[0]!,profile=profiles.get(href)!;jobs.set(anchor.personId,[...(jobs.get(anchor.personId)??[]),{profile,anchor}]);
 }
 const tasks=[...jobs].slice(0,limit||undefined),report={runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>,held},checked=new Set<string>();
 for(let offset=0;offset<tasks.length;offset+=30){
  const batch=tasks.slice(offset,offset+30);
  const result=await withOperatorRun({name:'catalogo:rym-integral-person-profiles',operator:'Codex (encargo de Brian: agotar RYM)',note:'Fechas personales RYM vinculadas por un crédito del catálogo anterior a esta campaña. No crea ni convierte artistas o personas; solo completa hechos compatibles.',
   params:{campaign:'rym-integral-2026-10-21',phase:'person_profiles',offset,planHash:digest(batch),sourcePins:batch.flatMap(([,sources])=>sources.flatMap(s=>[...s.profile.capturePins,...s.anchor.pins]))}},async ctx=>{
   const output:Array<Record<string,unknown>>=[];
   for(const [personId,sources] of batch){
    let valid=true;
    for(const {profile,anchor} of sources){
     if(!checked.has(anchor.artistHref)){await assertRymIdentity(ctx.client,ledger,anchor.artistHref,anchor.artistId);checked.add(anchor.artistHref);}
     for(const pin of [...profile.capturePins,...anchor.pins])verifyRymPin(pin);
     if(!(await ctx.client.query('SELECT 1 FROM public.album_credits WHERE id=$1 AND album_id=$2 AND person_id=$3',[anchor.creditId,anchor.albumId,personId])).rowCount){valid=false;break;}
     const htmlPin=profile.capturePins.find(p=>p.path.endsWith('.html'))!,$=load(readFileSync(htmlPin.path,'utf8'));
     const canonical=$('meta[property="og:url"]').attr('content')??$('link[rel="canonical"]').attr('href');
     if(!canonical||rymHref(canonical)!==rymHref(profile.href))throw new Error('La ficha personal no corresponde al perfil enlazado');
     const info=new Map<string,string>();let key='';
     const main=$('.artist_info_main').first(),scope=main.length?main:$('.artist_info').first();
     scope.children().each((_i,el)=>{const node=$(el);if(node.hasClass('info_hdr'))key=node.text().replace(/\s+/gu,' ').trim();else if(node.hasClass('info_content')&&key){info.set(key,node.text().replace(/\s+/gu,' ').trim());key='';}});
     for(const field of ['Born','Died'])if(profile.info[field]&&(info.get(field)??'').replace(/\s+/gu,'')!==profile.info[field].replace(/\s+/gu,''))throw new Error('La fecha no coincide con el texto literal del perfil');
    }
    if(!valid){held.push({personId,reason:'baseline_credit_changed'});continue;}
    const births=sources.map(s=>rymPersonDate(s.profile.info['Born'])),deaths=sources.map(s=>rymPersonDate(s.profile.info['Died']));
    const born=agreed(births),died=agreed(deaths);
    if(births.filter(Boolean).length&&!born||deaths.filter(Boolean).length&&!died){held.push({personId,reason:'profile_dates_disagree'});continue;}
    await ctx.client.query('SAVEPOINT integral_profile');
    try{
     const live=(await ctx.client.query<{name:string;real_name:string|null;aliases:string[];birth_date_value:string|null;death_date_value:string|null;birth_city:string|null;is_deceased:boolean}>('SELECT p.name,p.real_name,ARRAY(SELECT alias FROM ingest.person_aliases WHERE person_id=p.id) aliases,p.birth_date_value,p.death_date_value,p.birth_city,p.is_deceased FROM public.persons p WHERE id=$1 FOR UPDATE',[personId])).rows[0];
     if(!live)continue;
     if(sources.some(({profile,anchor})=>{
      const names=(profile.info['Also Known As']??'').split(/[,;|]/u).filter(s=>/\[(?:birth|real|full) name\]/iu.test(s)).map(s=>s.replace(/\s*\[[^\]]*\]/gu,'').trim());
      return !rymProfilePersonMatches(profile.nombre,names,anchor.artistId,{id:personId,name:live.name,aliases:live.aliases,projects:[anchor.artistId]},live.real_name);
     })){held.push({personId,reason:'profile_birth_name_differs_from_credited_person'});continue;}
     const birth=live.birth_date_value??born,death=live.death_date_value??died;
     const span=birth&&death?Math.min(birth.length,death.length):0;
     if(!compatible(live.birth_date_value,born)||!compatible(live.death_date_value,died)||birth&&death&&death.slice(0,span)<birth.slice(0,span)){held.push({personId,reason:'preserved_existing_dates_or_chronology'});continue;}
     const career=(await ctx.client.query<{from_year:number|null;to_year:number|null;is_current:boolean}>('SELECT from_year,to_year,is_current FROM public.artist_members WHERE person_id=$1',[personId])).rows;
     if(career.some(m=>born&&(m.from_year!==null&&m.from_year<Number(born.slice(0,4))||m.to_year!==null&&m.to_year<Number(born.slice(0,4)))||died&&(m.from_year!==null&&m.from_year>Number(died.slice(0,4))||m.to_year!==null&&m.to_year>Number(died.slice(0,4))||m.is_current))){held.push({personId,reason:'profile_dates_conflict_with_documented_career'});continue;}
     const fields:Record<string,string|boolean>={};
     if(born&&!live.birth_date_value)fields['birth_date']=born;
     if(died&&!live.death_date_value)fields['death_date']=died;
     if(died&&!live.is_deceased)fields['is_deceased']=true;
     const places=sources.flatMap(s=>rymPersonDate(s.profile.info['Born'])&&(s.profile.info['Born']??'').split(',').length>=3?[(s.profile.info['Born']??'').split(',')[1]!.trim()]:[]);
     if(!live.birth_city&&places.length&&new Set(places).size===1&&places[0]!.length<=120&&!/^(?:Venezuela|United States|USA|UK|United Kingdom|England|Scotland|Spain|España|France|Germany|Italy|Canada|Argentina|Chile|Colombia|México|Mexico|Brazil|Brasil)$/iu.test(places[0]!))fields['birth_city']=places[0]!;
     if(Object.keys(fields).length){
      await updateEntity(ctx,'person',personId,fields);
      for(const {profile,anchor} of sources)for(const url of [`https://rateyourmusic.com${profile.href}`,anchor.url])await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
       SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND person_id=$5 ON CONFLICT DO NOTHING`,[ctx.runId,url,`Perfil personal identificado por el crédito previo ${anchor.creditId}; ${profile.nombre}; Born: ${profile.info['Born']??''}; Died: ${profile.info['Died']??''}.`,digest(profile.capturePins),personId]);
      output.push({personId,fields:Object.keys(fields),profiles:sources.map(s=>s.profile.href)});
     }
     await ctx.client.query('RELEASE SAVEPOINT integral_profile');
    }catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT integral_profile');if(!(error instanceof OperatorError))throw error;held.push({personId,reason:error.code,detail:error.message});}
   }
   return output;
  },{rollbackOnly:!confirm});
  if(confirm){report.runs.push(result.runId);writeFileSync(path.join(directory!,`run-${result.runId}-person-profiles.json`),JSON.stringify(result,null,2)+'\n');}
  report.outcomes.push(...result.result);writeFileSync(path.join(directory!,`person-profiles-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`Perfiles personales ${offset+batch.length}/${tasks.length}; aportes=${report.outcomes.length}`);
 }
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
