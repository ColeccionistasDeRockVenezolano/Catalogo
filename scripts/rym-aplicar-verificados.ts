/** Apply only reviewed identities, preserving edition scope and native undo. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {load} from 'cheerio';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun,updateEntity,createEntity,createRelation,updateRelation,OperatorError,type OperatorContext} from '../src/merge/operator.js';
import {rememberEvidenceDocument,rememberEvidenceFragment,recordFact} from '../src/evidence/inventory.js';
import {createAlias} from '../src/api/repositories/aliases.js';
import {writeModel} from '../src/catalog/model.js';
import {excludedArtist} from '../src/catalog/editorial-scope.js';
import {writeAlbumClassifications} from '../src/catalog/album-classifications.js';
import {writeEditorResource} from '../src/catalog/editor.js';
import {creditTypeForRole} from '../src/merge/relations.js';
import {combineRoles,sameRole} from '../src/merge/membership-roles.js';
import {verifyRymPin,rymHref,normalizeRymIdentity as norm,assertRymIdentity,readRymIdentityLedger} from '../src/verification/rym-identity.js';
import {rymPersonDate} from '../src/verification/rym-person-resolution.js';
import {rymReleaseClassifications,rymReleaseDateText,rymTrackPositions,type RymTrackInput} from '../src/verification/rym-release-plan.js';
import {planRymTrackEnrichment,type ExistingRymTrack} from '../src/verification/rym-track-enrichment.js';
import {rymCreditScope} from '../src/verification/rym-credit-scope.js';
import {distinctRymPublication} from '../src/verification/rym-distinct-publication.js';
import {rymCatalogKey} from '../src/verification/rym-publication-identity.js';
import {matchReviewedRymRelease,disputedRymField,compatibleRymDate,reviewedRymOwnerMatches,type ReviewedReleaseCandidate} from '../src/verification/rym-reviewed-application.js';
import {loadTaxonomy} from '../src/genres/store.js';
import {resolveGenreValue,isAncestorOf} from '../src/genres/taxonomy.js';
import {confirmGenre} from '../src/genres/human.js';

// Native snapshots and historical extractor metadata have variable columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
interface Pin {path:string;sha256:string}
interface Evidence {url:string;quote:string;text:string;title:string;sourcePath:string;sourceSha256:string;capturedAt:string|null;primaryEligible:boolean;supports:string}
interface Case {proposal:Row;profile:{href:string;nombre:string;info:Record<string,string>;capturePins:Pin[]};artistBaseline:Row|null;personBaseline:Row|null;albumsBaseline:Row[];membersBaseline:Row[];evidence:Evidence[]}
interface Release {slug:string;href:string;url:string;artista:string;artista_url:string;titulo:string;tipo:string|null;anio:number|null;catalog_no:string|null;formato:string|null;released_text:string|null;capturePins:Pin[];pistas:RymTrackInput[];labels:Array<{nombre:string}>;creditos:Array<{nombre:string;roles:string|null;href:string|null;positions?:string|null}>;rating?:number;n_ratings?:number;primaryGenres?:string[];secondaryGenres?:string[];musicalEditionVerified?:boolean}
interface Input {campaign:string;proposalPin:Pin;baselineLedger:string;cases:Case[];releases:Release[];creditReleases:Release[]}
const arg=(s:string)=>{const i=process.argv.indexOf(s);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir required');
const confirm=process.argv.includes('--confirm'),phase=arg('--phase')??'all';
if(!['identities','profiles','releases','credits','all'].includes(phase))throw new Error('Unknown phase');
const input=JSON.parse(readFileSync(path.join(directory,'entrada-verificada.json'),'utf8')) as Input;
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const cases=new Map(input.cases.map(c=>[c.profile.href,c]));
const report={phase,dryRun:!confirm,campaign:input.campaign,runs:[] as number[],outcomes:[] as Row[],held:[] as Row[],counts:{} as Record<string,number>};
const count=(key:string,n=1)=>{report.counts[key]=(report.counts[key]??0)+n;};
const hold=(source:string,reason:string,detail?:unknown)=>report.held.push({source,reason,detail});
const save=()=>writeFileSync(path.join(directory!,`${phase}-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');
let reviewFloor=0,claimFloor=0;
async function resetClaimFloor(ctx:OperatorContext){claimFloor=Number((await ctx.client.query<{id:string}>('SELECT coalesce(max(id),0)::text id FROM ingest.claims')).rows[0]!.id);}

function sourcePins(pins:Pin[],href:string):void {
  if(pins.length<2)throw new Error('Original HTML/metadata pair missing');
  for(const pin of pins)verifyRymPin(pin);
  const meta=pins.find(p=>p.path.endsWith('.json')),html=pins.find(p=>p.path.endsWith('.html'));
  if(!meta||!html)throw new Error('Original pair missing');
  const row=JSON.parse(readFileSync(meta.path,'utf8')) as Row;
  if(rymHref(row['href']??row['rymHref']??row['u']??'')!==rymHref(href))throw new Error('Capture URL changed');
  const $=load(readFileSync(html.path,'utf8'));
  const canonical=$('meta[property="og:url"]').attr('content')??$('link[rel="canonical"]').attr('href');
  if(canonical&&rymHref(canonical)!==rymHref(href))throw new Error('Canonical capture URL differs');
}

async function validateCase(ctx:OperatorContext,c:Case):Promise<void> {
  const p=c.proposal;
  assert.equal(p['finalStatus'],'ready_for_native_validation');
  assert.equal(p['allCitationsVerified'],true);assert.equal(p['mechanicalEvidenceGate'],true);
  assert.equal(p['semanticReview']['verdict'],'accept_link');assert.equal(p['blockingContradictions'].length,0);
  sourcePins(c.profile.capturePins,c.profile.href);
  for(const e of c.evidence){verifyRymPin({path:e.sourcePath,sha256:e.sourceSha256});assert.ok(e.text.includes(e.quote));}
  const competing=(await ctx.client.query<Row>(`SELECT f.subject_kind,b.artist_id::int,b.person_id::int FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id
    WHERE f.relation='external_rym_identity' AND f.documentary_state='verified' AND b.disposition='applied' AND f.value=$1::jsonb`,[JSON.stringify({url:`https://rateyourmusic.com${c.profile.href}`})])).rows;
  assert.ok(competing.every(r=>r['subject_kind']==='artist'?r['artist_id']===p['candidateArtistId']:r['subject_kind']==='person'&&r['person_id']===p['candidatePersonId']),'Competing native RYM identity destination');
  for(const [kind,id,baseline] of [['artist',p['candidateArtistId'],c.artistBaseline],['person',p['candidatePersonId'],c.personBaseline]] as const){
    if(!id)continue;
    assert.ok(baseline,`No snapshot for ${kind}:${id}`);
    const live=(await ctx.client.query<Row>(`SELECT * FROM public.${kind==='artist'?'artists':'persons'} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    assert.ok(live,`Missing ${kind}:${id}`);
    for(const field of kind==='artist'?['name','artist_type','biography']:['name','real_name','birth_date_value','death_date_value','biography']){
      if(baseline[field]!==null&&baseline[field]!==undefined&&baseline[field]!=='')assert.equal(live[field],baseline[field],`Identity witness changed: ${kind}:${id}:${field}`);
    }
    if(kind==='artist')assert.equal(await excludedArtist(ctx.client,{artistId:id}),undefined,'Artist excluded by editorial policy');
  }
}

async function evidenceFragments(ctx:OperatorContext,c:Case):Promise<number[]> {
  const fragments:number[]=[];
  for(const e of c.evidence){
    const id=await rememberEvidenceDocument(ctx.client,{url:e.url,title:e.title,content:e.text,contentHash:digest(e.text),
      capturedAt:e.capturedAt,readAt:new Date().toISOString(),fetchedAt:e.capturedAt??'',acquisitionMethod:e.capturedAt?'http':'local_archive'});
    fragments.push(await rememberEvidenceFragment(ctx.client,id,e.quote,JSON.stringify({originalPath:e.sourcePath,originalSha256:e.sourceSha256,normalization:'NFKC and whitespace only'})));
  }
  return [...new Set(fragments)];
}

async function identities(ctx:OperatorContext):Promise<void> {
  for(const c of input.cases){
    const fragmentIds=await evidenceFragments(ctx,c),p=c.proposal;
    for(const [kind,id] of [['artist',p['candidateArtistId']],['person',p['candidatePersonId']]] as const){
      if(!id)continue;
      const prior=(await ctx.client.query<Row>(`SELECT f.id::int,b.id::int binding_id,b.disposition FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id
        WHERE f.subject_kind=$1 AND b.${kind}_id=$2 AND f.relation='external_rym_identity' AND f.value=$3::jsonb`,[kind,id,JSON.stringify({url:`https://rateyourmusic.com${c.profile.href}`})])).rows;
      assert.ok(prior.every(f=>f['disposition']==='applied'),'Previous identity has a different disposition');
      if(prior.length){count('identity_already_present');continue;}
      const fact=await recordFact(ctx,{kind,entityId:id,relation:'external_rym_identity',value:{url:`https://rateyourmusic.com${c.profile.href}`},valueType:'relation',state:'verified',
        evidence:fragmentIds.map(fragmentId=>({fragmentId,role:'supports'}))});
      await ctx.client.query("UPDATE ingest.catalog_fact_bindings SET disposition='applied',decided_by=$2,decision_reason=$3 WHERE id=$1",[fact.bindingId,ctx.operator,ctx.note]);
      report.outcomes.push({phase:'identities',href:c.profile.href,kind,id,...fact});count('identity_links_added');
    }
    const aid=p['candidateArtistId'],pid=p['candidatePersonId'];
    if(aid&&pid){
      const existing=(await ctx.client.query<{person_id:number;relationship:string}>('SELECT person_id::int,relationship FROM ingest.musical_identities WHERE artist_id=$1 FOR UPDATE',[aid])).rows;
      if(existing.some(m=>m.person_id!==pid&&m.relationship==='solo_identity'))hold(c.profile.href,'existing_solo_owner_differs',existing);
      else if(!existing.some(m=>m.person_id===pid&&m.relationship==='solo_identity')){
        await writeModel(ctx,'identity',{artistId:aid,personId:pid,relationship:'solo_identity',notes:`Identidad verificada con dos ejes y evidencia primaria: https://rateyourmusic.com${c.profile.href}`});count('solo_identities_added');
      }
    }
  }
}

async function attachClaims(ctx:OperatorContext,url:string,pins:Pin[],excerpt:string):Promise<void> {
  await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
    SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 AND id>$5 AND NOT EXISTS(SELECT 1 FROM ingest.claim_evidence e WHERE e.claim_id=ingest.claims.id AND e.url=$2)
    ON CONFLICT DO NOTHING`,[ctx.runId,url,excerpt.slice(0,1800),digest(JSON.stringify(pins)),claimFloor]);
}

async function addAlias(ctx:OperatorContext,kind:'artist'|'person',id:number,name:string):Promise<void> {
  if(!name||name.length>200)return;
  const keys=(await ctx.client.query<{name:string}>(`SELECT name FROM public.${kind==='artist'?'artists':'persons'} WHERE id=$1 UNION SELECT alias AS name FROM ingest.${kind}_aliases WHERE ${kind}_id=$1`,[id])).rows;
  if(keys.some(r=>norm(r.name)===norm(name)))return;
  const other=(await ctx.client.query<{id:number;name:string}>(`SELECT id::int,name FROM public.${kind==='artist'?'artists':'persons'} WHERE id<>$1 AND lower(name)=lower($2) UNION SELECT ${kind}_id::int,alias FROM ingest.${kind}_aliases WHERE ${kind}_id<>$1 AND lower(alias)=lower($2)`,[id,name])).rows;
  if(other.length){hold(`${kind}:${id}`,'alias_belongs_to_another_existing_entity',{name,other});return;}
  await createAlias(ctx,kind,id,{alias:name,aliasType:'name_variant',isPrimary:false});count(`${kind}_aliases_added`);
}

let personNames:Map<string,Set<number>>|undefined;
async function loadPersonNames(ctx:OperatorContext){
  if(!personNames){
    personNames=new Map();
    for(const r of (await ctx.client.query<{id:number;name:string}>('SELECT id::int,name FROM public.persons UNION SELECT person_id::int,alias FROM ingest.person_aliases')).rows){
      const key=norm(r.name),ids=personNames.get(key)??new Set<number>();ids.add(r.id);personNames.set(key,ids);
    }
  }
  return personNames;
}
async function members(ctx:OperatorContext,c:Case,aid:number):Promise<void> {
  const raw=c.profile.info['Members'];if(!raw)return;
  const people=await loadPersonNames(ctx);
  const pieces=raw.includes('(')?raw.split(/\),\s*/u):raw.split(/,\s*/u);
  for(const piece of pieces){
    const parsed=/^(.+?)\s*\(([^)]*)\)?$/u.exec(piece.trim());
    const name=(parsed?.[1]??piece).replace(/\s*\[aka[^\]]*\]/giu,'').trim();
    const role=(parsed?.[2]??'Integrante').trim();
    if(!name||!role||role.length>200||/\d{4}/u.test(role)){hold(c.profile.href,'member_requires_period_or_name_parsing',piece);continue;}
    const ids=[...(people.get(norm(name))??[])];
    const linked=(await ctx.client.query<{person_id:number}>('SELECT person_id::int FROM public.artist_members WHERE artist_id=$1 AND person_id=ANY($2::bigint[])',[aid,ids])).rows;
    const candidates=[...new Set(linked.map(m=>m.person_id))];
    const backed=c.evidence.some(e=>e.primaryEligible&&norm(e.quote).includes(norm(name)));
    const pid=candidates.length===1?candidates[0]:ids.length===1&&backed&&norm(name).split(' ').length>=2?ids[0]:null;
    if(!pid){hold(c.profile.href,'member_identity_not_sufficiently_proved',{name,ids});continue;}
    const current=(await ctx.client.query<Row>('SELECT id::int,role FROM public.artist_members WHERE artist_id=$1 AND person_id=$2 FOR UPDATE',[aid,pid])).rows;
    if(current.length>1){hold(c.profile.href,'preserved_membership_periods',{name,pid});continue;}
    if(current.length){
      if(role==='Integrante')continue;
      const combined=combineRoles([current[0]!['role'],role]);
      if(combined.length<=200&&!sameRole(current[0]!['role'],combined)){await updateRelation(ctx,'artist_membership',current[0]!['id'],{role:combined});count('member_roles_added');}
    }else{
      const person=(await ctx.client.query<{biography:string|null}>('SELECT biography FROM public.persons WHERE id=$1',[pid])).rows[0];
      const anchor=(await ctx.client.query(`SELECT 1 FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id=$1 AND a.artist_id=$2
        UNION SELECT 1 FROM ingest.musical_identities WHERE person_id=$1 AND artist_id=$2 LIMIT 1`,[pid,aid])).rowCount;
      const independentlyResolved=input.cases.some(other=>other.proposal['candidatePersonId']===pid);
      const projectInBiography=!!person?.biography&&reviewedRymOwnerMatches(person.biography,[c.profile.nombre,String(c.artistBaseline?.['name']??'')]);
      if(!anchor&&!independentlyResolved&&!projectInBiography){hold(c.profile.href,'member_has_no_second_native_identity_anchor',{name,pid});continue;}
      await createRelation(ctx,'artist_membership',{artistId:aid,personId:pid},{role});count('memberships_added');
      report.outcomes.push({phase:'profiles',membership:{artistId:aid,personId:pid,name,role}});
    }
  }
}

