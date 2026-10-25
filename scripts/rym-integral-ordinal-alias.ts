import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {withOperatorRun} from '../src/merge/operator.js';
import {createAlias} from '../src/api/repositories/aliases.js';
import {assertRymIdentity,readRymIdentityLedger,verifyRymPin,normalizeRymIdentity as norm} from '../src/verification/rym-identity.js';
import {rymTrackPositions,type RymTrackInput} from '../src/verification/rym-release-plan.js';

const directory=(()=>{
 const value=process.argv[process.argv.indexOf('--dir')+1];
 if(!process.argv.includes('--dir')||!value)throw new Error('--dir obligatorio');
 return value;
})();
const confirm=process.argv.includes('--confirm');
const ordinal=(s:string)=>norm(s.replace(/\bn[º°]\s*(?=\d)/giu,'no '));
async function main(){
 const releases=readFileSync(path.join(directory,'corpus/albumes.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as {slug:string;titulo:string;tipo:string;anio:number;pistas:RymTrackInput[];url:string;capturePins:Array<{path:string;sha256:string}>});
 const source=releases.find(r=>r.slug==='rel_album_los-melodicos_recuerdos-no-20');
 if(!source||source.titulo!=='Recuerdos no. 20'||source.anio!==1972||source.tipo!=='Album')throw new Error('Fuente inesperada');
 const proof=['cruce-sobrantes.jsonl','cruce.jsonl'].flatMap(file=>readFileSync(path.join(directory,file),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as {slug:string;artistId:number;artistHref:string})).find(r=>r.slug===source.slug);
 const ledger=readRymIdentityLedger(path.join(directory,'identity-ledger.json'));
 if(!proof||proof.artistId!==3794)throw new Error('Artista sin acreditar');
 const result=await withOperatorRun({name:'catalogo:rym-integral-ordinal-alias',operator:'Codex (encargo de Brian: agotar RYM)',note:`Variante ortográfica Nº/no. de Recuerdos Nº 20; mismo artista, 1972 y once posiciones/títulos contrastados. ${source.url}`,params:{campaign:'rym-integral-2026-10-21',phase:'ordinal_alias',sourcePins:source.capturePins}},async ctx=>{
  await assertRymIdentity(ctx.client,ledger,proof.artistHref,3794);for(const pin of source.capturePins)verifyRymPin(pin);
  if(!(await ctx.client.query('SELECT 1 FROM ingest.catalog_albums WHERE id=8305')).rowCount)throw new Error('Disco fuera del catálogo');
  const album=(await ctx.client.query<{artist_id:number;title:string;release_year:number;album_type:string}>('SELECT artist_id::int,title,release_year,album_type FROM public.albums WHERE id=8305 FOR UPDATE')).rows[0];
  if(!album||album.artist_id!==3794||album.release_year!==1972||!['album','other'].includes(album.album_type)||ordinal(album.title)!==ordinal(source.titulo))throw new Error('El disco no acredita esta variante');
  const others=(await ctx.client.query<{title:string;aliases:string[]}>('SELECT title,ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases FROM public.albums a WHERE artist_id=3794 AND id<>8305')).rows;
  if(others.some(a=>[a.title,...a.aliases].some(t=>ordinal(t)===ordinal(source.titulo))))throw new Error('Variante ambigua entre discos');
  const tracks=(await ctx.client.query<{id:number;title:string;disc_number:number;track_number:number}>('SELECT id::int,title,disc_number,track_number FROM public.tracks WHERE album_id=8305 ORDER BY disc_number,track_number,id FOR UPDATE')).rows;
  const stated=rymTrackPositions(source.pistas);
  if(!stated||tracks.length!==11||stated.length!==11||tracks.some((t,i)=>t.disc_number!==stated[i]!.disc_number||t.track_number!==stated[i]!.track_number||ordinal(t.title)!==ordinal(stated[i]!.title)))throw new Error('El repertorio no coincide');
  const aliases=(await ctx.client.query<{alias:string}>('SELECT alias FROM ingest.album_aliases WHERE album_id=8305')).rows;
  const changed:Array<Record<string,unknown>>=[];
  if(!aliases.some(a=>norm(a.alias)===norm(source.titulo))){await createAlias(ctx,'album',8305,{alias:source.titulo,aliasType:'alternate_title',isPrimary:false});changed.push({albumId:8305,alias:source.titulo});}
  for(const [i,track] of tracks.entries())if(norm(track.title)!==norm(stated[i]!.title)){
   const existing=(await ctx.client.query<{alias:string}>('SELECT alias FROM ingest.track_aliases WHERE track_id=$1',[track.id])).rows;
   if(!existing.some(a=>norm(a.alias)===norm(stated[i]!.title))){await createAlias(ctx,'track',track.id,{alias:stated[i]!.title,aliasType:'alternate_title',isPrimary:false});changed.push({trackId:track.id,alias:stated[i]!.title});}
  }
  return changed;
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory,`ordinal-alias-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
