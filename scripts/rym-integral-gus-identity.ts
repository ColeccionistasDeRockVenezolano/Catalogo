import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {createEntity,updateEntity,updateRelation,withOperatorRun} from '../src/merge/operator.js';
import {writeModel} from '../src/catalog/model.js';
import {assertRymIdentity,normalizeRymIdentity as norm,readRymIdentityLedger,verifyRymPin} from '../src/verification/rym-identity.js';
const directory=(()=>{const i=process.argv.indexOf('--dir'),v=process.argv[i+1];if(i<0||!v)throw new Error('--dir obligatorio');return v;})();
const confirm=process.argv.includes('--confirm');
async function main(){
 const profile=readFileSync(path.join(directory,'corpus/artistas.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as {href:string;info:Record<string,string>;capturePins:Array<{path:string;sha256:string}>}).find(p=>p.href==='/artist/gus-6');
 if(!profile||profile.info['Born']!=='10 March 2000, Valencia, Carabobo, Venezuela'||profile.info['Also Known As']!=='Gustavo Enrique Ortega Urdaneta [birth name]')throw new Error('Perfil inesperado');
 const ledger=readRymIdentityLedger(path.join(directory,'identity-ledger.json'));
 const baseline=JSON.parse(readFileSync(path.join(directory,'catalogo-inicial.json'),'utf8')) as {persons:Array<{id:number;birth_date_value:string|null;birth_city:string|null}>};
 const old=baseline.persons.find(p=>p.id===1123);if(!old||old.birth_date_value!==null||old.birth_city!==null)throw new Error('Restauración sin base comprobada');
 const result=await withOperatorRun({name:'catalogo:rym-integral-separar-gus-corma',operator:'Codex (encargo de Brian: resolver identidades)',note:'Gus / Gustavo Enrique Ortega Urdaneta nació en 2000 según el perfil RYM acreditado; no es Gustavo Corma, documentado en Seguridad Nacional desde 1978. Corregir la titularidad previa de Gus y revertir solo los datos personales añadidos por esta campaña a Corma.',params:{campaign:'rym-integral-2026-10-21',phase:'gus_identity',sourcePins:profile.capturePins}},async ctx=>{
  await assertRymIdentity(ctx.client,ledger,profile.href,6788);for(const pin of profile.capturePins)verifyRymPin(pin);
  const membership=(await ctx.client.query<{id:number;person_id:number;role:string}>('SELECT id::int,person_id::int,role FROM public.artist_members WHERE id=11156 AND artist_id=6788 FOR UPDATE')).rows[0];
  if(!membership||membership.role!=='Titular del proyecto')throw new Error('La titularidad cambió');
  const fullname='Gustavo Enrique Ortega Urdaneta';
  const all=(await ctx.client.query<{id:number;name:string;real_name:string|null;aliases:string[]}>('SELECT p.id::int,p.name,p.real_name,ARRAY(SELECT alias FROM ingest.person_aliases WHERE person_id=p.id) aliases FROM public.persons p')).rows;
  const matches=all.filter(p=>[p.name,...p.aliases,...(p.real_name?[p.real_name]:[])].some(name=>norm(name)===norm(fullname)));
  if(matches.length>1)throw new Error('Identidad personal ambigua');
  let personId=matches[0]?.id;
  if(membership.person_id!==1123&&membership.person_id!==personId)throw new Error('Titularidad ajena al caso');
  const corma=(await ctx.client.query<{name:string;birth_date_value:string|null;birth_city:string|null}>('SELECT name,birth_date_value,birth_city FROM public.persons WHERE id=1123 FOR UPDATE')).rows[0];
  if(!corma||corma.name!=='Gustavo Corma'||corma.birth_date_value!==null&&corma.birth_date_value!=='2000-03-10'||corma.birth_city!==null&&corma.birth_city!=='Valencia')throw new Error('Los campos de Corma fueron modificados');
  if(corma.birth_date_value!==null||corma.birth_city!==null)await updateEntity(ctx,'person',1123,{birth_date:null,birth_city:null});
  if(!personId)personId=(await createEntity(ctx,'person',{name:fullname,real_name:fullname,birth_date:'2000-03-10',birth_city:'Valencia',is_venezuelan:true,notes:'Titular del proyecto Gus. Nombre de nacimiento y fecha documentados en https://rateyourmusic.com/artist/gus-6; distinto de Gustavo Corma, activo desde 1978.'},{allowSimilar:true})).id;
  if(membership.person_id!==personId)await updateRelation(ctx,'artist_membership',11156,{person_id:personId});
  const identities=(await ctx.client.query<{person_id:number}>('SELECT person_id::int FROM ingest.musical_identities WHERE artist_id=6788 FOR UPDATE')).rows;
  if(identities.some(i=>i.person_id!==personId))throw new Error('Otra identidad musical requiere examen');
  if(!identities.length)await writeModel(ctx,'identity',{artistId:6788,personId,relationship:'solo_identity',notes:'Gus: Gustavo Enrique Ortega Urdaneta, Born 10 March 2000, Valencia. https://rateyourmusic.com/artist/gus-6'});
  await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
   SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 ON CONFLICT DO NOTHING`,[ctx.runId,'https://rateyourmusic.com/artist/gus-6','Gus: Gustavo Enrique Ortega Urdaneta [birth name]; Born 10 March 2000, Valencia. No es Gustavo Corma, integrante de Seguridad Nacional desde 1978.',createHash('sha256').update(JSON.stringify(profile.capturePins)).digest('hex')]);
  return {artistId:6788,personId,revertedPersonId:1123,membershipId:11156,sourcePins:profile.capturePins};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory,`identidad-gus-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
