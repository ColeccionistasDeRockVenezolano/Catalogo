// Read-only audit. Includes existing review pairs instead of hiding them.
// Usage: PERSON_AUDIT_OUT=<SSD staging directory> ./scripts/with-node22.sh npx tsx scripts/audit-person-alias-projects.mts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { loadPersonFacts, scorePersonPair } from '../src/review/person-candidates.js';
import { nameWithoutNickname, nicknamesOf, personBlockingKeys, personVariantBlockingKeys } from '../src/review/person-names.js';
import { wordKey, parsePersonName, personRelation } from '../src/ambiguity/text.js';
const out = process.env['PERSON_AUDIT_OUT'];
if (!out) throw new Error('PERSON_AUDIT_OUT must point to SSD staging');
try {
 const db = await getPool().connect();
 try {
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const loaded = await loadPersonFacts(db);
 const biographyRows = (await db.query<{ id: string; biography: string | null }>("SELECT id::text,biography FROM public.persons")).rows;
 const biographies = new Map(biographyRows.map(row => [Number(row.id), row.biography]));
 const facts = loaded.map(person => ({ ...person, biography: biographies.get(person.id) ?? null }));
 const artists = new Map((await db.query('select id, name from artists')).rows.map(r=>[Number(r.id),r.name]));
 const reviews = (await db.query("select id,person_a_id a,person_b_id b,status,resolution_note from ingest.review_queue where kind::text in ('person_duplicate','person_match') and person_a_id is not null and person_b_id is not null")).rows;
 const key=(a:number,b:number)=>`${Math.min(a,b)}:${Math.max(a,b)}`;
 const reviewMap=new Map<string,typeof reviews>();
 for(const r of reviews){const k=key(Number(r.a),Number(r.b));reviewMap.set(k,[...(reviewMap.get(k)??[]),r]);}
 const distinctRows = (await db.query<{ a_id: string; b_id: string; note: string; decided_by: string }>("SELECT a_id::text,b_id::text,note,decided_by FROM ingest.curation_distinct_pairs WHERE kind='person'")).rows;
 const distinct = new Map(distinctRows.map(row => [key(Number(row.a_id), Number(row.b_id)), row]));
 const byId=new Map(facts.map(p=>[p.id,p]));
 const prepared=new Map(facts.map(p=>{const values=[p.name,...p.aliases];return [p.id,{values,keys:new Set(values.map(wordKey).filter(Boolean)),bases:new Set(values.map(nameWithoutNickname).filter(Boolean)),nicks:new Set(values.flatMap(nicknamesOf)),context:new Set(p.artistIds??[]),parsed:parsePersonName(p.name)}];}));
 const blocks=new Map<string,number[]>();
 for(const p of facts){const prep=prepared.get(p.id)!;const keys=new Set([...personBlockingKeys(p.name),...personVariantBlockingKeys(p.name,p.aliases),...prep.keys,...prep.bases,...prep.nicks,...[...prep.keys].flatMap(k=>k.split(' ').filter(t=>t.length>=4))]);for(const k of keys)blocks.set(k,[...(blocks.get(k)??[]),p.id]);}
 const seen=new Set<string>();const candidates=[];
 for(const ids of blocks.values()){if(ids.length>500)continue;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const k=key(ids[i]!,ids[j]!);if(seen.has(k))continue;seen.add(k);
  const a=byId.get(ids[i]!)!, b=byId.get(ids[j]!)!;
  const ap=prepared.get(a.id)!,bp=prepared.get(b.id)!;
  if(![...ap.context].some(id=>bp.context.has(id)))continue;
  const bv=bp.values;const ak=ap.keys,abase=ap.bases;
  const exactAliases = [...new Set(bv.filter(v => ak.has(wordKey(v))))];
  const sharedAlias = [...new Set(bv.filter(v => ak.has(wordKey(v)) || abase.has(nameWithoutNickname(v))))];
  const nicksA=ap.nicks,nicksB=bp.nicks;
  const nickShared=[...nicksA].filter(n=>nicksB.has(n)||[...bp.keys].some(v=>(' '+v+' ').includes(' '+n+' ')));
  for(const n of nicksB)if([...ap.keys].some(v=>(' '+v+' ').includes(' '+n+' '))&&!nickShared.includes(n))nickShared.push(n);
  if(!sharedAlias.length&&!nickShared.length&&ap.parsed.tokens[0]?.[0]!==bp.parsed.tokens[0]?.[0])continue;
  const relation=personRelation(ap.parsed,bp.parsed);
  if(!sharedAlias.length&&!nickShared.length&&(!relation||relation==='fuzzy'))continue;
  const scored=scorePersonPair(a,b);
  const sharedArtists=(a.artistIds??[]).filter(id=>b.artistIds?.includes(id)).map(id=>({id,name:artists.get(id)}));
  const sharedAlbums=a.albumIds.filter(id=>b.albumIds.includes(id));
  const prior=reviewMap.get(k)??[];
  candidates.push({a,b,exactAliases,declaredDistinct:distinct.has(k),distinctDecision:distinct.get(k)??null,sharedAlias,nickShared,relation,sharedArtists,sharedAlbums,score:scored.score,features:scored.features,blocked:scored.blocked??null,prior,
   tier:scored.blocked||distinct.has(k)||prior.some(r=>r.status==='dismissed')?'contradiction_or_prior_rejection':sharedAlias.length?'shared_name_form':nickShared.length?'nickname_bridge':'name_variant'});
 }
 }
 await db.query('COMMIT');
 candidates.sort((a,b)=>b.sharedAlias.length-a.sharedAlias.length||b.nickShared.length-a.nickShared.length||b.score-a.score);
 const report={at:new Date().toISOString(),readOnly:true,persons:facts.length,nameBlockedPairs:seen.size,candidates};
 writeFileSync(path.join(out,'audit.json'),JSON.stringify(report,null,2));
 writeFileSync(path.join(out,'facts.json'),JSON.stringify(facts,null,2));
 console.log(JSON.stringify({persons:facts.length,compared:seen.size,candidates:candidates.length}));
 for(const c of candidates)console.log(JSON.stringify({a:[c.a.id,c.a.name],b:[c.b.id,c.b.name],alias:c.sharedAlias,nick:c.nickShared,rel:c.relation,projects:c.sharedArtists.map(a=>a.name),albums:c.sharedAlbums.length,score:c.score,blocked:c.blocked,prior:c.prior.map(r=>[r.id,r.status])}));
 }finally{db.release();}
}finally{await closeDb();}
