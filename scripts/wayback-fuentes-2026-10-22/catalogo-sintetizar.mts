import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {createDeepSeekGateway} from '../../src/ai/gateway.js';
import {closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT'] ?? `${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const parse=(name:string)=>readFileSync(join(out,name),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
const done=new Set(existsSync(join(out,'sintesis-artistas.jsonl'))?parse('sintesis-artistas.jsonl').filter(x=>!x.error).map(x=>x.key):[]);
const pending=parse('expedientes-artistas.jsonl').filter(x=>!done.has(x.key));
const schema=z.object({
 key:z.string(),artistId:z.number().int().nullable(),identity:z.enum(['same','new','conflict','insufficient']),reason:z.string(),
 biography:z.string().nullable(),artistType:z.enum(['band','solo_artist','duo','project','group']).nullable(),
 city:z.string().nullable(),formedYear:z.number().int().nullable(),
 members:z.array(z.object({name:z.string(),role:z.string().nullable(),quote:z.string()})),
 events:z.array(z.object({title:z.string(),description:z.string(),date:z.string().nullable(),year:z.number().int().nullable(),place:z.string().nullable(),quote:z.string()})),
 conflicts:z.array(z.object({field:z.string(),current:z.string().nullable(),source:z.string(),quote:z.string()})),
 releases:z.array(z.object({title:z.string(),year:z.number().int().nullable(),kind:z.string().nullable(),quote:z.string()})),
});
const instructions=`Editas un catálogo venezolano a petición expresa de incorporar los archivos históricos y fusionar biografías sin perder hechos actuales. Usa exclusivamente el expediente. Devuelve JSON del esquema.
Identidad: si un candidato único es compatible, same y su artistId; si no existe candidato y el texto documenta un proyecto musical propio, new. Si hay varios candidatos elige sólo si integrantes/obra/ciudad documentados distinguen inequívocamente; en otro caso conflict y artistId null. Si describe otro proyecto distinto de todos, new con razón concreta. Nunca unas entidades sólo por nombre. Una colaboración conjunta es su propio proyecto, no sus músicos por separado. No crees bandas de menús, categorías, personas de créditos o usuarios del chat. Los períodos distintos no son contradicción por sí mismos: conservar carácter histórico. La falta de información no es conflicto.
Biografía: español enciclopédico en tercera persona, párrafos sin markdown, links, contactos ni nombres de fuente. FUSIONA todos los hechos de la biografía actual con los nuevos, sin truncar ni borrar hechos existentes. No impongas un máximo de palabras que destruya la biografía actual. Elimina promoción y opinión. Aporta historia e integrantes y obras documentadas. Si ya está todo, conserva la actual. No presentes formación histórica como actual ni deduzcas estado activo por existir web archivada. No inventes años, ciudad, instrumentos o nacionalidad individual. Una portada no acredita que el artista sea una banda; si no hay más datos escribe una frase que nombre sus publicaciones, no fabrique historia. Fechas de subida/captura no son fechas de obras.
members: sólo integrantes explícitos con nombre NO ambiguo y rol literal; no autores de diseño, productores ni invitados convertidos en miembros. quote debe contener nombre y rol en la fuente; si no hay rol, null. Extrae todos los miembros documentados, no un número limitado. No llames fundador al que sólo figura como miembro.
events: sólo hitos históricos (formación, estreno, grabación, premio, separación, concierto celebrado), con año EXPLÍCITO y cita. date es ISO sólo si día/mes/año están explícitos, null si sólo año/mes. Nunca usar 1 de enero como fecha ficticia. Anuncios futuros de conciertos no prueban celebración: excluir de events. No deduzcas cumpleaños. Año debe aparecer en la cita. Máximo 12 hitos principales.
conflicts: sólo contradicciones concretas en identidad, año de formación, origen o discografía entre fuente y catálogo, NO ausencias. Conserva hechos actuales en biografía cuando un conflicto no esté resuelto, omitiendo la afirmación contradictoria del archivo de la síntesis. Copia cita y ambos valores sin inventar.
releases: extrae publicaciones con TÍTULO explícito de la biografía, año sólo si escrito. No conviertas canciones sueltas, video, concierto anunciado o playlist en disco. kind sólo si fuente determina tipo. No inventes número de pistas. actorId null para altas. key exacta del expediente.`;
const gateway=createDeepSeekGateway();let cursor=0,ok=0,errors=0;
const limit=Number(process.env['WAYBACK_LIMIT']??pending.length);
async function worker(){while(cursor<Math.min(pending.length,limit)){
 const c=pending[cursor++];try{
 const response=await gateway.propose({taskKind:'biography',schemaVersion:'wayback-catalogo.v1',instructions,responseSchema:schema,input:c});
 const r=response.proposal;if(r.key!==c.key)throw new Error('key no coincide');
 if(r.artistId!==null&&!c.candidates.some((x:{id:number})=>x.id===r.artistId))throw new Error('artistId fuera del expediente');
 const source=JSON.stringify(c.source);r.members=r.members.filter(m=>source.toLowerCase().includes(m.name.toLowerCase())&&m.quote.length>3);
 r.events=r.events.filter(e=>e.year!==null&&e.year>=1900&&e.year<=2026&&e.quote.includes(String(e.year))&&(!e.date||e.date.startsWith(String(e.year)+'-')));
 if(r.biography&&/(?:https?:\/\/|\bwww\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu.test(r.biography))throw new Error('Contacto en biografía');
 appendFileSync(join(out,'sintesis-artistas.jsonl'),JSON.stringify({...r,model:response.model,promptHash:response.promptHash})+'\n');ok++;
 }catch(e){appendFileSync(join(out,'errores-sintesis.jsonl'),JSON.stringify({key:c.key,error:String(e)})+'\n');errors++;}
 if((ok+errors)%20===0)console.log(`${ok} correctos, ${errors} errores, ${cursor}/${Math.min(pending.length,limit)}`);
}}
console.log('Expedientes pendientes',pending.length);await Promise.all(Array.from({length:10},worker));console.log({ok,errors});await closeDb();
