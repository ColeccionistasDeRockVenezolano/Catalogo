import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb,getPool } from '../src/db/client.js';
import { createEntity,createRelation,OperatorError,updateEntity,updateRelation,withOperatorRun } from '../src/merge/operator.js';
import { creditTypeForRole } from '../src/merge/relations.js';
import { combineRoles,sameRole } from '../src/merge/membership-roles.js';
import { assertRymIdentity,normalizeRymIdentity as norm,readRymIdentityLedger,rymHref,validateRymCross,verifyRymPin } from '../src/verification/rym-identity.js';
import { completePersonName,exactSourcePeople,membershipPeriodConflict,type PersonCandidate } from '../src/verification/person-source-plan.js';
import { planRymPerson,rymProfilePersonMatches,rymPersonDate as personDate } from '../src/verification/rym-person-resolution.js';
import { createAlias } from '../src/api/repositories/aliases.js';
import {loadTaxonomy} from '../src/genres/store.js';
import {resolveGenreValue,isAncestorOf} from '../src/genres/taxonomy.js';
import {confirmGenre} from '../src/genres/human.js';
import {GenreCurationError} from '../src/genres/errors.js';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const requestedPhase=arg('--phase')??'members';if(!['members','credits','artists','all'].includes(requestedPhase))throw new Error('Fase desconocida');
const confirm=process.argv.includes('--confirm');
const limit=Number(arg('--limit')??0);
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const jsonl=<T>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
interface Artist{href:string;nombre:string;info:Record<string,string>;capturePins:Array<{path:string;sha256:string}>}
interface Member{name:string;role:string;from_year:number|null;to_year:number|null;is_current:boolean}
interface Release{slug:string;url:string;creditos:Array<{nombre:string;roles:string|null;positions?:string|null;href:string|null}>}
function members(raw:string):Member[]{
  return raw.split(/\),\s*/u).flatMap(part=>{
    const match=/^(.+?)\s*\(([^)]*)\)?$/u.exec(part.trim());if(!match)return [];
    const name=match[1]!.trim(),detail=match[2]!;
    const ranges=[...detail.matchAll(/\b((?:18|19|20)\d{2})\s*[-–]\s*(present|(?:18|19|20)\d{2})\b/giu)];
    if(ranges.length>1||/\d{4}\s*[-–]\s*\d{2}\b/u.test(detail))return [];
    const role=detail.replace(/\b\d{4}\s*[-–]\s*(?:present|\d{4})\b/giu,'').replace(/\b(?:since|until|from|to)\s+\d{4}\b/giu,'').replace(/^[,\s]+|[,\s]+$/gu,'');
    if(!name||role.length>200||/\d{4}/u.test(role))return [];
    const range=ranges[0],from=range?Number(range[1]):null,to=range&&!/^present$/iu.test(range[2]!)?Number(range[2]):null;
    if(from&&to&&from>to)return [];
    return [{name,role:role||'Integrante',from_year:from,to_year:to,is_current:!!range&&/^present$/iu.test(range[2]!)}];
  });
}
async function main(phase:string){
  const ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
  const resolvedProfiles=new Map(ledger.identities.filter(e=>e.status==='resolved').map(e=>[rymHref(e.href),e]));
  const cross=phase==='credits'?await validateRymCross(getPool(),directory!):new Map();
  const people=(await getPool().query<PersonCandidate>(`SELECT p.id::int,p.name,
    ARRAY(SELECT alias FROM ingest.person_aliases WHERE person_id=p.id) aliases,
    ARRAY(SELECT artist_id::int FROM public.artist_members WHERE person_id=p.id UNION SELECT a.artist_id::int FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id=p.id UNION SELECT artist_id::int FROM ingest.musical_identities WHERE person_id=p.id) projects FROM public.persons p`)).rows;
  const musicalIdentities=(await getPool().query<{artist_id:number;person_id:number}>('SELECT artist_id::int,person_id::int FROM ingest.musical_identities')).rows;
  const personBounds=new Map((await getPool().query<{id:number;birth_date_value:string|null;death_date_value:string|null;is_deceased:boolean}>('SELECT id::int,birth_date_value,death_date_value,is_deceased FROM public.persons')).rows.map(p=>[p.id,p]));
  const artistYears=new Map((await getPool().query<{id:number;formed_year:number|null}>('SELECT id::int,formed_year FROM public.artists')).rows.map(a=>[a.id,a.formed_year]));
  const taxonomyClient=await getPool().connect();
  const taxonomy=await loadTaxonomy(taxonomyClient).finally(()=>taxonomyClient.release());
  const artists=jsonl<Artist>(path.join(directory!,'corpus/artistas.jsonl'));
  const aliasOwners=new Map<string,Set<number>>();
  if(phase==='artists')for(const artist of artists){
    const identity=resolvedProfiles.get(rymHref(artist.href));if(!identity?.artistId)continue;
    for(const raw of (artist.info['Also Known As']??'').split(/[,;|]/u)){
      const name=norm(raw.replace(/\s*\[[^\]]*\]/gu,''));if(!name)continue;
      const owners=aliasOwners.get(name)??new Set<number>();owners.add(identity.artistId);aliasOwners.set(name,owners);
    }
  }
  const releases=phase==='credits'?jsonl<Release>(path.join(directory!,'corpus/albumes.jsonl')):[];
  const collectiveIds=new Set((await getPool().query<{id:number}>("SELECT id::int FROM public.artists WHERE artist_type::text IN ('band','group','duo','orchestra','ensemble')")).rows.map(a=>a.id));
  const tasks:Array<{artistId:number;href:string;sourceUrl:string;pins:Array<{path:string;sha256:string}>;member?:Member;albumId?:number;credit?:{name:string;role:string;type:string;targetArtistId?:number;targetPersonId?:number;creditedHref?:string;creditedArtistId?:number};artist?:Artist}>=[];
  for(const artist of artists){
    const identity=ledger.identities.find(e=>rymHref(e.href)===rymHref(artist.href));
    if(identity?.status!=='resolved'||!identity.artistId)continue;
    if(phase==='members')for(const member of members(artist.info['Members']??''))tasks.push({artistId:identity.artistId,href:artist.href,sourceUrl:`https://rateyourmusic.com${artist.href}`,pins:identity.pins,member});
    if(phase==='artists')tasks.push({artistId:identity.artistId,href:artist.href,sourceUrl:`https://rateyourmusic.com${artist.href}`,pins:identity.pins,artist});
  }
  if(phase==='credits'){
    const groups=new Map<string,(typeof tasks)[number]>();
    for(const release of releases){
      const proof=cross.get(release.slug);if(!proof)continue;
      for(const credit of release.creditos??[]){
        const role=(credit.roles??'Crédito sin rol especificado')+(credit.positions?` [${credit.positions}]`:'');
        const type=credit.roles?creditTypeForRole(role):'other';
        const key=`${proof.albumId}|${norm(credit.nombre)}|${type}`;
        const previous=groups.get(key);
        if(previous?.credit){previous.credit.role=combineRoles([previous.credit.role,role]);continue;}
        const credited=credit.href?resolvedProfiles.get(rymHref(credit.href)):undefined;
        const target=credited?.artistId&&collectiveIds.has(credited.artistId)?credited.artistId:undefined;
        const documented=credited?.artistId?musicalIdentities.filter(i=>i.artist_id===credited.artistId):[];
        const person=documented.length===1?documented[0]!.person_id:undefined;
        groups.set(key,{artistId:proof.artistId,href:proof.artistHref,albumId:proof.albumId,sourceUrl:release.url,pins:proof.capturePins,
          credit:{name:credit.nombre,role,type,...(target?{targetArtistId:target}:person?{targetPersonId:person,creditedHref:credited!.href,creditedArtistId:credited!.artistId!}:{})}});
      }
    }
    tasks.push(...groups.values());
  }
  if(limit)tasks.splice(limit);
  const report={runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>,held:[] as Array<Record<string,unknown>>};
  const rejected=new Set<string>(),checked=new Set<string>();
  for(let offset=0;offset<tasks.length;offset+=50){
    const batch=tasks.slice(offset,offset+50);
    // Resolution caches are refreshed after rollback so an ID from an
    // uncommitted dry run can never leak into the next transaction.
    const peopleLength=people.length;
    const result=await withOperatorRun({name:`catalogo:rym-integral-${phase}`,operator:'Codex (encargo de Brian: agotar RYM)',
      note:`RYM integral: ${phase}; identidad, alias y proyectos contrastados. Sin fusiones por parecido ni nuevas colas de revisión.`,
      params:{campaign:'rym-integral-2026-10-21',phase,offset,planHash:digest(JSON.stringify(batch)),sourcePins:batch.flatMap(t=>t.pins)}},async context=>{
      await context.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
      const output:Array<Record<string,unknown>>=[];
      for(const task of batch){
        if(!checked.has(task.href)){await assertRymIdentity(context.client,ledger,task.href,task.artistId);checked.add(task.href);}
        for(const pin of task.pins)verifyRymPin(pin);
        await context.client.query('SAVEPOINT integral_person');
        try{
          if(task.artist){
            const live=(await context.client.query<Record<string,unknown>>('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE',[task.artistId])).rows[0]!;
            const info=task.artist.info,fields:Record<string,string|number>={};
            const formed=info['Formed']??'',year=/^(?:(?:\d{1,2}\s+)?[A-Za-z]+\s+)?((?:18|19|20)\d{2})(?:,|$)/u.exec(formed);
            const countries=/^(?:Venezuela|United States|USA|UK|United Kingdom|Spain|España|Colombia|México|Mexico|Argentina|Chile|Peru|Perú|Cuba|Brazil|Brasil|Canada|Germany|France|Italy)$/iu;
            if(year&&!live['formed_year'])fields['formed_year']=Number(year[1]);
            const formedCountry=formed.split(',').at(-1)?.trim();
            if(formedCountry&&countries.test(formedCountry)&&!live['origin_country'])fields['origin_country']=formedCountry;
            if(/^(?:18|19|20)\d{2}$/u.test(info['Disbanded']??'')&&!live['disbanded_year'])fields['disbanded_year']=Number(info['Disbanded']);
            const city=formed.split(',').map(s=>s.trim()).filter(s=>s&&!countries.test(s)&&!/(?<!\d)\d{4}(?!\d)/u.test(s)).join(', ');
            if(city&&city.length<=120&&!live['origin_city'])fields['origin_city']=city;
            const location=(info['Currently']??'').split(',').map(s=>s.trim()).filter(Boolean);
            const country=location.at(-1);
            if(country&&countries.test(country)){
              const currentCity=location.slice(0,-1).join(', ');
              if(!live['current_country'])fields['current_country']=country;
              if(currentCity&&currentCity.length<=120&&!live['current_city'])fields['current_city']=currentCity;
            }
            let aliases=0;
            const previous=(await context.client.query<{alias:string}>('SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1',[task.artistId])).rows.map(r=>norm(r.alias));
            for(const raw of (info['Also Known As']??'').split(/[,;|]/u)){
              const alias=raw.replace(/\s*\[[^\]]*\]/gu,'').trim();
              if(!alias||alias.length>120||norm(alias)===norm(String(live['name']))||previous.includes(norm(alias)))continue;
              const shared=(aliasOwners.get(norm(alias))?.size??0)>1;
              const other=shared||(await context.client.query<{name:string}>('SELECT name FROM public.artists WHERE id<>$1 UNION SELECT alias AS name FROM ingest.artist_aliases WHERE artist_id<>$1',[task.artistId])).rows.some(a=>norm(a.name)===norm(alias));
              if(other){report.held.push({artistId:task.artistId,reason:'alias_matches_other_artist',alias});continue;}
              await createAlias(context,'artist',task.artistId,{alias,aliasType:'name_variant',isPrimary:false});previous.push(norm(alias));aliases++;
            }
            if(Object.keys(fields).length)await updateEntity(context,'artist',task.artistId,fields);
            if(aliases||Object.keys(fields).length)output.push({artistId:task.artistId,fields:Object.keys(fields),aliases});
            const terms=(info['Genres']??'').split(',').map(s=>s.trim()).filter(Boolean);
            const mappedGenreIds=[...new Set(terms.flatMap(term=>resolveGenreValue(taxonomy,term).items.flatMap(item=>item.kind==='genre'?[item.genreId]:[])))];
            const genreIds=mappedGenreIds.filter(gid=>!mappedGenreIds.some(child=>child!==gid&&isAncestorOf(taxonomy,gid,child)));
            const existingGenres=(await context.client.query<{genre_id:number;status:string;role:string;decision_kind:string;derived:boolean}>("SELECT genre_id::int,status,role,decision_kind,(source_kind='albums' AND decision_kind='rule') AS derived FROM ingest.artist_genres WHERE artist_id=$1",[task.artistId])).rows;
            if(!existingGenres.some(g=>g.status==='confirmed'&&g.decision_kind==='human'))for(const genreId of genreIds){
              const genre=taxonomy.genres.get(genreId);
              if(!genre?.active||existingGenres.some(g=>g.genre_id===genreId||!g.derived&&g.status==='confirmed'&&isAncestorOf(taxonomy,genreId,g.genre_id)))continue;
              await context.client.query('SAVEPOINT integral_artist_genre');
              try{
                const role=existingGenres.some(g=>g.status==='confirmed'&&g.role==='primary')?'secondary':'primary';
                await confirmGenre(context.client,{kind:'artist',entityId:task.artistId,genreSlug:genre.slug,actor:'Codex: encargo de Brian de aprovechar RYM',reason:`Género de la trayectoria declarado en el perfil RYM ${task.sourceUrl}: ${terms.join(', ')}.`,role,runId:context.runId});
                existingGenres.push({genre_id:genreId,status:'confirmed',role,decision_kind:'human',derived:false});
                output.push({artistId:task.artistId,genre:genre.slug});
                await context.client.query('RELEASE SAVEPOINT integral_artist_genre');
              }catch(error){await context.client.query('ROLLBACK TO SAVEPOINT integral_artist_genre');if(!(error instanceof GenreCurationError))throw error;report.held.push({artistId:task.artistId,reason:'genre_hierarchy',genre:genre.slug});}
            }
            if(info['Born']||info['Died']){
              const documented=musicalIdentities.filter(i=>i.artist_id===task.artistId);
              const linked=documented.length===1?people.filter(p=>p.id===documented[0]!.person_id):exactSourcePeople(task.artist.nombre,people).filter(p=>p.projects.includes(task.artistId));
              if(linked.length===1){
                const birthNames=(info['Also Known As']??'').split(/[,;|]/u).filter(s=>/\[(?:birth|real|full) name\]/iu.test(s)).map(s=>s.replace(/\s*\[[^\]]*\]/gu,'').trim());
                const person=(await context.client.query<{birth_date_value:string|null;death_date_value:string|null;birth_city:string|null;is_deceased:boolean;real_name:string|null}>('SELECT birth_date_value,death_date_value,birth_city,is_deceased,real_name FROM public.persons WHERE id=$1 FOR UPDATE',[linked[0]!.id])).rows[0]!;
                if(!rymProfilePersonMatches(task.artist.nombre,birthNames,task.artistId,linked[0]!,person.real_name)){
                  report.held.push({artistId:task.artistId,personId:linked[0]!.id,reason:'profile_birth_name_differs_from_linked_person'});continue;
                }
                const born=personDate(info['Born']),died=personDate(info['Died']),values:Record<string,string|boolean>={};
                const compatibleDate=(a:string|null,b:string|null)=>!a||!b||a.slice(0,Math.min(a.length,b.length))===b.slice(0,Math.min(a.length,b.length));
                if(!compatibleDate(person.birth_date_value,born)||!compatibleDate(person.death_date_value,died)){
                  report.held.push({artistId:task.artistId,personId:linked[0]!.id,reason:'profile_dates_conflict_with_existing_person'});continue;
                }
                const career=(await context.client.query<{from_year:number|null;to_year:number|null;is_current:boolean}>('SELECT from_year,to_year,is_current FROM public.artist_members WHERE person_id=$1',[linked[0]!.id])).rows;
                if(career.some(m=>born&&(m.from_year!==null&&m.from_year<Number(born.slice(0,4))||m.to_year!==null&&m.to_year<Number(born.slice(0,4)))||died&&(m.from_year!==null&&m.from_year>Number(died.slice(0,4))||m.to_year!==null&&m.to_year>Number(died.slice(0,4))||m.is_current))){
                  report.held.push({artistId:task.artistId,personId:linked[0]!.id,reason:'profile_dates_conflict_with_documented_career'});continue;
                }
                if(born&&!person.birth_date_value)values['birth_date']=born;
                if(died&&!person.death_date_value)values['death_date']=died;
                if(died&&!person.is_deceased)values['is_deceased']=true;
                if(born&&!person.birth_city){const place=(info['Born']??'').split(',')[1]?.trim();if(place&&!countries.test(place)&&place.length<=120)values['birth_city']=place;}
                if(Object.keys(values).length){await updateEntity(context,'person',linked[0]!.id,values);output.push({artistId:task.artistId,personId:linked[0]!.id,personFields:Object.keys(values)});}
              }
            }
          }else{
            const name=task.member?.name??task.credit!.name;
            if(task.credit?.targetArtistId){
              const target=task.credit.targetArtistId;
              const existing=await context.client.query('SELECT 1 FROM public.album_credits WHERE album_id=$1 AND artist_id=$2 AND credit_type=$3',[task.albumId,target,task.credit.type]);
              if(!existing.rowCount&&task.credit.role.length<=200){
                const targetProof=ledger.identities.find(e=>e.artistId===target&&e.status==='resolved')!;
                await assertRymIdentity(context.client,ledger,targetProof.href,target);
                const relation=await createRelation(context,'album_credit',{albumId:task.albumId!,artistId:target},{credit_role:task.credit.role,credit_type:task.credit.type});
                output.push({albumId:task.albumId,creditedArtistId:target,relationId:relation.id,relation:'artist_album_credit'});
              }
              await context.client.query('RELEASE SAVEPOINT integral_person');continue;
            }
            const personPlan=planRymPerson(name,task.artistId,people,!!task.member);
            let personId=task.credit?.targetPersonId??personPlan.personId,created=false;
            if(task.credit?.targetPersonId){
              if(!checked.has(task.credit.creditedHref!)){await assertRymIdentity(context.client,ledger,task.credit.creditedHref!,task.credit.creditedArtistId!);checked.add(task.credit.creditedHref!);}
              const liveIdentities=(await context.client.query<{person_id:number}>('SELECT person_id::int FROM ingest.musical_identities WHERE artist_id=$1',[task.credit.creditedArtistId])).rows;
              if(liveIdentities.length!==1||liveIdentities[0]!.person_id!==personId){report.held.push({albumId:task.albumId,name,reason:'credited_musical_identity_changed'});continue;}
            }
            if(!personId&&norm(name).split(' ').length===1){const exact=exactSourcePeople(name,people).filter(p=>p.projects.includes(task.artistId));if(exact.length===1)personId=exact[0]!.id;}
            if(!personId){
              if(!task.member||!completePersonName(personPlan.canonicalName)||rejected.has(norm(name))||exactSourcePeople(name,people).length){report.held.push({artistId:task.artistId,name,reason:'person_identity_unresolved'});continue;}
              if(!personPlan.canCreateDifferent){report.held.push({artistId:task.artistId,name,reason:'plausible_existing_person_requires_more_identity_evidence'});continue;}
              const group=(await context.client.query<{name:string;artist_type:string}>('SELECT name,artist_type FROM public.artists')).rows.some(a=>norm(a.name)===norm(name)&&['band','group','duo'].includes(a.artist_type));
              if(group){report.held.push({artistId:task.artistId,name,reason:'group_is_not_a_person'});continue;}
              const p=await createEntity(context,'person',{name:personPlan.canonicalName,notes:`Integrante documentado en ${task.sourceUrl}.`},{allowSimilar:personPlan.canCreateDifferent});
              personId=p.id;created=true;
            }
            let relationId:number|undefined,changed=false;
            if(task.member){
              const member=task.member;
              const bounds=personBounds.get(personId),born=bounds?.birth_date_value?Number(bounds.birth_date_value.slice(0,4)):null,died=bounds?.death_date_value?Number(bounds.death_date_value.slice(0,4)):null;
              const earliest=member.from_year??artistYears.get(task.artistId);
              if(born&&member.from_year&&born>member.from_year||born&&member.to_year&&born>member.to_year||died&&earliest&&died<earliest||member.is_current&&bounds?.is_deceased){report.held.push({artistId:task.artistId,personId,reason:'person_chronology_conflicts_with_membership'});continue;}
              const current=(await context.client.query<{id:number;role:string;from_year:number|null;to_year:number|null;is_current:boolean}>('SELECT id::int,role,from_year,to_year,is_current FROM public.artist_members WHERE artist_id=$1 AND person_id=$2 FOR UPDATE',[task.artistId,personId])).rows;
              if(current.length===0){const relation=await createRelation(context,'artist_membership',{artistId:task.artistId,personId},{role:member.role,from_year:member.from_year,to_year:member.to_year,is_current:member.is_current});relationId=relation.id;changed=true;}
              else if(current.length===1){
                const old=current[0]!,fields:Record<string,string|number|boolean>={};
                const conflict=membershipPeriodConflict(old,member)||old.from_year!==null&&member.from_year!==null&&old.from_year!==member.from_year||old.to_year!==null&&member.to_year!==null&&old.to_year!==member.to_year;
                if(!conflict){
                  if(old.from_year===null&&member.from_year!==null)fields['from_year']=member.from_year;
                  if(old.to_year===null&&member.to_year!==null)fields['to_year']=member.to_year;
                  const role=combineRoles([old.role,member.role]);if(!sameRole(old.role,role)&&role.length<=200)fields['role']=role;
                  if(Object.keys(fields).length){await updateRelation(context,'artist_membership',old.id,fields);relationId=old.id;changed=true;}
                }else report.held.push({artistId:task.artistId,personId,reason:'contradictory_membership_period'});
              }
            }else{
              const c=task.credit!;
              const existing=await context.client.query<{id:number;role:string}>('SELECT id::int,role FROM public.album_credits WHERE album_id=$1 AND person_id=$2 AND credit_type=$3',[task.albumId,personId,c.type]);
              if(!existing.rowCount&&c.role.length<=200){const relation=await createRelation(context,'album_credit',{albumId:task.albumId!,personId},{credit_role:c.role,credit_type:c.type});relationId=relation.id;changed=relation.created;}
              else if(existing.rows.length===1){const old=existing.rows[0]!,role=combineRoles([old.role,c.role]);if(role.length<=200&&!sameRole(old.role,role)){await updateRelation(context,'album_credit',old.id,{role});relationId=old.id;changed=true;}}
            }
            if(created)people.push({id:personId,name:personPlan.canonicalName,aliases:[],projects:[task.artistId]});
            if(changed||created){
              output.push({artistId:task.artistId,albumId:task.albumId,personId,createdPerson:created,relationId,relation:task.member?'membership':'album_credit'});
              await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
                SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND (person_id=$5 OR ($7='membership' AND artist_membership_id=$6) OR ($7='credit' AND album_credit_id=$6)) ON CONFLICT DO NOTHING`,
                [context.runId,task.sourceUrl,`${name}: ${task.member?.role??task.credit?.role}`,digest(JSON.stringify(task.pins)),personId,relationId??null,task.member?'membership':'credit']);
            }
          }
          await context.client.query('RELEASE SAVEPOINT integral_person');
        }catch(error){
          await context.client.query('ROLLBACK TO SAVEPOINT integral_person');
          if(!(error instanceof OperatorError)&&!(error&&typeof error==='object'&&'code' in error&&error.code==='PCE01'))throw error;
          const name=task.member?.name??task.credit?.name;
          if(name)rejected.add(norm(name));
          report.held.push({artistId:task.artistId,name,reason:`operator_${error instanceof OperatorError?error.code:'editorial_exclusion'}`,detail:error instanceof Error?error.message:String(error)});
        }
      }
      return output;
    },{rollbackOnly:!confirm});
    if(!confirm)people.splice(peopleLength);
    else report.runs.push(result.runId);
    if(confirm)writeFileSync(path.join(directory!,`run-${result.runId}-people.json`),JSON.stringify(result,null,2)+'\n');
    report.outcomes.push(...result.result);
    writeFileSync(path.join(directory!,`${phase}-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify({...report,dryRun:!confirm},null,2)+'\n');
    console.log(`${phase} ${offset+batch.length}/${tasks.length}; aportes=${report.outcomes.length}; retenidos=${report.held.length}`);
  }
}
async function run(){for(const phase of requestedPhase==='all'?['members','artists','credits']:[requestedPhase])await main(phase);}
run().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
