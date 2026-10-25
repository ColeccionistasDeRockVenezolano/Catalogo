import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb,getPool} from '../src/db/client.js';
import {createAlias} from '../src/api/repositories/aliases.js';
import {withOperatorRun} from '../src/merge/operator.js';
import {assertRymIdentity,readRymIdentityLedger,normalizeRymIdentity as norm,verifyRymPin} from '../src/verification/rym-identity.js';
import {rymPublicationConflict,rymVideoOnlyMedium,rymCatalogKey as key,rymFormatKey as format} from '../src/verification/rym-publication-identity.js';

const index=process.argv.indexOf('--dir'),directory=index>=0?process.argv[index+1]:undefined;if(!directory)throw new Error('--dir obligatorio');
const confirm=process.argv.includes('--confirm');
const jsonl=<T>(name:string):T[]=>readFileSync(path.join(directory!,name),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
interface Source{slug:string;titulo:string;url:string;tipo:string|null;anio:number|null;formato:string|null;catalog_no:string|null;labels:Array<{nombre:string}>;musicalEditionVerified?:boolean}
interface Proposal{slug:string;artistId:number;artistHref:string;capturePins:Array<{path:string;sha256:string}>}
interface Album{id:number;artist_id:number;title:string;catalog_id:string|null;media_format:string|null;release_year:number|null;album_type:string;aliases:string[];labels:string[];classifications:string[]}
async function main(){
 const ledger=readRymIdentityLedger(path.join(directory!,'identity-ledger.json'));
 const sources=new Map(jsonl<Source>('corpus/albumes.jsonl').map(s=>[s.slug,s]));
 const albums=(await getPool().query<Album>(`SELECT a.id::int,a.artist_id::int,a.title,a.catalog_id,a.media_format,a.release_year,a.album_type,
  ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases,
  ARRAY(SELECT o.name FROM public.organizations o WHERE o.id=a.label_id UNION SELECT x.alias FROM ingest.organization_aliases x WHERE x.organization_id=a.label_id) labels,
  ARRAY(SELECT classification FROM ingest.effective_album_classifications WHERE album_id=a.id) classifications FROM ingest.catalog_albums a`)).rows;
 const byCatalog=new Map<string,Album[]>();for(const a of albums)if(a.catalog_id)byCatalog.set(`${a.artist_id}|${key(a.catalog_id)}`,[...(byCatalog.get(`${a.artist_id}|${key(a.catalog_id)}`)??[]),a]);
 const report={runs:[] as number[],outcomes:[] as Array<Record<string,unknown>>,held:[] as Array<Record<string,unknown>>};
 for(const proposal of jsonl<Proposal>('cruce-sobrantes.jsonl')){
  const source=sources.get(proposal.slug)!,code=key(source.catalog_no);
  if(!code||rymVideoOnlyMedium(source.formato))continue;
  const matches=byCatalog.get(`${proposal.artistId}|${code}`)??[];
  if(matches.length!==1)continue;
  const album=matches[0]!;
  if([album.title,...album.aliases].some(n=>norm(n)===norm(source.titulo)))continue;
  const strongCode=(code.match(/\p{L}/gu)?.length??0)>=2&&(code.match(/\p{N}/gu)?.length??0)>=2;
  const labelMatches=source.labels.some(s=>album.labels.some(l=>norm(l)===norm(s.nombre)));
  if(!strongCode&&!labelMatches||source.anio&&album.release_year&&source.anio!==album.release_year||source.formato&&album.media_format&&format(source.formato)!==format(album.media_format)
    ||rymPublicationConflict(source.tipo??'',album.album_type,album.classifications,!!source.musicalEditionVerified)){
   report.held.push({slug:source.slug,albumId:album.id,reason:'catalog_anchor_needs_more_edition_evidence'});continue;
  }
  const result=await withOperatorRun({name:'catalogo:rym-integral-catalog-alias',operator:'Codex (encargo de Brian: agotar RYM)',note:`Título alternativo documentado para el mismo artista y número de catálogo único ${source.catalog_no!}; año, soporte y tipo compatibles. ${source.url}`,
   params:{campaign:'rym-integral-2026-10-21',phase:'catalog_alias',albumId:album.id,sourcePins:proposal.capturePins,planHash:createHash('sha256').update(JSON.stringify({source,album})).digest('hex')}},async ctx=>{
   await assertRymIdentity(ctx.client,ledger,proposal.artistHref,proposal.artistId);for(const pin of proposal.capturePins)verifyRymPin(pin);
   const live=(await ctx.client.query<{artist_id:number;catalog_id:string|null;media_format:string|null;release_year:number|null}>('SELECT artist_id::int,catalog_id,media_format,release_year FROM public.albums WHERE id=$1 FOR UPDATE',[album.id])).rows[0];
   if(!live||live.artist_id!==proposal.artistId||key(live.catalog_id)!==code||live.media_format!==album.media_format||live.release_year!==album.release_year)throw new Error('El ancla de edición cambió');
   const current=(await ctx.client.query<{alias:string}>('SELECT alias FROM ingest.album_aliases WHERE album_id=$1',[album.id])).rows;
   if(current.some(a=>norm(a.alias)===norm(source.titulo)))return {albumId:album.id,changed:false};
   await createAlias(ctx,'album',album.id,{alias:source.titulo,aliasType:'alternate_title',isPrimary:false});
   return {albumId:album.id,changed:true,title:source.titulo,catalogNumber:source.catalog_no};
  },{rollbackOnly:!confirm});
  if(confirm){report.runs.push(result.runId);writeFileSync(path.join(directory!,`run-${result.runId}-catalog-alias.json`),JSON.stringify(result,null,2)+'\n');}
  report.outcomes.push(result.result);
 }
 writeFileSync(path.join(directory!,`catalog-aliases-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
