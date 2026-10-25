import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type pg from 'pg';
import { closeDb, getPool } from '../src/db/client.js';
import { createEntity, createRelation, OperatorError, withOperatorRun, type OperatorContext } from '../src/merge/operator.js';
import { creditTypeForRole } from '../src/merge/relations.js';
import { combineRoles, compatiblePeriods, sameRole } from '../src/merge/membership-roles.js';
import { assertRymIdentity, normalizeRymIdentity as norm, readRymIdentityLedger } from '../src/verification/rym-identity.js';
import { completePersonName, exactSourcePeople, membershipPeriodConflict, resolveSourcePerson, sourcePeriod, type PersonCandidate, type SourcePeriod } from '../src/verification/person-source-plan.js';

const root = 'reports/aprovechamiento-1-5-2026-10-17';
const confirm = process.argv.includes('--confirm');
interface Pin { path: string; sha256: string }
interface Source extends SourcePeriod {
  kind: string; url?: string; excerpt: string; capturePins?: Pin[]; artistHref?: string;
  snapshotHash?: string; personMbid?: string; groupIdentityResolved?: boolean; anchors?: number[];
}
interface RecordPlan { name: string; artistId: number; artist: string; relation: string; albumId: number | null; role: string; status: string; reason: string; personId?: number; sources: Source[] }
interface Job extends RecordPlan { fingerprint: string }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ledger = readRymIdentityLedger(`${root}/rym-resto/identity-ledger.json`);
const plan = JSON.parse(readFileSync(`${root}/personas-plan.json`,'utf8')) as { sourcePins: Pin[]; records: RecordPlan[] };
const typedPins = [...new Set(plan.records.flatMap(record=>record.sources.filter(source=>source.personMbid).map(source=>`data/raw/person-identities-2026-10-17/${source.personMbid}.json`)))]
  .filter(file=>existsSync(file)).map(file=>({path:file,sha256:digest(readFileSync(file))}));