async function genres(ctx:OperatorContext,kind:'artist'|'album',id:number,terms:string[],url:string):Promise<void> {
  if(!terms.length)return;
  const taxonomy=await loadTaxonomy(ctx.client);
  const mapped=[...new Set(terms.flatMap(term=>resolveGenreValue(taxonomy,term).items.flatMap(item=>item.kind==='genre'?[item.genreId]:[])))];
  const ids=mapped.filter(g=>!mapped.some(child=>g!==child&&isAncestorOf(taxonomy,g,child)));
  const existing=(await ctx.client.query<Row>(`SELECT genre_id::int,status,role,decision_kind FROM ingest.${kind}_genres WHERE ${kind}_id=$1`,[id])).rows;
  const preserveEditorial=existing.some(e=>e['decision_kind']==='human'&&e['status']==='confirmed');
  for(const gid of ids){
    const g=taxonomy.genres.get(gid);if(!g?.active)continue;
    if(existing.some(e=>e['genre_id']===gid||e['status']==='confirmed'&&isAncestorOf(taxonomy,gid,e['genre_id'])))continue;
    if(preserveEditorial){hold(`${kind}:${id}`,'preserved_editorial_genres',g.slug);continue;}
    await ctx.client.query('SAVEPOINT genre_change');
    try{
      const role=existing.some(e=>e['status']==='confirmed'&&e['role']==='primary')?'secondary':'primary';
      await confirmGenre(ctx.client,{kind,entityId:id,genreSlug:g.slug,actor:ctx.operator,reason:`Género documentado en ${url}: ${terms.join(', ')}.`,role,runId:ctx.runId});
      const opened=await ctx.client.query('SELECT 1 FROM ingest.review_queue WHERE id>$1 AND status IN (\'open\',\'in_progress\') LIMIT 1',[reviewFloor]);
      if(opened.rowCount){await ctx.client.query('ROLLBACK TO SAVEPOINT genre_change');hold(`${kind}:${id}`,'genre_would_require_editorial_resolution',g.slug);continue;}
      existing.push({genre_id:gid,status:'confirmed',role,decision_kind:'human'});count(`${kind}_genres_added`);
      await ctx.client.query('RELEASE SAVEPOINT genre_change');
    }catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT genre_change');hold(`${kind}:${id}`,'genre_preserved',error instanceof Error?error.message:String(error));}
  }
}

