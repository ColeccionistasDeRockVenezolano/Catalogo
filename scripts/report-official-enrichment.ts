import { readdir, readFile, writeFile, rename, mkdir,stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import type { WebPage } from "../src/ambiguity/web-search.js";
import {factEvidence,musicalFactReviewReasons,type MusicalFact} from "../src/verification/official-enrichment.js";
import type { CatalogEvidence, CatalogPlan } from "../src/curation/ai/types.js";

interface Case {
  artistId:number;name:string;phase:string;updatedAt:string;primaryStatus:string;queue:string[];pages:WebPage[];
  facts:Array<{fact:MusicalFact;sourceUrl:string;evidence:CatalogEvidence|null}>;
  failures:Array<{url:string;reason:string}>;rejectedSources:Array<{url:string;reason:string}>;pendingFragments:string[];
  planId:number|null;tokensIn:number;tokensOut:number;calls:number;cachedCalls:number;unknownUsageCalls?:number;
  nonPrimarySources?:Array<{url:string;reason:string}>;sourceAttributions?:Array<{origin:string;status:string;publisher:string|null;quotes:string[];reason:string}>;
}
const root=resolve(process.argv[2]??"reports/official-enrichment-2026-10-13");
const caseFiles=async(dir:string):Promise<string[]>=>{
  let files:string[];try{files=await readdir(join(dir,"cases"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  return files.filter(name=>/^artist-\d+\.json$/u.test(name)).map(name=>join(dir,"cases",name));
};
const write=async(file:string,data:string)=>{const temp=`${file}.tmp-${process.pid}`;await writeFile(temp,data);await rename(temp,file);};
const count=(items:string[])=>Object.fromEntries([...new Set(items)].sort().map(key=>[key,items.filter(item=>item===key).length]));
const escape=(value:unknown)=>String(value??"").replace(/\|/gu,"\\|").replace(/\r?\n/gu," ");
interface Digest {artistId:number;name:string;phase:string;planId:number|null;pages:string[];facts:number;cited:number;factKinds:Record<string,number>;failures:number;rejected:number;pending:number;queue:number;}
interface CachedDigest {mtime:number;size:number;digest:Digest;planUpdatedAt?:string;}
interface PlanDigest {id:number;status:string;phase:string;updatedAt:string;operations:number;errors:number;unresolved:number;accepted:number;}
const digest=(item:Case):Digest=>({artistId:item.artistId,name:item.name,phase:item.phase,planId:item.planId,pages:item.pages.map(page=>page.url),facts:item.facts.length,cited:item.facts.filter(row=>row.evidence).length,factKinds:count(item.facts.map(row=>row.fact.kind)),failures:item.failures.length,rejected:item.rejectedSources.length,pending:item.pendingFragments.length,queue:item.queue.length});
try{
  const [knownFiles,discoveryFiles,expandedFiles]=await Promise.all([caseFiles(root),caseFiles(join(root,"discovery")),caseFiles(join(root,"expanded"))]);
  const cachePath=join(root,"report-cache.json");
  let cache:Record<string,CachedDigest>={};
  try{const saved=JSON.parse(await readFile(cachePath,"utf8")) as {version:number;entries:Record<string,CachedDigest>};if(saved.version===1)cache=saved.entries;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const changed=new Set<string>();
  // Read a single full dossier at a time. Thousands of source-rich cases must not accumulate in memory.
  for(const file of [...knownFiles,...expandedFiles,...discoveryFiles]){
    const info=await stat(file),old=cache[file];
    if(old?.mtime===info.mtimeMs&&old.size===info.size)continue;
    const item=JSON.parse(await readFile(file,"utf8")) as Case;
    const pages=new Map(item.pages.map(page=>[page.url,page]));
    for(const row of item.facts){const page=pages.get(row.sourceUrl);if(page)row.evidence=item.nonPrimarySources?.some(source=>source.url===row.sourceUrl)||item.rejectedSources.some(source=>source.url===row.sourceUrl)?null:factEvidence(row.fact,page);}
    cache[file]={mtime:info.mtimeMs,size:info.size,digest:digest(item)};changed.add(file);
  }
  const cases=[...knownFiles,...expandedFiles].map(file=>cache[file]!.digest),discovery=discoveryFiles.map(file=>cache[file]!.digest);
  const ids=cases.flatMap(item=>item.planId?[item.planId]:[]);
  const plans=(await getPool().query<PlanDigest>(`SELECT id::int,status,phase,updated_at::text AS "updatedAt",coalesce(jsonb_array_length(draft->'operations'),0)::int operations,
    coalesce(jsonb_array_length(draft->'unresolved'),0)::int unresolved,
    (SELECT count(*)::int FROM jsonb_array_elements(coalesce(preview->'items','[]'::jsonb)) item WHERE item->>'error' IS NOT NULL) errors,
    (SELECT count(*)::int FROM jsonb_each(coalesce(decisions,'{}'::jsonb)) item WHERE item.value->>'decision'='accepted') accepted
    FROM ingest.ai_curation_plans WHERE id=ANY($1::bigint[])`,[ids])).rows;
  const planMap=new Map(plans.map(plan=>[plan.id,plan]));
  const modelRuns=(await getPool().query(`SELECT schema_version,status,count(*)::int runs,coalesce(sum(tokens_in),0)::bigint::text tokens_in,coalesce(sum(tokens_out),0)::bigint::text tokens_out,count(*) FILTER(WHERE tokens_in IS NULL OR tokens_out IS NULL)::int unknown_usage FROM ingest.ai_runs WHERE schema_version LIKE 'official-%' GROUP BY schema_version,status ORDER BY schema_version,status`)).rows;
  const summary={generatedAt:new Date().toISOString(),catalogue:JSON.parse(await readFile(join(root,"audit.json"),"utf8")),
    research:{cases:cases.length,casesStarted:cases.filter(item=>!["sources_discovered","discovery"].includes(item.phase)).length,casesQueued:cases.filter(item=>item.phase==="sources_discovered").length,phases:count(cases.map(item=>item.phase)),capturedPages:cases.reduce((sum,item)=>sum+item.pages.length,0),
      uniqueUrls:new Set(cases.flatMap(item=>item.pages)).size,
      candidateFacts:cases.reduce((sum,item)=>sum+item.facts,0),literallyCitedFacts:cases.reduce((sum,item)=>sum+item.cited,0),
      uncertainFacts:cases.reduce((sum,item)=>sum+item.facts-item.cited,0),
      factKinds:cases.reduce((counts,item)=>{for(const [key,value] of Object.entries(item.factKinds))counts[key]=(counts[key]??0)+value;return counts;},{} as Record<string,number>),
      failedUrls:cases.reduce((sum,item)=>sum+item.failures,0),identityRejectedUrls:cases.reduce((sum,item)=>sum+item.rejected,0),
      pendingFragments:cases.reduce((sum,item)=>sum+item.pending,0)},
    discovery:{cases:discovery.length,phases:count(discovery.map(item=>item.phase)),candidateUrls:discovery.reduce((sum,item)=>sum+item.queue,0)},
    proposals:{plans:plans.length,statuses:count(plans.map(plan=>`${plan.status}/${plan.phase}`)),operations:plans.reduce((sum,plan)=>sum+plan.operations,0),
      operationsWithPreviewError:plans.reduce((sum,plan)=>sum+plan.errors,0),
      unresolved:plans.reduce((sum,plan)=>sum+plan.unresolved,0),accepted:plans.reduce((sum,plan)=>sum+plan.accepted,0)},
    modelRuns,usageNote:"Las filas del caché cuentan la última respuesta conservada por hash; no equivalen al gasto facturado ni cuentan todos los reintentos. No se estima gasto con tarifas inventadas. Titularidad, afirmación literal e identidad son comprobaciones distintas.",
    completionNote:"sources_discovered indica candidatos aún sin recorrer. done indica final de esta pasada, no exhaustividad de todo el sitio. partial y pendientes no cuentan como trabajo terminado."};
  await mkdir(join(root,"dossiers"),{recursive:true});
  for(const file of [...knownFiles,...expandedFiles]){
    const cached=cache[file]!,planInfo=cached.digest.planId?planMap.get(cached.digest.planId):undefined;
    if(!changed.has(file)&&cached.planUpdatedAt===(planInfo?.updatedAt??"none"))continue;
    const item=JSON.parse(await readFile(file,"utf8")) as Case;
    const pages=new Map(item.pages.map(page=>[page.url,page]));
    for(const row of item.facts){const page=pages.get(row.sourceUrl);if(page)row.evidence=item.nonPrimarySources?.some(source=>source.url===row.sourceUrl)||item.rejectedSources.some(source=>source.url===row.sourceUrl)?null:factEvidence(row.fact,page);}
    const plan=item.planId?(await getPool().query<CatalogPlan>("SELECT id::int,status,phase,draft,preview FROM ingest.ai_curation_plans WHERE id=$1",[item.planId])).rows[0]:undefined;
    const lines=[`# ${item.name} · expediente documental`,"",`Actualizado: ${item.updatedAt}. Estado: ${item.phase}. Atribución: ${item.primaryStatus}.`,"",
      `${item.pages.length} páginas capturadas; ${item.facts.length} hechos candidatos, ${item.facts.filter(row=>row.evidence).length} con cita literal y sin incertidumbre declarada. Esto no sustituye el cotejo editorial.`,"",
      "## Propuesta y contraste con CRV","",`Propuesta ${item.planId??"pendiente"}: ${plan?`${plan.status}/${plan.phase}`:"pendiente"}.`,""];
    if(plan?.draft){
      lines.push(plan.draft.summary,"","| Cambio propuesto | Comprobación |","| --- | --- |");
      for(const operation of plan.draft.operations){const preview=plan.preview?.items.find(row=>row.key===operation.key);lines.push(`| ${escape(operation.label)} | ${escape(preview?.error??(preview?"Vista previa calculada; requiere revisión de citas e identidad":"Sin vista previa"))} |`);}
      if(plan.draft.unresolved.length)lines.push("","### Contradicciones y asuntos sin resolver","",...plan.draft.unresolved.map(reason=>`- ${reason}`));
    }
    if(item.sourceAttributions?.length)lines.push("","## Atribución de publicaciones","",...item.sourceAttributions.map(source=>`- ${source.origin}: ${source.status} · ${source.publisher??"editor pendiente"}. ${source.reason} ${source.quotes.map(quote=>`«${escape(quote)}»`).join(" ")}`));
    if(item.nonPrimarySources?.length)lines.push("","### Publicaciones sin atribución primaria suficiente","",...item.nonPrimarySources.map(source=>`- ${source.url}: ${source.reason}`));
    if(item.pendingFragments.length||item.failures.length||item.rejectedSources.length)lines.push("","## Lecturas e identidades pendientes","",
      ...item.pendingFragments.map(reason=>`- ${reason}`),...item.failures.map(row=>`- ${row.url}: ${row.reason}`),...item.rejectedSources.map(row=>`- ${row.url}: ${row.reason}`));
    lines.push("","## Hechos y citas","","| Tipo y sujeto | Dato | Alcance | Evidencia |","| --- | --- | --- | --- |");
    for(const row of item.facts){const page=item.pages.find(page=>page.url===row.sourceUrl);const reasons=page?musicalFactReviewReasons(row.fact,page):["Captura pendiente"];
      lines.push(`| ${escape(`${row.fact.kind} · ${row.fact.subject}`)} | ${escape(row.fact.value)} | ${escape([row.fact.project,row.fact.releaseTitle,row.fact.trackTitle,row.fact.role,row.fact.dateText].filter(Boolean).join(" · "))} | [Fuente](${row.sourceUrl}) · ${escape(row.fact.quote)}${row.evidence?"":` · PENDIENTE: ${escape(reasons.join("; "))}`} |`);}
    await write(join(root,"dossiers",`artist-${item.artistId}.md`),`${lines.join("\n")}\n`);
    cached.planUpdatedAt=planInfo?.updatedAt??"none";
  }
  await write(cachePath,JSON.stringify({version:1,entries:cache}));
  await write(join(root,"progress.json"),`${JSON.stringify(summary,null,2)}\n`);
  const table=cases.map(item=>`| ${escape(item.name)} | ${item.phase} | ${item.pages.length} | ${item.facts} | ${item.planId??"—"} | [Expediente](dossiers/artist-${item.artistId}.md) |`);
  await write(join(root,"RESULTADOS.md"),[`# Fuentes primarias · campaña CRV`,"",`Corte de seguimiento: ${summary.generatedAt}. La campaña sigue en curso mientras haya casos pendientes.`,"",
    `Catálogo auditado: ${summary.catalogue.artists} artistas, ${summary.catalogue.persons} personas y ${summary.catalogue.albums} discos.`,"",
    `Investigación: ${summary.research.casesStarted} casos iniciados y ${summary.research.casesQueued} en cola, ${summary.research.capturedPages} páginas y ${summary.research.candidateFacts} hechos candidatos. ${summary.research.uncertainFacts} requieren revisión adicional.`,"",
    `Descubrimiento adicional: ${summary.discovery.cases} expedientes de búsqueda; ${summary.discovery.phases["sources_discovered"]??0} con fuentes candidatas. Una búsqueda sin resultados no demuestra que no exista una fuente oficial.`,"",
    `Propuestas: ${summary.proposals.operations} operaciones; ${summary.proposals.operationsWithPreviewError} errores de vista previa y ${summary.proposals.unresolved} pendientes. ${summary.proposals.accepted} operaciones aceptadas mediante este flujo.`,"",
    "| Proyecto | Estado | Páginas | Hechos candidatos | Propuesta | Evidencia |","| --- | --- | ---: | ---: | ---: | --- |",...table,"",
    "Cada JSON de caso conserva páginas, hashes, capturas, citas, incertidumbres, fallos y actividad de extracción. Los JSON de propuestas incluyen los valores anteriores y posteriores calculados por CRV. Los textos de biografías y operaciones son propuestas hasta ser revisados. Los expedientes completos pueden contener citas extensas para cotejo interno; no están autorizados para redistribución pública.","",summary.usageNote,"",summary.completionNote,""].join("\n"));
  process.stdout.write(`${JSON.stringify({output:root,...summary.research,discovery:summary.discovery,proposals:summary.proposals},null,2)}\n`);
}finally{await closeDb();}
