import { readFileSync, writeFileSync } from 'node:fs';
import { closeDb, getPool } from '../src/db/client.js';
import { deleteRelation, updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { rymPublicationConflict } from '../src/verification/rym-publication-identity.js';
import { assertRymIdentity, readRymIdentityLedger } from '../src/verification/rym-identity.js';

const root='reports/aprovechamiento-1-5-2026-10-17';
const confirm=process.argv.includes('--confirm');
type Row=Record<string,unknown>;
interface Journal {table_name:string;op:string;row_pk:{id:number};old_data:Row|null;new_data:Row|null}
interface Cross {slug:string;albumId:number;artistId:number;artistHref:string;sourceHref:string;capturePins:Array<{path:string;sha256:string}>}
interface HoldPlan {albumId:number;artistId:number;title:unknown;catalogType:unknown;sources:Cross[];fields:Row;credits:Row[];links:Row[]}
const metadata=['release_year','release_date_text','catalog_id','media_format'];
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function main(){
  const runIds=JSON.parse(readFileSync(`${root}/own-runs.json`,'utf8')) as number[];
  const ledger=readRymIdentityLedger(`${root}/rym-resto/identity-ledger.json`);
  const rich=new Map(readFileSync(`${root}/rym-v4-resto/albumes.jsonl`,'utf8').trim().split('\n').map(line=>{const row=JSON.parse(line) as {slug:string;tipo:string;tipo_desc:string};return[row.slug,row] as const;}));
  const cross=readFileSync(`${root}/rym-resto-segunda-pasada/cruce.jsonl`,'utf8').trim().split('\n').map(line=>JSON.parse(line) as Cross);
  const albums=new Map((await getPool().query<{id:number;data:Row;classifications:string[]}>(`SELECT id::int,row_to_json(a) data,ARRAY(SELECT classification FROM ingest.effective_album_classifications c WHERE c.album_id=a.id) classifications FROM public.albums a`)).rows.map(row=>[row.id,row]));
  const conflicts=new Map<number,Cross[]>();
  for(const row of cross){
    const album=albums.get(row.albumId)!,source=rich.get(row.slug)!;
    if(rymPublicationConflict(source.tipo || source.tipo_desc,String(album.data['album_type']),album.classifications))conflicts.set(row.albumId,[...(conflicts.get(row.albumId) ?? []),row]);
  }
  const ids=[...conflicts.keys()];
  const reviews=new Set((await getPool().query<{album_id:number}>("SELECT album_id::int FROM ingest.review_queue WHERE payload->>'operation'='rym_publication_identity_hold'")).rows.map(row=>row.album_id));
  const journals=(await getPool().query<Journal>(`SELECT table_name,op,row_pk,old_data,new_data FROM ingest.change_journal
    WHERE run_id=ANY($1::bigint[]) AND ((table_name='public.albums' AND (row_pk->>'id')::bigint=ANY($2::bigint[]))
      OR (table_name IN ('public.album_credits','public.streaming_links') AND (new_data->>'album_id')::bigint=ANY($2::bigint[]))) ORDER BY id`,[runIds,ids])).rows;
  const protectedIds=new Set((JSON.parse(readFileSync(`${root}/streaming-protegidos-antes.json`,'utf8')) as Array<{kind:string;id:number}>).filter(row=>row.kind==='streaming').map(row=>row.id));
  const plan:HoldPlan[]=[];
  for(const [albumId,sources] of conflicts){
    const album=albums.get(albumId)!;
    const before:Row={},after:Row={};
    for(const journal of journals.filter(row=>row.table_name==='public.albums' && row.row_pk.id===albumId))for(const field of metadata){
      if(journal.old_data && Object.hasOwn(journal.old_data,field)){
        if(!Object.hasOwn(before,field))before[field]=journal.old_data[field];
        after[field]=journal.new_data?.[field];
      }
    }
    const fields:Row={};
    for(const field of Object.keys(before))if(!same(album.data[field],before[field])){
      if(!same(album.data[field],after[field]))throw new Error('Un campo fue editado después del lote; no se sobreescribe');
      fields[field]=before[field];
    }
    const credits:Row[]=[],links:Row[]=[];
    for(const journal of journals.filter(row=>row.op==='I' && Number(row.new_data?.['album_id'])===albumId && row.table_name!=='public.albums')){
      if(!journal.new_data)continue;
      const table=journal.table_name==='public.album_credits'?'public.album_credits':'public.streaming_links';
      const live=(await getPool().query<{data:Row}>(`SELECT row_to_json(t) data FROM ${table} t WHERE id=$1`,[journal.row_pk.id])).rows[0]?.data;
      if(!live)continue;
      const keys=table==='public.album_credits'?['album_id','person_id','artist_id','organization_id','credit_type','role','notes']:['album_id','url','external_id','source','verified','notes'];
      if(!keys.every(field=>same(live[field],journal.new_data?.[field])))throw new Error('Una relación fue editada después del lote; no se retira');
      if(table==='public.streaming_links' && protectedIds.has(journal.row_pk.id))throw new Error('Enlace protegido; no se retira');
      (table==='public.album_credits'?credits:links).push(live);
    }
    if(!reviews.has(albumId)||Object.keys(fields).length||credits.length||links.length)plan.push({albumId,artistId:Number(album.data['artist_id']),title:album.data['title'],catalogType:album.data['album_type'],sources,fields,credits,links});
  }
  writeFileSync(`${root}/publicaciones-conflictivas-plan.json`,JSON.stringify(plan,null,2)+'\n');
  if(!plan.length){console.log('0 publicaciones conflictivas pendientes de aislar');return;}
  const result=await withOperatorRun({name:'catalogo:rym-publicaciones-en-revision',operator:'Codex (encargo de Brian: puntos 1–5)',
    note:'Retirar solo incorporaciones de esta campaña en fichas cuya publicación/edición sigue sin acreditarse. Conservar fichas, datos originales, fuentes y enlaces protegidos.',params:{plan}},async context=>{
    for(const item of plan){
      for(const source of item.sources)await assertRymIdentity(context.client,ledger,source.artistHref,item.artistId);
      await context.client.query('SELECT 1 FROM public.albums WHERE id=$1 FOR UPDATE',[item.albumId]);
      for(const credit of item.credits)await deleteRelation(context,'album_credit',Number(credit['id']));
      for(const link of item.links)await context.client.query('DELETE FROM public.streaming_links WHERE id=$1 AND url=$2 AND source=$3',[link['id'],link['url'],link['source']]);
      if(Object.keys(item.fields).length)await updateEntity(context,'album',item.albumId,item.fields);
      await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,album_id,payload,notes)
        SELECT 'manual_review','open',2,$1,$2,$3::jsonb,'Acreditar publicación/edición antes de usar los datos RYM; conservadas las propuestas y retirados únicamente cambios de este lote'
        WHERE NOT EXISTS(SELECT 1 FROM ingest.review_queue WHERE album_id=$2 AND payload->>'operation'='rym_publication_identity_hold')`,[item.artistId,item.albumId,JSON.stringify({operation:'rym_publication_identity_hold',...item})]);
    }
    return {albums:plan.length,creditsWithdrawn:plan.reduce((n,item)=>n+item.credits.length,0),linksWithdrawn:plan.reduce((n,item)=>n+item.links.length,0),metadataFieldsRestored:plan.reduce((n,item)=>n+Object.keys(item.fields).length,0)};
  },{rollbackOnly:!confirm});
  writeFileSync(`${root}/publicaciones-conflictivas-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify({runId:confirm?result.runId:null,dryRun:!confirm,...result.result},null,2)+'\n');
  console.log(JSON.stringify(result.result));
}
main().catch((error:unknown)=>{console.error(error);process.exitCode=1;}).finally(()=>closeDb());
