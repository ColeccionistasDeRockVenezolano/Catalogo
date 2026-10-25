import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {deleteAlias} from '../src/api/repositories/aliases.js';
import {deleteEntity,updateEntity,withOperatorRun} from '../src/merge/operator.js';

const directory=(()=>{const i=process.argv.indexOf('--dir'),v=process.argv[i+1];if(i<0||!v)throw new Error('--dir obligatorio');return v;})();
const confirm=process.argv.includes('--confirm');
const aliases=[{id:10326,artistId:795,name:'Gorepriest'},{id:10307,artistId:3121,name:'VF'},{id:10309,artistId:3133,name:'VF'}];
async function main(){
 const verification=JSON.parse(readFileSync(path.join(directory,'verificacion-final.json'),'utf8')) as {createdIds:Record<string,number[]>};
 const baseline=JSON.parse(readFileSync(path.join(directory,'catalogo-inicial.json'),'utf8')) as {albums:Array<{id:number;label_id:number|null}>;organizations:Array<{id:number}>};
 if(baseline.albums.find(a=>a.id===25941)?.label_id!==null||baseline.organizations.some(o=>o.id===4559))throw new Error('La corrección no corresponde a un alta propia');
 const result=await withOperatorRun({name:'catalogo:rym-integral-resolver-alias-ambiguos',operator:'Codex (encargo de Brian: evitar duplicados)',note:'Retirar únicamente tres alias añadidos por esta campaña que confunden proyectos distintos. Retirar el alta propia del sello León sin equipararla por nombre a Discos León; conservar el sello literal y la fuente en Festival Llanero.',params:{campaign:'rym-integral-2026-10-21',phase:'alias_conflicts',aliases,organizationId:4559,albumId:25941}},async ctx=>{
  const removed=[];
  for(const alias of aliases){
   if(!verification.createdIds['ingest.artist_aliases']?.includes(alias.id))throw new Error('Alias ajeno a la campaña');
   const row=(await ctx.client.query<{id:number;artist_id:number;alias:string}>('SELECT id::int,artist_id::int,alias FROM ingest.artist_aliases WHERE id=$1 FOR UPDATE',[alias.id])).rows[0];
   if(!row)continue;
   if(row.artist_id!==alias.artistId||row.alias!==alias.name)throw new Error('El alias cambió');
   await deleteAlias(ctx,'artist',alias.artistId,alias.id);removed.push(row);
  }
  const organization=(await ctx.client.query<{id:number;name:string;notes:string}>('SELECT id::int,name,notes FROM public.organizations WHERE id=4559 FOR UPDATE')).rows[0];
  if(!organization)return {removed,organizationAlreadyRetired:true};
  if(!verification.createdIds['public.organizations']?.includes(4559)||organization.name!=='León'||!organization.notes.includes('/jose-romero-bello-hermanos-chirinos/festival-llanero'))throw new Error('Organización ajena o modificada');
  const album=(await ctx.client.query<{label_id:number;notes:string|null}>('SELECT label_id::int,notes FROM public.albums WHERE id=25941 FOR UPDATE')).rows[0];
  if(!album||album.label_id!==4559)throw new Error('El sello del disco cambió');
  const literal='Sello declarado para esta edición: León. Fuente: https://rateyourmusic.com/release/album/jose-romero-bello-hermanos-chirinos/festival-llanero';
  const notes=album.notes?.includes(literal)?album.notes:[album.notes,literal].filter(Boolean).join('\n\n');
  await updateEntity(ctx,'album',25941,{label_id:null,notes});
  const removal=await deleteEntity(ctx,'organization',4559);
  return {removed,albumId:25941,preservedLabelText:literal,removal};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory,`conflictos-alias-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({runId:result.runId,removedAliases:result.result.removed.map(r=>r.id)}));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
