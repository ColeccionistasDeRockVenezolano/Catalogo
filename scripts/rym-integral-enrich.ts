import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb,getPool } from '../src/db/client.js';
import { createEntity,OperatorError,updateEntity,withOperatorRun,type OperatorContext } from '../src/merge/operator.js';
import { validateRymCross,verifyRymPin,normalizeRymIdentity as norm,type RymCross } from '../src/verification/rym-identity.js';
import { rymReleaseClassifications,rymReleaseDateText,type RymPublicationInput,type RymTrackInput } from '../src/verification/rym-release-plan.js';
import { planRymTrackEnrichment,type ExistingRymTrack } from '../src/verification/rym-track-enrichment.js';
import { loadTaxonomy } from '../src/genres/store.js';
import { isAncestorOf,resolveGenreValue } from '../src/genres/taxonomy.js';
import { confirmGenre } from '../src/genres/human.js';
import { GenreCurationError } from '../src/genres/errors.js';
import { writeAlbumClassifications } from '../src/catalog/album-classifications.js';
import { writeEditorResource } from '../src/catalog/editor.js';
import { tracklistFingerprint } from '../src/verification/tracklist-corrections.js';
import {rymCatalogKey} from '../src/verification/rym-publication-identity.js';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const directory=arg('--dir');if(!directory)throw new Error('--dir obligatorio');
const phase=arg('--phase')??'metadata';
if(!['metadata','tracks','labels','genres','categories','all'].includes(phase))throw new Error('Fase desconocida');
const active=(name:string)=>phase==='all'||phase===name;
const confirm=process.argv.includes('--confirm');
const limit=Number(arg('--limit')??0);
const startOffset=Number(arg('--offset')??0);
interface Release extends RymPublicationInput {slug:string;href:string;url:string;anio:number|null;catalog_no:string|null;released_text:string|null;pistas:RymTrackInput[];labels:Array<{nombre:string;slug:string}>;primaryGenres?:string[];secondaryGenres?:string[];rating?:number|null;n_ratings?:number}
const jsonl=<T>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const consensus=<T>(items:T[])=>{const values=[...new Map(items.filter(x=>x!==null&&x!==undefined&&x!=='').map(x=>[JSON.stringify(x),x])).values()];return values.length===1?values[0]:undefined;};
const report:{runs:number[];changed:number;counts:Record<string,number>;withheld:Array<Record<string,unknown>>;outcomes:Array<Record<string,unknown>>}={runs:[],changed:0,counts:{},withheld:[],outcomes:[]};
function count(key:string,n=1){report.counts[key]=(report.counts[key]??0)+n;}
function hold(albumId:number,reason:string,detail?:unknown){report.withheld.push({albumId,reason,detail});}