const countries=/^(Venezuela|United States|United Kingdom|Spain|Mexico|Colombia|Argentina|Chile|Brazil|Germany|France|Italy|Sweden|Curaçao|Trinidad and Tobago|Dominican Republic)$/iu;
async function profiles(ctx:OperatorContext):Promise<void> {
  for(const c of input.cases){
    await resetClaimFloor(ctx);
    const p=c.proposal,info=c.profile.info,href=c.profile.href,url=`https://rateyourmusic.com${href}`;
    const contradictions=p['contradictions'] as string[];
    const aid=p['candidateArtistId'] as number|null,pid=p['candidatePersonId'] as number|null;
    if(aid){
      const live=(await ctx.client.query<Row>('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE',[aid])).rows[0]!;
      const fields:Row={},formed=info['Formed']??'',formationDate=rymPersonDate(formed),location=formed.split(',').map(s=>s.trim()).filter(Boolean);
      const originCountry=location.at(-1),originCity=location.filter(s=>!countries.test(s)&&!/(?<!\d)\d{4}(?!\d)/u.test(s)).join(', ');
      if(formationDate&&!live['formed_year']&&!disputedRymField('formed_year',contradictions))fields['formed_year']=Number(formationDate.slice(0,4));
      if(originCountry&&countries.test(originCountry)&&!live['origin_country']&&!disputedRymField('origin_country',contradictions))fields['origin_country']=originCountry;
      if(originCity&&originCity.length<=120&&!live['origin_city']&&!disputedRymField('origin_city',contradictions))fields['origin_city']=originCity;
      const ended=rymPersonDate(info['Disbanded']);
      if(ended&&!live['disbanded_year']&&!disputedRymField('disbanded_year',contradictions)&&(!live['formed_year']||Number(ended.slice(0,4))>=Number(live['formed_year'])))fields['disbanded_year']=Number(ended.slice(0,4));
      const current=(info['Currently']??'').split(',').map(s=>s.trim()).filter(Boolean),country=current.at(-1),city=current.slice(0,-1).join(', ');
      if(country&&countries.test(country)){
        if(!live['current_country'])fields['current_country']=country;
        if(city&&city.length<=120&&!live['current_city'])fields['current_city']=city;
      }
      if(Object.keys(fields).length){await updateEntity(ctx,'artist',aid,fields);count('artist_fields_added',Object.keys(fields).length);report.outcomes.push({phase:'profiles',kind:'artist',id:aid,fields});}
      await genres(ctx,'artist',aid,(info['Genres']??'').split(',').map(s=>s.trim()).filter(Boolean),url);
      // A profile name is a proved alias of its artist destination; civil
      // names and other projects are not copied wholesale from Also Known As.
      await addAlias(ctx,'artist',aid,c.profile.nombre);
      await members(ctx,c,aid);
    }
    if(pid){
      const live=(await ctx.client.query<Row>('SELECT * FROM public.persons WHERE id=$1 FOR UPDATE',[pid])).rows[0]!;
      const fields:Row={},born=rymPersonDate(info['Born']),died=rymPersonDate(info['Died']);
      const career=(await ctx.client.query<Row>('SELECT from_year,to_year,is_current FROM public.artist_members WHERE person_id=$1',[pid])).rows;
      const chronology=(!born||!died||born.slice(0,Math.min(born.length,died.length))<=died.slice(0,Math.min(born.length,died.length)))&&career.every(m=>!born||(!m['from_year']||m['from_year']>=Number(born.slice(0,4)))&&(!m['to_year']||m['to_year']>=Number(born.slice(0,4))));
      if(chronology&&born&&compatibleRymDate(live['birth_date_value'],born)&&!disputedRymField('birth_date',contradictions)&&!live['birth_date_value'])fields['birth_date']=born;
      if(chronology&&died&&compatibleRymDate(live['death_date_value'],died)&&!disputedRymField('death_date',contradictions)&&career.every(m=>!m['is_current']&&(!m['from_year']||m['from_year']<=Number(died.slice(0,4)))&&(!m['to_year']||m['to_year']<=Number(died.slice(0,4))))){
        if(!live['death_date_value'])fields['death_date']=died;
        if(!live['is_deceased'])fields['is_deceased']=true;
      }
      const birthplace=(info['Born']??'').split(',').map(s=>s.trim());
      const birthCity=born?birthplace[1]:birthplace.length>=3?birthplace[0]:null;
      if(birthCity&&birthCity.length<=120&&!countries.test(birthCity)&&!live['birth_city']&&!disputedRymField('birth_city',contradictions))fields['birth_city']=birthCity;
      const civil=(info['Also Known As']??'').split(/[,;|]/u).filter(s=>/\[(?:birth|real|full) name\]/iu.test(s)).map(s=>s.replace(/\s*\[[^\]]*\]/gu,'').trim());
      if(civil.length===1&&!live['real_name']&&!disputedRymField('real_name',contradictions))fields['real_name']=civil[0];
      // Untagged civil names need literal corroboration in the independently
      // reviewed quotations. A different project name never becomes real_name.
      const civilNames:Record<string,string>={
        '/artist/reix':'Reinaldo López','/artist/dhargorak':'Daniel Perdomo',
        '/artist/sunsplash':'Alberto Stangarone','/artist/odnam':'Armando Figueredo',
        '/artist/luislo':'Luis Ángel Lozano Acosta','/artist/lucas-de-paiva':'Lucas Caramuru de Paiva',
        '/artist/jasmine-sendar':'Jasmine Jeritza Sendar','/artist/fito-paez':'Rodolfo Páez Ávalos',
        '/artist/durban-betancourt-laverde':'Durban Omar Betancourt Laverde',
        '/artist/bolas-criollas':'Javier Alejandro Castellanos','/artist/rize-1200':'Ramón Andrés Guzmán Ojeda',
      };
      const civilName=civilNames[href];
      if(civilName&&!live['real_name']&&!fields['real_name']&&!disputedRymField('real_name',contradictions)&&c.evidence.some(e=>norm(e.quote).includes(norm(civilName))))fields['real_name']=civilName;
      if(Object.keys(fields).length){await updateEntity(ctx,'person',pid,fields);count('person_fields_added',Object.keys(fields).length);report.outcomes.push({phase:'profiles',kind:'person',id:pid,fields});}
      if(!aid||norm(c.profile.nombre)===norm(live['name'])||c.evidence.some(e=>norm(e.quote).includes(norm(c.profile.nombre))))await addAlias(ctx,'person',pid,c.profile.nombre);
    }
    await attachClaims(ctx,url,c.profile.capturePins,`Perfil identificado: ${c.profile.nombre}; ${JSON.stringify(info)}. Discrepancias conservadas: ${contradictions.join('; ')}`);
  }
}

