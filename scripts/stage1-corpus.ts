import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../src/config/env.js";
import { closeDb,getPool } from "../src/db/client.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const directory=path.resolve(process.argv[2]??"reports/plan-20-de-20/etapa-1/corpus-initial");
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
await mkdir(path.join(directory,"documents"),{recursive:true});
const client=await getPool().connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const seeds=JSON.parse(await readFile("docs/plan-20-de-20/stage1-cases.json","utf8")) as {artists:string[]};
  const artistRows=(await client.query<{row:Record<string,unknown>}>("SELECT to_jsonb(t) AS row FROM public.artists t ORDER BY id")).rows.map(item=>item.row);
  const named=seeds.artists.map(name=>{
    const matches=artistRows.filter(row=>normalizeEntityName(String(row["name"])).primaryKey===normalizeEntityName(name).primaryKey);
    if(matches.length!==1)throw new Error(`Identidad basal no única: ${name}`);
    return matches[0]!;
  });
  const entities:Array<{kind:string;id:number;partition:string;data:Record<string,unknown>}>=[];
  for(const [kind,table,count] of [["artist","artists",12],["person","persons",12],["album","albums",12],["organization","organizations",2],["track","tracks",2]] as const) {
    const rows=(await client.query<{row:Record<string,unknown>}>(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY (SELECT count(*) FROM jsonb_each(to_jsonb(t)) j WHERE j.value<>'null'::jsonb) DESC,id LIMIT 40`)).rows.map(item=>item.row);
    const candidates=kind==="artist"?[...named,...rows.filter(row=>!named.some(seed=>seed["id"]===row["id"]))]:rows;
    const development={artist:7,person:7,album:8,organization:1,track:1}[kind];
    candidates.slice(0,count).forEach((data,index)=>entities.push({kind,id:Number(data["id"]),partition:index<development?"development":"reserved",data}));
  }
  if(entities.length!==40)throw new Error("El catálogo no aporta 40 fichas para la línea base");
  const observations=entities.flatMap(entity=>Object.entries(entity.data).filter(([,value])=>value!==null).map(([field,value])=>({kind:entity.kind,id:entity.id,field,value,label:"must_preserve",basis:"catalog snapshot; external truth not asserted"})));
  if(observations.length<300)throw new Error(`Solo ${observations.length} valores catalogados conservables; se necesitan 300`);
  const documents:Array<{id:number;url:string;file:string;sha256:string;bytes:number;capturedAt:unknown;label:string;documentaryReviewed:boolean}>=[];
  const raw=(await client.query<{id:string;url:string;sha256:string;stored_path:string;capture:unknown}>("SELECT id::text,url,sha256,stored_path,to_jsonb(r)->'captured_at' AS capture FROM ingest.raw_pages r WHERE http_status BETWEEN 200 AND 299 ORDER BY id LIMIT 300")).rows;
  for(const item of raw) {
    const original=path.resolve(getEnv().DATA_DIR,item.stored_path);
    const base=path.resolve(getEnv().DATA_DIR);
    if(!original.startsWith(base+path.sep))throw new Error("Una captura sale del directorio de datos");
    const bytes=await readFile(original);
    if(sha(bytes)!==item.sha256)throw new Error(`Captura ${item.id}: hash de bytes distinto`);
    const file=`documents/${item.id}${path.extname(item.stored_path)||".bin"}`;
    await writeFile(path.join(directory,file),bytes);
    documents.push({id:Number(item.id),url:item.url,file,sha256:item.sha256,bytes:bytes.length,capturedAt:item.capture??null,label:"archived_bytes_verified",documentaryReviewed:false});
    if(documents.length===120)break;
  }
  if(documents.length!==120)throw new Error("Faltan 120 documentos archivados verificables");
  const imageRows=(await client.query<{kind:string;id:string;url:string}>("SELECT kind,id::text,url FROM (SELECT 'artist' AS kind,id,picture_url AS url FROM public.artists UNION ALL SELECT 'person',id,picture_url FROM public.persons UNION ALL SELECT 'album',id,cover_url FROM public.albums) images WHERE url IS NOT NULL ORDER BY kind,id LIMIT 100")).rows;
  const images=imageRows.map(item=>({...item,id:Number(item.id),label:"existing_catalog_association",visualIdentityReviewed:false}));
  const negatives=Array.from({length:100},(_,i)=>{
    if(i<25)return {id:`date-negative-${i+1}`,input:{date:`${1901+4*i}-02-30`},label:"reject",basis:"Calendar has no February 30; representative synthetic case"};
    if(i<50)return {id:`identity-negative-${i-24}`,input:{sameName:true,sourceIdentityConfirmed:false,case:i},label:"pending",basis:"A matching name alone cannot verify identity; representative synthetic case"};
    if(i<75)return {id:`edition-negative-${i-49}`,input:{sameTitle:true,formats:["CD","DVD"],case:i},label:"keep_distinct",basis:"A shared title does not merge separate media editions; representative synthetic case"};
    return {id:`evidence-negative-${i-74}`,input:{quote:`Cita sintética ausente QA ${i}`,documentId:documents[i-75]!.id},label:"reject",basis:"An absent literal quote cannot become documentary evidence; representative synthetic case"};
  });
  await client.query("COMMIT");
  const corpus={version:2,createdAt:new Date().toISOString(),purpose:"Initial stage 1 conservation and model corpus; not editorial acceptance of external facts",entities,observations,negatives,documents,images,
    behavioralCases:["test/contract/stage1-catalog-model.test.ts","test/contract/fact-inventory.test.ts","test/contract/journal-undo-concurrency.test.ts"],
    limitations:["Catalog values are labeled for conservation, not externally verified.","Image identity/quality and source fact annotations require editorial evaluation in their corresponding stages.","Synthetic negative cases and browser runs are not human sessions."]};
  const serialized=JSON.stringify(corpus,null,2)+"\n";
  await writeFile(path.join(directory,"corpus.json"),serialized,{flag:"wx"});
  await writeFile(path.join(directory,"manifest.json"),JSON.stringify({version:2,sha256:sha(serialized),entities:entities.length,development:24,reserved:16,observations:observations.length,negatives:negatives.length,documents:documents.length,images:images.length},null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({entities:entities.length,observations:observations.length,negatives:negatives.length,documents:documents.length,images:images.length}));
} catch(error) {await client.query("ROLLBACK");throw error;}
finally {client.release();await closeDb();}
