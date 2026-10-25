import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeDb} from '../src/db/client.js';
import {updateEntity,updateRelation,withOperatorRun} from '../src/merge/operator.js';
import {writeModel} from '../src/catalog/model.js';
import {assertRymIdentity,readRymIdentityLedger,verifyRymPin} from '../src/verification/rym-identity.js';
const directory=(()=>{const i=process.argv.indexOf('--dir'),v=process.argv[i+1];if(i<0||!v)throw new Error('--dir obligatorio');return v;})();
const confirm=process.argv.includes('--confirm');
async function main(){
 const ledger=readRymIdentityLedger(path.join(directory,'identity-ledger.json')),identity=ledger.identities.find(e=>e.artistId===6630&&e.status==='resolved');
 const profile=readFileSync(path.join(directory,'corpus/artistas.jsonl'),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s) as {href:string;info:Record<string,string>;capturePins:Array<{path:string;sha256:string}>}).find(p=>p.href===identity?.href);
 if(!profile||profile.info['Born']!=='22 August 1983, Lechería, Anzoátegui, Venezuela'||profile.info['Also Known As']!=='Miguel Ignacio Mendoza Donatti [birth name]')throw new Error('Perfil inesperado');
 const baseline=JSON.parse(readFileSync(path.join(directory,'catalogo-inicial.json'),'utf8')) as {persons:Array<{id:number;birth_date_value:string|null;birth_city:string|null}>};
 const old=baseline.persons.find(p=>p.id===3343);if(!old||old.birth_date_value!==null||old.birth_city!==null)throw new Error('Restauración sin base');
 const result=await withOperatorRun({name:'catalogo:rym-integral-separar-nacho-perez',operator:'Codex (encargo de Brian: resolver identidades)',note:'Nacho es Miguel Ignacio Mendoza Donatti, ya presente como Miguel Ignacio Mendoza y miembro de Chino & Nacho. Corregir el vínculo previo con Ignacio Pérez de Ricochet y restaurar solamente los campos personales introducidos por esta campaña.',params:{campaign:'rym-integral-2026-10-21',phase:'nacho_identity',sourcePins:profile.capturePins}},async ctx=>{
  await assertRymIdentity(ctx.client,ledger,profile.href,6630);for(const pin of profile.capturePins)verifyRymPin(pin);
  if(!(await ctx.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=4247 AND person_id=35444')).rowCount)throw new Error('Falta el vínculo con Chino & Nacho');
  const membership=(await ctx.client.query<{person_id:number;role:string}>('SELECT person_id::int,role FROM public.artist_members WHERE id=10999 AND artist_id=6630 FOR UPDATE')).rows[0];
  if(!membership||![3343,35444].includes(membership.person_id)||membership.role!=='Titular del proyecto')throw new Error('La titularidad cambió');
  const people=(await ctx.client.query<{id:number;name:string;birth_date_value:string|null;birth_city:string|null;real_name:string|null}>('SELECT id::int,name,birth_date_value,birth_city,real_name FROM public.persons WHERE id IN (3343,35444) ORDER BY id FOR UPDATE')).rows;
  const wrong=people.find(p=>p.id===3343),right=people.find(p=>p.id===35444);
  if(!wrong||!right||wrong.name!=='Ignacio Pérez'||right.name!=='Miguel Ignacio Mendoza')throw new Error('Personas inesperadas');
  if(wrong.birth_date_value!==null&&wrong.birth_date_value!=='1983-08-22'||wrong.birth_city!==null&&wrong.birth_city!=='Lechería')throw new Error('Los campos de Pérez cambiaron');
  if(wrong.birth_date_value!==null||wrong.birth_city!==null)await updateEntity(ctx,'person',3343,{birth_date:null,birth_city:null});
  if(right.birth_date_value!==null&&right.birth_date_value!=='1983-08-22'||right.birth_city!==null&&right.birth_city!=='Lechería'||right.real_name!==null&&right.real_name!=='Miguel Ignacio Mendoza Donatti')throw new Error('Datos personales previos distintos');
  const fields:Record<string,string>={};if(!right.birth_date_value)fields['birth_date']='1983-08-22';if(!right.birth_city)fields['birth_city']='Lechería';if(!right.real_name)fields['real_name']='Miguel Ignacio Mendoza Donatti';
  if(Object.keys(fields).length)await updateEntity(ctx,'person',35444,fields);
  if(membership.person_id!==35444)await updateRelation(ctx,'artist_membership',10999,{person_id:35444});
  const identities=(await ctx.client.query<{person_id:number}>('SELECT person_id::int FROM ingest.musical_identities WHERE artist_id=6630 FOR UPDATE')).rows;
  if(identities.some(i=>i.person_id!==35444))throw new Error('Identidad musical distinta');
  if(!identities.length)await writeModel(ctx,'identity',{artistId:6630,personId:35444,relationship:'solo_identity',notes:`Nacho: Miguel Ignacio Mendoza Donatti, nacido el 22 de agosto de 1983 en Lechería. https://rateyourmusic.com${profile.href}`});
  await ctx.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) SELECT id,$2,$3,0,$4 FROM ingest.claims WHERE run_id=$1 ON CONFLICT DO NOTHING`,[ctx.runId,`https://rateyourmusic.com${profile.href}`,'Nacho: Miguel Ignacio Mendoza Donatti [birth name]; Born 22 August 1983, Lechería. Persona ya vinculada a Chino & Nacho; distinta de Ignacio Pérez de Ricochet.',createHash('sha256').update(JSON.stringify(profile.capturePins)).digest('hex')]);
  return {artistId:6630,personId:35444,revertedPersonId:3343,membershipId:10999,sourcePins:profile.capturePins};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(directory,`identidad-nacho-${confirm?'aplicado':'ensayo'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch((e:unknown)=>{console.error(e);process.exitCode=1;}).finally(()=>closeDb());
