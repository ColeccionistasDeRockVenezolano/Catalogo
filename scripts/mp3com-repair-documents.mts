/** Corrige conteos documentales, con preview, control de concurrencia y run reversible. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { discographyCounts, discographyTitle, renderDiscography, type Mp3Discography, type Mp3Song } from './lib/mp3com-discography.js';

const args=process.argv.slice(2),probe=args.includes('--probe'),apply=args.includes('--apply')||probe;
const out=process.env['CRV_RECOVERY_REPORT'];
if(!out)throw new Error('CRV_RECOVERY_REPORT debe apuntar al staging SSD');
const data=process.env['CRV_RECOVERY_DATA'];
if(!data)throw new Error('CRV_RECOVERY_DATA debe apuntar al plan revisado');
mkdirSync(out,{recursive:true});
const root=path.resolve('data/raw/mp3com-2003');
const jsonl=<T,>(file:string):T[]=>readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l) as T);
const raw=jsonl<Mp3Discography & {key:string}>(path.join(root,'discografia-venezolanos.jsonl'));
const songs=jsonl<Mp3Song>(path.join(root,'songs-venezolanos.jsonl'));
const rawMap=new Map(raw.map(d=>[d.key,d]));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface Doc {id:string;artist_id:string;source_key:string;title:string;content:string;metadata:Record<string,unknown>}
interface Website {id:string;url:string;verified:boolean;notes:string|null}
const pool=getPool();
try{
  const docs=(await pool.query<Doc>("SELECT id::text,artist_id::text,source_key,title,content,metadata FROM media.artist_documents WHERE source_key LIKE 'mp3com-2003:discografia:%' ORDER BY id")).rows;
  const plans=docs.map(before=>{
    const key=before.metadata['mp3comPage'];
    if(typeof key!=='string'||before.source_key!==`mp3com-2003:discografia:${key}`)throw new Error(`Documento sin identidad de fuente inequívoca: ${before.id}`);
    const d=rawMap.get(key);if(!d)throw new Error(`Falta crudo para ${before.id}`);
    const plays=typeof before.metadata['plays']==='number'?before.metadata['plays']:undefined;
    const after={title:discographyTitle(d),content:renderDiscography(d,songs,plays),metadata:{...before.metadata,...discographyCounts(d)}};
    return {id:before.id,artist_id:before.artist_id,before,after,version:hash(before)};
  }).filter(p=>p.before.title!==p.after.title||p.before.content!==p.after.content||JSON.stringify(p.before.metadata)!==JSON.stringify(p.after.metadata));
  const webs=(await pool.query<Website>("SELECT id::text,url,verified,notes FROM public.social_links WHERE source='mp3-com-2003-project' AND verified=true ORDER BY id")).rows;
  interface Identity {artist_id:string;identity_flags:string[];source_url:string;mp3com_page:string;source_name:string}
  const identities=jsonl<Identity>(path.join(data,'mp3com/identidades-publicadas-revision.jsonl'));
  const byArtist=new Map<string,Identity[]>();
  for(const row of identities.filter(r=>r.identity_flags.length))byArtist.set(row.artist_id,[...(byArtist.get(row.artist_id)??[]),row]);
  const cases:Array<{key:string;kind:string;a:string;b:string|null;payload:Record<string,unknown>}>=[];
  for(const [aid,rows]of byArtist)cases.push({key:`mp3com:identity:${aid}`,kind:'manual_review',a:aid,b:null,
    payload:{reason:'Contrastar identidad y procedencia antes de reutilizar el cruce MP3.com; una ubicación actual distinta no demuestra otro origen.',profiles:rows}});
  const collisions=JSON.parse(readFileSync(path.join(data,'mp3com/nombres-compactos-ambiguos.json'),'utf8')) as Array<Array<{id:string;name:string}>>;
  for(const group of collisions){
    const [a,b]=group;if(!a||!b)continue;
    cases.push({key:`mp3com:duplicate:${[a.id,b.id].sort().join(':')}`,kind:'possible_duplicate',a:a.id,b:b.id,
      payload:{reason:'Colisión de nombres compactos; revisar repertorio y miembros. No fusionar automáticamente por nombre o ciudad.',candidates:group,
        profiles:identities.filter(r=>group.some(g=>g.id===r.artist_id))}});
  }
  const registered=new Set((await pool.query<{key:string}>("SELECT payload->>'recoveryKey' AS key FROM ingest.review_queue WHERE payload->>'campaign'='hermes-recuperacion-2026-10-24'")).rows.map(r=>r.key));
  const newCases=cases.filter(c=>!registered.has(c.key));
  const invalidTypeClaims=(await pool.query<{id:string}>(`SELECT c.id::text FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
    JOIN public.artists a ON a.id=c.artist_id WHERE s.slug='mp3-com-2003-project' AND c.artist_id=1155
    AND c.identity_key='mp3-com-2003-project:mp3com:225/doppler_ven.html:artist_type'
    AND c.field='artist_type' AND c.status='accepted' AND c.normalized_value='"solo_artist"'::jsonb AND a.artist_type='band'`)).rows;
  const preview={apply:false,created_at:new Date().toISOString(),documents:plans,website_flags:webs,identity_reviews:newCases,invalid_type_claims:invalidTypeClaims,
    reason_web:'La campaña original comprobó accesibilidad HTTP, no titularidad. Se conserva la URL y se retira únicamente la marca de identidad verificada.'};
  writeFileSync(path.join(out,'mp3com-correcciones-preview.json'),JSON.stringify(preview,null,2));
  if(!apply){console.log(JSON.stringify({apply:false,documents:plans.length,website_flags:webs.length,identity_reviews:newCases.length,invalid_type_claims:invalidTypeClaims.length}));}
  else if(!plans.length&&!webs.length&&!newCases.length&&!invalidTypeClaims.length){console.log('Sin cambios pendientes');}
  else{
    const {runId,result}=await withOperatorRun({name:'mp3com:repair-document-counts-and-verification',operator:'codex (encargo de Brian)',
      note:'Reparación tras auditoría: no contar grupos sin título como discos; conservar todas las canciones y distinguir accesibilidad HTTP de identidad de web verificada.'},async ctx=>{
      await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
      for(const p of plans){
        const current=(await ctx.client.query<Doc>('SELECT id::text,artist_id::text,source_key,title,content,metadata FROM media.artist_documents WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
        if(!current||hash(current)!==p.version)throw new Error(`Documento ${p.id} cambió después del preview`);
        await ctx.client.query('UPDATE media.artist_documents SET title=$2,content=$3,metadata=$4::jsonb,updated_at=now() WHERE id=$1',[p.id,p.after.title,p.after.content,JSON.stringify(p.after.metadata)]);
      }
      for(const w of webs){
        const note='Titularidad pendiente: el chequeo de MP3.com 2003 sólo confirmó respuesta HTTP. La URL se conserva como enlace histórico declarado.';
        const r=await ctx.client.query("UPDATE public.social_links SET verified=false,notes=concat_ws(E'\\n',notes,$2::text) WHERE id=$1 AND source='mp3-com-2003-project' AND url=$3 AND verified=true",[w.id,note,w.url]);
        if(r.rowCount!==1)throw new Error(`Web ${w.id} cambió después del preview`);
      }
      const reviewIds:string[]=[];
      for(const c of newCases){
        const r=await ctx.client.query<{id:string}>(`INSERT INTO ingest.review_queue(kind,status,priority,artist_a_id,artist_b_id,payload,notes)
          VALUES($1,'open',6,$2,$3,$4::jsonb,$5) RETURNING id::text`,[c.kind,c.a,c.b,
          JSON.stringify({campaign:'hermes-recuperacion-2026-10-24',recoveryKey:c.key,runId:ctx.runId,...c.payload}),
          'Revisión tras auditoría de Hermes solicitada por Brian. No confirma ni fusiona identidades.']);
        reviewIds.push(r.rows[0]!.id);
      }
      for(const c of invalidTypeClaims){
        await ctx.client.query(`UPDATE ingest.claims SET status='rejected',notes=concat_ws(E'\\n',notes,$2::text),updated_at=now()
          WHERE id=$1 AND status='accepted' AND artist_id=1155 AND normalized_value='"solo_artist"'::jsonb`,
          [c.id,'Clasificación derivada incorrecta: la lista Group Members de 225/doppler_ven.html concatena Renan Ramirez, Juan Carlos Chavez y Diego. La banda y su repertorio se contrastaron con fuentes independientes; se conserva la ficha band y el claim original rechazado como evidencia.']);
      }
      return {documents:plans.length,website_flags:webs.length,identity_reviews:newCases.length,review_ids:reviewIds,rejected_derived_type_claims:invalidTypeClaims.length};
    },{serializable:true,rollbackOnly:probe});
    writeFileSync(path.join(out,probe?'mp3com-correcciones-sonda-revertida.json':'mp3com-correcciones-aplicadas.json'),JSON.stringify({runId,...result,rolled_back:probe,applied_at:new Date().toISOString()},null,2));
    console.log(JSON.stringify({runId,...result,rolled_back:probe}));
  }
}finally{await closeDb();}