async function evidence(context:OperatorContext,rows:Release[],cross:RymCross[]){
  for(const [i,release] of rows.entries())await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
    SELECT c.id,$2,$3,$4,$5 FROM ingest.claims c WHERE c.run_id=$1 AND
    (c.album_id=$6 OR c.track_id IN (SELECT id FROM public.tracks WHERE album_id=$6))
    ON CONFLICT DO NOTHING`,[context.runId,release.url,`RYM: ${release.titulo}; ${phase}; identidad y edición contrastadas.`,i,digest(JSON.stringify(cross[i]?.capturePins)),cross[i]?.albumId]);
}

async function main(){
  const cross=await validateRymCross(getPool(),directory!);
  const rich=new Map(jsonl<Release>(path.join(directory!,'corpus/albumes.jsonl')).map(r=>[r.slug,r]));
  const grouped=new Map<number,RymCross[]>();
  for(const row of cross.values())grouped.set(row.albumId,[...(grouped.get(row.albumId)??[]),row]);
  const jobs=[...grouped].slice(0,limit||undefined);
  const taxonomyClient=await getPool().connect();
  const taxonomy=await loadTaxonomy(taxonomyClient).finally(()=>taxonomyClient.release());
  const ownGenrePairs=new Set((await getPool().query<{entity_id:number;genre_id:number}>(`SELECT DISTINCT l.entity_id::int,l.genre_id::int FROM ingest.genre_assignment_log l JOIN ingest.scrape_runs r ON r.id=l.run_id WHERE l.entity_kind='album' AND r.params->>'campaign'='rym-integral-2026-10-21'`)).rows.map(g=>`${g.entity_id}:${g.genre_id}`));
  const unresolvedLabels=new Set<string>();
  const normalizedLabelNames=new Set((await getPool().query<{name:string}>('SELECT name FROM public.organizations UNION SELECT alias AS name FROM ingest.organization_aliases')).rows.map(r=>norm(r.name)));
  for(let offset=startOffset;offset<jobs.length;offset+=25){
    const batch=jobs.slice(offset,offset+25);
    const result=await withOperatorRun({name:`catalogo:rym-integral-${phase}`,operator:'Codex (encargo de Brian: agotar RYM sin duplicados ni revisiones masivas)',
      note:`Aprovechamiento integral RYM: ${phase}; completar datos documentados, respetar decisiones existentes, resolver antes de proponer revisiones.`,
      params:{campaign:'rym-integral-2026-10-21',phase,offset,albums:batch.map(([id])=>id),planHash:digest(JSON.stringify(batch)),
        sourcePins:batch.flatMap(([,rows])=>rows.flatMap(r=>r.capturePins))}},async context=>{
      await context.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s'");
      const outcomes:Array<Record<string,unknown>>=[];
      for(const [albumId,proofs] of batch){
        await context.client.query('SAVEPOINT integral_album');
        const rows=proofs.map(p=>rich.get(p.slug)!);
        for(const proof of proofs)for(const pin of proof.capturePins)verifyRymPin(pin);
        const current=(await context.client.query<Record<string,unknown>>('SELECT * FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
        if(!current||Number(current['artist_id'])!==proofs[0]!.artistId||current['title']!==proofs[0]!.tituloCatalogo)throw new Error('Destino cambió');
        let changed=0;
        try{
          if(active('metadata')){
            const fields:Record<string,string|number>={};
            const wanted={catalog_id:consensus(rows.map(r=>r.catalog_no?.trim()).filter((v):v is string=>!!v&&!!rymCatalogKey(v))),
              media_format:consensus(rows.map(r=>r.formato).filter((v):v is string=>!!v)),
              release_year:consensus(rows.map(r=>r.anio).filter((v):v is number=>!!v)),
              release_date_text:consensus(rows.map(r=>rymReleaseDateText(r.released_text)).filter((v):v is string=>!!v)),
              rym_rating:consensus(rows.map(r=>r.rating).filter((v):v is number=>typeof v==='number'&&v>=0&&v<=5)),
              rym_ratings_count:consensus(rows.map(r=>r.n_ratings).filter((v):v is number=>typeof v==='number'&&v>0))};
            for(const [field,value] of Object.entries(wanted))if(value!==undefined&&(current[field]===null||current[field]==='')
              &&!(field==='catalog_id'&&String(value).length>80)&&!(field==='media_format'&&String(value).length>50))fields[field]=value;
            if(Object.keys(fields).length){await updateEntity(context,'album',albumId,fields);changed+=Object.keys(fields).length;for(const key of Object.keys(fields))count(key);}
          }
          if(active('tracks')){
            const rejected=(await context.client.query<{fingerprint:string}>("SELECT payload->>'fingerprint' fingerprint FROM ingest.review_queue WHERE album_id=$1 AND payload->>'operation'='tracklist_source_rejected'",[albumId])).rows;
            const sourceRejected=rows.some(r=>rejected.some(x=>x.fingerprint===tracklistFingerprint(r.pistas.map(t=>t.titulo))));
            if(sourceRejected)hold(albumId,'previously_rejected_tracklist');
            const live=(await context.client.query<ExistingRymTrack>('SELECT t.id::int,t.title,t.disc_number,t.track_number,t.duration_seconds,ARRAY(SELECT alias FROM ingest.track_aliases WHERE track_id=t.id) aliases FROM public.tracks t WHERE album_id=$1 ORDER BY disc_number,track_number,id FOR UPDATE',[albumId])).rows;
            const plan=planRymTrackEnrichment(live,sourceRejected?[]:rows.map(r=>r.pistas));
            for(const reason of plan.withheld)hold(albumId,reason);
            for(const track of plan.added)await createEntity(context,'track',track,{albumId,allowSimilar:true});
            for(const duration of plan.durations)await updateEntity(context,'track',duration.id,{duration_seconds:duration.seconds});
            count('tracks_added',plan.added.length);count('durations_filled',plan.durations.length);changed+=plan.added.length+plan.durations.length;
          }
          if(active('labels')){
            const names=rows.map(r=>r.labels.map(l=>l.nombre));
            const labels=[...new Set(names[0]??[])].filter(label=>names.every(set=>set.includes(label)));
            const organizations:Array<{id:number;label:string}>=[];
            for(const label of labels){
              if(label.length<3||/^(?:n\/?a|none|unknown|independent|self[- ]released|not on label)$/iu.test(label))continue;
              const matches=(await context.client.query<{id:number}>(`SELECT DISTINCT o.id::int FROM public.organizations o
                LEFT JOIN ingest.organization_aliases a ON a.organization_id=o.id
                WHERE o.organization_type='record_label' AND (lower(o.name)=lower($1) OR lower(a.alias)=lower($1))`,[label])).rows;
              if(matches.length===1)organizations.push({id:matches[0]!.id,label});
              else if(matches.length)hold(albumId,'ambiguous_label',label);
              else{
                if(normalizedLabelNames.has(norm(label))){hold(albumId,'label_normalized_alias_needs_identity_evidence',label);continue;}
                if(unresolvedLabels.has(label.toLowerCase())){hold(albumId,'label_identity_unresolved',label);continue;}
                await context.client.query('SAVEPOINT integral_label');
                try{
                  const organization=await createEntity(context,'organization',{name:label,organization_type:'record_label',notes:`Sello documentado en ${rows.map(r=>r.url).join(' ')}`});
                  organizations.push({id:organization.id,label});changed++;count('labels_created');
                  normalizedLabelNames.add(norm(label));
                  await context.client.query('RELEASE SAVEPOINT integral_label');
                }catch(error){
                  await context.client.query('ROLLBACK TO SAVEPOINT integral_label');
                  if(!(error instanceof OperatorError))throw error;
                  const matched=error.code==='already_exists'?error.details?.['existingId']:undefined;
                  const existingId=typeof matched==='number'?matched:undefined;
                  const known=existingId?(await context.client.query<{id:number}>("SELECT id::int FROM public.organizations WHERE id=$1 AND organization_type='record_label'",[existingId])).rows[0]:undefined;
                  if(known)organizations.push({id:known.id,label});
                  else{unresolvedLabels.add(label.toLowerCase());hold(albumId,'label_identity_unresolved',label);}
                }
              }
            }
            const uniqueOrganizations=[...new Map(organizations.map(o=>[o.id,o])).values()];
            if(!current['label_id']&&organizations.length===labels.length&&uniqueOrganizations.length===1){
              await updateEntity(context,'album',albumId,{label_id:uniqueOrganizations[0]!.id});current['label_id']=uniqueOrganizations[0]!.id;changed++;count('labels_linked');
            }
            // Keep an existing core label represented when adding co-labels;
            // otherwise the explicit list would hide its fallback in the UI.
            if(uniqueOrganizations.length>1&&(!current['label_id']||uniqueOrganizations.some(o=>o.id===Number(current['label_id'])))){
              const present=(await context.client.query<{organization_id:number}>('SELECT organization_id::int FROM ingest.album_labels WHERE album_id=$1 AND version_id IS NULL AND role=\'label\'',[albumId])).rows;
              for(const [position,organization] of uniqueOrganizations.entries())if(!present.some(o=>o.organization_id===organization.id)){
                await writeEditorResource(context,'label',albumId,{organizationId:organization.id,versionId:null,role:'label',position:position+1,sourceText:organization.label,notes:rows.map(r=>r.url).join(' ')});
                present.push({organization_id:organization.id});
                changed++;count('co_labels_linked');
              }
            }
          }
          if(active('genres')){
            const terms=[...new Set(rows.flatMap(r=>[...(r.primaryGenres??[]),...(r.secondaryGenres??[])]))];
            const mapped=[...new Set(terms.flatMap(term=>resolveGenreValue(taxonomy,term).items.flatMap(item=>item.kind==='genre'?[item.genreId]:[])))];
            const wanted=mapped.filter(gid=>!mapped.some(child=>child!==gid&&isAncestorOf(taxonomy,gid,child)));
            const existing=(await context.client.query<{genre_id:number;status:string;role:string;decision_kind:string;decided_by:string|null}>('SELECT genre_id::int,status,role,decision_kind,decided_by FROM ingest.album_genres WHERE album_id=$1',[albumId])).rows;
            const own=(g:(typeof existing)[number])=>g.decided_by==='auto:rateyourmusic'&&ownGenrePairs.has(`${albumId}:${g.genre_id}`);
            const curated=existing.some(g=>g.status==='confirmed'&&g.decision_kind==='human'&&!own(g));
            if(curated&&wanted.some(gid=>!existing.some(g=>g.genre_id===gid)))hold(albumId,'preserved_editorial_genres');
            for(const gid of curated?[]:wanted){
              if(existing.some(g=>g.genre_id===gid))continue;
              if(existing.some(g=>g.status==='confirmed'&&(isAncestorOf(taxonomy,gid,g.genre_id)||g.decision_kind==='human'&&!own(g)&&isAncestorOf(taxonomy,g.genre_id,gid))))continue;
              const genre=taxonomy.genres.get(gid);if(!genre?.active)continue;
              await context.client.query('SAVEPOINT integral_genre');
              try{
                const primary=existing.some(g=>g.role==='primary'&&g.status==='confirmed'&&!isAncestorOf(taxonomy,g.genre_id,gid));
                await confirmGenre(context.client,{kind:'album',entityId:albumId,genreSlug:genre.slug,actor:'auto:rateyourmusic',
                  reason:`RYM declara ${terms.join(' | ')} en ${rows.map(r=>r.url).join(' ')}`,role:primary?'secondary':'primary',runId:context.runId});
                for(const g of existing)if(g.status==='confirmed'&&isAncestorOf(taxonomy,g.genre_id,gid))g.status='superseded';
                existing.push({genre_id:gid,status:'confirmed',role:primary?'secondary':'primary',decision_kind:'human',decided_by:'auto:rateyourmusic'});
                ownGenrePairs.add(`${albumId}:${gid}`);changed++;count('genres_added');
                await context.client.query('RELEASE SAVEPOINT integral_genre');
              }catch(error){await context.client.query('ROLLBACK TO SAVEPOINT integral_genre');if(!(error instanceof GenreCurationError))throw error;hold(albumId,'genre_hierarchy',genre.slug);}
            }
          }
          if(active('categories')){
            const published=rows.map(r=>rymReleaseClassifications(r));
            if(published.every(p=>p&&!p.reviewReason)){
              const before=(await context.client.query<{classification:string}>('SELECT classification FROM ingest.effective_album_classifications WHERE album_id=$1',[albumId])).rows.map(r=>r.classification);
              const wanted=[...new Set(published.flatMap(p=>p!.classifications))].filter(c=>!before.includes(c));
              const decisions=(await context.client.query<{classification:string}>('SELECT classification FROM ingest.album_classification_decisions WHERE album_id=$1 AND NOT selected',[albumId])).rows.map(r=>r.classification);
              const additions=wanted.filter(c=>!decisions.includes(c));
              if(additions.length){await writeAlbumClassifications(context,albumId,additions,{addOnly:true});changed+=additions.length;count('classifications_added',additions.length);}
            }
          }
          if(changed){await evidence(context,rows,proofs);outcomes.push({albumId,changed});}
          await context.client.query('RELEASE SAVEPOINT integral_album');
        }catch(error){
          await context.client.query('ROLLBACK TO SAVEPOINT integral_album');
          if(!(error instanceof OperatorError)&&!(error&&typeof error==='object'&&'code' in error&&error.code==='PCE01'))throw error;
          hold(albumId,`operator_${error instanceof OperatorError?error.code:'editorial_exclusion'}`,error instanceof Error?error.message:String(error));
        }
      }
      return outcomes;
    },{rollbackOnly:!confirm});
    if(confirm)report.runs.push(result.runId);
    if(confirm)writeFileSync(path.join(directory!,`run-${result.runId}-enrich.json`),JSON.stringify(result,null,2)+'\n');
    report.changed+=result.result.length;report.outcomes.push(...result.result);
    writeFileSync(path.join(directory!,`${phase}-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify({...report,dryRun:!confirm},null,2)+'\n');
    console.log(`${phase}: ${Math.min(offset+25,jobs.length)}/${jobs.length}; changed=${report.changed}`,JSON.stringify(report.counts));
  }
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
