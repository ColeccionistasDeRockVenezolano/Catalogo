import {readFileSync,writeFileSync,appendFileSync,existsSync,copyFileSync} from 'node:fs';
import {join,extname} from 'node:path';import {createHash} from 'node:crypto';
import sharp from 'sharp';import {z} from 'zod';
import {createDeepSeekGateway} from '../../src/ai/gateway.js';import {closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']??`${process.env['HOME']}/crv-staging/reports/wayback-incorporacion-2026-10-23`;
const media=`${process.env['HOME']}/crv-staging/web/public/media/wayback-archivo-2026-10-23`;
const analysis='reports/wayback-analisis-catalogo-2026-10-22';
const rows=(name:string)=>readFileSync(join(analysis,name+'.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
const photos=rows('fotos-bandas-verificadas').filter(r=>r.imagen_valida);
const covers=rows('portadas-locales-verificadas').filter(r=>r.imagen_valida).map(r=>({banda:r.artista,archivo:r.archivo_local,url_imagen:r.url,obra:r.obra,category:'related'}));
const seen=new Set<string>(),images:any[]=[];
for(const r of [...photos,...covers]){
 const raw=readFileSync(r.archivo);const hash=createHash('sha256').update(raw).digest('hex');const key=r.banda+':'+hash;if(seen.has(key))continue;seen.add(key);
 const meta=await sharp(raw).metadata();const extension=meta.format==='jpeg'?'.jpg':meta.format==='png'?'.png':meta.format==='gif'?'.gif':extname(r.archivo);
 const filename=hash+extension;if(!existsSync(join(media,filename)))copyFileSync(r.archivo,join(media,filename));
 images.push({...r,key,sha256:hash,width:meta.width,height:meta.height,imageUrl:'/crv/media/wayback-archivo-2026-10-23/'+filename});
}
writeFileSync(join(out,'imagenes-localizadas.jsonl'),images.map(r=>JSON.stringify(r)).join('\n')+'\n');
const file=join(out,'imagenes-inspeccionadas.jsonl');const done=new Set(existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x).key):[]);
const schema=z.object({category:z.enum(['artist','concert','poster','related','logo']),description:z.string(),date:z.string().nullable(),dateText:z.string().nullable(),location:z.string().nullable(),visibleText:z.string().nullable()});
const gateway=createDeepSeekGateway();let cursor=0;
const pending=images.filter(r=>!done.has(r.key));
async function worker(){while(cursor<pending.length){const r=pending[cursor++];try{
 const data=await sharp(r.archivo).rotate().resize({width:700,height:700,fit:'inside',withoutEnlargement:true}).jpeg().toBuffer();
 const result=await gateway.propose({taskKind:'vision_analysis',schemaVersion:'wayback-galeria.v1',responseSchema:schema,
 instructions:'Describe exclusivamente los elementos VISIBLES de esta imagen de un archivo musical histórico, en español sobrio. Nombre de banda del contexto no prueba identidad de las personas. Clasifica fotografía artist, actuación concert, afiche poster, logotipo logo, portada/ilustración related. No adivines quién es cada persona, recinto, ciudad o fecha de la foto. date ISO sólo si día mes y año impresos explícitamente; dateText literal para fechas parciales; location sólo si está ESCRITA dentro de la imagen, no por contexto o ciudad de la banda. Descripción breve 1-2 frases, sin promoción ni autores inventados. visibleText sólo textos legibles, null si no hay.',
 input:{banda:r.banda,obra:r.obra??null},images:[{dataUrl:'data:image/jpeg;base64,'+data.toString('base64'),sourceUrl:r.url_imagen}]});
 appendFileSync(file,JSON.stringify({key:r.key,...result.proposal,model:result.model,promptHash:result.promptHash})+'\n');
 }catch(e){appendFileSync(join(out,'imagenes-errores.jsonl'),JSON.stringify({key:r.key,error:String(e)})+'\n');}
 if(cursor%25===0)console.log(cursor+'/'+pending.length);
}}
console.log('Imágenes',images.length,'pendientes',pending.length);await Promise.all(Array.from({length:5},worker));await closeDb();
