import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {normalizePreservedState} from "../src/verification/preserved-state.js";
import {extractionDispositions} from "../src/verification/extraction-dispositions.js";
import type {ResearchState} from "../src/verification/research.js";
import type {VerificationReport,VerificationSnapshot} from "../src/verification/types.js";

const root=resolve(process.argv[2]??""),output=resolve(process.argv[3]??"reports/plan-20-de-20/etapa-2/normalized-copies",randomUUID());
const manifest=JSON.parse(await readFile(join(root,"manifest.json"),"utf8")) as {files:Array<{file:string;sha256:string;entityId:number;name:string}>};
await mkdir(output,{recursive:true});const results=[];
for(const item of manifest.files){
 const bytes=await readFile(join(root,item.file));if(createHash("sha256").update(bytes).digest("hex")!==item.sha256)throw Error(`La copia ${item.file} fue alterada.`);
 const copy=JSON.parse(bytes.toString("utf8")) as {report:VerificationReport;state:ResearchState},state=normalizePreservedState(copy.state,copy.report);
 const snapshot:VerificationSnapshot={kind:copy.report.kind,id:copy.report.entityId,name:copy.report.name,identity:[copy.report.name],units:copy.report.findings,sourceUrls:[],albums:[],catalogAlbums:[]};
 const extractions=extractionDispositions(snapshot,state.pages,state.proposal,copy.report.findings,copy.report.suggestions??[]);
 const originalCitations=[...copy.state.proposal.findings,...copy.state.proposal.discoveries].flatMap(claim=>claim.evidence.map(citation=>({url:copy.state.pages[citation.source]!.url,hash:copy.state.pages[citation.source]!.contentHash,quote:citation.quote})));
 const normalizedCitations=[...state.proposal.findings,...state.proposal.discoveries].flatMap(claim=>claim.evidence.map(citation=>({url:state.pages[citation.source]!.url,hash:state.pages[citation.source]!.contentHash,quote:citation.quote})));
 if(JSON.stringify(originalCitations)!==JSON.stringify(normalizedCitations))throw Error(`Se perdieron citas de ${item.name}.`);
 const value=JSON.stringify({originalFile:item.file,originalHash:item.sha256,state,extractions});await writeFile(join(output,item.file),value);
 results.push({name:item.name,entityId:item.entityId,pages:state.pages.length,normalizations:state.normalizations?.length??0,rawDiscoveries:state.proposal.discoveries.length,rawFindings:state.proposal.findings.length,retainedCitations:originalCitations.length,extractions:extractions.length,destinations:Object.fromEntries(["already_present","proposal","conflict","pending","discarded"].map(destination=>[destination,extractions.filter(item=>item.destination===destination).length])),sha256:createHash("sha256").update(value).digest("hex")});
}
await writeFile(join(output,"audit.json"),JSON.stringify({createdAt:new Date().toISOString(),sourceDirectory:root,modelCalls:0,scope:"Normalization, no-loss and destination audit of legacy assertions; no current-catalog re-evaluation or recall claimed",results},null,2));
process.stdout.write(`${JSON.stringify({output,results},null,2)}\n`);
