import {writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {closeDb,getPool} from '../src/db/client.js';
import {loadResolutionCandidates} from '../src/er/repository.js';
import {createEntity,withOperatorRun} from '../src/merge/operator.js';
import {writeAlbumClassifications} from '../src/catalog/album-classifications.js';
const index=process.argv.indexOf('--dir'),directory=index>=0?process.argv[index+1]:undefined;
if(!directory)throw new Error('--dir obligatorio');
async function main(){
 const client=await getPool().connect();
 const quality:Record<string,unknown>={};
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const start=performance.now();
  const old=(await client.query<{id:string;albums:string[];persons:string[]}>(`SELECT o.id::text,
   ARRAY(SELECT DISTINCT al.title FROM public.albums al WHERE al.label_id=o.id UNION SELECT DISTINCT al2.title FROM public.album_credits ac JOIN public.albums al2 ON al2.id=ac.album_id WHERE ac.organization_id=o.id) albums,
   ARRAY(SELECT DISTINCT p.name FROM public.person_organizations po JOIN public.persons p ON p.id=po.person_id WHERE po.organization_id=o.id) persons
   FROM public.organizations o ORDER BY o.id`)).rows;
  const oldMs=performance.now()-start,nextStart=performance.now();
  const next=await loadResolutionCandidates({kind:'ORGANIZATION',name:'Quality check'},client);
  const newMs=performance.now()-nextStart;
  assert.equal(old.length,next.length);
  for(const [i,row] of old.entries()){
   const candidate=next[i]!;if(candidate.kind!=='ORGANIZATION')throw new Error('Wrong candidate kind');assert.equal(Number(row.id),candidate.id);
   assert.deepEqual([...row.albums].sort(),[...(candidate.associatedAlbums??[])].sort());
   assert.deepEqual([...row.persons].sort(),[...(candidate.associatedPersons??[])].sort());
  }
  quality['organizationCandidates']={identical:true,organizations:old.length,oldMs,newMs};
  await client.query('ROLLBACK');
 }finally{client.release();}
 const tested=await withOperatorRun({name:'catalogo:rym-integral-ensayo-categorias',operator:'Codex',note:'Ensayo reversible: enriquecer categorías no rechaza las ausentes.'},async ctx=>{
  const artist=(await ctx.client.query<{id:number}>('SELECT id::int FROM ingest.catalog_artists ORDER BY id LIMIT 1')).rows[0]!;
  const album=await createEntity(ctx,'album',{title:'__Ensayo RYM categorías aditivas 2026-10-21',album_type:'single'},{artistId:artist.id,allowSimilar:true});
  await writeAlbumClassifications(ctx,album.id,['Single','Remix'],{addOnly:true});
  const rows=(await ctx.client.query<{classification:string;selected:boolean}>('SELECT classification,selected FROM ingest.album_classification_decisions WHERE album_id=$1',[album.id])).rows;
  assert.deepEqual(rows.map(r=>r.classification).sort(),['Remix','Single']);assert.ok(rows.every(r=>r.selected));
  return {positive:rows.length,negative:rows.filter(r=>!r.selected).length};
 },{rollbackOnly:true});
 quality['additiveClassifications']=tested.result;
 if(process.argv.includes('--repair-negatives')){
  const repair=await withOperatorRun({name:'catalogo:rym-integral-categorias-aditivas',operator:'Codex',note:'Retirar únicamente rechazos implícitos creados por el primer lote RYM: ausencia de categoría no significa rechazo editorial.',params:{campaign:'rym-integral-2026-10-21',phase:'repair_implicit_rejections'}},async ctx=>{
   const result=await ctx.client.query(`DELETE FROM ingest.album_classification_decisions d USING ingest.scrape_runs current_run
    WHERE d.run_id=current_run.id AND current_run.params->>'campaign'='rym-integral-2026-10-21' AND NOT d.selected
    AND EXISTS(SELECT 1 FROM ingest.change_journal j JOIN ingest.scrape_runs r ON r.id=j.run_id
      WHERE r.params->>'campaign'='rym-integral-2026-10-21' AND j.table_name='ingest.album_classification_decisions' AND j.op='I'
      AND j.new_data->>'selected'='false' AND j.row_pk=jsonb_build_object('id',d.id))
    RETURNING d.album_id,d.classification`);
   return {removed:result.rowCount,rows:result.rows};
  });
  quality['implicitRejectionsRemoved']=repair.result.removed;quality['repairRun']=repair.runId;
  writeFileSync(path.join(directory!,`run-${repair.runId}-repair.json`),JSON.stringify(repair,null,2)+'\n');
 }
 writeFileSync(path.join(directory!,'verificacion-reglas.json'),JSON.stringify(quality,null,2)+'\n');
 console.log(JSON.stringify(quality));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
