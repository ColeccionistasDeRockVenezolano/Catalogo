import {describe,it,expect} from "vitest";
import {corroborateNativeLayer,visibleTranscript} from "../../src/verification/documents/visibility.js";
import {Transcript} from "../../src/verification/documents/types.js";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import {fullSourceChunks} from "../../src/verification/research.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
import {evidenceFromPage} from "../../src/curation/ai/context.js";

describe("capas nativas no corroboradas de PDF",()=>{
 it("conserva el texto interno y sus posiciones pero impide usarlo como dato visible, cita o sugerencia",()=>{
  const transcript=new Transcript(),box={x:50,y:100,width:40,height:10,unit:"pt" as const};
  transcript.append("Grupo Actual · Disco Actual\n",{selector:"pdf:native-word",page:1,bbox:{...box,y:10,width:150}});
  transcript.append("ABC099 ",{selector:"pdf:native-word",page:1,bbox:box});
  transcript.append("ABC001 ",{selector:"pdf:native-word",page:1,bbox:box});
  transcript.append("Grupo Actual · Disco Actual\n",{selector:"pdf:ocr-word",page:1,bbox:{...box,y:10,width:150},confidence:95});
  transcript.append("ABC001 ",{selector:"pdf:ocr-word",page:1,bbox:box,confidence:95});
  const original=transcript.content;
  expect(corroborateNativeLayer(original,transcript.locations)).toBe(1);expect(transcript.content).toBe(original);
  expect(visibleTranscript(original,transcript.locations)).not.toContain("ABC099");expect(visibleTranscript(original,transcript.locations)).toContain("ABC001");
  const snapshot:VerificationSnapshot={kind:"album",id:1,name:"Disco Actual",identity:["Disco Actual","Grupo Actual"],units:[{key:"album.1.catalogId",area:"discography",label:"Edición",value:"ABC099",expected:["ABC099"],context:["Grupo Actual","Disco Actual"],issue:null}],sourceUrls:[],albums:[],catalogAlbums:[]};
  const page={url:"https://fuente.example/disco.pdf",title:"Disco Actual",content:original,contentHash:"fixture",fetchedAt:"2026-10-13T00:00:00Z",document:{captureId:1,rawHash:"fixture",format:"pdf" as const,method:"pdf_text+ocr",extractionVersion:2,complete:true,unreadParts:[],warnings:[],locations:transcript.locations,followLinks:[]}};
  const report=evaluateVerification(snapshot,[page],{findings:[{key:"album.1.catalogId",status:"confirmed",observed:"ABC099",reason:"Capa interna",evidence:[{source:0,quote:original}]}],discoveries:[{area:"discography",value:"ABC099",context:"Disco Actual",reason:"Capa interna",evidence:[{source:0,quote:original}]}]},true);
  expect(report.findings[0]).toMatchObject({status:"unverified",coverage:0});expect(report.suggestions).toEqual([]);
  expect(report.extractions?.every(item=>item.destination==="pending"&&item.evidence.every(citation=>!citation.valid))).toBe(true);
  expect(fullSourceChunks(page).join(" ")).not.toContain("ABC099");expect(page.content).toBe(original);
  const citations=evidenceFromPage(page,[],1);expect(citations.some(citation=>citation.quote.includes("ABC099"))).toBe(false);
  expect(citations.every(citation=>page.content.includes(citation.quote))).toBe(true);
 });
});
