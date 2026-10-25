// Plan 20/20 · M06: puntúa el uso de la muestra etiquetada (det) y, con "vision", la lectura visual donde el contexto no lo dice.
// Uso: npx tsx scripts/stage3-m06-score.ts [det|vision]   (M06_CACHE guarda los originales descargados)
// M06_DIR apunta a otra muestra (p. ej. la reserva en etapa-3/m06-reserva).
import { readFile, writeFile, access } from "node:fs/promises";
const R=process.cwd();
const {getPool,closeDb}=await import(R+"/src/db/client.js");
const {downloadImage}=await import(R+"/src/merge/image-inspection.js");
const {inspectImage,classifyImageUse}=await import(R+"/src/verification/image-quality.js");
const {isDecorativeImageUrl}=await import(R+"/src/ambiguity/page-images.js");
const {createVisionClassifier,mergeVisualReading,needsVisualReading}=await import(R+"/src/verification/image-vision.js");
const {createDeepSeekGateway}=await import(R+"/src/ai/gateway.js");
const out=process.env["M06_DIR"] ?? R+"/reports/plan-20-de-20/etapa-3/m06"; const cache=process.env["M06_CACHE"] ?? (await import("node:os")).tmpdir()+"/crv-m06"; await (await import("node:fs/promises")).mkdir(cache,{recursive:true});
const mode=process.argv[2]??"det";
const sample=JSON.parse(await readFile(out+"/sample.json","utf8")).filter((x:any)=>x.n);
const lab=JSON.parse(await readFile(out+"/labels.json","utf8")); const L=lab.use, UNCERTAIN=Object.keys(lab.uncertain).map(Number), WRONG=Object.keys(lab.wrongEntity).map(Number);
const vision=mode==="vision"?createVisionClassifier(createDeepSeekGateway()):null;
const rows:any[]=[];let ok=0,total=0,calls=0;const confusion:Record<string,number>={};
for(const s of sample){
  const file=`${cache}/${s.n}.bin`;let bytes:Buffer;
  try{await access(file);bytes=await readFile(file);}catch{const d=await downloadImage(s.candidate_url);if("error" in d){rows.push({n:s.n,error:d.error});continue;}bytes=d.bytes;await writeFile(file,bytes);}
  const ins=await inspectImage(bytes);
  const {e:expected,o:otherTitles}=(await getPool().query("SELECT array_remove(ARRAY[al.title,COALESCE(alar.name,ar.name)],NULL) AS e, ARRAY(SELECT o.title FROM public.albums o WHERE o.artist_id=COALESCE(al.artist_id,c.artist_id) AND o.id IS DISTINCT FROM al.id) AS o FROM ingest.image_candidates c LEFT JOIN public.albums al ON al.id=c.album_id LEFT JOIN public.artists alar ON alar.id=al.artist_id LEFT JOIN public.artists ar ON ar.id=c.artist_id WHERE c.id=$1",[s.id])).rows[0];
  let {use,reasons}=classifyImageUse({url:s.candidate_url,context:`${s.image_context??""} ${s.source} ${s.origin} ${s.page_url??""}`,target:s.entity_kind,width:ins.width,height:ins.height,decorative:isDecorativeImageUrl(s.candidate_url)});
  let seen:any=null;
  if(vision&&ins.ok&&needsVisualReading(use,reasons)){seen=await vision({bytes,sourceUrl:s.candidate_url,target:s.entity_kind,expected,otherTitles,context:s.image_context});calls++;({use,reasons}=mergeVisualReading({use,reasons},seen,s.entity_kind,expected));}
  const label=L[String(s.n)];const uncertain=UNCERTAIN.includes(s.n);
  if(label&&!uncertain){total++;if(label===use)ok++;else confusion[`${label}→${use}`]=(confusion[`${label}→${use}`]??0)+1;}
  rows.push({n:s.n,kind:s.entity_kind,origin:s.origin,label,use,reasons,expected,seen,wrong:WRONG.includes(s.n)});
}
const wrong=rows.filter(r=>r.wrong);
const mism=rows.filter(r=>r.reasons.some((x:string)=>x.includes("posible imagen de otra ficha")));
const summary={mode,total,ok,accuracy:+(ok/total*100).toFixed(1),calls,confusion,wrongEntity:wrong.map(r=>({n:r.n,textMatch:r.seen?.textMatch??null,visible:r.seen?.visibleText??null})),mismatchFlags:mism.map(r=>({n:r.n,wrong:r.wrong,visible:r.seen.visibleText,expected:r.expected}))};
await writeFile(`${out}/score-${mode}.json`,JSON.stringify({summary,rows},null,1));
console.log(JSON.stringify(summary,null,1));
await closeDb();
