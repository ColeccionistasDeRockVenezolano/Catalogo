import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun,createRelation} from '../../src/merge/operator.js';
import {bindRun} from '../../src/db/run-binding.js';
const confirm=process.argv.includes('--confirm');
const h='/artist/jose_ignacio_cabrujas';
const out=await withOperatorRun({name:'RYM remanente: créditos de Cabrujas y Moisés de Martín',operator:'Codex (autorizado por Brian)',note:'Cabrujas es autor acreditado junto a Juan Carlos Núñez. Moisés de Martín es José Ignacio Benítez, coautor de Pajarera Vertical: https://augustobrachomoisesdemartin.bandcamp.com/album/pajarera-vertical; https://revistaladosis.com/augusto-bracho-gustavo-guerrero-entrevista'},async c=>{
 await bindRun(c.client,c.runId);
 const p=(await c.client.query("SELECT id FROM public.persons WHERE name='José Ignacio Cabrujas'")).rows;
 if(p.length!==1)throw Error('Identidad de Cabrujas ambigua');
 const id=Number(p[0].id);
 await c.client.query("UPDATE ingest.claims SET status='rejected',notes=coalesce(notes,'') || ' Corrección: este href identifica al autor Cabrujas, no al compositor Juan Carlos Núñez.' WHERE entity_kind='artist' AND artist_id=3976 AND field='rym_identity' AND normalized_value=$1::jsonb AND extractor='rym-remanente'",[JSON.stringify(h)]);
 const r=await c.client.query(`INSERT INTO ingest.claims(source_id,entity_kind,person_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key) VALUES((SELECT id FROM ingest.sources WHERE slug='rateyourmusic'),'person',$1,'rym_identity',$2::jsonb,$2::jsonb,$3,'rym-remanente','1','medium','accepted','human',$4,'Autor de textos y voz en colaboración con Juan Carlos Núñez',$5) ON CONFLICT DO NOTHING RETURNING id`,[id,JSON.stringify(h),createHash('sha256').update(`person:${id}:${h}`).digest('hex'),c.runId,`rym-remanente:person:${id}:rym_identity`]);
 if(r.rows[0])await c.client.query('INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING',[r.rows[0].id,`https://rateyourmusic.com${h}`,'José Ignacio Cabrujas: autor acreditado junto a Juan Carlos Núñez',createHash('sha256').update(h).digest('hex')]);
 await createRelation(c,'album_credit',{albumId:27562,personId:7946},{credit_type:'writer',credit_role:'Letra y música (Moisés de Martín)'});
 return {personId:id,pajareraAlbum:27562,coautorPerson:7946};
},{rollbackOnly:!confirm});
writeFileSync(`reports/rym-resolucion-2026-10-09/vinculos-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify(out,null,2));
if(confirm){const path='docs/decisions/2026-10-09-rym-remanente.json';const d=JSON.parse(readFileSync(path,'utf8'));Object.assign(d.artistas[h],{aplicar_solo_destinos_explicitos:true,representacion:'persona_acreditada',person_id:out.result.personId});writeFileSync(path,JSON.stringify(d,null,2)+'\n');}
console.log(JSON.stringify(out));await closeDb();