async function albumCandidates(ctx:OperatorContext,aid:number):Promise<ReviewedReleaseCandidate[]> {
  return (await ctx.client.query<ReviewedReleaseCandidate>(`SELECT a.id::int,a.title,a.release_year,a.catalog_id,a.media_format,a.album_type,
    ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases,
    ARRAY(SELECT classification FROM ingest.effective_album_classifications WHERE album_id=a.id) classifications,
    ARRAY(SELECT title FROM public.tracks WHERE album_id=a.id ORDER BY disc_number,track_number,id) titles
    FROM ingest.catalog_albums a WHERE a.artist_id=$1 ORDER BY a.id`,[aid])).rows;
}

async function applyRelease(ctx:OperatorContext,r:Release,aid:number):Promise<void> {
  await resetClaimFloor(ctx);
  sourcePins(r.capturePins,r.href);
  const $=load(readFileSync(r.capturePins.find(p=>p.path.endsWith('.html'))!.path,'utf8'));
  const owner=$('.release_page_header a[href^="/artist/"], a.artist[href^="/artist/"]').first().attr('href');
  if(!owner||rymHref(owner)!==rymHref(r.artista_url)){hold(r.href,'release_primary_owner_not_confirmed');return;}
  const identity=cases.get(r.artista_url)!;
  if(!reviewedRymOwnerMatches(r.artista,[identity.profile.nombre,String(identity.artistBaseline?.['name']??'')])){hold(r.href,'release_credited_to_another_project_in_combined_rym_profile',r.artista);return;}
  if(r.artista_url==='/artist/los_vanders'&&r.anio===2004){hold(r.href,'unresolved_release_or_demo_attribution_recorded_in_identity_review');return;}
  if((identity.proposal['contradictions'] as string[]).some(note=>/no se verificaron externamente/iu.test(note))&&!identity.evidence.some(e=>norm(e.quote).includes(norm(r.titulo)))&&!identity.albumsBaseline.some(a=>norm(a['title'])===norm(r.titulo))){hold(r.href,'release_attribution_not_corroborated_as_noted_in_identity_review');return;}
  const yearDisputed=(identity.proposal['contradictions'] as string[]).some(note=>{
    const years=[...new Set(note.match(/\b(?:19|20)\d{2}\b/gu)??[])];
    return years.length>1&&norm(note).includes(norm(r.titulo))&&/fecha|data|año|frente|mientras|en \d{4}/iu.test(note);
  });
  if(yearDisputed){hold(r.href,'release_year_discrepancy_preserved',{sourceYear:r.anio});r={...r,anio:null,released_text:null};}
  if(!r.musicalEditionVerified&&r.pistas.length>=3){
    const musicSource=identity.evidence.find(e=>e.primaryEligible&&/bandcamp\.com\/album\//u.test(e.url)&&norm(e.text).includes(norm(r.titulo))&&r.pistas.every(t=>norm(e.text).includes(norm(t.titulo))));
    if(musicSource){r={...r,musicalEditionVerified:true};count('audio_editions_corroborated');}
  }
  const publication=rymReleaseClassifications(r);
  if(!publication||publication.reviewReason){hold(r.href,publication?.reviewReason??'audiovisual_or_unsupported_publication');return;}
  const nativeHolds=await ctx.client.query(`SELECT 1 FROM ingest.review_queue WHERE album_id IN (SELECT id FROM public.albums WHERE artist_id=$1)
    AND payload->>'operation'='rym_publication_identity_hold' AND status IN ('open','in_progress')`,[aid]);
  if(nativeHolds.rowCount){hold(r.href,'artist_has_existing_publication_identity_hold');return;}
  const existing=await albumCandidates(ctx,aid),match=matchReviewedRymRelease(r,existing);
  if(match.status==='hold'){
    if(r.href==='/release/additional/cero-a-la-izquierda/demo-1986'&&match.reason==='nearly_complete_existing_repertoire'&&match.ids.length===1&&match.ids[0]===146&&r.musicalEditionVerified){
      const versions=(await ctx.client.query<{id:number;position:number;source_ref:string|null}>('SELECT id::int,position,source_ref FROM ingest.album_versions WHERE album_id=146 FOR UPDATE')).rows;
      if(!versions.some(v=>v.source_ref===r.url)){
        const versionId=await writeEditorResource(ctx,'version',146,{title:'Demo 1986',format:'Digital',releaseDate:'2019-05-01',sourceRef:r.url,
          position:Math.max(0,...versions.map(v=>v.position))+1,distinctTracks:false,isPrimary:false,
          notes:'Edición digital de Humano Derecho Records, publicada el 1 de mayo de 2019. El material corresponde a la etapa 1985-1986. Diez de once títulos coinciden literalmente al normalizar con la obra existente; «Seré lo que yo quiera» queda como variante documental sin asignación automática de pista. Se conserva el orden original del catálogo. Fuente primaria: https://humanoderechorecords.bandcamp.com/album/demo-1986'});
        count('versions_added');report.outcomes.push({phase:'releases',albumId:146,versionId,href:r.href,status:'preserved_as_digital_edition'});
      }
      return;
    }
    hold(r.href,match.reason,match.ids);return;
  }
  let albumId:number;
  if(match.status==='new'){
    if(/collaboration|split/iu.test(r.tipo??'')){
      const same=(await ctx.client.query<{id:number;name:string;release_year:number|null}>(`SELECT a.id::int,p.name,a.release_year FROM ingest.catalog_albums a JOIN public.artists p ON p.id=a.artist_id WHERE a.artist_id<>$1 AND lower(a.title)=lower($2)`,[aid,r.titulo])).rows.filter(a=>reviewedRymOwnerMatches(r.artista,[a.name])&&(!r.anio||!a.release_year||r.anio===a.release_year));
      if(same.length){hold(r.href,'collaboration_already_cataloged_under_another_credited_artist',same);return;}
    }
    const variants=await ctx.client.query(`SELECT 1 FROM ingest.album_versions v JOIN public.albums a ON a.id=v.album_id WHERE a.artist_id=$1 AND (v.source_ref=$2 OR ($3::text IS NOT NULL AND v.catalog_number=$3))`,[aid,r.url,r.catalog_no]);
    if(variants.rowCount){hold(r.href,'already_present_as_version');return;}
    const tracks=rymTrackPositions(r.pistas);if(tracks===null){hold(r.href,'ambiguous_track_positions');return;}
    const date=rymReleaseDateText(r.released_text);
    const fields:Row={title:r.titulo,album_type:publication.albumType,notes:`Publicación musical documentada en ${r.url}. Originales conservados; identidad revisada.`};
    if(r.anio)fields['release_year']=r.anio;if(date)fields['release_date_text']=date;
    if(r.catalog_no&&r.catalog_no.length<=80&&rymCatalogKey(r.catalog_no))fields['catalog_id']=r.catalog_no;
    if(r.formato&&r.formato.length<=50)fields['media_format']=r.formato;
    const distinct=distinctRymPublication({title:r.titulo,year:r.anio,albumType:publication.albumType,titles:tracks.map(t=>t.title)},existing);
    albumId=(await createEntity(ctx,'album',fields,{artistId:aid,allowSimilar:distinct})).id;
    count('albums_created');report.outcomes.push({phase:'releases',status:'created',href:r.href,albumId,artistId:aid});
  }else{albumId=match.album.id;count('existing_albums_matched');}
  const current=(await ctx.client.query<Row>('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0]!;
  const fields:Row={},date=rymReleaseDateText(r.released_text);
  for(const [key,value] of Object.entries({release_year:r.anio,release_date_text:date,catalog_id:r.catalog_no&&rymCatalogKey(r.catalog_no)?r.catalog_no:null,media_format:r.formato,
    rym_rating:typeof r.rating==='number'&&r.rating>=0&&r.rating<=5?r.rating:null,rym_ratings_count:r.n_ratings&&r.n_ratings>0?r.n_ratings:null})){
    if(value!==null&&value!==undefined&&(current[key]===null||current[key]==='')&&!(key==='catalog_id'&&String(value).length>80)&&!(key==='media_format'&&String(value).length>50))fields[key]=value;
  }
  if(Object.keys(fields).length){await updateEntity(ctx,'album',albumId,fields);count('album_fields_added',Object.keys(fields).length);report.outcomes.push({phase:'releases',albumId,fields});}
  const before=new Set((await ctx.client.query<{classification:string}>('SELECT classification FROM ingest.effective_album_classifications WHERE album_id=$1',[albumId])).rows.map(v=>v.classification));
  const rejected=new Set((await ctx.client.query<{classification:string}>('SELECT classification FROM ingest.album_classification_decisions WHERE album_id=$1 AND NOT selected',[albumId])).rows.map(v=>v.classification));
  const wanted=publication.classifications.filter(v=>!rejected.has(v));
  if(wanted.some(v=>!before.has(v))){await writeAlbumClassifications(ctx,albumId,wanted,{addOnly:true});count('classifications_added',wanted.filter(v=>!before.has(v)).length);}
  const trackRows=(await ctx.client.query<ExistingRymTrack>(`SELECT id::int,title,disc_number,track_number,duration_seconds,ARRAY(SELECT alias FROM ingest.track_aliases WHERE track_id=t.id) aliases FROM public.tracks t WHERE album_id=$1 ORDER BY disc_number,track_number,id`,[albumId])).rows;
  const plan=planRymTrackEnrichment(trackRows,[r.pistas]);
  for(const reason of plan.withheld)hold(r.href,reason,{albumId});
  for(const track of plan.added){await createEntity(ctx,'track',track,{albumId,allowSimilar:true});count('tracks_created');}
  for(const d of plan.durations){await updateEntity(ctx,'track',d.id,{duration_seconds:d.seconds});count('track_durations_added');}
  const labels=r.labels??[];
  for(const label of labels){
    const matches=(await ctx.client.query<{id:number;name:string}>(`SELECT id::int,name FROM public.organizations WHERE organization_type='record_label' UNION SELECT o.id::int,alias FROM ingest.organization_aliases a JOIN public.organizations o ON o.id=a.organization_id WHERE o.organization_type='record_label'`)).rows.filter(o=>norm(o.name)===norm(label.nombre));
    const ids=[...new Set(matches.map(m=>m.id))];
    if(ids.length!==1){hold(r.href,'label_identity_not_unique',label.nombre);continue;}
    if((await ctx.client.query('SELECT 1 FROM ingest.album_labels WHERE album_id=$1 AND organization_id=$2 AND version_id IS NULL AND role=\'label\'',[albumId,ids[0]])).rowCount)continue;
    if(current['label_id']&&Number(current['label_id'])!==ids[0]){hold(r.href,'preserved_existing_label',label.nombre);continue;}
    await writeEditorResource(ctx,'label',albumId,{organizationId:ids[0],role:'label',position:0,sourceText:label.nombre,notes:`Fuente de esta edición: ${r.url}`});
    if(!current['label_id']&&labels.length===1)await updateEntity(ctx,'album',albumId,{label_id:ids[0]});
    count('album_labels_added');
  }
  await genres(ctx,'album',albumId,[...(r.primaryGenres??[]),...(r.secondaryGenres??[])],r.url);
  await attachClaims(ctx,r.url,r.capturePins,`${r.titulo}: ${r.tipo}; año ${r.anio}; datos y lista primaria de la misma edición.`);
}

async function releases(ctx:OperatorContext):Promise<void> {
  // Multiple captures/editions of one title require agreement before any fill.
  const groups=new Map<string,Release[]>();
  for(const r of input.releases){const aid=cases.get(r.artista_url)?.proposal['candidateArtistId'];if(!aid){hold(r.href,'verified_person_has_no_approved_artist_destination');continue;}
    const key=`${aid}|${norm(r.titulo)}|${rymReleaseClassifications(r)?.albumType??r.tipo}`;groups.set(key,[...(groups.get(key)??[]),r]);}
  let processed=0;
  for(const rows of groups.values()){
    const r=rows[0]!,aid=cases.get(r.artista_url)!.proposal['candidateArtistId'] as number;
    if(rows.length>1&&new Set(rows.map(s=>JSON.stringify([s.anio,s.catalog_no,s.formato,s.tipo,s.pistas.map(t=>[t.n,norm(t.titulo)])]))).size>1){hold(r.href,'captured_editions_disagree',rows.map(s=>s.href));continue;}
    await ctx.client.query('SAVEPOINT release_change');
    const countsBefore={...report.counts},outcomesBefore=report.outcomes.length;
    try{await applyRelease(ctx,r,aid);await ctx.client.query('RELEASE SAVEPOINT release_change');}
    catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT release_change');report.counts=countsBefore;report.outcomes.length=outcomesBefore;
      if(!(error instanceof OperatorError))throw error;hold(r.href,`native_${error.code}`,error.message);}
    processed++;if(processed%15===0)console.log(`Publicaciones comprobadas ${processed}/${groups.size}`);
  }
}

async function credits(ctx:OperatorContext):Promise<void> {
  const ledger=readRymIdentityLedger(input.baselineLedger),checked=new Set<string>();
  const sources=[...new Map([...input.releases,...input.creditReleases].map(r=>[r.href,r])).values()];
  for(const r of sources){
    await resetClaimFloor(ctx);
    const own=cases.get(r.artista_url),old=ledger.identities.find(e=>e.href===r.artista_url&&e.status==='resolved');
    const aid=own?.proposal['candidateArtistId']??old?.artistId;
    if(!aid){hold(r.href,'credit_album_owner_unresolved');continue;}
    if(await excludedArtist(ctx.client,{artistId:aid})){hold(r.href,'credit_album_owner_excluded_by_editorial_policy');continue;}
    if(!own&&!checked.has(r.artista_url)){try{await assertRymIdentity(ctx.client,ledger,r.artista_url,aid);checked.add(r.artista_url);}catch{hold(r.href,'baseline_album_owner_no_longer_valid');continue;}}
    sourcePins(r.capturePins,r.href);
    const match=matchReviewedRymRelease(r,await albumCandidates(ctx,aid));
    if(match.status!=='match'){hold(r.href,'credited_publication_not_matched_to_exact_edition',match);continue;}
    const albumId=match.album.id;
    for(const credit of r.creditos){
      const c=credit.href?cases.get(rymHref(credit.href)):undefined;if(!credit.roles)continue;
      // Owned releases can also credit already documented native members;
      // this never creates a person from an isolated name.
      let pid=(c?.proposal['candidatePersonId']??null) as number|null,artistId=(c?.proposal['candidateArtistId']??null) as number|null;
      if(!c&&own){
        const credited=credit.href?ledger.identities.find(e=>e.href===rymHref(credit.href!)&&e.status==='resolved'):undefined;
        if(credited?.artistId){
          try{
            await assertRymIdentity(ctx.client,ledger,credited.href,credited.artistId);
            const linked=(await ctx.client.query<{person_id:number}>('SELECT person_id::int FROM ingest.musical_identities WHERE artist_id=$1 AND relationship=\'solo_identity\'',[credited.artistId])).rows;
            if(linked.length===1)pid=linked[0]!.person_id;
            else if(!await excludedArtist(ctx.client,{artistId:credited.artistId}))artistId=credited.artistId;
          }catch{hold(r.href,'credited_profile_identity_no_longer_valid',credit.nombre);}
        }
        if(!pid&&!artistId){
          const names=await loadPersonNames(ctx),ids=[...(names.get(norm(credit.nombre))??[])];
          const anchored=(await ctx.client.query<{person_id:number}>(`SELECT DISTINCT person_id::int FROM public.artist_members WHERE artist_id=$1 AND person_id=ANY($2::bigint[])
            UNION SELECT DISTINCT c.person_id::int FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE a.artist_id=$1 AND c.person_id=ANY($2::bigint[])`,[aid,ids])).rows;
          if(anchored.length===1)pid=anchored[0]!.person_id;
        }
      }
      const kind=pid?'person':artistId?'artist':null,target=pid??artistId;if(!kind||!target)continue;
      if(c?.profile.href==='/artist/fito-paez'&&norm(r.titulo)==='el amor ya no existe'&&/keyboard|teclad/iu.test(credit.roles)){hold(r.href,'unconfirmed_keyboard_role_excluded',credit);continue;}
      const type=creditTypeForRole(credit.roles),column=kind==='person'?'person_id':'artist_id';
      const scope=credit.positions?rymCreditScope(credit.positions,r.pistas):null;
      if(credit.positions&&!scope){hold(r.href,'ambiguous_credit_track_scope',credit);continue;}
      const targets=scope?await ctx.client.query<Row>('SELECT id::int,title,disc_number,track_number FROM public.tracks WHERE album_id=$1',[albumId]):null;
      const rows=scope?scope.flatMap(track=>targets!.rows.filter(t=>t['disc_number']===track.disc_number&&t['track_number']===track.track_number&&norm(t['title'])===norm(track.title))):[{id:albumId}];
      if(scope&&rows.length!==scope.length){hold(r.href,'credit_track_positions_or_titles_differ',credit);continue;}
      for(const row of rows){
        const table=scope?'track_credits':'album_credits',parent=scope?'track_id':'album_id';
        const existing=(await ctx.client.query<Row>(`SELECT id::int,role FROM public.${table} WHERE ${parent}=$1 AND ${column}=$2 AND credit_type=$3 FOR UPDATE`,[row['id'],target,type])).rows;
        const role=combineRoles([...(existing.map(e=>String(e['role']))),credit.roles]);
        if(role.length>200||existing.length>1){hold(r.href,'credit_existing_duplicates_or_role_too_long',credit);continue;}
        if(existing.length&&sameRole(existing[0]!['role'],role))continue;
        await ctx.client.query('SAVEPOINT credit_change');
        try{
          const relationKind=scope?'track_credit':'album_credit';
          if(existing.length)await updateRelation(ctx,relationKind,existing[0]!['id'],{role});
          else await createRelation(ctx,relationKind,{...(scope?{trackId:row['id']}:{albumId}),...(kind==='person'?{personId:target}:{artistId:target})},{credit_role:role,credit_type:type});
          count(scope?'track_credits_added':'album_credits_added');report.outcomes.push({phase:'credits',href:r.href,albumId,parent:row['id'],kind,target,role});
          await ctx.client.query('RELEASE SAVEPOINT credit_change');
        }catch(error){await ctx.client.query('ROLLBACK TO SAVEPOINT credit_change');if(!(error instanceof OperatorError))throw error;hold(r.href,`native_credit_${error.code}`,error.message);}
      }
    }
    await attachClaims(ctx,r.url,r.capturePins,`${r.titulo}: créditos de colaboradores identificados; posiciones literales de esta edición.`);
  }
}

async function main(){
  verifyRymPin(input.proposalPin);assert.equal(input.cases.length,70);assert.equal(cases.size,70);
  const stages=phase==='all'?['identities','profiles','releases','credits']:[phase];
  for(const stage of stages){
    const result=await withOperatorRun({name:`catalogo:rym-verificados-${stage}`,operator:'Codex por encargo expreso de Brian: aplicar los puntos 1, 2 y 3',
      note:'Aplicación de identidades RYM investigadas y revisadas; fuentes originales verificadas, destinos actuales contrastados, conservación de discrepancias y control de duplicación por entidad y edición.',
      params:{campaign:input.campaign,phase:stage,inputSha256:digest(readFileSync(path.join(directory!,'entrada-verificada.json'))),proposalPin:input.proposalPin}},async ctx=>{
      await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
      await ctx.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'");
      reviewFloor=Number((await ctx.client.query<{id:string}>('SELECT coalesce(max(id),0)::text id FROM ingest.review_queue')).rows[0]!.id);
      for(const c of input.cases)await validateCase(ctx,c);
      if(confirm&&stage!=='identities')for(const c of input.cases)for(const [kind,id] of [['artist',c.proposal['candidateArtistId']],['person',c.proposal['candidatePersonId']]] as const){
        if(!id)continue;
        assert.ok((await ctx.client.query(`SELECT 1 FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.relation='external_rym_identity' AND f.documentary_state='verified' AND b.disposition='applied' AND b.${kind}_id=$1 AND f.value=$2::jsonb`,[id,JSON.stringify({url:`https://rateyourmusic.com${c.profile.href}`})])).rowCount,'Apply native identity links first');
      }
      const firstJournal=(await ctx.client.query<{id:string}>('SELECT coalesce(max(id),0)::text id FROM ingest.change_journal')).rows[0]!.id;
      if(stage==='identities')await identities(ctx);
      if(stage==='profiles')await profiles(ctx);
      if(stage==='releases')await releases(ctx);
      if(stage==='credits')await credits(ctx);
      const reviews=(await ctx.client.query<{count:string}>('SELECT count(*)::text FROM ingest.review_queue WHERE id>$1 AND status IN (\'open\',\'in_progress\')',[reviewFloor])).rows[0]!.count;
      assert.equal(Number(reviews),0,'Application must not leave an open review queue');
      const changes=(await ctx.client.query<Row>('SELECT table_name,op,count(*)::int count FROM ingest.change_journal WHERE id>$1 AND run_id=$2 GROUP BY 1,2 ORDER BY 1,2',[firstJournal,ctx.runId])).rows;
      return {stage,changes,counts:{...report.counts},outcomes:report.outcomes.length,held:report.held.length};
    },{rollbackOnly:!confirm,serializable:true});
    report.runs.push(result.runId);save();
    writeFileSync(path.join(directory!,`run-${result.runId}-${stage}-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({counts:report.counts,held:report.held.length,runs:report.runs,dryRun:!confirm}));
}
main().catch((error:unknown)=>{save();console.error(error);process.exitCode=1;}).finally(()=>closeDb());