function pins(values: Pin[]) { for (const pin of values) if (digest(readFileSync(pin.path)) !== pin.sha256) throw new Error(`Fuente modificada: ${pin.path}`); }
type Client = pg.Pool | pg.PoolClient;
async function people(client: Client): Promise<PersonCandidate[]> {
  return (await client.query<PersonCandidate>(`SELECT p.id::int,p.name,
    ARRAY(SELECT alias FROM ingest.person_aliases WHERE person_id=p.id) aliases,
    ARRAY(SELECT artist_id::int FROM public.artist_members WHERE person_id=p.id UNION
      SELECT a.artist_id::int FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id=p.id) projects
    FROM public.persons p`)).rows;
}
function mbPerson(source: Source, name: string): boolean {
  if (!source.personMbid) return false;
  const file = `data/raw/person-identities-2026-10-17/${source.personMbid}.json`;
  if (!existsSync(file)) return false;
  const pin=typedPins.find(item=>item.path===file);
  if (!pin || digest(readFileSync(file)) !== pin.sha256) throw new Error('Cambió la identidad tipada de MusicBrainz');
  const raw = JSON.parse(readFileSync(file,'utf8')) as { id: string; type: string; name: string; aliases?: Array<{name: string}> };
  return raw.id === source.personMbid && raw.type === 'Person'
    && [raw.name,...(raw.aliases ?? []).map(alias=>alias.name)].some(value => norm(value) === norm(name));
}
function authorizesNew(record: RecordPlan): boolean {
  if (!completePersonName(record.name)) return false;
  return record.sources.some(source => source.kind === 'musicbrainz' && mbPerson(source,record.name)
    || record.relation === 'membership' && (source.kind === 'rym_members'
      || source.kind === 'myspace' && creditTypeForRole(record.role) === 'musician'));
}
async function validateSource(client: Client, record: RecordPlan): Promise<void> {
  const artist = (await client.query<{name: string; biography: string | null}>('SELECT name,biography FROM public.artists WHERE id=$1',[record.artistId])).rows[0];
  if (!artist || norm(artist.name) !== norm(record.artist)) throw new Error('Cambió el artista del plan de personas');
  if (record.albumId && !(await client.query('SELECT 1 FROM public.albums WHERE id=$1 AND artist_id=$2',[record.albumId,record.artistId])).rowCount) throw new Error('Cambió el dueño del crédito');
  for (const source of record.sources) {
    pins(source.capturePins ?? []);
    if (source.kind.startsWith('rym')) {
      if (!source.artistHref) throw new Error('Fuente RYM sin identidad');
      await assertRymIdentity(client,ledger,source.artistHref,record.artistId);
    }
    if (source.kind === 'catalog_biography' && digest(artist.biography ?? '') !== source.snapshotHash) throw new Error('Cambió la biografía usada como evidencia');
    if (source.kind === 'musicbrainz') {
      if (!source.groupIdentityResolved || !source.anchors?.length) throw new Error('Grupo MB no acreditado');
      const anchors = await client.query(`SELECT person_id FROM public.artist_members WHERE artist_id=$1 AND person_id=ANY($2::bigint[])
        UNION SELECT c.person_id FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE a.artist_id=$1 AND c.person_id=ANY($2::bigint[])`,[record.artistId,source.anchors]);
      if (anchors.rowCount !== source.anchors.length) throw new Error('Cambió la evidencia del grupo MB');
    }
  }
}
type Decision = { action: 'unchanged' | 'apply' | 'review'; personId: number | null; reason?: string };
const creationRejections = new Map<string,string>();
const publicationHolds = new Set<number>();
async function decide(client: Client, job: Job, livePeople: PersonCandidate[]): Promise<Decision> {
  const personId = resolveSourcePerson(job.name,job.artistId,livePeople);
  if(job.albumId && publicationHolds.has(job.albumId))return {action:'review',personId,reason:'publication_identity_pending'};
  if (job.name.length > 200) return {action:'review',personId,reason:'name_exceeds_catalog_field_preserved_in_review'};
  if (job.role.length > 200) return {action:'review',personId,reason:'role_exceeds_catalog_field_preserved_in_review'};
  if (job.relation==='membership' && /\b\d{4}\b/u.test(job.role)) return {action:'review',personId,reason:'unparsed_membership_period_or_publication_title'};
  if (job.reason === 'credited_group_is_not_a_person' || norm(job.name).split(' ').length < 2) return {action:'review',personId,reason:job.reason};
  if (job.status === 'resolved' && personId !== job.personId) return {action:'review',personId,reason:'live_identity_changed'};
  if (job.relation === 'membership' && !sourcePeriod(job.sources)) return {action:'review',personId,reason:'membership_periods_require_review'};
  if (!personId) {
    const exact = exactSourcePeople(job.name,livePeople).length > 0;
    if (exact || job.status === 'needs_review') return {action:'review',personId:null,reason:'identity_ambiguous'};
    if (!authorizesNew(job)) return {action:'review',personId:null,reason:'new_person_type_or_full_name_unproven'};
    const rejection=creationRejections.get(norm(job.name));
    if (rejection) return {action:'review',personId:null,reason:rejection};
    return {action:'apply',personId:null};
  }
  if (job.relation === 'membership') {
    const period = sourcePeriod(job.sources)!;
    const rows = (await client.query<{role: string; from_year: number | null; to_year: number | null; is_current: boolean}>(
      'SELECT role,from_year,to_year,is_current FROM public.artist_members WHERE artist_id=$1 AND person_id=$2 ORDER BY id',[job.artistId,personId])).rows;
    const compatible=rows.filter(row=>compatiblePeriods(row,period));
    const stage=compatible.find(row=>sameRole(row.role,job.role)) ?? compatible[0];
    const conflict=stage ? membershipPeriodConflict(stage,period) : null;
    if (conflict) return {action:'review',personId,reason:conflict};
    if (rows.some(row=>compatiblePeriods(row,period) && sameRole(combineRoles([row.role,job.role]),row.role)
      && (period.from_year === null || row.from_year === period.from_year) && (period.to_year === null || row.to_year === period.to_year)
      && (!period.is_current || row.is_current))) return {action:'unchanged',personId};
  } else {
    const rows = await client.query<{role: string}>('SELECT role FROM public.album_credits WHERE album_id=$1 AND person_id=$2 AND credit_type=$3',[job.albumId,personId,creditTypeForRole(job.role)]);
    // A prior scoped/grouped credit must not become duplicate rows per role.
    if (rows.rows.some(row=>sameRole(combineRoles([row.role,job.role]),row.role))) return {action:'unchanged',personId};
    if (rows.rowCount) return {action:'review',personId,reason:'existing_credit_role_differs_preserve_both_for_review'};
  }
  return {action:'apply',personId};
}
async function review(context: OperatorContext, job: Job, reason: string) {
  await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,album_id,payload,notes)
    SELECT 'manual_review','open',3,$1,$2,$3::jsonb,$4 WHERE NOT EXISTS
    (SELECT 1 FROM ingest.review_queue WHERE artist_a_id=$1 AND payload->>'operation'='person_source_resolution' AND payload->>'fingerprint'=$5)`,
  [job.artistId,job.albumId,JSON.stringify({operation:'person_source_resolution',...job,reason}),reason,job.fingerprint]);
}
async function evidence(context: OperatorContext, job: Job, afterClaim: number) {
  for (const source of job.sources) {
    const url = source.url ?? `crv:artist:${job.artistId}:biography`;
    await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
      SELECT id,$3,$4,0,$5 FROM ingest.claims WHERE run_id=$1 AND id>$2 ON CONFLICT DO NOTHING`,
    [context.runId,afterClaim,url,source.excerpt,digest(JSON.stringify(source))]);
    if (source.kind==='musicbrainz' && source.personMbid) {
      const pin=typedPins.find(item=>item.path.endsWith(`/${source.personMbid}.json`));
      if (pin) await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
        SELECT id,$3,$4,1,$5 FROM ingest.claims WHERE run_id=$1 AND id>$2 ON CONFLICT DO NOTHING`,
      [context.runId,afterClaim,`https://musicbrainz.org/artist/${source.personMbid}`,`Identidad tipada conservada en ${pin.path}`,pin.sha256]);
    }
  }
}
async function main() {
  pins([...plan.sourcePins,...typedPins]);
  for(const row of (await getPool().query<{album_id:number}>("SELECT album_id::int FROM ingest.review_queue WHERE payload->>'operation'='rym_publication_identity_hold' AND status IN ('open','in_progress')")).rows)publicationHolds.add(row.album_id);
  const grouped = new Map<string,RecordPlan>();
  const records: RecordPlan[] = [];
  for (const record of plan.records) {
    if (record.relation !== 'album_credit') { records.push(record); continue; }
    const key = `${record.artistId}|${norm(record.name)}|${record.albumId}|${creditTypeForRole(record.role)}`;
    const previous = grouped.get(key);
    if (previous) { previous.role += `; ${record.role}`; previous.sources.push(...record.sources); }
    else grouped.set(key,{...record,sources:[...record.sources]});
  }
  records.push(...grouped.values());
  const jobs: Job[] = records.map(record=>({...record,fingerprint:digest(JSON.stringify({name:norm(record.name),artistId:record.artistId,relation:record.relation,albumId:record.albumId,role:record.role,sources:record.sources}))}));
  // Establish membership identities before using them for album credits.
  jobs.sort((a,b)=>Number(a.relation==='album_credit')-Number(b.relation==='album_credit'));
  const reviewed = new Set((await getPool().query<{fingerprint: string}>("SELECT payload->>'fingerprint' fingerprint FROM ingest.review_queue WHERE payload->>'operation'='person_source_resolution'")).rows.map(row=>row.fingerprint));
  const live = await people(getPool());
  const pending: Job[] = []; let unchanged = 0, alreadyReviewed = 0;
  for (const job of jobs) {
    if (reviewed.has(job.fingerprint)) { alreadyReviewed++; continue; }
    if ((await decide(getPool(),job,live)).action === 'unchanged') unchanged++; else pending.push(job);
  }
  const previous=confirm && existsSync(`${root}/personas-aplicado.json`) ? JSON.parse(readFileSync(`${root}/personas-aplicado.json`,'utf8')) as {outcomes:Array<Record<string,unknown>>;runs:number[]} : null;
  const outcomes: Array<Record<string, unknown>> = previous?.outcomes ?? [], runs: number[] = previous?.runs ?? [];
  for (let offset=0;offset<pending.length;offset+=50) {
    const batch = pending.slice(offset,offset+50);
    const applied = await withOperatorRun({name:'catalogo:personas-fuentes-conjuntas',operator:'Codex (encargo de Brian: puntos 1–5)',
      note:'Resolver personas por nombre/alias y proyecto documentado; altas tipadas, sin forzar candidatos similares. Períodos ambiguos conservados para revisión.',
      params:{offset,size:batch.length,planHash:digest(JSON.stringify(batch)),sourcePins:[...plan.sourcePins,...typedPins]}},async context=>{
      await context.client.query("SET LOCAL lock_timeout='5s'");
      await context.client.query("SET LOCAL statement_timeout='30s'");
      const current = await people(context.client), results: Array<Record<string,unknown>> = [];
      for (const job of batch) {
        await validateSource(context.client,job);
        const decision = await decide(context.client,job,current);
        if (decision.action === 'unchanged') { results.push({fingerprint:job.fingerprint,status:'unchanged',personId:decision.personId}); continue; }
        if (decision.action === 'review') { await review(context,job,decision.reason!); results.push({fingerprint:job.fingerprint,status:'needs_review',reason:decision.reason}); continue; }
        const lastClaim = Number((await context.client.query<{id:string}>('SELECT COALESCE(max(id),0)::text id FROM ingest.claims WHERE run_id=$1',[context.runId])).rows[0]!.id);
        await context.client.query('SAVEPOINT person_source');
        let personId = decision.personId, createdPerson = false;
        try {
          if (!personId) {
            const person = await createEntity(context,'person',{name:job.name,notes:`Identidad documentada como integrante de ${job.artist}. Fuentes: ${job.sources.map(source=>source.url ?? source.kind).join('; ')}`});
            personId = person.id; createdPerson = true;
          }
          const period = sourcePeriod(job.sources);
          const relation = job.relation === 'membership'
            ? await createRelation(context,'artist_membership',{artistId:job.artistId,personId},{role:job.role,...period,notes:job.sources.map(source=>source.excerpt).join('\n')})
            : await createRelation(context,'album_credit',{albumId:job.albumId!,personId},{credit_role:job.role,credit_type:creditTypeForRole(job.role),notes:job.sources.map(source=>source.excerpt).join('\n')});
          await evidence(context,job,lastClaim);
          if (createdPerson) current.push({id:personId,name:job.name,aliases:[],projects:[job.artistId]});
          else { const person=current.find(item=>item.id===personId); if (person && !person.projects.includes(job.artistId)) person.projects.push(job.artistId); }
          results.push({fingerprint:job.fingerprint,status:'applied',personId,createdPerson,relation:job.relation,relationId:relation.id,createdRelation:relation.created});
        } catch (error) {
          if (!(error instanceof OperatorError) || !['needs_review','already_exists','invalid'].includes(error.code)) throw error;
          await context.client.query('ROLLBACK TO SAVEPOINT person_source');
          if (!personId) creationRejections.set(norm(job.name),`${error.code}: ${error.message}`);
          await review(context,job,`${error.code}: ${error.message}`);
          results.push({fingerprint:job.fingerprint,status:'needs_review',reason:error.message});
        }
        await context.client.query('RELEASE SAVEPOINT person_source');
      }
      return results;
    },{rollbackOnly:!confirm});
    if(confirm) {
      runs.push(applied.runId);
      writeFileSync(`${root}/personas-run${applied.runId}.json`,JSON.stringify({runId:applied.runId,outcomes:applied.result,planHash:digest(JSON.stringify(batch))},null,2)+'\n');
    }
    outcomes.push(...applied.result);
    writeFileSync(`${root}/personas-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify({dryRun:!confirm,runs,unchanged,alreadyReviewed,planned:pending.length,pending:pending.length-offset-batch.length,outcomes},null,2)+'\n');
    console.log(`Lote ${offset+1}–${offset+batch.length}: ${applied.result.filter(item=>item['status']==='applied').length} vínculos ${confirm?'aplicados':'ensayados y revertidos'}`);
  }
  if(!pending.length) writeFileSync(`${root}/personas-repeticion.json`,JSON.stringify({pending:0,unchanged,alreadyReviewed},null,2)+'\n');
  console.log(JSON.stringify({planned:pending.length,pending:0,unchanged,alreadyReviewed,runs}));
}
main().catch((error: unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
