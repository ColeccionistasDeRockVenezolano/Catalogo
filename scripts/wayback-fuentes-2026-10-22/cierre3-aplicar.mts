import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun, updateEntity} from '../../src/merge/operator.js';

const out=process.env['WAYBACK_OUT'];
if(!out)throw Error('WAYBACK_OUT obligatorio');
const planText=readFileSync(out+'/biografias-aprobadas.json','utf8');
const plan=JSON.parse(planText), campaign='wayback-finalizacion-3-2026-10-25';
const sha256=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const planHash=sha256(planText), receipt=out+'/aplicado.json';
const results:any[]=existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):[];
try {
  for(const r of plan){
    if(results.some(x=>x.artistId===r.artistId))continue;
    if(sha256(readFileSync(r.source.path))!==r.source.sha256)throw Error('Cambió el original '+r.documentId);
    const run=await withOperatorRun({name:'wayback-cierre3:bio:'+r.artistId,
      operator:'codex (encargo de Brian)', note:r.reason, params:{campaign,planSha256:planHash}},async ctx=>{
      await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
      const a=(await ctx.client.query('SELECT biography,notes FROM public.artists WHERE id=$1 FOR UPDATE',[r.artistId])).rows[0];
      const d=(await ctx.client.query('SELECT * FROM media.artist_documents WHERE id=$1 FOR UPDATE',[r.documentId])).rows[0];
      if(!a||a.biography!==r.previous||!d||Number(d.artist_id)!==r.artistId||d.metadata.editorialHidden)
        throw Error('Cambió la ficha o el documento '+r.artistId);
      await updateEntity(ctx,'artist',r.artistId,{biography:r.newBiography,
        notes:[a.notes,'Revisión histórica de biografía: '+r.source.archiveUrl].filter(Boolean).join('\n\n')});
      const revision={campaign,runId:ctx.runId,planSha256:planHash,sourceSha256:r.source.sha256,
        reason:r.reason,paragraph:r.paragraph,replacements:r.replacements,
        anchors:r.anchors,externalEvidence:r.externalEvidence};
      await ctx.client.query('UPDATE media.artist_documents SET tags=$2,metadata=$3::jsonb,updated_at=now() WHERE id=$1',
        [d.id,[...new Set([...d.tags,'hechos-integrados-biografia-cierre3'])],
          JSON.stringify({...d.metadata,biographyRevisions:[...(d.metadata.biographyRevisions??[]),revision]})]);
      return {artistId:r.artistId,documentId:r.documentId,previousSha256:sha256(r.previous),newSha256:sha256(r.newBiography)};
    });
    results.push({artistId:r.artistId,...run});
    writeFileSync(receipt,JSON.stringify(results,null,2));
    console.log(JSON.stringify({artistId:r.artistId,...run}));
  }
} finally {await closeDb();}
